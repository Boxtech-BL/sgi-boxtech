const { DatabaseSync } = require('node:sqlite');
const { fases, ondas } = require('./catalogo');

const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT,
  segmento TEXT,
  porte TEXT CHECK (porte IN ('pequeno', 'medio', 'grande')),
  contato TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('inicial', 'encerramento', 'semestral')),
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  consultor TEXT,
  pesos TEXT NOT NULL DEFAULT '{}',
  observacoes TEXT
);

CREATE TABLE IF NOT EXISTS avaliacao_itens (
  avaliacao_id INTEGER NOT NULL REFERENCES avaliacoes(id) ON DELETE CASCADE,
  pratica_id TEXT NOT NULL,
  nivel INTEGER CHECK (nivel BETWEEN 1 AND 5),
  meta INTEGER CHECK (meta BETWEEN 1 AND 5),
  evidencias TEXT,
  observacoes TEXT,
  PRIMARY KEY (avaliacao_id, pratica_id)
);

CREATE TABLE IF NOT EXISTS projetos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  patrocinador TEXT,
  ponto_focal TEXT,
  gerente TEXT,
  inicio TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'encerrado', 'suspenso'))
);

CREATE TABLE IF NOT EXISTS projeto_fases (
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  fase_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'nao_iniciada' CHECK (status IN ('nao_iniciada', 'em_andamento', 'concluida')),
  portao_aprovado_em TEXT,
  observacoes TEXT,
  PRIMARY KEY (projeto_id, fase_id)
);

CREATE TABLE IF NOT EXISTS projeto_ondas (
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  onda_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'nao_iniciada' CHECK (status IN ('nao_iniciada', 'desenho', 'configuracao', 'treinamento', 'piloto', 'aceita')),
  praticas TEXT NOT NULL DEFAULT '[]',
  aceite_em TEXT,
  PRIMARY KEY (projeto_id, onda_id)
);

CREATE TABLE IF NOT EXISTS medicoes (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  indicador_id TEXT NOT NULL,
  periodo TEXT NOT NULL,
  valor REAL NOT NULL,
  linha_base INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT,
  UNIQUE (cliente_id, indicador_id, periodo)
);

-- Acesso: 'admin' = equipe Boxtech (vê todos os clientes); 'empresa' = usuário de um cliente.
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('admin', 'empresa')),
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'ativo', 'recusado', 'bloqueado')),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  decidido_em TEXT,
  decidido_por TEXT,
  CHECK (papel = 'admin' OR cliente_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);
`;

function abrir(arquivo = process.env.SGI_DB || 'sgi.db') {
  const db = new DatabaseSync(arquivo);
  db.exec(schema);
  return db;
}

// Cria as 5 fases e as 3 ondas de um projeto novo, já com as práticas padrão de cada onda.
function criarEstruturaProjeto(db, projetoId) {
  const { praticas } = require('./catalogo');
  const insFase = db.prepare('INSERT INTO projeto_fases (projeto_id, fase_id) VALUES (?, ?)');
  const insOnda = db.prepare('INSERT INTO projeto_ondas (projeto_id, onda_id, praticas) VALUES (?, ?, ?)');
  for (const f of fases) insFase.run(projetoId, f.id);
  for (const o of ondas) {
    insOnda.run(projetoId, o.id, JSON.stringify(praticas.filter((p) => p.onda === o.id).map((p) => p.id)));
  }
}

// Cria (ou atualiza a senha de) um administrador da Boxtech.
function garantirAdmin(db, { email, senha, nome = 'Boxtech' }) {
  const { hashSenha } = require('./seguranca');
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existente) {
    db.prepare("UPDATE usuarios SET senha_hash = ?, papel = 'admin', status = 'ativo' WHERE id = ?").run(hashSenha(senha), existente.id);
    return existente.id;
  }
  return db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel, status, decidido_em) VALUES (?, ?, ?, 'admin', 'ativo', datetime('now'))")
    .run(nome, email, hashSenha(senha)).lastInsertRowid;
}

module.exports = { abrir, criarEstruturaProjeto, garantirAdmin };
