// Regras de pontuação da avaliação de maturidade.
// - Nota da área = média das práticas avaliadas da área.
// - Nota geral = média das áreas (ponderada pelos pesos, padrão 1), com uma casa decimal.
// - Lacuna = meta - nível; as 3 maiores vão para o resumo executivo.
const { areas, praticas } = require('./catalogo');

const arred = (n) => Math.round(n * 10) / 10;

function calcularNotas(itens, pesos = {}) {
  const porPratica = new Map(itens.map((i) => [i.pratica_id, i]));

  const notasAreas = areas.map((area) => {
    const niveis = praticas
      .filter((p) => p.area === area.id)
      .map((p) => porPratica.get(p.id))
      .filter((i) => i && i.nivel != null)
      .map((i) => i.nivel);
    const nota = niveis.length ? arred(niveis.reduce((a, b) => a + b, 0) / niveis.length) : null;
    return { area: area.id, nome: area.nome, nota, peso: Number(pesos[area.id]) || 1, avaliadas: niveis.length };
  });

  const comNota = notasAreas.filter((a) => a.nota != null);
  const somaPesos = comNota.reduce((s, a) => s + a.peso, 0);
  const geral = somaPesos ? arred(comNota.reduce((s, a) => s + a.nota * a.peso, 0) / somaPesos) : null;

  const lacunas = praticas
    .map((p) => {
      const i = porPratica.get(p.id);
      if (!i || i.nivel == null || i.meta == null) return null;
      return { pratica: p.id, nome: p.nome, area: p.area, onda: p.onda, nivel: i.nivel, meta: i.meta, lacuna: i.meta - i.nivel };
    })
    .filter((l) => l && l.lacuna > 0)
    // Maior lacuna primeiro; no empate, a prática de onda mais básica.
    .sort((a, b) => b.lacuna - a.lacuna || (a.onda ?? 0) - (b.onda ?? 0));

  return {
    geral,
    areas: notasAreas,
    lacunas,
    criticas: lacunas.slice(0, 3),
    completa: praticas.every((p) => porPratica.get(p.id)?.nivel != null),
  };
}

// Compara duas avaliações (ex.: inicial x encerramento) prática a prática.
function comparar(anteriores, atuais) {
  const ant = new Map(anteriores.map((i) => [i.pratica_id, i.nivel]));
  return praticas.map((p) => {
    const atual = atuais.find((i) => i.pratica_id === p.id)?.nivel ?? null;
    const anterior = ant.get(p.id) ?? null;
    return { pratica: p.id, nome: p.nome, anterior, atual, variacao: atual != null && anterior != null ? atual - anterior : null };
  });
}

module.exports = { calcularNotas, comparar };
