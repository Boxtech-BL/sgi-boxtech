// Popula o banco com um cliente de exemplo para demonstração: `npm run demo`.
const { abrir, criarEstruturaProjeto } = require('../src/db');
const { praticas } = require('../src/catalogo');

const db = abrir();
const cliente = db.prepare("INSERT INTO clientes (nome, cnpj, segmento, porte, contato) VALUES ('Clínica Vida (exemplo)', '00.000.000/0001-00', 'saúde', 'medio', 'TI: ponto focal')").run().lastInsertRowid;

const niveisIniciais = { 'central-servico': 2, incidente: 2, requisicao: 1, ativos: 1, configuracao: 1, mudanca: 1, 'nivel-servico': 1, fornecedores: 2, 'seguranca-informacao': 2, continuidade: 1, monitoramento: 2, problema: 1, conhecimento: 1, 'melhoria-continua': 1, projetos: 2 };
const av = db.prepare("INSERT INTO avaliacoes (cliente_id, tipo, data, status, consultor, pesos) VALUES (?, 'inicial', '2026-11-03', 'concluida', 'Consultor ITIL Boxtech', ?)")
  .run(cliente, JSON.stringify({ seguranca: 2 })).lastInsertRowid;
const ins = db.prepare('INSERT INTO avaliacao_itens (avaliacao_id, pratica_id, nivel, meta, observacoes) VALUES (?, ?, ?, 3, ?)');
for (const p of praticas) ins.run(av, p.id, niveisIniciais[p.id], niveisIniciais[p.id] === 1 ? 'Sem registro ou processo; prioridade no mapa de ondas.' : null);

const proj = db.prepare("INSERT INTO projetos (cliente_id, nome, patrocinador, ponto_focal, gerente, inicio) VALUES (?, 'Implantação de boas práticas de TIC', 'Diretoria administrativa', 'Coordenador de TI', 'GP Boxtech', '2026-11-03')").run(cliente).lastInsertRowid;
criarEstruturaProjeto(db, proj);
db.prepare("UPDATE projeto_fases SET status = 'concluida', portao_aprovado_em = '2026-11-14' WHERE projeto_id = ? AND fase_id = 1").run(proj);
db.prepare("UPDATE projeto_fases SET status = 'em_andamento' WHERE projeto_id = ? AND fase_id IN (2, 4)").run(proj);

const med = db.prepare('INSERT INTO medicoes (cliente_id, indicador_id, periodo, valor, linha_base) VALUES (?, ?, ?, ?, ?)');
med.run(cliente, 'mttr', '2026-11', 26, 1);
med.run(cliente, 'resolucao-n1', '2026-11', 41, 1);
med.run(cliente, 'csat', '2026-11', 3.4, 1);

console.log('Cliente de exemplo criado.');
