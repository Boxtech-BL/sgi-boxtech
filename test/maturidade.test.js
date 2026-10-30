const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularNotas, comparar } = require('../src/maturidade');
const { praticas } = require('../src/catalogo');

const todas = (nivel, meta = 3) => praticas.map((p) => ({ pratica_id: p.id, nivel, meta }));

test('nota geral é a média das áreas com uma casa decimal', () => {
  const itens = todas(2);
  // Atendimento (3 práticas): 1, 2, 3 -> 2,0; demais áreas 2 -> geral 2,0
  itens.find((i) => i.pratica_id === 'central-servico').nivel = 1;
  itens.find((i) => i.pratica_id === 'requisicao').nivel = 3;
  const r = calcularNotas(itens);
  assert.equal(r.areas.find((a) => a.area === 'atendimento').nota, 2);
  assert.equal(r.geral, 2);
  assert.equal(r.completa, true);
});

test('média da área arredonda para uma casa', () => {
  const itens = todas(2);
  itens.find((i) => i.pratica_id === 'continuidade').nivel = 3; // segurança: 2,3,2 -> 2,3
  const r = calcularNotas(itens);
  assert.equal(r.areas.find((a) => a.area === 'seguranca').nota, 2.3);
});

test('pesos alteram a nota geral', () => {
  const itens = todas(2);
  for (const id of ['seguranca-informacao', 'continuidade', 'monitoramento']) itens.find((i) => i.pratica_id === id).nivel = 4;
  assert.equal(calcularNotas(itens).geral, 2.4); // (2+2+2+4+2)/5
  assert.equal(calcularNotas(itens, { seguranca: 2 }).geral, 2.7); // (2*4+4*2)/6 = 2,67
});

test('práticas sem nível ficam fora da média e marcam a avaliação como incompleta', () => {
  const r = calcularNotas([{ pratica_id: 'incidente', nivel: 4, meta: 3 }]);
  assert.equal(r.geral, 4);
  assert.equal(r.completa, false);
  assert.equal(r.areas.find((a) => a.area === 'controle').nota, null);
});

test('lacunas ordenadas pela maior distância da meta, empate pela onda mais básica', () => {
  const itens = todas(3);
  itens.find((i) => i.pratica_id === 'problema').nivel = 1; // lacuna 2, onda 3
  itens.find((i) => i.pratica_id === 'ativos').nivel = 1; // lacuna 2, onda 1
  itens.find((i) => i.pratica_id === 'mudanca').nivel = 2; // lacuna 1
  const r = calcularNotas(itens);
  assert.deepEqual(r.criticas.map((l) => l.pratica), ['ativos', 'problema', 'mudanca']);
});

test('sem avaliações, nota é nula', () => {
  assert.equal(calcularNotas([]).geral, null);
});

test('comparar calcula a variação por prática', () => {
  const c = comparar([{ pratica_id: 'incidente', nivel: 1 }], [{ pratica_id: 'incidente', nivel: 3 }]);
  assert.equal(c.find((x) => x.pratica === 'incidente').variacao, 2);
  assert.equal(c.find((x) => x.pratica === 'ativos').variacao, null);
});
