# Publicação do SGI no site da Boxtech

O SGI roda como uma aplicação Node.js própria. A forma recomendada de colocá-lo "no site" é publicá-lo num subdomínio, por exemplo **https://sgi.boxtech.com.br**, e pôr no site da Boxtech um botão "Área do cliente / SGI" que aponta para ele. Assim o site institucional continua como está (WordPress, HTML ou outro) e o SGI fica separado, com HTTPS e banco próprios.

## Como o acesso funciona

1. A empresa abre o SGI e clica em **Cadastre-se**: informa os dados da empresa, o nome, o e-mail e uma senha.
2. O cadastro fica **aguardando liberação** e o SGI envia um e-mail para **boxtech@boxtech.com.br** com os dados e um link.
3. Pelo link (ou pelo menu **Acessos**, entrando como administrador) a Boxtech escolhe **Liberar acesso** ou **Recusar**. Abrir o link sozinho não libera nada: é preciso clicar no botão, para que antivírus e pré-visualizadores de e-mail não aprovem por engano.
4. A empresa recebe um e-mail avisando e passa a entrar com o e-mail e a senha.
5. Cada empresa vê **só os próprios dados**. Ela pode preencher a autoavaliação e registrar indicadores; concluir avaliações, conduzir o projeto e excluir dados é só da Boxtech. Pelo menu **Acessos** a Boxtech também pode bloquear uma empresa a qualquer momento.

## O que é preciso

| Item | Para quê |
| --- | --- |
| Um servidor (VPS) com Docker, ou uma hospedagem que rode Node.js 22 | Executar o SGI |
| Registro DNS `sgi` apontando para esse servidor | Endereço sgi.boxtech.com.br |
| Certificado HTTPS (Let's Encrypt, gratuito) | Login seguro |
| Conta SMTP para envio (ex.: a caixa boxtech@boxtech.com.br no Microsoft 365) | E-mails de cadastro e liberação |

Hospedagens compartilhadas que só rodam PHP (a maioria dos planos de WordPress) **não** rodam o SGI. Nesse caso, o SGI vai num servidor separado e o site só ganha o link.

## Na Locaweb

O site da Boxtech está na Locaweb. Os planos de **Hospedagem de Sites** (compartilhada) são feitos para PHP/WordPress e não mantêm uma aplicação Node.js rodando. Por isso o caminho é:

1. **Contratar um VPS Locaweb** com Linux (Ubuntu). O menor plano basta para começar: o SGI usa pouca memória e o banco é um arquivo SQLite.
2. **Instalar Docker e nginx** no VPS (`apt install docker.io docker-compose-v2 nginx certbot python3-certbot-nginx`).
3. **Criar o subdomínio** no Painel Locaweb, na zona DNS de boxtech.com.br: um registro **A** `sgi` apontando para o IP do VPS. O site atual continua na hospedagem de sempre.
4. Seguir o passo a passo abaixo e a configuração do nginx.
5. **E-mail:** se a caixa boxtech@boxtech.com.br também é da Locaweb, use o SMTP da Locaweb (no painel, em E-mail > Configurações de envio, ficam o servidor e a porta) com o usuário e a senha dessa caixa.
6. Colocar no site o botão para https://sgi.boxtech.com.br (seção "Botão no site").

## Passo a passo com Docker

```bash
git clone https://github.com/Boxtech-BL/sgi-boxtech.git
cd sgi-boxtech
cp .env.exemplo .env
# edite o .env: SGI_SEGREDO (openssl rand -hex 32), ADMIN_SENHA e os dados de SMTP
docker compose up -d --build
```

Depois do primeiro início, entre em https://sgi.boxtech.com.br com `boxtech@boxtech.com.br` e a senha do `ADMIN_SENHA`, **apague a linha `ADMIN_SENHA` do `.env`** e rode `docker compose up -d` de novo.

O banco (SQLite) fica no volume `sgi-dados`. Para backup diário (por exemplo num cron do servidor):

```bash
docker compose cp sgi:/dados/sgi.db ./backups/sgi-$(date +%F).db
```

## nginx com HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name sgi.boxtech.com.br;

    ssl_certificate     /etc/letsencrypt/live/sgi.boxtech.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sgi.boxtech.com.br/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name sgi.boxtech.com.br;
    return 301 https://$host$request_uri;
}
```

Certificado: `certbot --nginx -d sgi.boxtech.com.br`.

## Botão no site da Boxtech

```html
<a href="https://sgi.boxtech.com.br" class="botao">Área do cliente: SGI</a>
<a href="https://sgi.boxtech.com.br/#/cadastro">Cadastre sua empresa</a>
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `SGI_URL_BASE` | sim | Endereço público, usado nos links dos e-mails |
| `SGI_SEGREDO` | sim | Assina os links de aprovação; sem ele o sistema não inicia em produção |
| `SGI_APROVADOR` | não | Quem recebe e libera os cadastros (padrão boxtech@boxtech.com.br) |
| `ADMIN_SENHA` | 1º início | Cria o administrador (ou redefine a senha dele) |
| `ADMIN_EMAIL` | não | E-mail do administrador (padrão: o mesmo do aprovador) |
| `SMTP_HOST`, `SMTP_PORTA`, `SMTP_USUARIO`, `SMTP_SENHA`, `SMTP_REMETENTE` | sim, para e-mail | Sem SMTP, os e-mails só aparecem no log do servidor |
| `SGI_DB` | não | Caminho do banco (no Docker: /dados/sgi.db) |
| `PORT` | não | Porta interna (padrão 3000) |
