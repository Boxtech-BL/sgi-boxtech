<?php
// Catálogo do framework de gestão de TIC da Boxtech (PMBOK + ITIL 4).
// catalogo.json é gerado a partir de src/catalogo.js da versão Node, para as duas versões
// usarem o mesmo conteúdo:  node -e "..."  (ver README da pasta php).
declare(strict_types=1);

function catalogo(): array
{
    static $c = null;
    if ($c === null) $c = json_decode(file_get_contents(__DIR__ . '/catalogo.json'), true, 512, JSON_THROW_ON_ERROR);
    return $c;
}

function buscarNoCatalogo(string $lista, $id): ?array
{
    foreach (catalogo()[$lista] as $x) if ($x['id'] === $id) return $x;
    return null;
}

// Meta sugerida: nível 3 em todas as práticas; nível 4 nas de atendimento no ciclo seguinte.
function metaSugerida(string $praticaId, string $tipo): int
{
    $p = buscarNoCatalogo('praticas', $praticaId);
    if ($tipo === 'semestral' && $p && $p['area'] === 'atendimento') return 4;
    return 3;
}
