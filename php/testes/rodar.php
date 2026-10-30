<?php
// Testes do SGI em PHP. Precisam de um PostgreSQL local com um banco vazio só para teste:
//   SGI_TESTE_DB="pgsql://usuario:senha@127.0.0.1:5432/sgi_teste" php testes/rodar.php
// O banco de teste é apagado e recriado a cada execução.
declare(strict_types=1);

$url = parse_url(getenv('SGI_TESTE_DB') ?: 'pgsql://sgi:sgi@127.0.0.1:5432/sgi_teste');
$raiz = dirname(__DIR__);
$tmp = __DIR__ . '/tmp';
@mkdir($tmp);
$logEmails = "$tmp/emails.log";
@unlink($logEmails);
$configTeste = "$tmp/config.php";
file_put_contents($configTeste, '<?php return ' . var_export([
    'db' => ['host' => $url['host'], 'porta' => $url['port'] ?? 5432, 'nome' => ltrim($url['path'], '/'),
        'usuario' => urldecode($url['user'] ?? ''), 'senha' => urldecode($url['pass'] ?? '')],
    'url_base' => 'https://sgi.exemplo',
    'segredo' => str_repeat('segredo-de-teste-', 3),
    'aprovador' => 'boxtech@boxtech.com.br',
    'admin_senha_inicial' => 'senha-admin-123',
    'email' => ['modo' => 'log', 'log' => $logEmails],
], true) . ';');
putenv("SGI_CONFIG=$configTeste");

require "$raiz/inc/base.php";
require "$raiz/inc/catalogo.php";
require "$raiz/inc/maturidade.php";
require "$raiz/inc/seguranca.php";

// Banco limpo
foreach (db()->query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")->fetchAll(PDO::FETCH_COLUMN) as $t) {
    db()->exec('DROP TABLE IF EXISTS "' . $t . '" CASCADE');
}
passthru(PHP_BINARY . ' ' . escapeshellarg("$raiz/instalar.php"), $saida);
if ($saida !== 0) exit("Instalação falhou\n");

// ---------- Mini framework de teste ----------
$falhas = 0;
$total = 0;
function teste(string $nome, callable $fn): void
{
    global $falhas, $total;
    $total++;
    try {
        $fn();
        echo "ok   $nome\n";
    } catch (Throwable $e) {
        $falhas++;
        echo "FALHOU $nome\n     {$e->getMessage()} ({$e->getFile()}:{$e->getLine()})\n";
    }
}
function igual($esperado, $obtido, string $msg = ''): void
{
    if ($esperado !== $obtido) {
        throw new Exception(($msg ? "$msg: " : '') . 'esperado ' . json_encode($esperado, JSON_UNESCAPED_UNICODE) . ', obtido ' . json_encode($obtido, JSON_UNESCAPED_UNICODE));
    }
}
function verdade($v, string $msg = 'esperado verdadeiro'): void
{
    if (!$v) throw new Exception($msg);
}

// ---------- Servidor embutido do PHP ----------
$porta = 18000 + random_int(0, 999);
$servidor = proc_open([PHP_BINARY, '-S', "127.0.0.1:$porta", '-t', $raiz], [1 => ['file', "$tmp/servidor.log", 'w'], 2 => ['file', "$tmp/servidor.log", 'a']], $pipes);
register_shutdown_function(fn() => proc_terminate($servidor));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $porta); $i++) usleep(100000);
$base = "http://127.0.0.1:$porta";

