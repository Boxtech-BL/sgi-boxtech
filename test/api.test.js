const test = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { criarApp } = require('../src/app');
const { praticas } = require('../src/catalogo');

let servidor, base;

test.before(async () => {
  servidor = criarApp(abrir(':memory:')).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

async function req(metodo, url, corpo) {
  const r = await fetch(base + url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo && JSON.stringify(corpo) });
  return { status: r.status, corpo: r.status === 204 ? null : await r.json() };
}

test('fluxo completo: cliente, avaliação, projeto e indicadores', async () => {
  const { status, corpo: cliente } = await req('POST', '/api/clientes', { nome: 'Clínica Exemplo', segmento: 'saúde', porte: 'medio' });
  assert.equal(status, 201);

  // Avaliação nasce com as 15 práticas e meta sugerida 3
  const { corpo: av } = await req('POST', `/api/clientes/${cliente.id}/avaliacoes`, { tipo: 'inicial', data: '2026-11-03' });
  assert.equal(av.itens.length, praticas.length);
  assert.ok(av.itens.every((i) => i.meta === 3));

  // Não conclui com práticas sem nível
  const incompleta = await req('PUT', `/api/avaliacoes/${av.id}`, { status: 'concluida', itens: [{ pratica_id: 'incidente', nivel: 2, meta: 3 }] });
  assert.equal(incompleta.status, 400);

  // Preenche tudo com nível 2 e peso 2 em segurança
  const itens = praticas.map((p) => ({ pratica_id: p.id, nivel: p.area === 'seguranca' ? 1 : 2, meta: 3 }));
  const { status: s2, corpo: concluida } = await req('PUT', `/api/avaliacoes/${av.id}`, { status: 'concluida', pesos: { seguranca: 2 }, itens });
  assert.equal(s2, 200);
  assert.equal(concluida.status, 'concluida');
  assert.equal(concluida.resultado.geral, 1.7); // (2*4 + 1*2) / 6
  assert.equal(concluida.resultado.criticas[0].area, 'seguranca');

  // Nível inválido é recusado
  const invalido = await req('PUT', `/api/avaliacoes/${av.id}`, { itens: [{ pratica_id: 'incidente', nivel: 7 }] });
  assert.equal(invalido.status, 400);

  // Segunda avaliação compara com a anterior concluída
  const { corpo: av2 } = await req('POST', `/api/clientes/${cliente.id}/avaliacoes`, { tipo: 'encerramento', data: '2027-06-01' });
  const { corpo: av2b } = await req('PUT', `/api/avaliacoes/${av2.id}`, { itens: [{ pratica_id: 'incidente', nivel: 3, meta: 3 }] });
  assert.equal(av2b.anterior.id, av.id);
  assert.equal(av2b.anterior.comparacao.find((c) => c.pratica === 'incidente').variacao, 1);

  // Lista de clientes mostra a nota da avaliação mais recente
  const { corpo: lista } = await req('GET', '/api/clientes');
  assert.equal(lista[0].nota_atual, 3);

  // Projeto nasce com 5 fases e 3 ondas
  const { corpo: proj } = await req('POST', `/api/clientes/${cliente.id}/projetos`, { nome: 'Implantação 2026' });
  assert.equal(proj.fases.length, 5);
  assert.deepEqual(proj.ondas[0].praticas, ['central-servico', 'incidente', 'requisicao', 'ativos']);

  // Portão exige data de aprovação
  assert.equal((await req('PUT', `/api/projetos/${proj.id}/fases/1`, { status: 'concluida' })).status, 400);
  const { corpo: proj2 } = await req('PUT', `/api/projetos/${proj.id}/fases/1`, { status: 'concluida', portao_aprovado_em: '2026-11-10' });
  assert.equal(proj2.progresso, 20);

  // Onda 2 só começa depois do aceite da onda 1
  assert.equal((await req('PUT', `/api/projetos/${proj.id}/ondas/2`, { status: 'desenho' })).status, 400);
  assert.equal((await req('PUT', `/api/projetos/${proj.id}/ondas/1`, { status: 'aceita' })).status, 400);
  await req('PUT', `/api/projetos/${proj.id}/ondas/1`, { status: 'aceita', aceite_em: '2027-02-01' });
  assert.equal((await req('PUT', `/api/projetos/${proj.id}/ondas/2`, { status: 'desenho' })).status, 200);

  // Indicadores: linha de base e evolução respeitando o sentido
  await req('POST', `/api/clientes/${cliente.id}/medicoes`, { indicador_id: 'mttr', periodo: '2026-11', valor: 20, linha_base: true });
  await req('POST', `/api/clientes/${cliente.id}/medicoes`, { indicador_id: 'mttr', periodo: '2027-03', valor: 12 });
  const { corpo: inds } = await req('GET', `/api/clientes/${cliente.id}/indicadores`);
  const mttr = inds.find((i) => i.id === 'mttr');
  assert.deepEqual(mttr.evolucao, { delta: -8, melhorou: true });
  assert.equal((await req('POST', `/api/clientes/${cliente.id}/medicoes`, { indicador_id: 'mttr', periodo: '2027-13', valor: 1 })).status, 400);

  // Excluir cliente apaga tudo em cascata
  assert.equal((await req('DELETE', `/api/clientes/${cliente.id}`)).status, 204);
  assert.equal((await req('GET', `/api/avaliacoes/${av.id}`)).status, 404);
});

test('validações básicas', async () => {
  assert.equal((await req('POST', '/api/clientes', {})).status, 400);
  assert.equal((await req('GET', '/api/clientes/999')).status, 404);
  assert.equal((await req('GET', '/api/nada')).status, 404);
});
