// Función serverless (Vercel): recibe una recomendación del Programa de referidos,
// la guarda en Airtable (tabla "Referidos") y avisa por correo a OfiRent.
// Solo mismo origen (sin CORS). El éxito se devuelve únicamente cuando Airtable
// confirmó el guardado; un fallo del correo no cambia la respuesta (se reintenta).

const { randomBytes } = require('node:crypto');
const airtable = require('./_lib/airtable');
const { notifyRecord } = require('./_lib/notify');
const { getClientIp, hashIp, isSameOrigin } = require('./_lib/security');
const { validateReferral } = require('./_lib/validation');

const MAX_BODY_BYTES = 16 * 1024;
// Un humano tarda más que esto en llenar dos secciones; un bot suele enviar al instante.
const MIN_FILL_MS = 2500;
const RATE_LIMIT_PER_HOUR = 10;
const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
const FOLIO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function fail(res, status, code, message, extra) {
  send(res, status, Object.assign({ ok: false, code, message }, extra || {}));
}

function newFolio() {
  let out = '';
  for (const byte of randomBytes(8)) out += FOLIO_ALPHABET[byte % FOLIO_ALPHABET.length];
  return 'REF-' + out;
}

// Lee el cuerpo desde el stream. Si la plataforma ya lo dejó leído en req.body,
// usa ese valor. Devuelve { tooLarge } o { text }.
async function readBody(req) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BODY_BYTES) return { tooLarge: true };

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { tooLarge: true };
    chunks.push(chunk);
  }
  if (size > 0) return { text: Buffer.concat(chunks).toString('utf8') };

  if (req.body !== undefined && req.body !== null) {
    const text = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { tooLarge: true };
    return { text };
  }
  return { text: '' };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'method_not_allowed', 'Método no permitido.');
  }
  if (!isSameOrigin(req.headers)) {
    return fail(res, 403, 'forbidden', 'No pudimos procesar la solicitud.');
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return fail(res, 415, 'unsupported_media_type', 'Formato de solicitud no válido.');
  }

  let body;
  try {
    const raw = await readBody(req);
    if (raw.tooLarge) return fail(res, 413, 'too_large', 'La información enviada es demasiado grande.');
    const parsed = JSON.parse(raw.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    body = parsed;
  } catch {
    return fail(res, 400, 'bad_request', 'No pudimos leer la información enviada.');
  }

  // Antispam: campo trampa y tiempo mínimo de llenado. Nunca un éxito falso.
  const honeypot = typeof body.website === 'string' ? body.website.trim() : '';
  const fillMs = Number(body.fillMs);
  if (honeypot !== '' || !Number.isFinite(fillMs) || fillMs < MIN_FILL_MS) {
    return fail(res, 400, 'rejected', 'No pudimos procesar tu envío. Revisa los datos e inténtalo de nuevo.');
  }

  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (!KEY_RE.test(idempotencyKey)) {
    return fail(res, 400, 'bad_request', 'No pudimos leer la información enviada.');
  }

  const validation = validateReferral(body);
  if (!validation.ok) {
    return fail(res, 422, 'validation', 'Revisa los campos marcados.', { errors: validation.errors });
  }

  const cfg = airtable.config();
  if (!cfg) {
    console.error('[referidos] airtable_not_configured');
    return fail(res, 503, 'storage_unavailable', 'No pudimos guardar tu recomendación en este momento. Tus datos siguen en el formulario; inténtalo de nuevo en unos minutos.');
  }

  const ip = getClientIp(req.headers);
  const ipHash = ip ? hashIp(ip) : null;

  try {
    // Las dos consultas son independientes. Un reintento con la misma clave
    // devuelve el folio ya guardado aunque la conexión esté al límite.
    const [existing, recent] = await Promise.all([
      airtable.findByIdempotencyKey(cfg, idempotencyKey),
      ipHash ? airtable.countRecentByIpHash(cfg, ipHash, RATE_LIMIT_PER_HOUR) : Promise.resolve(0),
    ]);

    if (existing) {
      const folio = airtable.toReferral(existing).reference;
      return send(res, 200, { ok: true, reference: folio });
    }
    if (recent >= RATE_LIMIT_PER_HOUR) {
      return fail(res, 429, 'rate_limited', 'Recibimos muchos envíos desde tu conexión. Inténtalo de nuevo más tarde.');
    }

    const folio = newFolio();
    // El éxito solo se devuelve cuando Airtable ya confirmó este guardado.
    const record = await airtable.createRecord(
      cfg,
      airtable.toFields(validation.value, {
        folio,
        receivedAt: new Date().toISOString(),
        idempotencyKey,
        ipHash,
      }),
    );

    // Con el registro ya guardado se intenta el correo; su fallo no cambia la respuesta.
    await notifyRecord(cfg, record);

    return send(res, 201, { ok: true, reference: folio });
  } catch (error) {
    const kind = error && error.name === 'AirtableError' ? 'airtable_' + error.status + (error.kind ? '_' + error.kind : '') : error && error.name ? error.name : 'unknown';
    console.error('[referidos] no se pudo guardar ' + kind);
    return fail(res, 503, 'storage_unavailable', 'No pudimos guardar tu recomendación en este momento. Tus datos siguen en el formulario; inténtalo de nuevo en unos minutos.');
  }
};