function req(string $metodo, string $rota, $corpo = null, ?string $cookie = null, array $extras = []): array
{
    global $base;
    $ch = curl_init("$base/api.php?r=" . rawurlencode($rota));
    $temTipo = (bool) preg_grep('/^Content-Type:/i', $extras);
    $cab = array_merge($temTipo ? [] : ['Content-Type: application/json'], $cookie ? ["Cookie: $cookie"] : [], $extras);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $metodo, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_HTTPHEADER => $cab]);
    if ($corpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($corpo));
    $resp = curl_exec($ch);
    $tam = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $cabecalhos = substr($resp, 0, $tam);
    preg_match('/^Set-Cookie: (sgi_sessao=[^;]+)/mi', $cabecalhos, $m);
    $json = substr($resp, $tam);
    return ['status' => $status, 'corpo' => $json === '' ? null : json_decode($json, true), 'cookie' => $m[1] ?? null, 'bruto' => $json];
}
function login(string $e, string $s): ?string
{
    return req('POST', '/login', ['email' => $e, 'senha' => $s])['cookie'];
}
function emails(): array
{
    global $logEmails;
    return is_file($logEmails) ? array_map(fn($l) => json_decode($l, true), file($logEmails, FILE_IGNORE_NEW_LINES)) : [];
}
function ultimoEmail(): array
{
    $e = emails();
    return end($e);
}
function cadastro(string $nome, string $email): array
{
    return req('POST', '/cadastro', ['empresa' => ['nome' => $nome, 'cnpj' => '11.111.111/0001-11', 'porte' => 'medio'], 'nome' => 'Fulano', 'email' => $email, 'senha' => 'senha-forte-1']);
}
function tokenDoEmail(array $msg): string
{
    preg_match('~#/aprovar/(\S+)~', $msg['texto'], $m);
    return $m[1];
}
$praticas = catalogo()['praticas'];
$todas = fn(int $nivel, int $meta = 3) => array_map(fn($p) => ['pratica_id' => $p['id'], 'nivel' => $nivel, 'meta' => $meta], $praticas);
function alterar(array $itens, string $id, int $nivel): array
{
    foreach ($itens as &$i) if ($i['pratica_id'] === $id) $i['nivel'] = $nivel;
    return $itens;
}
function daArea(array $r, string $area)
{
    foreach ($r['areas'] as $a) if ($a['area'] === $area) return $a['nota'];
}

// ---------- Maturidade (regras puras) ----------
teste('nota geral é a média das áreas com uma casa decimal', function () use ($todas) {
    $itens = alterar(alterar($todas(2), 'central-servico', 1), 'requisicao', 3);
    $r = calcularNotas($itens);
    igual(2.0, daArea($r, 'atendimento'));
    igual(2.0, $r['geral']);
    igual(true, $r['completa']);
});

teste('média da área arredonda para uma casa', function () use ($todas) {
    igual(2.3, daArea(calcularNotas(alterar($todas(2), 'continuidade', 3)), 'seguranca'));
});

teste('pesos alteram a nota geral', function () use ($todas) {
    $itens = $todas(2);
    foreach (['seguranca-informacao', 'continuidade', 'monitoramento'] as $id) $itens = alterar($itens, $id, 4);
    igual(2.4, calcularNotas($itens)['geral']);
    igual(2.7, calcularNotas($itens, ['seguranca' => 2])['geral']);
});

teste('práticas sem nível ficam fora da média e marcam a avaliação como incompleta', function () {
    $r = calcularNotas([['pratica_id' => 'incidente', 'nivel' => 4, 'meta' => 3]]);
    igual(4.0, $r['geral']);
    igual(false, $r['completa']);
    igual(null, daArea($r, 'controle'));
});

teste('lacunas ordenadas pela maior distância da meta, empate pela onda mais básica', function () use ($todas) {
    $itens = alterar(alterar(alterar($todas(3), 'problema', 1), 'ativos', 1), 'mudanca', 2);
    igual(['ativos', 'problema', 'mudanca'], array_column(calcularNotas($itens)['criticas'], 'pratica'));
});

teste('sem avaliações, nota é nula', fn() => igual(null, calcularNotas([])['geral']));

teste('comparar calcula a variação por prática', function () {
    $c = array_column(comparar([['pratica_id' => 'incidente', 'nivel' => 1]], [['pratica_id' => 'incidente', 'nivel' => 3]]), 'variacao', 'pratica');
    igual(2, $c['incidente']);
    igual(null, $c['ativos']);
});

// ---------- Segurança ----------
teste('token de aprovação: assinatura e validade', function () {
    $t = tokenAprovacao('s', 42);
    igual(42, lerTokenAprovacao('s', $t));
    igual(null, lerTokenAprovacao('outro', $t));
    igual(null, lerTokenAprovacao('s', preg_replace('/^42/', '43', $t)));
    igual(null, lerTokenAprovacao('s', tokenAprovacao('s', 42, time() - 31 * 86400)));
});

