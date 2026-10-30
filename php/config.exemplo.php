<?php
// Copie este arquivo para config.php e preencha. Nunca publique o config.php no GitHub.
return [
    // Banco PostgreSQL criado no painel da Locaweb (Hospedagem > Banco de dados).
    'db' => [
        'host' => 'localhost',          // use o endereço do servidor que o painel mostra para o banco
        'porta' => 5432,
        'nome' => 'sgi',
        'usuario' => '',
        'senha' => '',
    ],

    // Endereço público do sistema, sem barra no final (usado nos links dos e-mails).
    'url_base' => 'https://www.boxtech.com.br/sgi',

    // Texto aleatório longo que assina os links de aprovação. Gere com: openssl rand -hex 32
    'segredo' => '',

    // Quem recebe os pedidos de cadastro e libera o acesso (também é o login do administrador).
    'aprovador' => 'boxtech@boxtech.com.br',

    // Senha do administrador (login = aprovador). Preencha, abra instalar.php uma vez e depois apague o valor.
    'admin_senha_inicial' => '',

    // Envio de e-mail.
    //  'smtp' => conta autenticada (recomendado; ex.: Microsoft 365 smtp.office365.com:587,
    //            ou e-mail da Locaweb email-ssl.com.br:465)
    //  'mail' => função mail() do PHP da hospedagem
    //  'log'  => não envia; grava as mensagens em email_log (desenvolvimento e testes)
    'email' => [
        'modo' => 'smtp',
        'host' => 'smtp.office365.com',
        'porta' => 587,
        'usuario' => 'boxtech@boxtech.com.br',
        'senha' => '',
        'remetente' => 'boxtech@boxtech.com.br',
        'nome_remetente' => 'SGI Boxtech',
        'log' => __DIR__ . '/inc/emails.log',
    ],
];
