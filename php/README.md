# SGI Boxtech em PHP

Versão do SGI Boxtech feita para rodar direto na hospedagem compartilhada da Locaweb (PHP + PostgreSQL), sem Node, sem Docker e sem instalar bibliotecas. Tem as mesmas funções da versão Node que fica na raiz do repositório:

| Módulo | Funcionalidades |
| --- | --- |
| Acesso | A empresa se cadastra, a Boxtech recebe um e-mail em boxtech@boxtech.com.br e libera ou recusa o acesso (pelo link do e-mail ou pelo menu Acessos). Cada empresa vê só os próprios dados |
| Clientes | Cadastro, nota de maturidade atual e projetos ativos de cada cliente |
| Avaliação de maturidade | 15 práticas em 5 áreas, nível 1 a 5 com evidências, meta, pesos por área, nota por área e geral, 3 lacunas críticas, radar e comparação com a avaliação anterior. A empresa preenche a autoavaliação; só a Boxtech conclui |
| Relatório | Resumo executivo, radar atual x meta, detalhe por prática e recomendações por onda; imprime ou salva em PDF |
| Projeto de implantação | 5 fases PMBOK com portões e 3 ondas ITIL (a onda seguinte só começa após o aceite da anterior). Conduzido pela Boxtech; a empresa acompanha |
| Indicadores | 8 indicadores, linha de base, medições mensais e evolução |
| Framework | Consulta da escala, fases, ondas e práticas |

Requisitos: PHP 8.0 ou mais novo com a extensão PDO PostgreSQL (`pdo_pgsql`) e um banco PostgreSQL 9.5 ou mais novo.

## Como instalar na Locaweb

1. **Versão do PHP.** No painel da hospedagem, confira se o site usa PHP 8.0 ou mais novo.
2. **Banco de dados.** No painel, crie um banco PostgreSQL. Anote o endereço do servidor (host), a porta (normalmente 5432), o nome do banco, o usuário e a senha. Se o seu plano não mostrar a opção PostgreSQL, confirme com o suporte da Locaweb.
3. **Arquivos.** Envie o conteúdo desta pasta `php/` por FTP (ou pelo gerenciador de arquivos do painel) para uma pasta do site, por exemplo `public_html/sgi/`. O sistema fica em `https://www.boxtech.com.br/sgi/`. Se preferir um subdomínio (`sgi.boxtech.com.br`), crie o subdomínio no painel e envie os arquivos para a pasta dele. A pasta `testes/` não precisa ir para o servidor.
4. **Configuração.** No servidor, copie `config.exemplo.php` para `config.php` e preencha:
   - `db`: os dados do banco do passo 2.
   - `url_base`: o endereço do passo 3, sem barra no final.
   - `segredo`: um texto aleatório de 32 caracteres ou mais (por exemplo, o resultado de `openssl rand -hex 32`, ou uma senha longa gerada no gerenciador de senhas).
   - `admin_senha_inicial`: a senha que a Boxtech vai usar para entrar com boxtech@boxtech.com.br.
   - `email`: a conta que envia os e-mails (veja abaixo).
5. **Instalação.** Abra `https://.../sgi/instalar.php` no navegador. A página confere a conexão, cria as tabelas e o administrador. Se aparecer "could not find driver", a extensão `pdo_pgsql` não está ativa no PHP da hospedagem: ative no painel (configurações do PHP) ou peça ao suporte.
6. **Limpeza.** Apague o valor de `admin_senha_inicial` no `config.php` e apague o `instalar.php` do servidor.
7. **Pronto.** Abra o SGI e entre com boxtech@boxtech.com.br. No site da Boxtech, basta um botão ou link "Área do cliente" apontando para o endereço do SGI.

O `.htaccess` desta pasta impede que o `config.php` e a pasta `inc/` sejam abertos pelo navegador. Depois que o domínio tiver certificado HTTPS, tire o `#` das linhas indicadas no fim do `.htaccess` para forçar HTTPS.