// ---------- Acesso ----------
teste('sem login, a API recusa', function () {
    igual(401, req('GET', '/clientes')['status']);
    igual(200, req('GET', '/catalogo')['status']);
});

teste('cadastro fica pendente até a Boxtech liberar pelo link do e-mail', function () {
    igual(201, cadastro('Empresa A', 'ana@empresa-a.com')['status']);
    $msg = ultimoEmail();
    igual('boxtech@boxtech.com.br', $msg['para']);
    verdade(str_contains($msg['assunto'], 'Empresa A'));
    verdade(str_contains($msg['texto'], 'https://sgi.exemplo/#/aprovar/'), 'link com url_base');
    $token = tokenDoEmail($msg);

    $antes = req('POST', '/login', ['email' => 'ana@empresa-a.com', 'senha' => 'senha-forte-1']);
    igual(403, $antes['status']);
    verdade(str_contains($antes['corpo']['erro'], 'aguarda'));

    $ver = req('GET', "/aprovacoes/$token");
    igual('Empresa A', $ver['corpo']['empresa']);
    igual('pendente', $ver['corpo']['status']);

    $ok = req('POST', "/aprovacoes/$token", ['decisao' => 'aprovar']);
    igual('ativo', $ok['corpo']['status']);
    igual('ana@empresa-a.com', ultimoEmail()['para']);
    verdade(str_contains(ultimoEmail()['assunto'], 'liberado'));

    igual(409, req('POST', "/aprovacoes/$token", ['decisao' => 'recusar'])['status']);

    $cookie = login('ana@empresa-a.com', 'senha-forte-1');
    verdade($cookie, 'login devolve cookie');
    igual('empresa', req('GET', '/eu', null, $cookie)['corpo']['papel']);
});

teste('e-mail repetido, senha curta e link falso são recusados', function () {
    igual(400, cadastro('Outra', 'ana@empresa-a.com')['status']);
    igual(400, cadastro('Outra', 'ANA@empresa-a.com')['status']);
    igual(400, req('POST', '/cadastro', ['empresa' => ['nome' => 'X'], 'nome' => 'Y', 'email' => 'y@x.com', 'senha' => '123'])['status']);
    igual(404, req('GET', '/aprovacoes/1.9999999999999.falso')['status']);
});

teste('cada empresa só vê os próprios dados', function () {
    cadastro('Empresa B', 'bia@empresa-b.com');
    $admin = login('boxtech@boxtech.com.br', 'senha-admin-123');

    $usuarios = req('GET', '/admin/usuarios', null, $admin)['corpo'];
    $bia = array_values(array_filter($usuarios, fn($u) => $u['email'] === 'bia@empresa-b.com'))[0];
    igual('pendente', $bia['status']);
    igual('ativo', req('POST', "/admin/usuarios/{$bia['id']}/aprovar", [], $admin)['corpo']['status']);

    $ana = login('ana@empresa-a.com', 'senha-forte-1');
    $biaC = login('bia@empresa-b.com', 'senha-forte-1');

    igual(['Empresa A'], array_column(req('GET', '/clientes', null, $ana)['corpo'], 'nome'));
    igual(2, count(req('GET', '/clientes', null, $admin)['corpo']));

    $idB = req('GET', '/clientes', null, $biaC)['corpo'][0]['id'];
    igual(404, req('GET', "/clientes/$idB", null, $ana)['status']);
    igual(404, req('GET', "/clientes/$idB/avaliacoes", null, $ana)['status']);

    $av = req('POST', "/clientes/$idB/avaliacoes", ['tipo' => 'inicial'], $biaC)['corpo'];
    igual(404, req('GET', "/avaliacoes/{$av['id']}", null, $ana)['status']);
    igual(200, req('PUT', "/avaliacoes/{$av['id']}", ['itens' => [['pratica_id' => 'incidente', 'nivel' => 2, 'meta' => 3]]], $biaC)['status']);
    igual(403, req('PUT', "/avaliacoes/{$av['id']}", ['status' => 'concluida'], $biaC)['status']);

    igual(403, req('POST', '/clientes', ['nome' => 'Z'], $biaC)['status']);
    $proj = req('POST', "/clientes/$idB/projetos", ['nome' => 'P'], $admin)['corpo'];
    igual(200, req('GET', "/projetos/{$proj['id']}", null, $biaC)['status']);
    igual(403, req('PUT', "/projetos/{$proj['id']}/fases/1", ['status' => 'em_andamento'], $biaC)['status']);
    igual(404, req('GET', "/projetos/{$proj['id']}", null, $ana)['status']);

    igual(403, req('GET', '/admin/usuarios', null, $biaC)['status']);

    req('POST', "/admin/usuarios/{$bia['id']}/bloquear", [], $admin);
    igual(401, req('GET', '/eu', null, $biaC)['status']);
});

