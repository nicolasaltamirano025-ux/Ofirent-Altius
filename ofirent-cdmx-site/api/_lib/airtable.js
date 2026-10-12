// Acceso a la tabla "Referidos" de Airtable (misma base que "Leads").
// fetch nativo, sin SDK. Nunca registra el contenido de las respuestas.
//
// Tabla minima: 9 campos. La fecha de recepcion es la propia fecha de creacion del
// registro (createdTime / CREATED_TIME()), por eso no hay campo de fecha.

const REQUEST_TIMEOUT_MS = 8000;
// Un aviso no enviado se reintenta cada dia mientras el registro tenga menos de estos dias.
const RETRY_WINDOW_DAYS = 7;

// Nombres exactos de los campos de la tabla.
const F = {
  folio: 'Folio',
  status: 'Estado',
  referrerName: 'Nombre de quien recomienda',
  referrerPhone: 'Teléfono de quien recomienda',
  referredName: 'Nombre del referido',
  referredPhone: 'Teléfono del referido',
  details: 'Detalles',
  mail: 'Aviso por correo',
  ipHash: 'Huella de conexión',
};

const SPACE_TO_LABEL = { oficina: 'Oficina', bodega: 'Bodega', otro: 'Otro' };
const LABEL_TO_SPACE = { Oficina: 'oficina', Bodega: 'bodega', Otro: 'otro' };

// Datos secundarios (una sola linea cada uno). "Comentarios" va siempre al final
// porque es el unico multilinea: todo lo que sigue a su etiqueta le pertenece.
const DETAIL_LABELS = [
  ['referrerCompany', 'Empresa de quien recomienda'],
  ['referrerEmail', 'Correo de quien recomienda'],
  ['referredEmail', 'Correo del referido'],
  ['spaceType', 'Tipo de espacio'],
  ['zone', 'Zona o sucursal'],
];
const COMMENTS_LABEL = 'Comentarios';
const CONSENT_LINE =
  'Autorización: quien recomienda confirmó contar con la autorización de la persona recomendada.';

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

async function findByFolio(cfg, folio) {
  const data = await request(cfg, 'GET', '', {
    query: [
      ['filterByFormula', '{' + F.folio + "}='" + escapeFormulaString(folio) + "'"],
      ['maxRecords', '1'],
    ],
  });
  return (data.records && data.records[0]) || null;
}

// Cuantos envios guardados tiene esta huella en la ultima hora (hasta `cap`).
async function countRecentByIpHash(cfg, ipHash, cap) {
  const formula =
    'AND({' + F.ipHash + "}='" + escapeFormulaString(ipHash) + "'," +
    "IS_AFTER(CREATED_TIME(),DATEADD(NOW(),-1,'hours')))";
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

// Registros cuyo aviso no salio y que siguen dentro de la ventana de reintento.
async function listUnsent(cfg, limit) {
  const formula =
    'AND({' + F.mail + "}!='Enviado'," +
    "IS_AFTER(CREATED_TIME(),DATEADD(NOW(),-" + RETRY_WINDOW_DAYS + ",'days')))";
  const data = await request(cfg, 'GET', '', {
    query: [
      ['filterByFormula', formula],
      ['maxRecords', String(limit)],
      ['pageSize', String(limit)],
    ],
  });
  return data.records || [];
}

// Datos secundarios del formulario -> texto del campo "Detalles".
function serializeDetails(value) {
  const lines = [];
  for (const [key, label] of DETAIL_LABELS) {
    const raw = key === 'spaceType' ? SPACE_TO_LABEL[value.spaceType] || '' : value[key];
    if (raw) lines.push(label + ': ' + raw);
  }
  lines.push(CONSENT_LINE);
  if (value.comments) lines.push(COMMENTS_LABEL + ': ' + value.comments);
  return lines.join('\n');
}

// Texto de "Detalles" -> datos secundarios (para reconstruir el correo en un reintento).
function parseDetails(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  const commentsPrefix = COMMENTS_LABEL + ': ';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(commentsPrefix)) {
      out.comments = [line.slice(commentsPrefix.length)].concat(lines.slice(i + 1)).join('\n');
      break;
    }
    for (const [key, label] of DETAIL_LABELS) {
      if (line.startsWith(label + ': ')) out[key] = line.slice(label.length + 2);
    }
  }
  if (out.spaceType) out.spaceType = LABEL_TO_SPACE[out.spaceType] || '';
  return out;
}

// Valor validado + metadatos -> campos de Airtable.
function toFields(value, meta) {
  const fields = {
    [F.folio]: meta.folio,
    [F.status]: 'Nuevo',
    [F.referrerName]: value.referrerName,
    [F.referrerPhone]: value.referrerPhone,
    [F.referredName]: value.referredName,
    [F.referredPhone]: value.referredPhone,
    [F.details]: serializeDetails(value),
    [F.mail]: 'Pendiente',
  };
  if (meta.ipHash) fields[F.ipHash] = meta.ipHash;
  return fields;
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

// Registro de Airtable -> forma que usa la plantilla del correo.
function toReferral(record) {
  const f = (record && record.fields) || {};
  const extra = parseDetails(f[F.details]);
  return {
    id: record.id,
    reference: str(f[F.folio]),
    createdAt: str(record.createdTime),
    referrerName: str(f[F.referrerName]),
    referrerCompany: str(extra.referrerCompany),
    referrerPhone: str(f[F.referrerPhone]),
    referrerEmail: str(extra.referrerEmail),
    referredName: str(f[F.referredName]),
    referredPhone: str(f[F.referredPhone]),
    referredEmail: str(extra.referredEmail),
    spaceType: str(extra.spaceType),
    zone: str(extra.zone),
    comments: str(extra.comments),
  };
}

module.exports = {
  F,
  RETRY_WINDOW_DAYS,
  AirtableError,
  config,
  findByFolio,
  countRecentByIpHash,
  createRecord,
  updateRecord,
  listUnsent,
  serializeDetails,
  parseDetails,
  toFields,
  toReferral,
};