### E-mail

O SGI manda três e-mails: o aviso de novo cadastro para boxtech@boxtech.com.br (com o link para liberar), e o aviso de liberado ou recusado para a empresa. Em `config.php`, escolha o `modo`:

- `smtp` (recomendado): envia por uma conta autenticada. Para Microsoft 365, use `smtp.office365.com`, porta 587, com o e-mail e a senha da conta (a conta precisa ter "SMTP autenticado" habilitado no admin do Microsoft 365). Para e-mail da própria Locaweb, use o servidor SMTP indicado no painel de e-mail, porta 465 ou 587.
- `mail`: usa a função `mail()` do PHP da hospedagem. É mais simples, mas costuma cair no spam.
- `log`: não envia; grava as mensagens em `inc/emails.log`. Serve para testar.

Se o envio falhar, o cadastro não se perde: o pedido aparece no menu **Acessos** do administrador e o erro vai para o log de erros do PHP no painel.

## Estrutura

```
index.html, app.js, estilo.css   interface (a mesma da versão Node)
api.php                          entrada da API: api.php?r=/clientes/1 (não precisa de mod_rewrite)
instalar.php                     cria as tabelas e o administrador
config.exemplo.php               modelo do config.php
inc/base.php                     configuração, banco (PDO) e utilitários
inc/esquema.php                  tabelas PostgreSQL
inc/catalogo.json                conteúdo do framework (gerado de src/catalogo.js)
inc/maturidade.php               regras de pontuação
inc/seguranca.php                senhas, sessões, links assinados e limite de tentativas
inc/email.php                    envio de e-mail (SMTP próprio, sem bibliotecas)
inc/acesso.php                   cadastro, login e aprovação
inc/rotas.php                    clientes, avaliações, projetos e indicadores
testes/rodar.php                 testes (precisa de um PostgreSQL local)
```

As rotas são as mesmas da versão Node (veja o README da raiz), trocando `/api/...` por `api.php?r=/...`.

## Segurança

- Senhas com `password_hash` (bcrypt). A sessão fica num cookie `HttpOnly` e `SameSite=Lax`; o banco guarda só o hash do token. Bloquear uma empresa derruba a sessão na hora.
- O link de liberação é assinado com o `segredo` e vale 30 dias. Abrir o link só mostra o cadastro; a decisão exige clicar no botão.
- Escrita na API só com JSON e da mesma origem (proteção contra CSRF). Login limitado a 10 tentativas a cada 15 minutos por IP e e-mail.
- Erros do banco não aparecem para o usuário; vão para o log de erros do PHP.

## Manter igual à versão Node

O conteúdo do framework vem de `src/catalogo.js`. Depois de mudar esse arquivo, gere de novo o JSON (na raiz do repositório):

```bash
node -e "const c=require('./src/catalogo.js'); delete c.metaSugerida; require('fs').writeFileSync('php/inc/catalogo.json', JSON.stringify(c,null,1)+'\n')"
```

A interface (`app.js`, `estilo.css`, `index.html`) é a mesma da versão Node, com uma diferença: a função `api()` do `app.js` chama `api.php?r=...`.

## Testes

```bash
# banco vazio só para teste (é apagado a cada execução)
sudo -u postgres psql -c "CREATE USER sgi PASSWORD 'sgi'" -c "CREATE DATABASE sgi_teste OWNER sgi"
SGI_TESTE_DB="pgsql://sgi:sgi@127.0.0.1:5432/sgi_teste" php php/testes/rodar.php
```

Os testes sobem o servidor embutido do PHP e repetem os cenários da versão Node: regras de maturidade, cadastro e liberação pelo link, isolamento entre empresas, proteções de login e o fluxo completo de avaliação, projeto e indicadores.

Para rodar a interface no computador: `SGI_CONFIG=/caminho/config.php php -S localhost:8080 -t php`.
