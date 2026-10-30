<?php
// Ponto de entrada da API: api.php?r=/clientes/1 (dispensa mod_rewrite na hospedagem).
declare(strict_types=1);

require __DIR__ . '/inc/base.php';
require __DIR__ . '/inc/catalogo.php';
require __DIR__ . '/inc/maturidade.php';
require __DIR__ . '/inc/seguranca.php';
require __DIR__ . '/inc/email.php';
require __DIR__ . '/inc/roteador.php';
require __DIR__ . '/inc/acesso.php';
require __DIR__ . '/inc/rotas.php';

atenderApi();
