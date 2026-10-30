// Cadastro de empresas, login e aprovação de acesso pela Boxtech.
//
// Fluxo: a empresa se cadastra (cliente + usuário 'pendente') -> o SGI envia um e-mail ao
// aprovador (boxtech@boxtech.com.br) com um link assinado -> o aprovador confirma pelo link
// ou pelo painel de administração -> a empresa recebe um e-mail e passa a entrar no sistema.
const seg = require('./seguranca');

const COOKIE = 'sgi_sessao';
const emailValido = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const texto = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function registrarAcesso(app, db, { rota, rotaAsync, exigir, email, segredo, urlBase, aprovador, cookieSeguro }) {
  const tentativas = seg.limitador();

  const definirCookie = (res, token) => res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: cookieSeguro, maxAge: seg.DURACAO_SESSAO_MS, path: '/',
  });

  // Toda requisição: identifica o usuário pela sessão.
  app.use((req, res, next) => {
    req.usuario = seg.lerSessao(db, seg.lerCookie(req, COOKIE));
    next();
  });

  app.post('/api/cadastro', rotaAsync(async (req, res) => {
    const { empresa = {}, nome, senha } = req.body;
    const emailUsuario = texto(req.body.email).toLowerCase();
    exigir(texto(empresa.nome), 'Informe o nome da empresa');
    exigir(texto(nome), 'Informe o seu nome');
    exigir(emailValido(emailUsuario), 'Informe um e-mail válido');
    exigir(typeof senha === 'string' && senha.length >= 8 && senha.length <= 200, 'A senha deve ter pelo menos 8 caracteres');
    exigir(!empresa.porte || ['pequeno', 'medio', 'grande'].includes(empresa.porte), 'Porte inválido');
    exigir(!db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(emailUsuario), 'Já existe um cadastro com este e-mail');

    db.exec('BEGIN');
    let usuarioId;
    try {
      const clienteId = db.prepare('INSERT INTO clientes (nome, cnpj, segmento, porte, contato) VALUES (?, ?, ?, ?, ?)')
        .run(texto(empresa.nome), texto(empresa.cnpj, 30) || null, texto(empresa.segmento) || null, empresa.porte || null, `${texto(nome)} <${emailUsuario}>`)
        .lastInsertRowid;
      usuarioId = db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel, cliente_id) VALUES (?, ?, ?, 'empresa', ?)")
        .run(texto(nome), emailUsuario, seg.hashSenha(senha), clienteId).lastInsertRowid;
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    const link = `${urlBase}/#/aprovar/${seg.tokenAprovacao(segredo, usuarioId)}`;
    const linhas = [
      `Empresa: ${texto(empresa.nome)}`, `CNPJ: ${texto(empresa.cnpj, 30) || '–'}`, `Segmento: ${texto(empresa.segmento) || '–'}`,
      `Porte: ${empresa.porte || '–'}`, `Responsável: ${texto(nome)} <${emailUsuario}>`,
    ];
    await email.enviar({
      para: aprovador,
      assunto: `[SGI] Novo cadastro aguardando liberação: ${texto(empresa.nome)}`,
      texto: `Uma empresa se cadastrou no SGI Boxtech e aguarda a liberação do acesso.\n\n${linhas.join('\n')}\n\nPara liberar ou recusar, abra: ${link}\n(ou entre no SGI como administrador, em Aprovações)`,
      html: `<p>Uma empresa se cadastrou no SGI Boxtech e aguarda a liberação do acesso.</p><p>${linhas.map(escHtml).join('<br>')}</p><p><a href="${escHtml(link)}">Liberar ou recusar o acesso</a></p>`,
    }).catch((e) => console.error('Falha ao enviar e-mail ao aprovador:', e.message));

    res.status(201);
    return { mensagem: 'Cadastro recebido. Você receberá um e-mail quando o acesso for liberado pela Boxtech.' };
  }));

  app.post('/api/login', rota((req, res) => {
    const emailUsuario = texto(req.body.email).toLowerCase();
    const chave = `${req.ip}|${emailUsuario}`;
    exigir(!tentativas.bloqueado(chave), 'Muitas tentativas. Aguarde 15 minutos e tente de novo.', 429);
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(emailUsuario);
    const ok = u && typeof req.body.senha === 'string' && seg.conferirSenha(req.body.senha, u.senha_hash);
    if (!ok) {
      tentativas.falhou(chave);
      exigir(false, 'E-mail ou senha incorretos', 401);
    }
    exigir(u.status !== 'pendente', 'Seu cadastro ainda aguarda a liberação da Boxtech', 403);
    exigir(u.status === 'ativo', 'Seu acesso não está liberado. Fale com a Boxtech.', 403);
    tentativas.limpar(chave);
    definirCookie(res, seg.criarSessao(db, u.id));
    return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, cliente_id: u.cliente_id };
  }));

  app.post('/api/logout', rota((req, res) => {
    seg.encerrarSessao(db, seg.lerCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  }));

  app.get('/api/eu', rota((req) => {
    exigir(req.usuario, 'Faça login para continuar', 401);
    return req.usuario;
  }));

  // ---------- Aprovação ----------
  const pendente = (id) => {
    const u = db.prepare(`
      SELECT u.id, u.nome, u.email, u.status, u.criado_em, c.id AS cliente_id, c.nome AS empresa, c.cnpj, c.segmento, c.porte
      FROM usuarios u JOIN clientes c ON c.id = u.cliente_id WHERE u.id = ? AND u.papel = 'empresa'`).get(id);
    exigir(u, 'Cadastro não encontrado', 404);
    return u;
  };

  async function decidir(usuarioId, decisao, quem) {
    exigir(['aprovar', 'recusar'].includes(decisao), 'Decisão inválida');
    const u = pendente(usuarioId);
    exigir(u.status === 'pendente', `Este cadastro já foi ${u.status === 'ativo' ? 'liberado' : 'decidido'}`, 409);
    const novo = decisao === 'aprovar' ? 'ativo' : 'recusado';
    db.prepare("UPDATE usuarios SET status = ?, decidido_em = datetime('now'), decidido_por = ? WHERE id = ?").run(novo, quem, u.id);
    await email.enviar(novo === 'ativo'
      ? { para: u.email, assunto: 'Seu acesso ao SGI Boxtech foi liberado',
        texto: `Olá, ${u.nome}.\n\nO acesso da ${u.empresa} ao SGI Boxtech foi liberado. Entre em ${urlBase}/#/login com o seu e-mail e a senha cadastrada.\n\nEquipe Boxtech` }
      : { para: u.email, assunto: 'Cadastro no SGI Boxtech',
        texto: `Olá, ${u.nome}.\n\nNão foi possível liberar o acesso da ${u.empresa} ao SGI Boxtech. Para mais informações, responda a este e-mail ou fale com ${aprovador}.\n\nEquipe Boxtech` },
    ).catch((e) => console.error('Falha ao avisar a empresa:', e.message));
    return { ...pendente(u.id) };
  }

  // Link do e-mail: GET mostra o cadastro (sem decidir, para pré-visualizadores de e-mail não
  // aprovarem sozinhos); a decisão exige o POST do botão.
  app.get('/api/aprovacoes/:token', rota((req) => {
    const id = seg.lerTokenAprovacao(segredo, req.params.token);
    exigir(id, 'Link de aprovação inválido ou expirado', 404);
    return pendente(id);
  }));

  app.post('/api/aprovacoes/:token', rotaAsync(async (req) => {
    const id = seg.lerTokenAprovacao(segredo, req.params.token);
    exigir(id, 'Link de aprovação inválido ou expirado', 404);
    return decidir(id, req.body.decisao, aprovador);
  }));

  // Painel de administração
  const soAdmin = (req) => exigir(req.usuario?.papel === 'admin', 'Acesso restrito à Boxtech', 403);

  app.get('/api/admin/usuarios', rota((req) => {
    exigir(req.usuario, 'Faça login para continuar', 401);
    soAdmin(req);
    return db.prepare(`
      SELECT u.id, u.nome, u.email, u.papel, u.status, u.criado_em, u.decidido_em, u.decidido_por, c.nome AS empresa, c.cnpj
      FROM usuarios u LEFT JOIN clientes c ON c.id = u.cliente_id
      ORDER BY u.status = 'pendente' DESC, u.criado_em DESC`).all();
  }));

  app.post('/api/admin/usuarios/:id/:decisao', rotaAsync(async (req) => {
    exigir(req.usuario, 'Faça login para continuar', 401);
    soAdmin(req);
    const { decisao } = req.params;
    if (decisao === 'bloquear' || decisao === 'reativar') {
      const u = pendente(Number(req.params.id));
      db.prepare("UPDATE usuarios SET status = ?, decidido_em = datetime('now'), decidido_por = ? WHERE id = ?")
        .run(decisao === 'bloquear' ? 'bloqueado' : 'ativo', req.usuario.email, u.id);
      if (decisao === 'bloquear') db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
      return pendente(u.id);
    }
    return decidir(Number(req.params.id), decisao, req.usuario.email);
  }));
}

module.exports = { registrarAcesso };
