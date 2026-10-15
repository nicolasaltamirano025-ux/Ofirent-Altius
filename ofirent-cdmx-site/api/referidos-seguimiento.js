// Función serverless (Vercel): "consulta tu recomendación". Quien recomendó escribe su
// folio y su teléfono y ve en qué etapa va. Solo lectura. Responde lo mismo cuando el
// folio no existe y cuando el teléfono no coincide, para no confirmar folios ajenos.

const airtable = require('./_lib/airtable');
const { getClientIp, hashIp, isSameOrigin } = require('./_lib/security');
const { normalizePhone, PROGRAM } = require('./_lib/validation');

const FOLIO_RE = /^REF-[A-Z2-9]{8}$/;
const MAX_BODY_BYTES = 2048;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const hits = new Map(); // huella de conexión -> marcas de tiempo (por instancia; es un freno, no un muro)

const STAGES = {
  Nuevo: {
    stage: 'received',
    title: 'Recibida',
    message: 'Recibimos tu recomendación. Nuestro equipo la revisará y contactará a tu referido.',
  },
  Contactado: {
    stage: 'contacted',
    title: 'En seguimiento',
    message: 'Ya estamos en contacto con tu referido.',
  },
  'Contrato firmado': {
    stage: 'signed',
    title: 'Contrato firmado',
    message: 'Tu referido firmó su contrato. Tu bono se libera cuando pague sus dos primeras mensualidades.',
  },
  'Bono aplicado': {
    stage: 'paid',
    title: 'Bono liberado',
    message: 'Tu bono ya fue liberado. Si elegiste crédito, lo verás aplicado en tu renta o membresía.',
  },
  'No procede': {
    stage: 'rejected',
    title: 'No aplica',
    message:
      'Esta recomendación no cumplió las condiciones del programa. Si tienes dudas, escríbenos a contacto@ofirent.com.mx.',
  },
};

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function fail(res, status, code, message) {
  send(res, status, { ok: false, code, message });
}

function tooMany(key) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > MAX_PER_WINDOW;
}

async function readBody(req) {
  if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) return { tooLarge: true };
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { tooLarge: true };
    chunks.push(chunk);
  }
  if (size > 0) return { text: Buffer.concat(chunks).toString('utf8') };
  if (req.body !== undefined && req.body !== null) {
    const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    return Buffer.byteLength(text) > MAX_BODY_BYTES ? { tooLarge: true } : { text };
  }
  return { text: '' };
}

function dateEs(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      timeZone: 'America/Mexico_City',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'method_not_allowed', 'Método no permitido.');
  }
  if (!isSameOrigin(req.headers)) return fail(res, 403, 'forbidden', 'No pudimos procesar la solicitud.');
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return fail(res, 415, 'unsupported_media_type', 'Formato de solicitud no válido.');
  }

  const ip = getClientIp(req.headers);
  if (ip && tooMany(hashIp(ip))) {
    return fail(res, 429, 'rate_limited', 'Demasiadas consultas desde tu conexión. Inténtalo más tarde.');
  }

  let body;
  try {
    const raw = await readBody(req);
    if (raw.tooLarge) return fail(res, 413, 'too_large', 'La información enviada es demasiado grande.');
    body = JSON.parse(raw.text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape');
  } catch {
    return fail(res, 400, 'bad_request', 'No pudimos leer la información enviada.');
  }

  const folio = typeof body.folio === 'string' ? body.folio.trim().toUpperCase() : '';
  const phone = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
  if (!FOLIO_RE.test(folio) || !phone) {
    return fail(res, 404, 'not_found', 'No encontramos una recomendación con esos datos. Revisa tu folio y tu teléfono.');
  }

  const cfg = airtable.config();
  if (!cfg) {
    console.error('[seguimiento] airtable_not_configured');
    return fail(res, 503, 'unavailable', 'No pudimos consultar tu recomendación en este momento. Inténtalo de nuevo en unos minutos.');
  }

  try {
    const record = await airtable.findByFolio(cfg, folio);
    const f = (record && record.fields) || {};
    if (!record || (f[airtable.F.referrerPhone] || '') !== phone) {
      return fail(res, 404, 'not_found', 'No encontramos una recomendación con esos datos. Revisa tu folio y tu teléfono.');
    }

    const closed = await airtable.countClosedByReferrerPhone(cfg, phone).catch(() => 0);
    const stage = STAGES[f[airtable.F.status]] || STAGES.Nuevo;
    const firstName = String(f[airtable.F.referredName] || '').trim().split(/\s+/)[0] || '';

    return send(res, 200, {
      ok: true,
      folio,
      stage: stage.stage,
      title: stage.title,
      message: stage.message,
      registeredOn: dateEs(record.createdTime),
      referredFirstName: firstName,
      closed,
      ambassadorAfter: PROGRAM.ambassadorAfter,
      ambassador: closed >= PROGRAM.ambassadorAfter,
    });
  } catch (error) {
    const kind =
      error && error.name === 'AirtableError' ? 'airtable_' + error.status : error && error.name ? error.name : 'unknown';
    console.error('[seguimiento] no se pudo consultar ' + kind);
    return fail(res, 503, 'unavailable', 'No pudimos consultar tu recomendación en este momento. Inténtalo de nuevo en unos minutos.');
  }
};
