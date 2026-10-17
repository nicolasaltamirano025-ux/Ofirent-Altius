// Enlace de baja de un clic para el aviso que recibe la persona recomendada.
// El enlace lleva el id interno del registro de Airtable (no el folio, que abre el seguimiento) y una
// firma (HMAC) para que nadie pueda dar de baja registros ajenos.
// La clave sale de UNSUBSCRIBE_SECRET o, si no existe, de IP_HASH_SALT (ya configurada en Vercel).

const { createHmac, timingSafeEqual } = require('node:crypto');

const SITE = 'https://www.ofirent.com.mx';
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

function secret() {
  return (process.env.UNSUBSCRIBE_SECRET || process.env.IP_HASH_SALT || '').trim();
}

function sign(recordId, key) {
  return createHmac('sha256', key).update('baja:' + recordId).digest('base64url').slice(0, 22);
}

// Devuelve null si falta la clave: sin firma no se ofrece enlace de baja.
function makeToken(recordId) {
  const key = secret();
  if (!key || !RECORD_ID_RE.test(String(recordId || ''))) return null;
  return recordId + '.' + sign(recordId, key);
}

function verifyToken(token) {
  const key = secret();
  if (!key || typeof token !== 'string') return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 2 || !RECORD_ID_RE.test(parts[0])) return { ok: false };
  const expected = Buffer.from(sign(parts[0], key));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false };
  return { ok: true, recordId: parts[0] };
}

function unsubscribeUrl(recordId) {
  const token = makeToken(recordId);
  return token ? SITE + '/api/referidos-baja/?t=' + encodeURIComponent(token) : null;
}

module.exports = { RECORD_ID_RE, makeToken, verifyToken, unsubscribeUrl };
