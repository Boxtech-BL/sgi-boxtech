const crypto = require('node:crypto');
const { abrir, garantirAdmin } = require('./src/db');
const { criarApp } = require('./src/app');
const { criarEmail } = require('./src/email');

const env = process.env;
const producao = env.NODE_ENV === 'production';
const porta = Number(env.PORT) || 3000;
const aprovador = env.SGI_APROVADOR || 'boxtech@boxtech.com.br';

let segredo = env.SGI_SEGREDO;
if (!segredo) {
  if (producao) {
    console.error('Defina SGI_SEGREDO (texto aleatório longo) para rodar em produção.');
    process.exit(1);
  }
  segredo = crypto.randomBytes(32).toString('hex');
  console.warn('SGI_SEGREDO não definido: usando um segredo temporário (links de aprovação valem só até reiniciar).');
}

const db = abrir();

// Primeiro acesso: cria o administrador da Boxtech com ADMIN_SENHA.
if (env.ADMIN_SENHA) {
  garantirAdmin(db, { email: env.ADMIN_EMAIL || aprovador, senha: env.ADMIN_SENHA });
  console.log(`Administrador ${env.ADMIN_EMAIL || aprovador} pronto. Remova ADMIN_SENHA do ambiente depois do primeiro acesso.`);
} else if (!db.prepare("SELECT 1 FROM usuarios WHERE papel = 'admin' AND status = 'ativo'").get()) {
  console.warn('Nenhum administrador cadastrado. Inicie uma vez com ADMIN_SENHA=... para criar o acesso da Boxtech.');
}

const app = criarApp(db, {
  email: criarEmail(env),
  segredo,
  aprovador,
  urlBase: (env.SGI_URL_BASE || `http://localhost:${porta}`).replace(/\/$/, ''),
  cookieSeguro: producao,
});

app.listen(porta, () => console.log(`SGI Boxtech rodando em http://localhost:${porta}`));
