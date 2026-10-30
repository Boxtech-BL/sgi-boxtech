// Catálogo do framework de gestão de TIC da Boxtech (PMBOK + ITIL 4).
// Fonte: "Roteiro de implantação de boas práticas de gestão de TIC" e
// "Avaliação de maturidade" (Biblioteca da Boxtech).

const niveis = [
  { nivel: 1, nome: 'Inicial', descricao: 'Acontece de forma improvisada e depende de pessoas específicas', evidencia: 'Nenhum registro, ou registros soltos (e-mail, WhatsApp)' },
  { nivel: 2, nome: 'Gerenciado', descricao: 'Existe rotina básica, mas cada um faz do seu jeito', evidencia: 'Ferramenta ou planilha em uso, sem processo escrito' },
  { nivel: 3, nome: 'Definido', descricao: 'Processo documentado, papéis claros e equipe treinada', evidencia: 'Procedimento aprovado, responsáveis nomeados, registros completos' },
  { nivel: 4, nome: 'Gerenciado quantitativamente', descricao: 'Medido com indicadores e metas acompanhados com regularidade', evidencia: 'Relatórios mensais de indicadores e SLAs, reuniões de análise' },
  { nivel: 5, nome: 'Otimizado', descricao: 'Melhorado de forma contínua a partir dos dados', evidencia: 'Registro de melhorias implantadas, tendências em queda de falhas' },
];

const areas = [
  { id: 'atendimento', nome: 'Atendimento', referencia: 'ITIL 4' },
  { id: 'controle', nome: 'Controle do ambiente', referencia: 'ITIL 4' },
  { id: 'servico', nome: 'Serviço e fornecedores', referencia: 'ITIL 4' },
  { id: 'seguranca', nome: 'Segurança e continuidade', referencia: 'ITIL 4' },
  { id: 'melhoria', nome: 'Melhoria e governança', referencia: 'ITIL 4 e PMBOK' },
];

// onda: em qual onda da Fase 3 a prática é implantada (null = base PMBOK, conduzida desde a Fase 1).
const praticas = [
  { id: 'central-servico', curto: 'Central de serviço', nome: 'Central de serviço', area: 'atendimento', onda: 1,
    perguntas: 'Existe um canal único de atendimento? Todos os contatos viram chamado?',
    evidencias: 'Ferramenta de chamados, canais divulgados aos usuários' },
  { id: 'incidente', curto: 'Incidente', nome: 'Gerenciamento de incidente', area: 'atendimento', onda: 1,
    perguntas: 'Há priorização por impacto e urgência? Existe escalonamento definido?',
    evidencias: 'Matriz de prioridade, relatório de tempo de resolução' },
  { id: 'requisicao', curto: 'Requisição', nome: 'Gerenciamento de requisição de serviço', area: 'atendimento', onda: 1,
    perguntas: 'Existe catálogo de pedidos padrão? Os pedidos têm aprovação e prazo?',
    evidencias: 'Catálogo de serviços, fluxos de aprovação' },
  { id: 'ativos', curto: 'Ativos', nome: 'Gestão de ativos de TI', area: 'controle', onda: 1,
    perguntas: 'O inventário de hardware, software e licenças está completo e atualizado?',
    evidencias: 'Inventário, controle de licenças, data da última atualização' },
  { id: 'configuracao', curto: 'Configuração', nome: 'Gerenciamento de configuração', area: 'controle', onda: 2,
    perguntas: 'As relações entre servidores, sistemas e serviços estão registradas?',
    evidencias: 'CMDB ou diagrama de rede e de sistemas' },
  { id: 'mudanca', curto: 'Mudança', nome: 'Habilitação de mudança', area: 'controle', onda: 2,
    perguntas: 'As mudanças no ambiente são registradas, avaliadas e aprovadas antes?',
    evidencias: 'Registro de mudanças, atas do comitê (CAB)' },
  { id: 'nivel-servico', curto: 'Nível de serviço', nome: 'Gerenciamento de nível de serviço', area: 'servico', onda: 2,
    perguntas: 'Existem SLAs acordados com as áreas? São medidos e reportados?',
    evidencias: 'Documento de SLA, relatórios mensais' },
  { id: 'fornecedores', curto: 'Fornecedores', nome: 'Gestão de fornecedores', area: 'servico', onda: 2,
    perguntas: 'Os contratos de TI têm responsável, vencimento e SLA acompanhados?',
    evidencias: 'Lista de contratos, avaliações de fornecedores' },
  { id: 'seguranca-informacao', curto: 'Segurança', nome: 'Gerenciamento de segurança da informação', area: 'seguranca', onda: 2,
    perguntas: 'Há política de segurança, controle de acessos e gestão de vulnerabilidades?',
    evidencias: 'Política aprovada, revisão de acessos, relatório de atualizações e antivírus' },
  { id: 'continuidade', curto: 'Continuidade', nome: 'Gerenciamento de continuidade do serviço', area: 'seguranca', onda: 3,
    perguntas: 'Os backups são testados? Existe plano para parada dos sistemas críticos?',
    evidencias: 'Relatório de teste de restauração, plano de continuidade' },
  { id: 'monitoramento', curto: 'Monitoramento', nome: 'Monitoramento e gerenciamento de evento', area: 'seguranca', onda: 3,
    perguntas: 'Os serviços críticos são monitorados com alertas? Quem recebe os alertas?',
    evidencias: 'Ferramenta de monitoramento, regras de alerta' },
  { id: 'problema', curto: 'Problema', nome: 'Gerenciamento de problema', area: 'melhoria', onda: 3,
    perguntas: 'Incidentes recorrentes têm a causa raiz investigada e eliminada?',
    evidencias: 'Registro de problemas, análises de causa raiz' },
  { id: 'conhecimento', curto: 'Conhecimento', nome: 'Gerenciamento do conhecimento', area: 'melhoria', onda: 3,
    perguntas: 'Soluções e procedimentos ficam documentados e acessíveis à equipe?',
    evidencias: 'Base de conhecimento, procedimentos operacionais' },
  { id: 'melhoria-continua', curto: 'Melhoria contínua', nome: 'Melhoria contínua', area: 'melhoria', onda: 3,
    perguntas: 'Os indicadores geram ações de melhoria acompanhadas?',
    evidencias: 'Registro de melhorias, atas de análise de indicadores' },
  { id: 'projetos', curto: 'Projetos (PMBOK)', nome: 'Gestão de projetos de TI (PMBOK)', area: 'melhoria', onda: null,
    perguntas: 'Os projetos têm termo de abertura, cronograma, responsáveis, controle de mudanças e encerramento?',
    evidencias: 'TAPs, cronogramas, relatórios de status, termos de encerramento' },
];

