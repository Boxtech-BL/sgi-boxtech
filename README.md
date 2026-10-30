# SGI Boxtech

Sistema web em Node.js que informatiza o framework de boas práticas de gestão de TIC da Boxtech (PMBOK + ITIL 4): avaliação de maturidade, projeto de implantação em fases e ondas, e indicadores.

## Como rodar

Requer Node.js 22.13 ou mais novo (usa o SQLite embutido do Node, sem banco externo).

```bash
npm install
npm run demo   # opcional: cria um cliente de exemplo
npm start      # http://localhost:3000
npm test
```

Variáveis: `PORT` (padrão 3000) e `SGI_DB` (arquivo do banco, padrão `sgi.db`).

## Versão em PHP (hospedagem compartilhada)

A pasta [`php/`](php/README.md) tem o mesmo SGI em PHP + MySQL, para rodar direto na hospedagem compartilhada da Locaweb (sem Node). As instruções de instalação estão em [php/README.md](php/README.md).

## O que o MVP faz

| Módulo | Funcionalidades |
| --- | --- |
| Clientes | Cadastro, nota de maturidade atual e projetos ativos de cada cliente |
| Avaliação de maturidade | Questionário das 15 práticas em 5 áreas, nível 1 a 5 com evidências, meta por prática, pesos por área, nota por área e geral com cálculo automático, 3 lacunas críticas, gráfico radar, comparação com a avaliação anterior |
| Relatório de maturidade | Resumo executivo, radar atual x meta, detalhe por prática e recomendações priorizadas por onda; imprime ou salva em PDF |
| Projeto de implantação | 5 fases PMBOK com portões (a fase só fecha com a data de aprovação), 3 ondas ITIL com as etapas do ciclo de entrega (a onda seguinte só começa após o aceite da anterior) |
| Indicadores | 8 indicadores do roteiro, linha de base, medições mensais e evolução considerando se "maior" ou "menor" é melhor |
| Framework | Consulta da escala, fases, ondas e práticas |

## Estrutura

```
server.js            inicia o servidor
src/catalogo.js      conteúdo do framework (níveis, áreas, práticas, fases, ondas, indicadores)
src/maturidade.js    regras de pontuação (puras, testadas)
src/db.js            esquema SQLite
src/app.js           API REST (Express)
public/              interface web (HTML, CSS e JS sem build)
scripts/demo.js      dados de exemplo
test/                testes (node:test)
```

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/catalogo` | Conteúdo do framework |
| GET, POST | `/api/clientes` | Listar e criar clientes |
| GET, PUT, DELETE | `/api/clientes/:id` | Cliente |
| GET, POST | `/api/clientes/:id/avaliacoes` | Avaliações do cliente |
| GET, PUT, DELETE | `/api/avaliacoes/:id` | Avaliação com itens, resultado e comparação |
| GET, POST | `/api/clientes/:id/projetos` | Projetos de implantação |
| GET, PUT, DELETE | `/api/projetos/:id` | Projeto com fases e ondas |
| PUT | `/api/projetos/:id/fases/:fase` | Status e portão de uma fase |
| PUT | `/api/projetos/:id/ondas/:onda` | Etapa, aceite e práticas de uma onda |
| GET | `/api/clientes/:id/indicadores` | Indicadores com linha de base e evolução |
| POST | `/api/clientes/:id/medicoes` | Registrar medição |
| DELETE | `/api/medicoes/:id` | Excluir medição |

## Próximos passos sugeridos

1. Login e perfis (consultor Boxtech, ponto focal do cliente, patrocinador), com cada cliente vendo só os seus dados.
2. Autoavaliação: o cliente preenche o questionário e anexa evidências (etapa 2 da avaliação).
3. Registro de riscos, mudanças do projeto e relatório mensal de status (Fase 4).
4. Trocar SQLite por PostgreSQL ao hospedar para vários usuários.
