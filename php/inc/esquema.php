<?php
// Esquema PostgreSQL (9.5 ou mais novo).
return [
    "CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      cnpj VARCHAR(30),
      segmento VARCHAR(200),
      porte VARCHAR(10) CHECK (porte IN ('pequeno', 'medio', 'grande')),
      contato VARCHAR(400),
      criado_em TIMESTAMP(0) NOT NULL DEFAULT LOCALTIMESTAMP(0)
    )",

    "CREATE TABLE IF NOT EXISTS avaliacoes (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('inicial', 'encerramento', 'semestral')),
      data DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
      consultor VARCHAR(200),
      pesos TEXT NOT NULL DEFAULT '{}',
      observacoes TEXT
    )",

    "CREATE TABLE IF NOT EXISTS avaliacao_itens (
      avaliacao_id INTEGER NOT NULL REFERENCES avaliacoes(id) ON DELETE CASCADE,
      pratica_id VARCHAR(40) NOT NULL,
      nivel SMALLINT CHECK (nivel BETWEEN 1 AND 5),
      meta SMALLINT CHECK (meta BETWEEN 1 AND 5),
      evidencias TEXT,
      observacoes TEXT,
      PRIMARY KEY (avaliacao_id, pratica_id)
    )",

    "CREATE TABLE IF NOT EXISTS projetos (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      nome VARCHAR(200) NOT NULL,
      patrocinador VARCHAR(200),
      ponto_focal VARCHAR(200),
      gerente VARCHAR(200),
      inicio DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'encerrado', 'suspenso'))
    )",

    "CREATE TABLE IF NOT EXISTS projeto_fases (
      projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
      fase_id INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'nao_iniciada' CHECK (status IN ('nao_iniciada', 'em_andamento', 'concluida')),
      portao_aprovado_em DATE,
      observacoes TEXT,
      PRIMARY KEY (projeto_id, fase_id)
    )",

    "CREATE TABLE IF NOT EXISTS projeto_ondas (
      projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
      onda_id INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'nao_iniciada' CHECK (status IN ('nao_iniciada', 'desenho', 'configuracao', 'treinamento', 'piloto', 'aceita')),
      praticas TEXT NOT NULL DEFAULT '[]',
      aceite_em DATE,
      PRIMARY KEY (projeto_id, onda_id)
    )",

    "CREATE TABLE IF NOT EXISTS medicoes (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      indicador_id VARCHAR(40) NOT NULL,
      periodo CHAR(7) NOT NULL,
      valor DOUBLE PRECISION NOT NULL,
      linha_base SMALLINT NOT NULL DEFAULT 0,
      observacoes TEXT,
      UNIQUE (cliente_id, indicador_id, periodo)
    )",

    // Acesso: 'admin' = equipe Boxtech (vê todos os clientes); 'empresa' = usuário de um cliente.
    "CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      email VARCHAR(200) NOT NULL UNIQUE,
      senha_hash VARCHAR(255) NOT NULL,
      papel VARCHAR(10) NOT NULL CHECK (papel IN ('admin', 'empresa')),
      cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      status VARCHAR(10) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'ativo', 'recusado', 'bloqueado')),
      criado_em TIMESTAMP(0) NOT NULL DEFAULT LOCALTIMESTAMP(0),
      decidido_em TIMESTAMP(0),
      decidido_por VARCHAR(200),
      CHECK (papel = 'admin' OR cliente_id IS NOT NULL)
    )",

    // O cookie guarda o token; o banco guarda só o hash, para um vazamento do banco não abrir sessões.
    "CREATE TABLE IF NOT EXISTS sessoes (
      token_hash CHAR(64) PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      expira_em BIGINT NOT NULL
    )",

    // Limite de tentativas de login por IP + e-mail (a hospedagem compartilhada não guarda memória entre requisições).
    "CREATE TABLE IF NOT EXISTS tentativas_login (
      chave CHAR(64) PRIMARY KEY,
      qtd INTEGER NOT NULL,
      inicio BIGINT NOT NULL
    )",
];
