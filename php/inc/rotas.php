<?php
// API do SGI: clientes, avaliações de maturidade, projetos de implantação e indicadores.
declare(strict_types=1);

const TIPOS_AVALIACAO = ['inicial', 'encerramento', 'semestral'];
const STATUS_AVALIACAO = ['rascunho', 'concluida'];
const STATUS_PROJETO = ['ativo', 'encerrado', 'suspenso'];
const STATUS_FASE = ['nao_iniciada', 'em_andamento', 'concluida'];
const STATUS_ONDA = ['nao_iniciada', 'desenho', 'configuracao', 'treinamento', 'piloto', 'aceita'];

// Valor do corpo da requisição quando o campo foi enviado (mesmo null); senão, o atual.
function campo(array $corpo, string $nome, $atual)
{
    return array_key_exists($nome, $corpo) ? $corpo[$nome] : $atual;
}

function buscar(string $tabela, $id): array
{
    $l = linha("SELECT * FROM $tabela WHERE id = ?", [(int) $id]);
    exigir($l, 'Registro não encontrado', 404);
    return $l;
}

function nivelValido($n): bool
{
    return $n === null || (is_int($n) && $n >= 1 && $n <= 5);
}

rota('GET', '/catalogo', fn() => catalogo(), true);

// ---------- Clientes ----------
function validarCliente(array $d): array
{
    $nome = texto($d['nome'] ?? null);
    exigir($nome !== '', 'Informe o nome do cliente');
    $porte = $d['porte'] ?? null;
    exigir($porte === null || $porte === '' || in_array($porte, PORTES, true), 'Porte inválido');
    return [$nome, textoOuNulo($d['cnpj'] ?? null, 30), textoOuNulo($d['segmento'] ?? null), $porte ?: null, textoOuNulo($d['contato'] ?? null, 400)];
}

