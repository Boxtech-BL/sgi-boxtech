// Senhas, sessões e tokens de aprovação. Só usa o módulo crypto do Node.
const crypto = require('node:crypto');

const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // 12 horas
const VALIDADE_APROVACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function conferirSenha(senha, guardado) {
  const [alg, salHex, hashHex] = String(guardado).split('$');
  if (alg !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const obtido = crypto.scryptSync(senha, Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, obtido);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// O cookie guarda o token; o banco guarda só o hash, para um vazamento do banco não abrir sessões.
function criarSessao(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)')
    .run(sha256(token), usuarioId, Date.now() + DURACAO_SESSAO_MS);
  return token;
}

function lerSessao(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.nome, u.email, u.papel, u.cliente_id, u.status
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ? AND s.expira_em > ? AND u.status = 'ativo'`).get(sha256(token), Date.now()) ?? null;
}

const encerrarSessao = (db, token) => token && db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(sha256(token));

// Token assinado (HMAC) que vai no e-mail de aprovação: usuário + validade.
function tokenAprovacao(segredo, usuarioId, agora = Date.now()) {
  const corpo = `${usuarioId}.${agora + VALIDADE_APROVACAO_MS}`;
  const assinatura = crypto.createHmac('sha256', segredo).update(`aprovacao:${corpo}`).digest('base64url');
  return `${corpo}.${assinatura}`;
}

function lerTokenAprovacao(segredo, token) {
  const [id, expira, assinatura] = String(token ?? '').split('.');
  if (!id || !expira || !assinatura) return null;
  const esperada = crypto.createHmac('sha256', segredo).update(`aprovacao:${id}.${expira}`).digest('base64url');
  const a = Buffer.from(assinatura), b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expira) < Date.now()) return null;
  return Number(id);
}

// Limite simples de tentativas de login por IP + e-mail (em memória).
function limitador({ maximo = 10, janelaMs = 15 * 60 * 1000 } = {}) {
  const falhas = new Map();
  return {
    bloqueado(chave) {
      const f = falhas.get(chave);
      if (!f || f.inicio + janelaMs < Date.now()) return false;
      return f.qtd >= maximo;
    },
    falhou(chave) {
      const f = falhas.get(chave);
      if (!f || f.inicio + janelaMs < Date.now()) falhas.set(chave, { qtd: 1, inicio: Date.now() });
      else f.qtd++;
    },
    limpar(chave) { falhas.delete(chave); },
  };
}

function lerCookie(req, nome) {
  const c = req.headers.cookie;
  if (!c) return null;
  for (const parte of c.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

module.exports = {
  DURACAO_SESSAO_MS, hashSenha, conferirSenha, criarSessao, lerSessao, encerrarSessao,
  tokenAprovacao, lerTokenAprovacao, limitador, lerCookie,
};
