<?php
// Envio de e-mail: SMTP autenticado (sem bibliotecas externas), mail() do PHP ou arquivo de log.
declare(strict_types=1);

function enviarEmail(string $para, string $assunto, string $texto, ?string $html = null): void
{
    $c = config()['email'] ?? ['modo' => 'log'];
    $remetente = $c['remetente'] ?? config()['aprovador'];
    $nome = $c['nome_remetente'] ?? 'SGI Boxtech';
    $modo = $c['modo'] ?? 'log';
    $assunto = preg_replace('/[\r\n]+/', ' ', $assunto); // o nome da empresa vem do formulário

    if ($modo === 'log') {
        $arquivo = $c['log'] ?? __DIR__ . '/emails.log';
        $registro = json_encode(['para' => $para, 'assunto' => $assunto, 'texto' => $texto, 'html' => $html], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        file_put_contents($arquivo, $registro . "\n", FILE_APPEND | LOCK_EX);
        return;
    }

    [$cabecalhos, $corpo] = montarMensagem($remetente, $nome, $para, $assunto, $texto, $html);
    if ($modo === 'mail') {
        $ok = mail($para, mb_encode_mimeheader($assunto, 'UTF-8'), $corpo, implode("\r\n", $cabecalhos), '-f' . $remetente);
        if (!$ok) throw new RuntimeException('mail() recusou a mensagem');
        return;
    }
    $cabecalhos[] = 'To: ' . $para;
    $cabecalhos[] = 'Subject: ' . mb_encode_mimeheader($assunto, 'UTF-8');
    enviarSmtp($c, $remetente, $para, implode("\r\n", $cabecalhos) . "\r\n\r\n" . $corpo);
}

// Falha no e-mail não deve desfazer o cadastro nem a decisão: registra no log de erros do PHP.
function enviarEmailSemFalhar(string $para, string $assunto, string $texto, ?string $html = null): void
{
    try {
        enviarEmail($para, $assunto, $texto, $html);
    } catch (Throwable $e) {
        error_log('SGI: falha ao enviar e-mail para ' . $para . ': ' . $e->getMessage());
    }
}

function montarMensagem(string $remetente, string $nome, string $para, string $assunto, string $texto, ?string $html): array
{
    $cabecalhos = [
        'From: ' . mb_encode_mimeheader($nome, 'UTF-8') . " <$remetente>",
        'Reply-To: ' . config()['aprovador'],
        'Date: ' . date(DATE_RFC2822),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . (substr(strrchr($remetente, '@'), 1) ?: 'sgi') . '>',
        'MIME-Version: 1.0',
    ];
    $parte = fn(string $tipo, string $conteudo) => "Content-Type: $tipo; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        . rtrim(chunk_split(base64_encode($conteudo), 76, "\r\n"));
    if ($html === null) {
        $cabecalhos[] = 'Content-Type: text/plain; charset=UTF-8';
        $cabecalhos[] = 'Content-Transfer-Encoding: base64';
        return [$cabecalhos, rtrim(chunk_split(base64_encode($texto), 76, "\r\n"))];
    }
    $limite = 'sgi-' . bin2hex(random_bytes(8));
    $cabecalhos[] = "Content-Type: multipart/alternative; boundary=\"$limite\"";
    $corpo = "--$limite\r\n" . $parte('text/plain', $texto) . "\r\n--$limite\r\n" . $parte('text/html', $html) . "\r\n--$limite--";
    return [$cabecalhos, $corpo];
}

// Cliente SMTP mínimo: porta 465 (SSL direto) ou 587/25 (STARTTLS quando o servidor oferece), AUTH LOGIN.
function enviarSmtp(array $c, string $de, string $para, string $mensagem): void
{
    $porta = (int) ($c['porta'] ?? 587);
    $host = $c['host'];
    $endereco = ($porta === 465 ? 'ssl://' : 'tcp://') . $host . ':' . $porta;
    $s = @stream_socket_client($endereco, $errno, $errstr, 20);
    if (!$s) throw new RuntimeException("Não conectou ao SMTP $host:$porta ($errstr)");
    stream_set_timeout($s, 20);

    $ler = function () use ($s): array {
        $resposta = '';
        while (($l = fgets($s, 1024)) !== false) {
            $resposta .= $l;
            if (strlen($l) < 4 || $l[3] === ' ') break;
        }
        return [(int) substr($resposta, 0, 3), $resposta];
    };
    $cmd = function (?string $linha, array $esperado) use ($s, $ler): string {
        if ($linha !== null) fwrite($s, $linha . "\r\n");
        [$cod, $resp] = $ler();
        if (!in_array($cod, $esperado, true)) throw new RuntimeException('SMTP: ' . trim($resp));
        return $resp;
    };

    try {
        $cmd(null, [220]);
        $nomeLocal = gethostname() ?: 'localhost';
        $ehlo = $cmd("EHLO $nomeLocal", [250]);
        if ($porta !== 465 && stripos($ehlo, 'STARTTLS') !== false) {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new RuntimeException('SMTP: falha ao iniciar TLS');
            }
            $cmd("EHLO $nomeLocal", [250]);
        }
        if (!empty($c['usuario'])) {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode($c['usuario']), [334]);
            $cmd(base64_encode($c['senha'] ?? ''), [235]);
        }
        $cmd("MAIL FROM:<$de>", [250]);
        $cmd("RCPT TO:<$para>", [250, 251]);
        $cmd('DATA', [354]);
        // Linhas que começam com ponto são duplicadas (transparência do SMTP).
        $dados = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $mensagem));
        $cmd($dados . "\r\n.", [250]);
        $cmd('QUIT', [221]);
    } finally {
        fclose($s);
    }
}
