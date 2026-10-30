<?php
// Cadastro de empresas, login e aprovação de acesso pela Boxtech.
//
// Fluxo: a empresa se cadastra (cliente + usuário 'pendente') -> o SGI envia um e-mail ao
// aprovador (boxtech@boxtech.com.br) com um link assinado -> o aprovador confirma pelo link
// ou pelo painel de administração -> a empresa recebe um e-mail e passa a entrar no sistema.
declare(strict_types=1);

const PORTES = ['pequeno', 'medio', 'grande'];

rota('POST', '/cadastro', function (array $c) {
    $empresa = is_array($c['empresa'] ?? null) ? $c['empresa'] : [];
    $nomeEmpresa = texto($empresa['nome'] ?? null);
    $nome = texto($c['nome'] ?? null);
    $email = strtolower(texto($c['email'] ?? null));
    $senha = $c['senha'] ?? null;
    $porte = $empresa['porte'] ?? null;
    $cnpj = textoOuNulo($empresa['cnpj'] ?? null, 30);
    $segmento = textoOuNulo($empresa['segmento'] ?? null);
    exigir($nomeEmpresa !== '', 'Informe o nome da empresa');
    exigir($nome !== '', 'Informe o seu nome');
    exigir(emailValido($email), 'Informe um e-mail válido');
    exigir(is_string($senha) && strlen($senha) >= 8 && strlen($senha) <= 200, 'A senha deve ter pelo menos 8 caracteres');
    exigir(!$porte || in_array($porte, PORTES, true), 'Porte inválido');
    exigir(!linha('SELECT 1 FROM usuarios WHERE email = ?', [$email]), 'Já existe um cadastro com este e-mail');

    try {
        $usuarioId = transacao(function () use ($nomeEmpresa, $cnpj, $segmento, $porte, $nome, $email, $senha) {
            $clienteId = inserir('INSERT INTO clientes (nome, cnpj, segmento, porte, contato) VALUES (?, ?, ?, ?, ?)',
                [$nomeEmpresa, $cnpj, $segmento, $porte ?: null, "$nome <$email>"]);
            return inserir("INSERT INTO usuarios (nome, email, senha_hash, papel, cliente_id) VALUES (?, ?, ?, 'empresa', ?)",
                [$nome, $email, password_hash($senha, PASSWORD_DEFAULT), $clienteId]);
        });
    } catch (PDOException $e) {
        exigir($e->getCode() !== '23505', 'Já existe um cadastro com este e-mail');
        throw $e;
    }

    $link = urlBase() . '/#/aprovar/' . tokenAprovacao(config()['segredo'], $usuarioId);
    $linhas = [
        "Empresa: $nomeEmpresa", 'CNPJ: ' . ($cnpj ?? '–'), 'Segmento: ' . ($segmento ?? '–'),
        'Porte: ' . ($porte ?: '–'), "Responsável: $nome <$email>",
    ];
    enviarEmailSemFalhar(
        config()['aprovador'],
        "[SGI] Novo cadastro aguardando liberação: $nomeEmpresa",
        "Uma empresa se cadastrou no SGI Boxtech e aguarda a liberação do acesso.\n\n" . implode("\n", $linhas)
            . "\n\nPara liberar ou recusar, abra: $link\n(ou entre no SGI como administrador, em Acessos)",
        '<p>Uma empresa se cadastrou no SGI Boxtech e aguarda a liberação do acesso.</p><p>'
            . implode('<br>', array_map('escHtml', $linhas)) . '</p><p><a href="' . escHtml($link) . '">Liberar ou recusar o acesso</a></p>'
    );

    http_response_code(201);
    return ['mensagem' => 'Cadastro recebido. Você receberá um e-mail quando o acesso for liberado pela Boxtech.'];
}, true);

