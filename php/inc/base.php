<?php
// Configuração, banco e utilitários comuns.
declare(strict_types=1);

if (PHP_VERSION_ID < 80000) {
    http_response_code(500);
    exit('O SGI precisa de PHP 8.0 ou mais novo. Troque a versão no painel da hospedagem.');
}

date_default_timezone_set('America/Sao_Paulo');
mb_internal_encoding('UTF-8');

class ErroHttp extends Exception
{
    public $status;

    public function __construct(int $status, string $mensagem)
    {
        parent::__construct($mensagem);
        $this->status = $status;
    }
}

function exigir($cond, string $mensagem, int $status = 400): void
{
    if (!$cond) throw new ErroHttp($status, $mensagem);
}

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $arquivo = getenv('SGI_CONFIG') ?: __DIR__ . '/../config.php';
        if (!is_file($arquivo)) throw new ErroHttp(500, 'Falta o arquivo config.php (copie de config.exemplo.php).');
        $cfg = require $arquivo;
        $cfg['aprovador'] = $cfg['aprovador'] ?? 'boxtech@boxtech.com.br';
        $cfg['url_base'] = rtrim($cfg['url_base'] ?? '', '/');
        exigir(strlen($cfg['segredo'] ?? '') >= 32, 'Defina "segredo" no config.php (texto aleatório de 32 caracteres ou mais).', 500);
    }
    return $cfg;
}

// Endereço público do sistema; sem url_base no config, deduz da requisição atual.
function urlBase(): string
{
    if (config()['url_base'] !== '') return config()['url_base'];
    $esquema = conexaoSegura() ? 'https' : 'http';
    $pasta = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $esquema . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $pasta;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config()['db'];
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], $c['porta'] ?? 3306, $c['nome']),
            $c['usuario'],
            $c['senha'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false, // números voltam como números
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ]
        );
        $pdo->exec("SET time_zone = '-03:00'");
    }
    return $pdo;
}

// Executa uma consulta preparada e devolve o PDOStatement.
function sql(string $consulta, array $params = []): PDOStatement
{
    $st = db()->prepare($consulta);
    $st->execute($params);
    return $st;
}

function linha(string $consulta, array $params = []): ?array
{
    $r = sql($consulta, $params)->fetch();
    return $r === false ? null : $r;
}

function linhas(string $consulta, array $params = []): array
{
    return sql($consulta, $params)->fetchAll();
}

function transacao(callable $fn)
{
    db()->beginTransaction();
    try {
        $r = $fn();
        db()->commit();
        return $r;
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
}

function instalarEsquema(): void
{
    foreach (require __DIR__ . '/esquema.php' as $comando) db()->exec($comando);
}

// Cria (ou atualiza a senha de) um administrador da Boxtech.
function garantirAdmin(string $email, string $senha, string $nome = 'Boxtech'): int
{
    $hash = password_hash($senha, PASSWORD_DEFAULT);
    $existente = linha('SELECT id FROM usuarios WHERE email = ?', [$email]);
    if ($existente) {
        sql("UPDATE usuarios SET senha_hash = ?, papel = 'admin', status = 'ativo' WHERE id = ?", [$hash, $existente['id']]);
        return (int) $existente['id'];
    }
    sql("INSERT INTO usuarios (nome, email, senha_hash, papel, status, decidido_em) VALUES (?, ?, ?, 'admin', 'ativo', NOW())", [$nome, $email, $hash]);
    return (int) db()->lastInsertId();
}

// Texto livre vindo do formulário: corta espaços e limita o tamanho.
function texto($v, int $max = 200): string
{
    return is_string($v) ? mb_substr(trim($v), 0, $max) : '';
}

function textoOuNulo($v, int $max = 200): ?string
{
    $t = texto($v, $max);
    return $t === '' ? null : $t;
}

// Data AAAA-MM-DD ou nulo (o MySQL recusa texto vazio em campo DATE).
function dataOuNulo($v): ?string
{
    if ($v === null || $v === '') return null;
    exigir(is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) && checkdate((int) substr($v, 5, 2), (int) substr($v, 8, 2), (int) substr($v, 0, 4)), 'Data inválida (use AAAA-MM-DD)');
    return $v;
}

function emailValido($e): bool
{
    return is_string($e) && strlen($e) <= 200 && (bool) preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $e);
}

function escHtml($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

function arred(float $n, int $casas = 1): float
{
    return round($n, $casas);
}
