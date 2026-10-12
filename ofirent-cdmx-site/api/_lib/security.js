const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');

// Si IP_HASH_SALT no está configurada, nunca se guarda un hash de IP sin sal
// (sería reversible por fuerza bruta en IPv4): se usa una sal por proceso.
const processSalt = randomBytes(16).toString('hex');

// Huella de la IP: solo sirve para limitar el ritmo de envíos; la IP no se guarda.
function hashIp(ip) {
  const salt = (process.env.IP_HASH_SALT || '').trim() || processSalt;
  return createHash('sha256').update(salt + ip).digest('hex');
}

// IP del cliente según la cabecera que inyecta el proxy de Vercel.
function getClientIp(headers) {
  const forwarded = headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof raw !== 'string') return null;
  const first = raw.split(',')[0].trim();
  return first || null;
}

function firstHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.split(',')[0].trim() : '';
}

// Si llega Origin, su host debe coincidir con el host de esta petición (también
// en previews). Sin Origin (curl, servidores) se permite: la ruta no usa cookies.
function isSameOrigin(headers) {
  const origin = firstHeader(headers.origin);
  if (!origin) return true;
  const host = firstHeader(headers['x-forwarded-host']) || firstHeader(headers.host);
  try {
    return host !== '' && new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Comparación en tiempo constante.
function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

module.exports = { hashIp, getClientIp, isSameOrigin, safeEqual };
