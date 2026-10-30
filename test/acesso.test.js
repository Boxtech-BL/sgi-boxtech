const test = require('node:test');
const assert = require('node:assert/strict');
const { abrir, garantirAdmin } = require('../src/db');
const { criarApp } = require('../src/app');
const { criarEmail } = require('../src/email');
const seg = require('../src/seguranca');

let servidor, base, email;

test.before(async () => {
  const db = abrir(':memory:');
  garantirAdmin(db, { email: 'boxtech@boxtech.com.br', senha: 'senha-admin-123' });
  email = criarEmail({ NODE_ENV: 'test' });
  servidor = criarApp(db, { email, segredo: 'segredo-de-teste', urlBase: 'https://sgi.exemplo' }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

async function req(metodo, url, corpo, cookie, extras = {}) {
  const r = await fetch(base + url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extras },
    body: corpo && JSON.stringify(corpo),
  });
  const cookieNovo = r.headers.get('set-cookie')?.split(';')[0];
  return { status: r.status, corpo: r.status === 204 ? null : await r.json(), cookie: cookieNovo };
}
const login = async (e, s) => (await req('POST', '/api/login', { email: e, senha: s })).cookie;

const cadastro = (nome, e) => req('POST', '/api/cadastro', {
  empresa: { nome, cnpj: '11.111.111/0001-11', porte: 'medio' }, nome: 'Fulano', email: e, senha: 'senha-forte-1',
});

test('senha: hash e conferência', () => {
  const h = seg.hashSenha('abc12345');
  assert.ok(seg.conferirSenha('abc12345', h));
  assert.ok(!seg.conferirSenha('errada', h));
  assert.ok(!h.includes('abc12345'));
});

test('token de aprovação: assinatura e validade', () => {
  const t = seg.tokenAprovacao('s', 42);
  assert.equal(seg.lerTokenAprovacao('s', t), 42);
  assert.equal(seg.lerTokenAprovacao('outro', t), null);
  assert.equal(seg.lerTokenAprovacao('s', t.replace(/^42/, '43')), null);
  assert.equal(seg.lerTokenAprovacao('s', seg.tokenAprovacao('s', 42, Date.now() - 31 * 864e5)), null);
});

test('sem login, a API recusa', async () => {
  assert.equal((await req('GET', '/api/clientes')).status, 401);
  assert.equal((await req('GET', '/api/catalogo')).status, 200);
});

test('cadastro fica pendente até a Boxtech liberar pelo link do e-mail', async () => {
  const r = await cadastro('Empresa A', 'ana@empresa-a.com');
  assert.equal(r.status, 201);

  // E-mail ao aprovador com o link
  const msg = email.enviados.at(-1);
  assert.equal(msg.para, 'boxtech@boxtech.com.br');
  assert.match(msg.assunto, /Empresa A/);
  const token = msg.texto.match(/#\/aprovar\/(\S+)/)[1];

  // Antes da liberação, não entra
  const antes = await req('POST', '/api/login', { email: 'ana@empresa-a.com', senha: 'senha-forte-1' });
  assert.equal(antes.status, 403);
  assert.match(antes.corpo.erro, /aguarda/);

  // Abrir o link só mostra os dados (não aprova)
  const ver = await req('GET', `/api/aprovacoes/${token}`);
  assert.equal(ver.corpo.empresa, 'Empresa A');
  assert.equal(ver.corpo.status, 'pendente');

  // Confirmar no botão libera e avisa a empresa
  const ok = await req('POST', `/api/aprovacoes/${token}`, { decisao: 'aprovar' });
  assert.equal(ok.corpo.status, 'ativo');
  assert.equal(email.enviados.at(-1).para, 'ana@empresa-a.com');
  assert.match(email.enviados.at(-1).assunto, /liberado/);

  // Link não pode ser reutilizado
  assert.equal((await req('POST', `/api/aprovacoes/${token}`, { decisao: 'recusar' })).status, 409);

  const cookie = await login('ana@empresa-a.com', 'senha-forte-1');
  assert.ok(cookie);
  const eu = await req('GET', '/api/eu', null, cookie);
  assert.equal(eu.corpo.papel, 'empresa');
});

test('e-mail repetido, senha curta e link falso são recusados', async () => {
  assert.equal((await cadastro('Outra', 'ana@empresa-a.com')).status, 400);
  assert.equal((await req('POST', '/api/cadastro', { empresa: { nome: 'X' }, nome: 'Y', email: 'y@x.com', senha: '123' })).status, 400);
  assert.equal((await req('GET', '/api/aprovacoes/1.9999999999999.falso')).status, 404);
});

test('cada empresa só vê os próprios dados', async () => {
  await cadastro('Empresa B', 'bia@empresa-b.com');
  const admin = await login('boxtech@boxtech.com.br', 'senha-admin-123');

  // Aprovação pelo painel
  const { corpo: usuarios } = await req('GET', '/api/admin/usuarios', null, admin);
  const bia = usuarios.find((u) => u.email === 'bia@empresa-b.com');
  assert.equal(bia.status, 'pendente');
  assert.equal((await req('POST', `/api/admin/usuarios/${bia.id}/aprovar`, {}, admin)).corpo.status, 'ativo');

  const ana = await login('ana@empresa-a.com', 'senha-forte-1');
  const biaC = await login('bia@empresa-b.com', 'senha-forte-1');

  const { corpo: listaAna } = await req('GET', '/api/clientes', null, ana);
  assert.deepEqual(listaAna.map((c) => c.nome), ['Empresa A']);
  const { corpo: listaAdmin } = await req('GET', '/api/clientes', null, admin);
  assert.equal(listaAdmin.length, 2);

  const idB = (await req('GET', '/api/clientes', null, biaC)).corpo[0].id;
  assert.equal((await req('GET', `/api/clientes/${idB}`, null, ana)).status, 404);
  assert.equal((await req('GET', `/api/clientes/${idB}/avaliacoes`, null, ana)).status, 404);

  // Empresa faz autoavaliação, mas não conclui; consultor conclui
  const { corpo: av } = await req('POST', `/api/clientes/${idB}/avaliacoes`, { tipo: 'inicial' }, biaC);
  assert.equal((await req('GET', `/api/avaliacoes/${av.id}`, null, ana)).status, 404);
  assert.equal((await req('PUT', `/api/avaliacoes/${av.id}`, { itens: [{ pratica_id: 'incidente', nivel: 2, meta: 3 }] }, biaC)).status, 200);
  assert.equal((await req('PUT', `/api/avaliacoes/${av.id}`, { status: 'concluida' }, biaC)).status, 403);

  // Empresa não cria cliente nem altera projeto
  assert.equal((await req('POST', '/api/clientes', { nome: 'Z' }, biaC)).status, 403);
  const { corpo: proj } = await req('POST', `/api/clientes/${idB}/projetos`, { nome: 'P' }, admin);
  assert.equal((await req('GET', `/api/projetos/${proj.id}`, null, biaC)).status, 200);
  assert.equal((await req('PUT', `/api/projetos/${proj.id}/fases/1`, { status: 'em_andamento' }, biaC)).status, 403);
  assert.equal((await req('GET', `/api/projetos/${proj.id}`, null, ana)).status, 404);

  // Empresa não acessa o painel
  assert.equal((await req('GET', '/api/admin/usuarios', null, biaC)).status, 403);

  // Bloqueio derruba a sessão
  await req('POST', `/api/admin/usuarios/${bia.id}/bloquear`, {}, admin);
  assert.equal((await req('GET', '/api/eu', null, biaC)).status, 401);
});

test('recusa avisa a empresa e impede o login', async () => {
  await cadastro('Empresa C', 'caio@empresa-c.com');
  const token = email.enviados.at(-1).texto.match(/#\/aprovar\/(\S+)/)[1];
  await req('POST', `/api/aprovacoes/${token}`, { decisao: 'recusar' });
  assert.match(email.enviados.at(-1).assunto, /Cadastro/);
  assert.equal((await req('POST', '/api/login', { email: 'caio@empresa-c.com', senha: 'senha-forte-1' })).status, 403);
});

test('proteções: senha errada, origem estranha e excesso de tentativas', async () => {
  assert.equal((await req('POST', '/api/login', { email: 'boxtech@boxtech.com.br', senha: 'x' })).status, 401);
  assert.equal((await req('POST', '/api/login', { email: 'a@b.c', senha: 'x' }, null, { origin: 'https://malicioso.exemplo' })).status, 403);
  for (let i = 0; i < 10; i++) await req('POST', '/api/login', { email: 'alvo@x.com', senha: 'x' });
  assert.equal((await req('POST', '/api/login', { email: 'alvo@x.com', senha: 'x' })).status, 429);
});
