// Envio de e-mail. Com SMTP_HOST configurado usa SMTP; sem ele, só registra no console
// (útil em desenvolvimento). `enviados` guarda as mensagens para os testes.
const nodemailer = require('nodemailer');

function criarEmail(env = process.env) {
  const enviados = [];
  const remetente = env.SMTP_REMETENTE || 'SGI Boxtech <boxtech@boxtech.com.br>';
  const transporte = env.SMTP_HOST
    ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORTA) || 587,
      secure: Number(env.SMTP_PORTA) === 465,
      auth: env.SMTP_USUARIO ? { user: env.SMTP_USUARIO, pass: env.SMTP_SENHA } : undefined,
    })
    : null;

  return {
    enviados,
    async enviar({ para, assunto, texto, html }) {
      enviados.push({ para, assunto, texto, html });
      if (!transporte) {
        if (env.NODE_ENV !== 'test') console.log(`[e-mail não enviado: SMTP não configurado] Para: ${para} | ${assunto}\n${texto}\n`);
        return;
      }
      await transporte.sendMail({ from: remetente, to: para, subject: assunto, text: texto, html });
    },
  };
}

module.exports = { criarEmail };