rota('POST', '/login', function (array $c) {
    $email = strtolower(texto($c['email'] ?? null));
    $chave = chaveTentativa($email);
    exigir(!loginBloqueado($chave), 'Muitas tentativas. Aguarde 15 minutos e tente de novo.', 429);
    $u = linha('SELECT * FROM usuarios WHERE email = ?', [$email]);
    $ok = $u && is_string($c['senha'] ?? null) && password_verify($c['senha'], $u['senha_hash']);
    if (!$ok) {
        loginFalhou($chave);
        exigir(false, 'E-mail ou senha incorretos', 401);
    }
    exigir($u['status'] !== 'pendente', 'Seu cadastro ainda aguarda a liberação da Boxtech', 403);
    exigir($u['status'] === 'ativo', 'Seu acesso não está liberado. Fale com a Boxtech.', 403);
    limparTentativas($chave);
    if (password_needs_rehash($u['senha_hash'], PASSWORD_DEFAULT)) {
        sql('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [password_hash($c['senha'], PASSWORD_DEFAULT), $u['id']]);
    }
    criarSessao((int) $u['id']);
    return ['id' => $u['id'], 'nome' => $u['nome'], 'email' => $u['email'], 'papel' => $u['papel'], 'cliente_id' => $u['cliente_id']];
}, true);

rota('POST', '/logout', function () {
    encerrarSessao();
    return ['ok' => true];
}, true);

rota('GET', '/eu', fn() => usuarioAtual());

// ---------- Aprovação ----------
function cadastroEmpresa(int $id): array
{
    $u = linha("
        SELECT u.id, u.nome, u.email, u.status, u.criado_em, c.id AS cliente_id, c.nome AS empresa, c.cnpj, c.segmento, c.porte
        FROM usuarios u JOIN clientes c ON c.id = u.cliente_id WHERE u.id = ? AND u.papel = 'empresa'", [$id]);
    exigir($u, 'Cadastro não encontrado', 404);
    return $u;
}

function decidirCadastro(int $usuarioId, $decisao, string $quem): array
{
    exigir(in_array($decisao, ['aprovar', 'recusar'], true), 'Decisão inválida');
    $u = cadastroEmpresa($usuarioId);
    exigir($u['status'] === 'pendente', 'Este cadastro já foi ' . ($u['status'] === 'ativo' ? 'liberado' : 'decidido'), 409);
    $novo = $decisao === 'aprovar' ? 'ativo' : 'recusado';
    // A condição no status evita que dois cliques simultâneos decidam duas vezes.
    $st = sql("UPDATE usuarios SET status = ?, decidido_em = LOCALTIMESTAMP(0), decidido_por = ? WHERE id = ? AND status = 'pendente'", [$novo, $quem, $u['id']]);
    exigir($st->rowCount() === 1, 'Este cadastro já foi decidido', 409);

    $aprovador = config()['aprovador'];
    if ($novo === 'ativo') {
        enviarEmailSemFalhar($u['email'], 'Seu acesso ao SGI Boxtech foi liberado',
            "Olá, {$u['nome']}.\n\nO acesso da {$u['empresa']} ao SGI Boxtech foi liberado. Entre em " . urlBase()
            . "/#/login com o seu e-mail e a senha cadastrada.\n\nEquipe Boxtech");
    } else {
        enviarEmailSemFalhar($u['email'], 'Cadastro no SGI Boxtech',
            "Olá, {$u['nome']}.\n\nNão foi possível liberar o acesso da {$u['empresa']} ao SGI Boxtech. Para mais informações, "
            . "responda a este e-mail ou fale com $aprovador.\n\nEquipe Boxtech");
    }
    return cadastroEmpresa($u['id']);
}

// Link do e-mail: GET mostra o cadastro (sem decidir, para pré-visualizadores de e-mail não
// aprovarem sozinhos); a decisão exige o POST do botão.
function idDoToken(string $token): int
{
    $id = lerTokenAprovacao(config()['segredo'], $token);
    exigir($id, 'Link de aprovação inválido ou expirado', 404);
    return $id;
}

rota('GET', '/aprovacoes/([^/]+)', fn(array $c, string $token) => cadastroEmpresa(idDoToken($token)), true);

rota('POST', '/aprovacoes/([^/]+)', fn(array $c, string $token) => decidirCadastro(idDoToken($token), $c['decisao'] ?? null, config()['aprovador']), true);

// ---------- Painel de administração ----------
rota('GET', '/admin/usuarios', function () {
    soAdmin();
    return linhas("
        SELECT u.id, u.nome, u.email, u.papel, u.status, u.criado_em, u.decidido_em, u.decidido_por, c.nome AS empresa, c.cnpj
        FROM usuarios u LEFT JOIN clientes c ON c.id = u.cliente_id
        ORDER BY u.status = 'pendente' DESC, u.criado_em DESC, u.id DESC");
});

rota('POST', '/admin/usuarios/(\d+)/(aprovar|recusar|bloquear|reativar)', function (array $c, string $id, string $decisao) {
    soAdmin();
    $quem = usuarioAtual()['email'];
    if ($decisao === 'bloquear' || $decisao === 'reativar') {
        $u = cadastroEmpresa((int) $id);
        sql('UPDATE usuarios SET status = ?, decidido_em = LOCALTIMESTAMP(0), decidido_por = ? WHERE id = ?',
            [$decisao === 'bloquear' ? 'bloqueado' : 'ativo', $quem, $u['id']]);
        if ($decisao === 'bloquear') sql('DELETE FROM sessoes WHERE usuario_id = ?', [$u['id']]);
        return cadastroEmpresa($u['id']);
    }
    return decidirCadastro((int) $id, $decisao, $quem);
});
