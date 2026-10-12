// Acceso a la tabla "Referidos" de Airtable (misma base que "Leads").
// fetch nativo, sin SDK. Nunca registra el contenido de las respuestas.

const SITE_LABEL = 'OfiRent CDMX / Programa de referidos';
const REQUEST_TIMEOUT_MS = 8000;

// Nombres exactos de los campos de la tabla.
const F = {
  folio: 'Folio',
  receivedAt: 'Fecha de recepción',
  status: 'Estado',
  referrerName: 'Nombre de quien recomienda',
  referrerCompany: 'Empresa de quien recomienda',
  referrerPhone: 'Teléfono de quien recomienda',
  referrerEmail: 'Correo de quien recomienda',
  referredName: 'Nombre del referido',
  referredPhone: 'Teléfono del referido',
  referredEmail: 'Correo del referido',
  spaceType: 'Tipo de espacio',
  zone: 'Zona o sucursal',
  comments: 'Comentarios',
  consent: 'Autorización confirmada',
  site: 'Sitio',
  notification: 'Notificación',
  attempts: 'Intentos',
  lastError: 'Último error',
  idempotencyKey: 'Clave de envío',
  ipHash: 'Huella de conexión',
};

const SPACE_TO_OPTION = { oficina: 'Oficina', bodega: 'Bodega', otro: 'Otro' };
const OPTION_TO_SPACE = { Oficina: 'oficina', Bodega: 'bodega', Otro: 'otro' };

class AirtableError extends Error {
  constructor(status, kind) {
    super('Airtable ' + status + (kind ? ' ' + kind : ''));
    this.name = 'AirtableError';
    this.status = status;
    this.kind = kind || '';
  }
}

function config() {
  const token = (process.env.AIRTABLE_TOKEN || '').trim();
  const baseId = (process.env.AIRTABLE_BASE_ID || '').trim();
  const tableId = (process.env.AIRTABLE_REFERIDOS_TABLE_ID || '').trim();
  if (!token || !baseId || !tableId) return null;
  return { token, baseId, tableId };
}

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function request(cfg, method, path, options) {
  const opts = options || {};
  const url = new URL(
    'https://api.airtable.com/v0/' +
      encodeURIComponent(cfg.baseId) +
      '/' +
      encodeURIComponent(cfg.tableId) +
      (path || ''),
  );
  for (const [key, value] of opts.query || []) url.searchParams.append(key, value);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let kind = '';
    try {
      const data = await response.json();
      const err = data && data.error;
      kind = typeof err === 'string' ? err : err && typeof err.type === 'string' ? err.type : '';
    } catch {
      kind = '';
    }
    throw new AirtableError(response.status, kind);
  }
  return response.json();
}

async function findByIdempotencyKey(cfg, key) {
  const data = await request(cfg, 'GET', '', {
    query: [
      ['filterByFormula', "{" + F.idempotencyKey + "}='" + escapeFormulaString(key) + "'"],
      ['maxRecords', '1'],
    ],
  });
  return (data.records && data.records[0]) || null;
}

// Cuántos envíos guardados tiene esta huella en la última hora (hasta `cap`).
async function countRecentByIpHash(cfg, ipHash, cap) {
  const formula =
    "AND({" + F.ipHash + "}='" + escapeFormulaString(ipHash) + "'," +
    "IS_AFTER({" + F.receivedAt + "},DATEADD(NOW(),-1,'hours')))";
  const data = await request(cfg, 'GET', '', {
    query: [
      ['filterByFormula', formula],
      ['maxRecords', String(cap)],
      ['pageSize', String(cap)],
      ['fields[]', F.folio],
    ],
  });
  return (data.records || []).length;
}

async function createRecord(cfg, fields) {
  return request(cfg, 'POST', '', { body: { fields } });
}

async function updateRecord(cfg, recordId, fields) {
  return request(cfg, 'PATCH', '/' + encodeURIComponent(recordId), { body: { fields } });
}

// Registros cuya notificación no salió y que aún no agotan los intentos.
async function listUnsent(cfg, maxAttempts, limit) {
  const formula =
    "AND({" + F.notification + "}!='Enviada',OR({" + F.attempts + "}=BLANK(),{" + F.attempts + "}<" +
    Number(maxAttempts) + "))";
  const data = await request(cfg, 'GET', '', {
    query: [
      ['filterByFormula', formula],
      ['maxRecords', String(limit)],
      ['pageSize', String(limit)],
      ['sort[0][field]', F.receivedAt],
      ['sort[0][direction]', 'asc'],
    ],
  });
  return data.records || [];
}

// Valor validado + metadatos -> campos de Airtable (los vacíos se omiten).
function toFields(value, meta) {
  const fields = {
    [F.folio]: meta.folio,
    [F.receivedAt]: meta.receivedAt,
    [F.status]: 'Nuevo',
    [F.referrerName]: value.referrerName,
    [F.referrerPhone]: value.referrerPhone,
    [F.referredName]: value.referredName,
    [F.referredPhone]: value.referredPhone,
    [F.consent]: true,
    [F.site]: SITE_LABEL,
    [F.notification]: 'Pendiente',
    [F.attempts]: 0,
    [F.idempotencyKey]: meta.idempotencyKey,
  };
  const optional = {
    [F.referrerCompany]: value.referrerCompany,
    [F.referrerEmail]: value.referrerEmail,
    [F.referredEmail]: value.referredEmail,
    [F.zone]: value.zone,
    [F.comments]: value.comments,
    [F.spaceType]: SPACE_TO_OPTION[value.spaceType] || '',
    [F.ipHash]: meta.ipHash || '',
  };
  for (const key of Object.keys(optional)) if (optional[key]) fields[key] = optional[key];
  return fields;
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

// Registro de Airtable -> forma que usa la plantilla del correo.
function toReferral(record) {
  const f = (record && record.fields) || {};
  return {
    id: record.id,
    reference: str(f[F.folio]),
    createdAt: str(f[F.receivedAt]),
    referrerName: str(f[F.referrerName]),
    referrerCompany: str(f[F.referrerCompany]),
    referrerPhone: str(f[F.referrerPhone]),
    referrerEmail: str(f[F.referrerEmail]),
    referredName: str(f[F.referredName]),
    referredPhone: str(f[F.referredPhone]),
    referredEmail: str(f[F.referredEmail]),
    spaceType: OPTION_TO_SPACE[str(f[F.spaceType])] || '',
    zone: str(f[F.zone]),
    comments: str(f[F.comments]),
    attempts: Number(f[F.attempts]) || 0,
  };
}

module.exports = {
  F,
  AirtableError,
  config,
  findByIdempotencyKey,
  countRecentByIpHash,
  createRecord,
  updateRecord,
  listUnsent,
  toFields,
  toReferral,
};