teste('recusa avisa a empresa e impede o login', function () {
    cadastro('Empresa C', 'caio@empresa-c.com');
    req('POST', '/aprovacoes/' . tokenDoEmail(ultimoEmail()), ['decisao' => 'recusar']);
    verdade(str_contains(ultimoEmail()['assunto'], 'Cadastro'));
    igual(403, req('POST', '/login', ['email' => 'caio@empresa-c.com', 'senha' => 'senha-forte-1'])['status']);
});

teste('proteções: senha errada, origem estranha, sem JSON e excesso de tentativas', function () {
    igual(401, req('POST', '/login', ['email' => 'boxtech@boxtech.com.br', 'senha' => 'x'])['status']);
    igual(403, req('POST', '/login', ['email' => 'a@b.c', 'senha' => 'x'], null, ['Origin: https://malicioso.exemplo'])['status']);
    igual(415, req('POST', '/login', ['email' => 'a@b.c', 'senha' => 'x'], null, ['Content-Type: text/plain'])['status']);
    for ($i = 0; $i < 10; $i++) req('POST', '/login', ['email' => 'alvo@x.com', 'senha' => 'x']);
    igual(429, req('POST', '/login', ['email' => 'alvo@x.com', 'senha' => 'x'])['status']);
});

teste('sair encerra a sessão', function () {
    $c = login('ana@empresa-a.com', 'senha-forte-1');
    igual(200, req('GET', '/eu', null, $c)['status']);
    req('POST', '/logout', [], $c);
    igual(401, req('GET', '/eu', null, $c)['status']);
});