const fases = [
  { id: 1, nome: 'Iniciação', duracao: '1 a 2 semanas', portao: 'TAP aprovado pelo patrocinador',
    entregaveis: ['Termo de Abertura do Projeto (TAP)', 'Registro de partes interessadas', 'Cronograma macro e plano de comunicação inicial'] },
  { id: 2, nome: 'Planejamento', duracao: '2 a 4 semanas', portao: 'Plano aprovado pelo patrocinador e orçamento liberado',
    entregaveis: ['Relatório de diagnóstico de maturidade ITIL', 'Plano de Gerenciamento do Projeto', 'Mapa de ondas e linha de base dos indicadores'] },
  { id: 3, nome: 'Execução em ondas', duracao: '3 a 9 meses', portao: 'Termo de aceite de cada onda assinado e indicadores medidos',
    entregaveis: ['Aceite da Onda 1 (Fundação)', 'Aceite da Onda 2 (Controle)', 'Aceite da Onda 3 (Maturidade)'] },
  { id: 4, nome: 'Monitoramento e controle', duracao: 'Durante todo o projeto', portao: null,
    entregaveis: ['Relatório mensal de status', 'Registro de riscos e de mudanças do projeto', 'Painel de indicadores'] },
  { id: 5, nome: 'Encerramento e operação contínua', duracao: '2 a 4 semanas', portao: 'Termo de encerramento assinado pelo patrocinador',
    entregaveis: ['Termo de encerramento', 'Pacote de documentação', 'Relatório de lições aprendidas', 'Novo diagnóstico de maturidade'] },
];

const ondas = [
  { id: 1, nome: 'Fundação', foco: 'Atender, registrar e conhecer o ambiente', duracao: '1 a 3 meses' },
  { id: 2, nome: 'Controle', foco: 'Reduzir riscos e cumprir acordos', duracao: '2 a 3 meses' },
  { id: 3, nome: 'Maturidade', foco: 'Prevenir falhas e melhorar continuamente', duracao: '2 a 3 meses' },
];

// sentido: 'maior' = quanto maior melhor; 'menor' = quanto menor melhor.
const indicadores = [
  { id: 'mttr', nome: 'Tempo médio de resolução (MTTR)', unidade: 'horas', sentido: 'menor', praticas: ['central-servico', 'incidente'], fonte: 'Relatório da ferramenta de chamados' },
  { id: 'resolucao-n1', nome: '% resolvido no 1º nível', unidade: '%', sentido: 'maior', praticas: ['central-servico', 'incidente'], fonte: 'Relatório da ferramenta de chamados' },
  { id: 'sla', nome: '% de chamados dentro do SLA', unidade: '%', sentido: 'maior', praticas: ['nivel-servico'], fonte: 'Relatório mensal de SLA' },
  { id: 'mudancas-falha', nome: '% de mudanças com falha ou revertidas', unidade: '%', sentido: 'menor', praticas: ['mudanca'], fonte: 'Registro de mudanças' },
  { id: 'ativos-inventariados', nome: '% de ativos inventariados e atualizados', unidade: '%', sentido: 'maior', praticas: ['ativos', 'configuracao'], fonte: 'Auditoria amostral do inventário' },
  { id: 'incidentes-recorrentes', nome: 'Incidentes recorrentes por mês', unidade: 'qtd', sentido: 'menor', praticas: ['problema'], fonte: 'Análise de tendência de incidentes' },
  { id: 'restauracao-backup', nome: 'Teste de restauração de backup bem-sucedido', unidade: '%', sentido: 'maior', praticas: ['continuidade'], fonte: 'Relatório de teste semestral' },
  { id: 'csat', nome: 'Satisfação do usuário (CSAT)', unidade: 'nota 1-5', sentido: 'maior', praticas: ['central-servico'], fonte: 'Pesquisa ao fechar o chamado' },
];

const tiposAvaliacao = [
  { id: 'inicial', nome: 'Diagnóstico inicial (Fase 2)' },
  { id: 'encerramento', nome: 'Encerramento do projeto (Fase 5)' },
  { id: 'semestral', nome: 'Reavaliação semestral' },
];

// Meta sugerida: nível 3 em todas as práticas; nível 4 nas de atendimento no ciclo seguinte.
function metaSugerida(praticaId, tipo) {
  const p = praticas.find((x) => x.id === praticaId);
  if (tipo === 'semestral' && p && p.area === 'atendimento') return 4;
  return 3;
}

module.exports = { niveis, areas, praticas, fases, ondas, indicadores, tiposAvaliacao, metaSugerida };
