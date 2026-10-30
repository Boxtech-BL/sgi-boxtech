<?php
// Esquema MySQL (5.7 ou mais novo / MariaDB 10.2+). Os valores permitidos de cada campo
// também são conferidos no PHP, porque o MySQL 5.7 ignora CHECK.
return [
    "CREATE TABLE IF NOT EXISTS clientes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      cnpj VARCHAR(30) NULL,
      segmento VARCHAR(200) NULL,
      porte VARCHAR(10) NULL,
      contato VARCHAR(400) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    "CREATE TABLE IF NOT EXISTS avaliacoes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cliente_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      data DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'rascunho',
      consultor VARCHAR(200) NULL,
      pesos TEXT NOT NULL,
      observacoes TEXT NULL,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    "CREATE TABLE IF NOT EXISTS avaliacao_itens (
      avaliacao_id INT NOT NULL,
      pratica_id VARCHAR(40) NOT NULL,
      nivel TINYINT NULL,
      meta TINYINT NULL,
      evidencias TEXT NULL,
      observacoes TEXT NULL,
      PRIMARY KEY (avaliacao_id, pratica_id),
      FOREIGN KEY (avaliacao_id) REFERENCES avaliacoes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    "CREATE TABLE IF NOT EXISTS projetos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cliente_id INT NOT NULL,
      nome VARCHAR(200) NOT NULL,
      patrocinador VARCHAR(200) NULL,
      ponto_focal VARCHAR(200) NULL,
      gerente VARCHAR(200) NULL,
      inicio DATE NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ativo',
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    "CREATE TABLE IF NOT EXISTS projeto_fases (
      projeto_id INT NOT NULL,
      fase_id INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'nao_iniciada',
      portao_aprovado_em DATE NULL,
      observacoes TEXT NULL,
      PRIMARY KEY (projeto_id, fase_id),
      FOREIGN KEY (projeto_id) REFERENCES projetos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    "CREATE TABLE IF NOT EXISTS projeto_ondas (
      projeto_id INT NOT NULL,
      onda_id INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'nao_iniciada',
      praticas TEXT NOT NULL,
      aceite_em DATE NULL,
      PRIMARY KEY (projeto_id, onda_id),
      FOREIGN KEY (projeto_id) REFERENCES projetos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    "CREATE TABLE IF NOT EXISTS medicoes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cliente_id INT NOT NULL,
      indicador_id VARCHAR(40) NOT NULL,
      periodo CHAR(7) NOT NULL,
      valor DOUBLE NOT NULL,
      linha_base TINYINT NOT NULL DEFAULT 0,
      observacoes TEXT NULL,
      UNIQUE KEY medicao_unica (cliente_id, indicador_id, periodo),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // Acesso: 'admin' = equipe Boxtech (vê todos os clientes); 'empresa' = usuário de um cliente.
    "CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      email VARCHAR(200) NOT NULL,
      senha_hash VARCHAR(255) NOT NULL,
      papel VARCHAR(10) NOT NULL,
      cliente_id INT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'pendente',
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decidido_em DATETIME NULL,
      decidido_por VARCHAR(200) NULL,
      UNIQUE KEY email_unico (email),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // O cookie guarda o token; o banco guarda só o hash, para um vazamento do banco não abrir sessões.
    "CREATE TABLE IF NOT EXISTS sessoes (
      token_hash CHAR(64) PRIMARY KEY,
      usuario_id INT NOT NULL,
      expira_em BIGINT NOT NULL,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    // Limite de tentativas de login por IP + e-mail (a hospedagem compartilhada não guarda memória entre requisições).
    "CREATE TABLE IF NOT EXISTS tentativas_login (
      chave CHAR(64) PRIMARY KEY,
      qtd INT NOT NULL,
      inicio BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
];
