<?php
// Senhas, sessões, tokens de aprovação e limite de tentativas de login.
declare(strict_types=1);

const COOKIE_SESSAO = 'sgi_sessao';
const DURACAO_SESSAO = 12 * 60 * 60; // 12 horas
const VALIDADE_APROVACAO = 30 * 24 * 60 * 60; // 30 dias
const MAX_TENTATIVAS = 10;
const JANELA_TENTATIVAS = 15 * 60;

function base64url(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function conexaoSegura(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || str_starts_with(config()['url_base'], 'https://');
}

function definirCookieSessao(string $valor, int $expira): void
{
    setcookie(COOKIE_SESSAO, $valor, [
        'expires' => $expira,
        'path' => '/',
        'secure' => conexaoSegura(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function criarSessao(int $usuarioId): void
{
    $token = base64url(random_bytes(32));
    sql('DELETE FROM sessoes WHERE expira_em < ?', [time()]);
    sql('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)', [hash('sha256', $token), $usuarioId, time() + DURACAO_SESSAO]);
    definirCookieSessao($token, time() + DURACAO_SESSAO);
}

// Usuário da sessão atual (só se ainda estiver ativo: bloquear derruba a sessão na hora).
function usuarioAtual(): ?array
{
    static $cache = false;
    if ($cache !== false) return $cache;
    $token = $_COOKIE[COOKIE_SESSAO] ?? '';
    $cache = $token === '' ? null : linha("
        SELECT u.id, u.nome, u.email, u.papel, u.cliente_id, u.status
        FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = ? AND s.expira_em > ? AND u.status = 'ativo'", [hash('sha256', $token), time()]);
    return $cache;
}

function encerrarSessao(): void
{
    $token = $_COOKIE[COOKIE_SESSAO] ?? '';
    if ($token !== '') sql('DELETE FROM sessoes WHERE token_hash = ?', [hash('sha256', $token)]);
    definirCookieSessao('', time() - 3600);
}

// Token assinado (HMAC) que vai no e-mail de aprovação: usuário + validade.
function tokenAprovacao(string $segredo, int $usuarioId, ?int $agora = null): string
{
    $corpo = $usuarioId . '.' . (($agora ?? time()) + VALIDADE_APROVACAO);
    return $corpo . '.' . base64url(hash_hmac('sha256', "aprovacao:$corpo", $segredo, true));
}

function lerTokenAprovacao(string $segredo, $token): ?int
{
    $partes = explode('.', (string) $token);
    if (count($partes) !== 3 || !ctype_digit($partes[0]) || !ctype_digit($partes[1])) return null;
    [$id, $expira, $assinatura] = $partes;
    $esperada = base64url(hash_hmac('sha256', "aprovacao:$id.$expira", $segredo, true));
    if (!hash_equals($esperada, $assinatura) || (int) $expira < time()) return null;
    return (int) $id;
}

// Limite de tentativas de login por IP + e-mail, guardado no banco.
function chaveTentativa(string $email): string
{
    return hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . $email);
}

function loginBloqueado(string $chave): bool
{
    $t = linha('SELECT qtd, inicio FROM tentativas_login WHERE chave = ?', [$chave]);
    return $t && $t['inicio'] + JANELA_TENTATIVAS >= time() && $t['qtd'] >= MAX_TENTATIVAS;
}

function loginFalhou(string $chave): void
{
    sql('DELETE FROM tentativas_login WHERE inicio < ?', [time() - JANELA_TENTATIVAS]);
    sql('INSERT INTO tentativas_login (chave, qtd, inicio) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE qtd = qtd + 1', [$chave, time()]);
}

function limparTentativas(string $chave): void
{
    sql('DELETE FROM tentativas_login WHERE chave = ?', [$chave]);
}
