const path = require('node:path');
const express = require('express');
const catalogo = require('./catalogo');
const { calcularNotas, comparar } = require('./maturidade');
const { criarEstruturaProjeto } = require('./db');
const { registrarAcesso } = require('./acesso');

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const exigir = (cond, mensagem, status = 400) => {
  if (!cond) throw new ErroHttp(status, mensagem);
};

// Express 4 não captura erros de handlers síncronos lançados fora do fluxo; este wrapper garante.
const rota = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res);
    if (r !== undefined) res.json(r);
  } catch (e) {
    next(e);
  }
};

const rotaAsync = (fn) => (req, res, next) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((r) => { if (r !== undefined) res.json(r); })
    .catch(next);
};

const nivelValido = (n) => n == null || (Number.isInteger(n) && n >= 1 && n <= 5);

// opcoes: email (de ./email), segredo (assina os links de aprovação), urlBase (endereço público),
// aprovador (quem libera os cadastros), cookieSeguro (true em produção, com HTTPS).
function criarApp(db, opcoes = {}) {
  const {
    email, segredo, urlBase = 'http://localhost:3000', aprovador = 'boxtech@boxtech.com.br', cookieSeguro = false,
  } = opcoes;
  exigir(email && segredo, 'criarApp precisa de email e segredo', 500);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do proxy do site (nginx), para req.ip e cookies seguros

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });

  // Proteção contra CSRF: escrita só com JSON e, se o navegador mandar Origin, do mesmo site.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origem = req.get('origin');
    let mesmoSite = true;
    try { mesmoSite = !origem || new URL(origem).host === req.get('host'); } catch { mesmoSite = false; }
    if (!mesmoSite) return res.status(403).json({ erro: 'Origem não permitida' });
    if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ erro: 'Envie JSON' });
    next();
  });

  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/catalogo', rota(() => catalogo));
  registrarAcesso(app, db, { rota, rotaAsync, exigir, email, segredo, urlBase, aprovador, cookieSeguro });

  // Daqui para baixo, tudo exige login.
  app.use('/api', (req, res, next) => (req.usuario ? next() : res.status(401).json({ erro: 'Faça login para continuar' })));

  const ehAdmin = (req) => req.usuario.papel === 'admin';
  const soAdmin = (req) => exigir(ehAdmin(req), 'Acesso restrito à Boxtech', 403);
  // Usuário de empresa só enxerga o próprio cliente; para os outros, o registro "não existe".
  const doCliente = (req, clienteId) => exigir(ehAdmin(req) || req.usuario.cliente_id === Number(clienteId), 'Registro não encontrado', 404);

  const buscar = (tabela, id) => {
    const linha = db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(Number(id));
    exigir(linha, 'Registro não encontrado', 404);
    return linha;
  };

  // ---------- Clientes ----------
  app.get('/api/clientes', rota((req) =>
    db.prepare(`
      SELECT c.*,
        (SELECT a.id FROM avaliacoes a WHERE a.cliente_id = c.id ORDER BY a.data DESC, a.id DESC LIMIT 1) AS ultima_avaliacao_id,
        (SELECT COUNT(*) FROM projetos p WHERE p.cliente_id = c.id AND p.status = 'ativo') AS projetos_ativos,
        (SELECT u.status FROM usuarios u WHERE u.cliente_id = c.id ORDER BY u.id LIMIT 1) AS acesso
      FROM clientes c
      WHERE ? OR c.id = ?
      ORDER BY c.nome`).all(ehAdmin(req) ? 1 : 0, req.usuario.cliente_id ?? -1)
      .map((c) => ({ ...c, nota_atual: c.ultima_avaliacao_id ? notasDaAvaliacao(c.ultima_avaliacao_id).geral : null }))
  ));

  app.post('/api/clientes', rota((req, res) => {
    soAdmin(req);
    const { nome, cnpj, segmento, porte, contato } = req.body;
    exigir(nome && nome.trim(), 'Informe o nome do cliente');
    const r = db.prepare('INSERT INTO clientes (nome, cnpj, segmento, porte, contato) VALUES (?, ?, ?, ?, ?)')
      .run(nome.trim(), cnpj ?? null, segmento ?? null, porte ?? null, contato ?? null);
    res.status(201);
    return buscar('clientes', r.lastInsertRowid);
  }));

  app.get('/api/clientes/:id', rota((req) => {
    doCliente(req, req.params.id);
    return buscar('clientes', req.params.id);
  }));

  app.put('/api/clientes/:id', rota((req) => {
    doCliente(req, req.params.id);
    const c = buscar('clientes', req.params.id);
    const d = { ...c, ...req.body };
    exigir(d.nome && String(d.nome).trim(), 'Informe o nome do cliente');
    db.prepare('UPDATE clientes SET nome = ?, cnpj = ?, segmento = ?, porte = ?, contato = ? WHERE id = ?')
      .run(d.nome, d.cnpj, d.segmento, d.porte, d.contato, c.id);
    return buscar('clientes', c.id);
  }));

  app.delete('/api/clientes/:id', rota((req, res) => {
    soAdmin(req);
    buscar('clientes', req.params.id);
    db.prepare('DELETE FROM clientes WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  }));

  // ---------- Avaliações de maturidade ----------
  const itensDa = (avaliacaoId) =>
    db.prepare('SELECT * FROM avaliacao_itens WHERE avaliacao_id = ?').all(avaliacaoId);

  function notasDaAvaliacao(id) {
    const a = buscar('avaliacoes', id);
    return calcularNotas(itensDa(a.id), JSON.parse(a.pesos));
  }

  function avaliacaoCompleta(id) {
    const a = buscar('avaliacoes', id);
    const itens = itensDa(a.id);
    const anterior = db.prepare(`
      SELECT * FROM avaliacoes WHERE cliente_id = ? AND id <> ? AND status = 'concluida'
        AND (data < ? OR (data = ? AND id < ?))
      ORDER BY data DESC, id DESC LIMIT 1`).get(a.cliente_id, a.id, a.data, a.data, a.id);
    return {
      ...a,
      pesos: JSON.parse(a.pesos),
      cliente: buscar('clientes', a.cliente_id),
      itens,
      resultado: calcularNotas(itens, JSON.parse(a.pesos)),
      anterior: anterior ? { id: anterior.id, data: anterior.data, tipo: anterior.tipo, comparacao: comparar(itensDa(anterior.id), itens) } : null,
    };
  }

  app.get('/api/clientes/:id/avaliacoes', rota((req) => {
    doCliente(req, req.params.id);
    buscar('clientes', req.params.id);
    return db.prepare('SELECT * FROM avaliacoes WHERE cliente_id = ? ORDER BY data DESC, id DESC')
      .all(Number(req.params.id))
      .map((a) => ({ ...a, pesos: JSON.parse(a.pesos), geral: notasDaAvaliacao(a.id).geral }));
  }));

  app.post('/api/clientes/:id/avaliacoes', rota((req, res) => {
    doCliente(req, req.params.id);
    const cliente = buscar('clientes', req.params.id);
    const { tipo = 'inicial', data = new Date().toISOString().slice(0, 10), consultor = null } = req.body;
    exigir(catalogo.tiposAvaliacao.some((t) => t.id === tipo), 'Tipo de avaliação inválido');
    const r = db.prepare('INSERT INTO avaliacoes (cliente_id, tipo, data, consultor) VALUES (?, ?, ?, ?)')
      .run(cliente.id, tipo, data, consultor);
    // Já cria uma linha por prática com a meta sugerida, para o questionário vir pronto.
    const ins = db.prepare('INSERT INTO avaliacao_itens (avaliacao_id, pratica_id, meta) VALUES (?, ?, ?)');
    for (const p of catalogo.praticas) ins.run(r.lastInsertRowid, p.id, catalogo.metaSugerida(p.id, tipo));
    res.status(201);
    return avaliacaoCompleta(r.lastInsertRowid);
  }));

  const avaliacaoDoUsuario = (req) => {
    const a = buscar('avaliacoes', req.params.id);
    doCliente(req, a.cliente_id);
    return a;
  };

  app.get('/api/avaliacoes/:id', rota((req) => avaliacaoCompleta(avaliacaoDoUsuario(req).id)));

  app.put('/api/avaliacoes/:id', rota((req) => {
    const a = avaliacaoDoUsuario(req);
    const { data, consultor, observacoes, pesos, status, itens } = req.body;
    // A empresa preenche a autoavaliação; concluir (ou mexer numa concluída) é do consultor Boxtech.
    if (!ehAdmin(req)) {
      exigir(a.status === 'rascunho' && (status ?? 'rascunho') === 'rascunho', 'Só o consultor da Boxtech pode concluir ou reabrir a avaliação', 403);
    }

    if (pesos) {
      exigir(Object.entries(pesos).every(([k, v]) => catalogo.areas.some((x) => x.id === k) && Number(v) > 0),
        'Pesos inválidos');
    }

    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE avaliacoes SET data = ?, consultor = ?, observacoes = ?, pesos = ?, status = ? WHERE id = ?`).run(
        data ?? a.data, consultor ?? a.consultor, observacoes ?? a.observacoes,
        pesos ? JSON.stringify(pesos) : a.pesos, status ?? a.status, a.id);
      if (Array.isArray(itens)) {
        const up = db.prepare(`
          INSERT INTO avaliacao_itens (avaliacao_id, pratica_id, nivel, meta, evidencias, observacoes)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (avaliacao_id, pratica_id) DO UPDATE SET
            nivel = excluded.nivel, meta = excluded.meta, evidencias = excluded.evidencias, observacoes = excluded.observacoes`);
        for (const i of itens) {
          exigir(catalogo.praticas.some((p) => p.id === i.pratica_id), `Prática desconhecida: ${i.pratica_id}`);
          exigir(nivelValido(i.nivel) && nivelValido(i.meta), 'Nível e meta devem ser inteiros de 1 a 5');
          up.run(a.id, i.pratica_id, i.nivel ?? null, i.meta ?? null, i.evidencias ?? null, i.observacoes ?? null);
        }
      }
      if (status === 'concluida') {
        exigir(calcularNotas(itensDa(a.id)).completa, 'Para concluir, atribua o nível de todas as práticas');
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return avaliacaoCompleta(a.id);
  }));

  app.delete('/api/avaliacoes/:id', rota((req, res) => {
    soAdmin(req);
    buscar('avaliacoes', req.params.id);
    db.prepare('DELETE FROM avaliacoes WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  }));

  // ---------- Projetos de implantação (fases PMBOK e ondas ITIL) ----------
  function projetoCompleto(id) {
    const p = buscar('projetos', id);
    const fases = db.prepare('SELECT * FROM projeto_fases WHERE projeto_id = ? ORDER BY fase_id').all(p.id)
      .map((f) => ({ ...catalogo.fases.find((x) => x.id === f.fase_id), ...f }));
    const ondas = db.prepare('SELECT * FROM projeto_ondas WHERE projeto_id = ? ORDER BY onda_id').all(p.id)
      .map((o) => ({ ...catalogo.ondas.find((x) => x.id === o.onda_id), ...o, praticas: JSON.parse(o.praticas) }));
    const concluidas = fases.filter((f) => f.status === 'concluida').length;
    return { ...p, fases, ondas, progresso: Math.round((concluidas / fases.length) * 100) };
  }

  app.get('/api/clientes/:id/projetos', rota((req) => {
    doCliente(req, req.params.id);
    buscar('clientes', req.params.id);
    return db.prepare('SELECT id FROM projetos WHERE cliente_id = ? ORDER BY id DESC')
      .all(Number(req.params.id)).map((p) => projetoCompleto(p.id));
  }));

  app.post('/api/clientes/:id/projetos', rota((req, res) => {
    soAdmin(req);
    const cliente = buscar('clientes', req.params.id);
    const { nome, patrocinador = null, ponto_focal = null, gerente = null, inicio = null } = req.body;
    exigir(nome && nome.trim(), 'Informe o nome do projeto');
    db.exec('BEGIN');
    let id;
    try {
      id = db.prepare('INSERT INTO projetos (cliente_id, nome, patrocinador, ponto_focal, gerente, inicio) VALUES (?, ?, ?, ?, ?, ?)')
        .run(cliente.id, nome.trim(), patrocinador, ponto_focal, gerente, inicio).lastInsertRowid;
      criarEstruturaProjeto(db, id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.status(201);
    return projetoCompleto(id);
  }));

  app.get('/api/projetos/:id', rota((req) => {
    doCliente(req, buscar('projetos', req.params.id).cliente_id);
    return projetoCompleto(req.params.id);
  }));
  // Projeto é conduzido pela Boxtech: a empresa acompanha, não altera.
  app.use('/api/projetos', (req, res, next) => (req.method === 'GET' || ehAdmin(req) ? next() : res.status(403).json({ erro: 'Acesso restrito à Boxtech' })));

  app.put('/api/projetos/:id', rota((req) => {
    const p = buscar('projetos', req.params.id);
    const d = { ...p, ...req.body };
    db.prepare('UPDATE projetos SET nome = ?, patrocinador = ?, ponto_focal = ?, gerente = ?, inicio = ?, status = ? WHERE id = ?')
      .run(d.nome, d.patrocinador, d.ponto_focal, d.gerente, d.inicio, d.status, p.id);
    return projetoCompleto(p.id);
  }));

  app.put('/api/projetos/:id/fases/:fase', rota((req) => {
    const p = buscar('projetos', req.params.id);
    const faseId = Number(req.params.fase);
    const f = db.prepare('SELECT * FROM projeto_fases WHERE projeto_id = ? AND fase_id = ?').get(p.id, faseId);
    exigir(f, 'Fase não encontrada', 404);
    const { status = f.status, portao_aprovado_em = f.portao_aprovado_em, observacoes = f.observacoes } = req.body;
    // Portão: a fase só é concluída com aprovação registrada (a Fase 4 não tem portão).
    const temPortao = catalogo.fases.find((x) => x.id === faseId).portao;
    exigir(status !== 'concluida' || !temPortao || portao_aprovado_em, 'Registre a data de aprovação do portão para concluir a fase');
    db.prepare('UPDATE projeto_fases SET status = ?, portao_aprovado_em = ?, observacoes = ? WHERE projeto_id = ? AND fase_id = ?')
      .run(status, portao_aprovado_em, observacoes, p.id, faseId);
    return projetoCompleto(p.id);
  }));

  app.put('/api/projetos/:id/ondas/:onda', rota((req) => {
    const p = buscar('projetos', req.params.id);
    const ondaId = Number(req.params.onda);
    const o = db.prepare('SELECT * FROM projeto_ondas WHERE projeto_id = ? AND onda_id = ?').get(p.id, ondaId);
    exigir(o, 'Onda não encontrada', 404);
    const { status = o.status, aceite_em = o.aceite_em } = req.body;
    const pr = req.body.praticas ?? JSON.parse(o.praticas);
    exigir(pr.every((id) => catalogo.praticas.some((x) => x.id === id)), 'Prática desconhecida');
    exigir(status !== 'aceita' || aceite_em, 'Registre a data do termo de aceite da onda');
    if (status !== 'nao_iniciada' && ondaId > 1) {
      const ant = db.prepare('SELECT status FROM projeto_ondas WHERE projeto_id = ? AND onda_id = ?').get(p.id, ondaId - 1);
      exigir(ant.status === 'aceita', 'Cada onda só começa quando a anterior foi aceita pelo cliente');
    }
    db.prepare('UPDATE projeto_ondas SET status = ?, aceite_em = ?, praticas = ? WHERE projeto_id = ? AND onda_id = ?')
      .run(status, aceite_em, JSON.stringify(pr), p.id, ondaId);
    return projetoCompleto(p.id);
  }));

  app.delete('/api/projetos/:id', rota((req, res) => {
    buscar('projetos', req.params.id);
    db.prepare('DELETE FROM projetos WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  }));

  // ---------- Indicadores ----------
  app.get('/api/clientes/:id/indicadores', rota((req) => {
    doCliente(req, req.params.id);
    buscar('clientes', req.params.id);
    const medicoes = db.prepare('SELECT * FROM medicoes WHERE cliente_id = ? ORDER BY periodo').all(Number(req.params.id));
    return catalogo.indicadores.map((ind) => {
      const m = medicoes.filter((x) => x.indicador_id === ind.id);
      const base = m.find((x) => x.linha_base) ?? null;
      const ultima = m.length ? m[m.length - 1] : null;
      let evolucao = null;
      if (base && ultima && ultima.id !== base.id) {
        const delta = ultima.valor - base.valor;
        evolucao = { delta: arred2(delta), melhorou: ind.sentido === 'maior' ? delta > 0 : delta < 0 };
      }
      return { ...ind, medicoes: m, linha_base: base, ultima, evolucao };
    });
  }));

  app.post('/api/clientes/:id/medicoes', rota((req, res) => {
    doCliente(req, req.params.id);
    const cliente = buscar('clientes', req.params.id);
    const { indicador_id, periodo, valor, linha_base = false, observacoes = null } = req.body;
    exigir(catalogo.indicadores.some((i) => i.id === indicador_id), 'Indicador desconhecido');
    exigir(/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo ?? ''), 'Período deve estar no formato AAAA-MM');
    exigir(typeof valor === 'number' && Number.isFinite(valor), 'Valor deve ser numérico');
    if (linha_base) {
      db.prepare('UPDATE medicoes SET linha_base = 0 WHERE cliente_id = ? AND indicador_id = ?').run(cliente.id, indicador_id);
    }
    db.prepare(`
      INSERT INTO medicoes (cliente_id, indicador_id, periodo, valor, linha_base, observacoes) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (cliente_id, indicador_id, periodo) DO UPDATE SET valor = excluded.valor, linha_base = excluded.linha_base, observacoes = excluded.observacoes`)
      .run(cliente.id, indicador_id, periodo, valor, linha_base ? 1 : 0, observacoes);
    res.status(201);
    return db.prepare('SELECT * FROM medicoes WHERE cliente_id = ? AND indicador_id = ? AND periodo = ?').get(cliente.id, indicador_id, periodo);
  }));

  app.delete('/api/medicoes/:id', rota((req, res) => {
    doCliente(req, buscar('medicoes', req.params.id).cliente_id);
    db.prepare('DELETE FROM medicoes WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  }));

  // ---------- Erros ----------
  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    if (String(err.code).startsWith('ERR_SQLITE')) return res.status(400).json({ erro: err.message });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno' });
  });

  return app;
}

const arred2 = (n) => Math.round(n * 100) / 100;

module.exports = { criarApp };