// ---------- Fluxo completo da API (administrador) ----------
teste('fluxo completo: cliente, avaliação, projeto e indicadores', function () use ($todas, $praticas) {
    $adm = login('boxtech@boxtech.com.br', 'senha-admin-123');
    $r = fn($m, $u, $c = null) => req($m, $u, $c, $adm);

    $novo = $r('POST', '/clientes', ['nome' => 'Clínica Exemplo', 'segmento' => 'saúde', 'porte' => 'medio']);
    igual(201, $novo['status']);
    $cliente = $novo['corpo'];
    igual('Clínica Exemplo', $cliente['nome']);

    $resp = $r('POST', "/clientes/{$cliente['id']}/avaliacoes", ['tipo' => 'inicial', 'data' => '2026-11-03']);
    $av = $resp['corpo'];
    verdade(str_contains($resp['bruto'], '"pesos":{}'), 'pesos vazio sai como objeto');
    igual(count($praticas), count($av['itens']));
    verdade(array_reduce($av['itens'], fn($ok, $i) => $ok && $i['meta'] === 3, true), 'meta sugerida 3');
    igual('2026-11-03', $av['data']);

    igual(400, $r('PUT', "/avaliacoes/{$av['id']}", ['status' => 'concluida', 'itens' => [['pratica_id' => 'incidente', 'nivel' => 2, 'meta' => 3]]])['status']);

    $itens = array_map(fn($p) => ['pratica_id' => $p['id'], 'nivel' => $p['area'] === 'seguranca' ? 1 : 2, 'meta' => 3], $praticas);
    $conc = $r('PUT', "/avaliacoes/{$av['id']}", ['status' => 'concluida', 'pesos' => ['seguranca' => 2], 'itens' => $itens]);
    igual(200, $conc['status']);
    igual('concluida', $conc['corpo']['status']);
    igual(1.7, $conc['corpo']['resultado']['geral']);
    igual('seguranca', $conc['corpo']['resultado']['criticas'][0]['area']);

    igual(400, $r('PUT', "/avaliacoes/{$av['id']}", ['itens' => [['pratica_id' => 'incidente', 'nivel' => 7]]])['status']);

    $av2 = $r('POST', "/clientes/{$cliente['id']}/avaliacoes", ['tipo' => 'encerramento', 'data' => '2027-06-01'])['corpo'];
    $av2b = $r('PUT', "/avaliacoes/{$av2['id']}", ['itens' => [['pratica_id' => 'incidente', 'nivel' => 3, 'meta' => 3]]])['corpo'];
    igual($av['id'], $av2b['anterior']['id']);
    igual(1, array_column($av2b['anterior']['comparacao'], 'variacao', 'pratica')['incidente']);

    $lista = array_column($r('GET', '/clientes')['corpo'], null, 'nome');
    igual(3.0, $lista['Clínica Exemplo']['nota_atual']);

    $proj = $r('POST', "/clientes/{$cliente['id']}/projetos", ['nome' => 'Implantação 2026'])['corpo'];
    igual(5, count($proj['fases']));
    igual(['central-servico', 'incidente', 'requisicao', 'ativos'], $proj['ondas'][0]['praticas']);
    igual('Iniciação', $proj['fases'][0]['nome']);

    igual(400, $r('PUT', "/projetos/{$proj['id']}/fases/1", ['status' => 'concluida'])['status']);
    igual(20, $r('PUT', "/projetos/{$proj['id']}/fases/1", ['status' => 'concluida', 'portao_aprovado_em' => '2026-11-10'])['corpo']['progresso']);
    igual(200, $r('PUT', "/projetos/{$proj['id']}/fases/4", ['status' => 'concluida'])['status'], 'fase 4 sem portão');

    igual(400, $r('PUT', "/projetos/{$proj['id']}/ondas/2", ['status' => 'desenho'])['status']);
    igual(400, $r('PUT', "/projetos/{$proj['id']}/ondas/1", ['status' => 'aceita'])['status']);
    $r('PUT', "/projetos/{$proj['id']}/ondas/1", ['status' => 'aceita', 'aceite_em' => '2027-02-01']);
    igual(200, $r('PUT', "/projetos/{$proj['id']}/ondas/2", ['status' => 'desenho'])['status']);

    igual(200, $r('PUT', "/projetos/{$proj['id']}", ['status' => 'suspenso', 'inicio' => ''])['status']);
    igual(400, $r('PUT', "/projetos/{$proj['id']}", ['status' => 'qualquer'])['status']);

    $r('POST', "/clientes/{$cliente['id']}/medicoes", ['indicador_id' => 'mttr', 'periodo' => '2026-11', 'valor' => 20, 'linha_base' => true]);
    $r('POST', "/clientes/{$cliente['id']}/medicoes", ['indicador_id' => 'mttr', 'periodo' => '2027-03', 'valor' => 12]);
    $mttr = array_column($r('GET', "/clientes/{$cliente['id']}/indicadores")['corpo'], null, 'id')['mttr'];
    igual(['delta' => -8.0, 'melhorou' => true], $mttr['evolucao']);
    igual(400, $r('POST', "/clientes/{$cliente['id']}/medicoes", ['indicador_id' => 'mttr', 'periodo' => '2027-13', 'valor' => 1])['status']);
    igual(204, $r('DELETE', "/medicoes/{$mttr['ultima']['id']}")['status']);

    igual(204, $r('DELETE', "/clientes/{$cliente['id']}")['status']);
    igual(404, $r('GET', "/avaliacoes/{$av['id']}")['status']);
});

teste('validações básicas', function () {
    $adm = login('boxtech@boxtech.com.br', 'senha-admin-123');
    igual(400, req('POST', '/clientes', [], $adm)['status']);
    igual(404, req('GET', '/clientes/999', null, $adm)['status']);
    igual(404, req('GET', '/nada', null, $adm)['status']);
});

$log = @file_get_contents("$tmp/servidor.log");
if ($log && preg_match('/(PHP (Warning|Notice|Deprecated|Fatal)[^\n]*)/', $log, $m)) {
    $falhas++;
    echo "FALHOU servidor registrou avisos do PHP:\n     {$m[1]}\n";
}

echo "\n" . ($total - $falhas) . " de $total testes passaram\n";
exit($falhas ? 1 : 0);
