<?php
// Instalação: cria as tabelas no PostgreSQL e o administrador da Boxtech.
// Abra https://.../instalar.php uma vez depois de preencher o config.php (ou rode: php instalar.php).
// Pode rodar de novo sem perder dados; depois do primeiro acesso, apague este arquivo do servidor.
declare(strict_types=1);

require __DIR__ . '/inc/base.php';

$mensagens = [];
$ok = true;
try {
    $cfg = config();
    db();
    $mensagens[] = 'Conexão com o banco PostgreSQL: ok (' . db()->query('SHOW server_version')->fetchColumn() . ').';
    instalarEsquema();
    $mensagens[] = 'Tabelas criadas ou já existentes: ok.';

    $senha = (string) ($cfg['admin_senha_inicial'] ?? '');
    if ($senha !== '') {
        if (strlen($senha) < 8) throw new ErroHttp(400, 'admin_senha_inicial precisa ter pelo menos 8 caracteres.');
        garantirAdmin($cfg['aprovador'], $senha);
        $mensagens[] = "Administrador {$cfg['aprovador']} pronto. Agora apague a linha admin_senha_inicial do config.php.";
    } elseif (linha("SELECT 1 FROM usuarios WHERE papel = 'admin' AND status = 'ativo'")) {
        $mensagens[] = 'Administrador já cadastrado.';
    } else {
        $ok = false;
        $mensagens[] = "Nenhum administrador cadastrado. Coloque 'admin_senha_inicial' => 'uma-senha-forte' no config.php e abra esta página de novo.";
    }
    if ($ok) $mensagens[] = 'Pronto. Apague o instalar.php do servidor e abra o SGI.';
} catch (Throwable $e) {
    $ok = false;
    $mensagens[] = 'Erro: ' . ($e instanceof ErroHttp ? $e->getMessage() : get_class($e) . ' - ' . $e->getMessage());
}

if (PHP_SAPI === 'cli') {
    echo implode(PHP_EOL, $mensagens), PHP_EOL;
    exit($ok ? 0 : 1);
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
?>
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Instalação do SGI Boxtech</title>
  <link rel="stylesheet" href="estilo.css">
</head>
<body>
  <main id="app">
    <div class="painel" style="max-width:640px;margin:40px auto">
      <h1>Instalação do SGI Boxtech</h1>
      <ul>
        <?php foreach ($mensagens as $m): ?><li><?= escHtml($m) ?></li><?php endforeach ?>
      </ul>
      <?php if ($ok): ?><p><a class="botao" href="./">Abrir o SGI</a></p><?php endif ?>
    </div>
  </main>
</body>
</html>
