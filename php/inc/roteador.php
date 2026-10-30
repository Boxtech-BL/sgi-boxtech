<?php
// Roteador mínimo da API: rota('GET', '/clientes/(\d+)', fn(array $corpo, string $id) => ...).
// O handler devolve o que vira JSON; null responde 204. Rotas não públicas exigem login.
declare(strict_types=1);

$GLOBALS['rotas'] = [];

function rota(string $metodo, string $padrao, callable $fn, bool $publica = false): void
{
    $GLOBALS['rotas'][] = [$metodo, '#^' . $padrao . '$#', $fn, $publica];
}

function ehAdmin(): bool
{
    return (usuarioAtual()['papel'] ?? null) === 'admin';
}

function soAdmin(): void
{
    exigir(ehAdmin(), 'Acesso restrito à Boxtech', 403);
}

// Usuário de empresa só enxerga o próprio cliente; para os outros, o registro "não existe".
function doCliente($clienteId): void
{
    exigir(ehAdmin() || (int) usuarioAtual()['cliente_id'] === (int) $clienteId, 'Registro não encontrado', 404);
}

function responderJson(int $status, $dados): void
{
    http_response_code($status);
    if ($status === 204) return;
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE);
}

function atenderApi(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Cache-Control: no-store');

    try {
        $metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $caminho = '/' . trim((string) ($_GET['r'] ?? ''), '/');

        if (!in_array($metodo, ['GET', 'HEAD', 'OPTIONS'], true)) {
            // Proteção contra CSRF: escrita só com JSON e, se o navegador mandar Origin, do mesmo site.
            $origem = $_SERVER['HTTP_ORIGIN'] ?? '';
            if ($origem !== '') {
                $p = parse_url($origem);
                $hostOrigem = ($p['host'] ?? '') . (isset($p['port']) ? ':' . $p['port'] : '');
                exigir($hostOrigem === ($_SERVER['HTTP_HOST'] ?? ''), 'Origem não permitida', 403);
            }
            if ($metodo !== 'DELETE') {
                exigir(stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === 0, 'Envie JSON', 415);
            }
        }

        $corpo = [];
        $bruto = file_get_contents('php://input');
        if ($bruto !== '' && $bruto !== false) {
            exigir(strlen($bruto) <= 200 * 1024, 'Requisição grande demais', 413);
            $corpo = json_decode($bruto, true);
            exigir(json_last_error() === JSON_ERROR_NONE, 'JSON inválido');
            if (!is_array($corpo)) $corpo = [];
        }

        foreach ($GLOBALS['rotas'] as [$m, $padrao, $fn, $publica]) {
            if ($m !== $metodo || !preg_match($padrao, $caminho, $partes)) continue;
            if (!$publica) exigir(usuarioAtual(), 'Faça login para continuar', 401);
            $r = $fn($corpo, ...array_slice($partes, 1));
            $status = http_response_code();
            responderJson($r === null ? 204 : ($status && $status !== 200 ? $status : 200), $r);
            return;
        }
        throw new ErroHttp(404, 'Rota não encontrada');
    } catch (ErroHttp $e) {
        responderJson($e->status, ['erro' => $e->getMessage()]);
    } catch (Throwable $e) {
        error_log('SGI: ' . $e);
        responderJson(500, ['erro' => 'Erro interno']);
    }
}
