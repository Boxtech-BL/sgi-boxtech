<?php
// Regras de pontuação da avaliação de maturidade.
// - Nota da área = média das práticas avaliadas da área.
// - Nota geral = média das áreas (ponderada pelos pesos, padrão 1), com uma casa decimal.
// - Lacuna = meta - nível; as 3 maiores vão para o resumo executivo.
declare(strict_types=1);

require_once __DIR__ . '/catalogo.php';

function porPratica(array $itens): array
{
    $m = [];
    foreach ($itens as $i) $m[$i['pratica_id']] = $i;
    return $m;
}

function calcularNotas(array $itens, array $pesos = []): array
{
    $cat = catalogo();
    $mapa = porPratica($itens);

    $notasAreas = [];
    foreach ($cat['areas'] as $area) {
        $niveis = [];
        foreach ($cat['praticas'] as $p) {
            if ($p['area'] === $area['id'] && isset($mapa[$p['id']]['nivel'])) $niveis[] = $mapa[$p['id']]['nivel'];
        }
        $peso = (float) ($pesos[$area['id']] ?? 0);
        $notasAreas[] = [
            'area' => $area['id'],
            'nome' => $area['nome'],
            'nota' => $niveis ? arred(array_sum($niveis) / count($niveis)) : null,
            'peso' => $peso > 0 ? $peso : 1,
            'avaliadas' => count($niveis),
        ];
    }

    $somaPesos = 0;
    $soma = 0;
    foreach ($notasAreas as $a) {
        if ($a['nota'] === null) continue;
        $somaPesos += $a['peso'];
        $soma += $a['nota'] * $a['peso'];
    }

    $lacunas = [];
    foreach ($cat['praticas'] as $p) {
        $i = $mapa[$p['id']] ?? null;
        if (!$i || !isset($i['nivel'], $i['meta'])) continue;
        $lacuna = $i['meta'] - $i['nivel'];
        if ($lacuna > 0) {
            $lacunas[] = ['pratica' => $p['id'], 'nome' => $p['nome'], 'area' => $p['area'], 'onda' => $p['onda'],
                'nivel' => $i['nivel'], 'meta' => $i['meta'], 'lacuna' => $lacuna];
        }
    }
    // Maior lacuna primeiro; no empate, a prática de onda mais básica (usort é estável no PHP 8).
    usort($lacunas, fn($a, $b) => ($b['lacuna'] <=> $a['lacuna']) ?: (($a['onda'] ?? 0) <=> ($b['onda'] ?? 0)));

    $completa = true;
    foreach ($cat['praticas'] as $p) if (!isset($mapa[$p['id']]['nivel'])) $completa = false;

    return [
        'geral' => $somaPesos ? arred($soma / $somaPesos) : null,
        'areas' => $notasAreas,
        'lacunas' => $lacunas,
        'criticas' => array_slice($lacunas, 0, 3),
        'completa' => $completa,
    ];
}

// Compara duas avaliações (ex.: inicial x encerramento) prática a prática.
function comparar(array $anteriores, array $atuais): array
{
    $ant = porPratica($anteriores);
    $atu = porPratica($atuais);
    $r = [];
    foreach (catalogo()['praticas'] as $p) {
        $atual = $atu[$p['id']]['nivel'] ?? null;
        $anterior = $ant[$p['id']]['nivel'] ?? null;
        $r[] = ['pratica' => $p['id'], 'nome' => $p['nome'], 'anterior' => $anterior, 'atual' => $atual,
            'variacao' => $atual !== null && $anterior !== null ? $atual - $anterior : null];
    }
    return $r;
}