rota('GET', '/clientes', function () {
    $u = usuarioAtual();
    $lista = linhas("
        SELECT c.*,
          (SELECT a.id FROM avaliacoes a WHERE a.cliente_id = c.id ORDER BY a.data DESC, a.id DESC LIMIT 1) AS ultima_avaliacao_id,
          (SELECT COUNT(*) FROM projetos p WHERE p.cliente_id = c.id AND p.status = 'ativo') AS projetos_ativos,
          (SELECT u.status FROM usuarios u WHERE u.cliente_id = c.id ORDER BY u.id LIMIT 1) AS acesso
        FROM clientes c
        WHERE ? = 1 OR c.id = ?
        ORDER BY c.nome", [ehAdmin() ? 1 : 0, $u['cliente_id'] ?? -1]);
    foreach ($lista as &$c) {
        $c['nota_atual'] = $c['ultima_avaliacao_id'] ? notasDaAvaliacao($c['ultima_avaliacao_id'])['geral'] : null;
    }
    return $lista;
});

rota('POST', '/clientes', function (array $c) {
    soAdmin();
    $id = inserir('INSERT INTO clientes (nome, cnpj, segmento, porte, contato) VALUES (?, ?, ?, ?, ?)', validarCliente($c));
    http_response_code(201);
    return buscar('clientes', $id);
});

rota('GET', '/clientes/(\d+)', function (array $c, string $id) {
    doCliente($id);
    return buscar('clientes', $id);
});

rota('PUT', '/clientes/(\d+)', function (array $c, string $id) {
    doCliente($id);
    $atual = buscar('clientes', $id);
    $dados = validarCliente(array_merge($atual, $c));
    sql('UPDATE clientes SET nome = ?, cnpj = ?, segmento = ?, porte = ?, contato = ? WHERE id = ?', [...$dados, $atual['id']]);
    return buscar('clientes', $atual['id']);
});

rota('DELETE', '/clientes/(\d+)', function (array $c, string $id) {
    soAdmin();
    buscar('clientes', $id);
    sql('DELETE FROM clientes WHERE id = ?', [(int) $id]);
    return null;
});

// ---------- Avaliações de maturidade ----------
function itensDa(int $avaliacaoId): array
{
    return linhas('SELECT * FROM avaliacao_itens WHERE avaliacao_id = ?', [$avaliacaoId]);
}

function pesosDe(array $a): array
{
    return json_decode($a['pesos'] ?: '{}', true) ?: [];
}

function notasDaAvaliacao($id): array
{
    $a = buscar('avaliacoes', $id);
    return calcularNotas(itensDa($a['id']), pesosDe($a));
}

function avaliacaoCompleta($id): array
{
    $a = buscar('avaliacoes', $id);
    $itens = itensDa($a['id']);
    $anterior = linha("
        SELECT * FROM avaliacoes WHERE cliente_id = ? AND id <> ? AND status = 'concluida'
          AND (data < ? OR (data = ? AND id < ?))
        ORDER BY data DESC, id DESC LIMIT 1", [$a['cliente_id'], $a['id'], $a['data'], $a['data'], $a['id']]);
    $a['pesos'] = (object) pesosDe($a);
    $a['cliente'] = buscar('clientes', $a['cliente_id']);
    $a['itens'] = $itens;
    $a['resultado'] = calcularNotas($itens, (array) $a['pesos']);
    $a['anterior'] = $anterior ? ['id' => $anterior['id'], 'data' => $anterior['data'], 'tipo' => $anterior['tipo'],
        'comparacao' => comparar(itensDa($anterior['id']), $itens)] : null;
    return $a;
}

rota('GET', '/clientes/(\d+)/avaliacoes', function (array $c, string $id) {
    doCliente($id);
    buscar('clientes', $id);
    return array_map(function ($a) {
        $a['geral'] = calcularNotas(itensDa($a['id']), pesosDe($a))['geral'];
        $a['pesos'] = (object) pesosDe($a);
        return $a;
    }, linhas('SELECT * FROM avaliacoes WHERE cliente_id = ? ORDER BY data DESC, id DESC', [(int) $id]));
});

rota('POST', '/clientes/(\d+)/avaliacoes', function (array $c, string $id) {
    doCliente($id);
    $cliente = buscar('clientes', $id);
    $tipo = $c['tipo'] ?? 'inicial';
    exigir(in_array($tipo, TIPOS_AVALIACAO, true), 'Tipo de avaliação inválido');
    $data = dataOuNulo($c['data'] ?? null) ?? date('Y-m-d');
    $novoId = transacao(function () use ($cliente, $tipo, $data, $c) {
        $novoId = inserir("INSERT INTO avaliacoes (cliente_id, tipo, data, consultor, pesos) VALUES (?, ?, ?, ?, '{}')",
            [$cliente['id'], $tipo, $data, textoOuNulo($c['consultor'] ?? null)]);
        // Já cria uma linha por prática com a meta sugerida, para o questionário vir pronto.
        $ins = db()->prepare('INSERT INTO avaliacao_itens (avaliacao_id, pratica_id, meta) VALUES (?, ?, ?)');
        foreach (catalogo()['praticas'] as $p) $ins->execute([$novoId, $p['id'], metaSugerida($p['id'], $tipo)]);
        return $novoId;
    });
    http_response_code(201);
    return avaliacaoCompleta($novoId);
});

function avaliacaoDoUsuario($id): array
{
    $a = buscar('avaliacoes', $id);
    doCliente($a['cliente_id']);
    return $a;
}

rota('GET', '/avaliacoes/(\d+)', fn(array $c, string $id) => avaliacaoCompleta(avaliacaoDoUsuario($id)['id']));

rota('PUT', '/avaliacoes/(\d+)', function (array $c, string $id) {
    $a = avaliacaoDoUsuario($id);
    $status = $c['status'] ?? null;
    exigir($status === null || in_array($status, STATUS_AVALIACAO, true), 'Status inválido');
    // A empresa preenche a autoavaliação; concluir (ou mexer numa concluída) é do consultor Boxtech.
    if (!ehAdmin()) {
        exigir($a['status'] === 'rascunho' && ($status ?? 'rascunho') === 'rascunho', 'Só o consultor da Boxtech pode concluir ou reabrir a avaliação', 403);
    }
    $pesos = $c['pesos'] ?? null;
    if ($pesos !== null) {
        $areas = array_column(catalogo()['areas'], 'id');
        $ok = is_array($pesos);
        foreach ((array) $pesos as $k => $v) $ok = $ok && in_array($k, $areas, true) && is_numeric($v) && $v > 0;
        exigir($ok, 'Pesos inválidos');
    }
    $itens = $c['itens'] ?? null;
    if (is_array($itens)) {
        $ids = array_column(catalogo()['praticas'], 'id');
        foreach ($itens as $i) {
            exigir(is_array($i) && in_array($i['pratica_id'] ?? null, $ids, true), 'Prática desconhecida: ' . (is_array($i) ? (string) ($i['pratica_id'] ?? '') : ''));
            exigir(nivelValido($i['nivel'] ?? null) && nivelValido($i['meta'] ?? null), 'Nível e meta devem ser inteiros de 1 a 5');
        }
    }

    transacao(function () use ($a, $c, $status, $pesos, $itens) {
        sql('UPDATE avaliacoes SET data = ?, consultor = ?, observacoes = ?, pesos = ?, status = ? WHERE id = ?', [
            dataOuNulo($c['data'] ?? null) ?? $a['data'],
            isset($c['consultor']) ? textoOuNulo($c['consultor']) : $a['consultor'],
            isset($c['observacoes']) ? textoOuNulo($c['observacoes'], 5000) : $a['observacoes'],
            $pesos !== null ? json_encode((object) $pesos) : $a['pesos'],
            $status ?? $a['status'],
            $a['id'],
        ]);
        if (is_array($itens)) {
            $up = db()->prepare('
                INSERT INTO avaliacao_itens (avaliacao_id, pratica_id, nivel, meta, evidencias, observacoes)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (avaliacao_id, pratica_id) DO UPDATE SET
                  nivel = EXCLUDED.nivel, meta = EXCLUDED.meta, evidencias = EXCLUDED.evidencias, observacoes = EXCLUDED.observacoes');
            foreach ($itens as $i) {
                $up->execute([$a['id'], $i['pratica_id'], $i['nivel'] ?? null, $i['meta'] ?? null,
                    textoOuNulo($i['evidencias'] ?? null, 5000), textoOuNulo($i['observacoes'] ?? null, 5000)]);
            }
        }
        if ($status === 'concluida') {
            exigir(calcularNotas(itensDa($a['id']))['completa'], 'Para concluir, atribua o nível de todas as práticas');
        }
    });
    return avaliacaoCompleta($a['id']);
});

rota('DELETE', '/avaliacoes/(\d+)', function (array $c, string $id) {
    soAdmin();
    buscar('avaliacoes', $id);
    sql('DELETE FROM avaliacoes WHERE id = ?', [(int) $id]);
    return null;
});

// ---------- Projetos de implantação (fases PMBOK e ondas ITIL) ----------
function projetoCompleto($id): array
{
    $p = buscar('projetos', $id);
    $fases = array_map(fn($f) => array_merge(buscarNoCatalogo('fases', $f['fase_id']), $f),
        linhas('SELECT * FROM projeto_fases WHERE projeto_id = ? ORDER BY fase_id', [$p['id']]));
    $ondas = array_map(fn($o) => array_merge(buscarNoCatalogo('ondas', $o['onda_id']), $o, ['praticas' => json_decode($o['praticas'], true)]),
        linhas('SELECT * FROM projeto_ondas WHERE projeto_id = ? ORDER BY onda_id', [$p['id']]));
    $concluidas = count(array_filter($fases, fn($f) => $f['status'] === 'concluida'));
    return $p + ['fases' => $fases, 'ondas' => $ondas, 'progresso' => $fases ? (int) round($concluidas / count($fases) * 100) : 0];
}

// Cria as 5 fases e as 3 ondas de um projeto novo, já com as práticas padrão de cada onda.
function criarEstruturaProjeto(int $projetoId): void
{
    $cat = catalogo();
    foreach ($cat['fases'] as $f) sql('INSERT INTO projeto_fases (projeto_id, fase_id) VALUES (?, ?)', [$projetoId, $f['id']]);
    foreach ($cat['ondas'] as $o) {
        $praticas = array_values(array_map(fn($p) => $p['id'], array_filter($cat['praticas'], fn($p) => $p['onda'] === $o['id'])));
        sql('INSERT INTO projeto_ondas (projeto_id, onda_id, praticas) VALUES (?, ?, ?)', [$projetoId, $o['id'], json_encode($praticas)]);
    }
}

rota('GET', '/clientes/(\d+)/projetos', function (array $c, string $id) {
    doCliente($id);
    buscar('clientes', $id);
    return array_map(fn($p) => projetoCompleto($p['id']), linhas('SELECT id FROM projetos WHERE cliente_id = ? ORDER BY id DESC', [(int) $id]));
});

rota('POST', '/clientes/(\d+)/projetos', function (array $c, string $id) {
    soAdmin();
    $cliente = buscar('clientes', $id);
    $nome = texto($c['nome'] ?? null);
    exigir($nome !== '', 'Informe o nome do projeto');
    $novoId = transacao(function () use ($cliente, $nome, $c) {
        $novoId = inserir('INSERT INTO projetos (cliente_id, nome, patrocinador, ponto_focal, gerente, inicio) VALUES (?, ?, ?, ?, ?, ?)', [
            $cliente['id'], $nome, textoOuNulo($c['patrocinador'] ?? null), textoOuNulo($c['ponto_focal'] ?? null),
            textoOuNulo($c['gerente'] ?? null), dataOuNulo($c['inicio'] ?? null),
        ]);
        criarEstruturaProjeto($novoId);
        return $novoId;
    });
    http_response_code(201);
    return projetoCompleto($novoId);
});

rota('GET', '/projetos/(\d+)', function (array $c, string $id) {
    doCliente(buscar('projetos', $id)['cliente_id']);
    return projetoCompleto($id);
});

// Projeto é conduzido pela Boxtech: a empresa acompanha, não altera.
rota('PUT', '/projetos/(\d+)', function (array $c, string $id) {
    soAdmin();
    $p = buscar('projetos', $id);
    $nome = texto(campo($c, 'nome', $p['nome']));
    $status = campo($c, 'status', $p['status']);
    exigir($nome !== '', 'Informe o nome do projeto');
    exigir(in_array($status, STATUS_PROJETO, true), 'Status inválido');
    sql('UPDATE projetos SET nome = ?, patrocinador = ?, ponto_focal = ?, gerente = ?, inicio = ?, status = ? WHERE id = ?', [
        $nome, textoOuNulo(campo($c, 'patrocinador', $p['patrocinador'])), textoOuNulo(campo($c, 'ponto_focal', $p['ponto_focal'])),
        textoOuNulo(campo($c, 'gerente', $p['gerente'])), dataOuNulo(campo($c, 'inicio', $p['inicio'])), $status, $p['id'],
    ]);
    return projetoCompleto($p['id']);
});

rota('PUT', '/projetos/(\d+)/fases/(\d+)', function (array $c, string $id, string $fase) {
    soAdmin();
    $p = buscar('projetos', $id);
    $faseId = (int) $fase;
    $f = linha('SELECT * FROM projeto_fases WHERE projeto_id = ? AND fase_id = ?', [$p['id'], $faseId]);
    exigir($f, 'Fase não encontrada', 404);
    $status = campo($c, 'status', $f['status']);
    $portao = dataOuNulo(campo($c, 'portao_aprovado_em', $f['portao_aprovado_em']));
    exigir(in_array($status, STATUS_FASE, true), 'Status inválido');
    // Portão: a fase só é concluída com aprovação registrada (a Fase 4 não tem portão).
    $temPortao = buscarNoCatalogo('fases', $faseId)['portao'] ?? null;
    exigir($status !== 'concluida' || !$temPortao || $portao, 'Registre a data de aprovação do portão para concluir a fase');
    sql('UPDATE projeto_fases SET status = ?, portao_aprovado_em = ?, observacoes = ? WHERE projeto_id = ? AND fase_id = ?',
        [$status, $portao, textoOuNulo(campo($c, 'observacoes', $f['observacoes']), 5000), $p['id'], $faseId]);
    return projetoCompleto($p['id']);
});

rota('PUT', '/projetos/(\d+)/ondas/(\d+)', function (array $c, string $id, string $onda) {
    soAdmin();
    $p = buscar('projetos', $id);
    $ondaId = (int) $onda;
    $o = linha('SELECT * FROM projeto_ondas WHERE projeto_id = ? AND onda_id = ?', [$p['id'], $ondaId]);
    exigir($o, 'Onda não encontrada', 404);
    $status = campo($c, 'status', $o['status']);
    $aceite = dataOuNulo(campo($c, 'aceite_em', $o['aceite_em']));
    $praticas = $c['praticas'] ?? json_decode($o['praticas'], true);
    exigir(in_array($status, STATUS_ONDA, true), 'Status inválido');
    $ids = array_column(catalogo()['praticas'], 'id');
    exigir(is_array($praticas) && array_reduce($praticas, fn($ok, $x) => $ok && in_array($x, $ids, true), true), 'Prática desconhecida');
    exigir($status !== 'aceita' || $aceite, 'Registre a data do termo de aceite da onda');
    if ($status !== 'nao_iniciada' && $ondaId > 1) {
        $ant = linha('SELECT status FROM projeto_ondas WHERE projeto_id = ? AND onda_id = ?', [$p['id'], $ondaId - 1]);
        exigir($ant && $ant['status'] === 'aceita', 'Cada onda só começa quando a anterior foi aceita pelo cliente');
    }
    sql('UPDATE projeto_ondas SET status = ?, aceite_em = ?, praticas = ? WHERE projeto_id = ? AND onda_id = ?',
        [$status, $aceite, json_encode(array_values($praticas)), $p['id'], $ondaId]);
    return projetoCompleto($p['id']);
});

rota('DELETE', '/projetos/(\d+)', function (array $c, string $id) {
    soAdmin();
    buscar('projetos', $id);
    sql('DELETE FROM projetos WHERE id = ?', [(int) $id]);
    return null;
});

// ---------- Indicadores ----------
// O pdo_pgsql devolve DOUBLE PRECISION como texto; a interface espera número.
function medicao(?array $m): ?array
{
    if ($m) $m['valor'] = (float) $m['valor'];
    return $m;
}

rota('GET', '/clientes/(\d+)/indicadores', function (array $c, string $id) {
    doCliente($id);
    buscar('clientes', $id);
    $medicoes = array_map('medicao', linhas('SELECT * FROM medicoes WHERE cliente_id = ? ORDER BY periodo', [(int) $id]));
    return array_map(function ($ind) use ($medicoes) {
        $m = array_values(array_filter($medicoes, fn($x) => $x['indicador_id'] === $ind['id']));
        $base = null;
        foreach ($m as $x) if ($x['linha_base']) { $base = $x; break; }
        $ultima = $m ? $m[count($m) - 1] : null;
        $evolucao = null;
        if ($base && $ultima && $ultima['id'] !== $base['id']) {
            $delta = $ultima['valor'] - $base['valor'];
            $evolucao = ['delta' => round($delta, 2), 'melhorou' => $ind['sentido'] === 'maior' ? $delta > 0 : $delta < 0];
        }
        return $ind + ['medicoes' => $m, 'linha_base' => $base, 'ultima' => $ultima, 'evolucao' => $evolucao];
    }, catalogo()['indicadores']);
});

rota('POST', '/clientes/(\d+)/medicoes', function (array $c, string $id) {
    doCliente($id);
    $cliente = buscar('clientes', $id);
    $indicador = $c['indicador_id'] ?? null;
    $periodo = $c['periodo'] ?? '';
    $valor = $c['valor'] ?? null;
    exigir(buscarNoCatalogo('indicadores', $indicador), 'Indicador desconhecido');
    exigir(is_string($periodo) && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $periodo), 'Período deve estar no formato AAAA-MM');
    exigir((is_int($valor) || is_float($valor)) && is_finite((float) $valor), 'Valor deve ser numérico');
    $linhaBase = !empty($c['linha_base']);
    transacao(function () use ($cliente, $indicador, $periodo, $valor, $linhaBase, $c) {
        if ($linhaBase) sql('UPDATE medicoes SET linha_base = 0 WHERE cliente_id = ? AND indicador_id = ?', [$cliente['id'], $indicador]);
        sql('INSERT INTO medicoes (cliente_id, indicador_id, periodo, valor, linha_base, observacoes) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (cliente_id, indicador_id, periodo) DO UPDATE SET valor = EXCLUDED.valor, linha_base = EXCLUDED.linha_base, observacoes = EXCLUDED.observacoes',
            [$cliente['id'], $indicador, $periodo, (float) $valor, $linhaBase ? 1 : 0, textoOuNulo($c['observacoes'] ?? null, 5000)]);
    });
    http_response_code(201);
    return medicao(linha('SELECT * FROM medicoes WHERE cliente_id = ? AND indicador_id = ? AND periodo = ?', [$cliente['id'], $indicador, $periodo]));
});

rota('DELETE', '/medicoes/(\d+)', function (array $c, string $id) {
    doCliente(buscar('medicoes', $id)['cliente_id']);
    sql('DELETE FROM medicoes WHERE id = ?', [(int) $id]);
    return null;
});
