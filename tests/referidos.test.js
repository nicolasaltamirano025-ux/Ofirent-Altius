// Pruebas del Programa de referidos (sin package.json, sin red real).
//   node --test tests/
// Usan req/res simulados y un fetch falso que imita Airtable y Resend.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');

const SITE = path.join(__dirname, '..', 'ofirent-cdmx-site');
const handler = require(path.join(SITE, 'api', 'referidos.js'));
const retryHandler = require(path.join(SITE, 'api', 'referidos-reintento.js'));
const trackHandler = require(path.join(SITE, 'api', 'referidos-seguimiento.js'));
const bajaHandler = require(path.join(SITE, 'api', 'referidos-baja.js'));
const notifyLib = require(path.join(SITE, 'api', '_lib', 'notify.js'));
const airtable = require(path.join(SITE, 'api', '_lib', 'airtable.js'));
const sharedValidation = require(path.join(SITE, 'assets', 'referidos', 'validation.js'));

const EM_DASH = String.fromCharCode(0x2014);
const HOST = 'www.ofirent.com.mx';
const ENV = {
  AIRTABLE_TOKEN: 'tok_test',
  AIRTABLE_BASE_ID: 'appTEST',
  AIRTABLE_REFERIDOS_TABLE_ID: 'tblTEST',
  AIRTABLE_LEADS_TABLE_ID: 'tblLEADS',
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'OfiRent Referidos <referidos@example.test>',
  NOTIFY_TO: 'contacto@ofirent.com.mx',
  NOTIFY_CC: 'nico@example.test, gerencia@example.test',
  CRON_SECRET: 'cron-secret-test',
  IP_HASH_SALT: 'salt-test',
};
const ALLOWED_FIELDS = new Set(Object.values(airtable.F));

// ---------------------------------------------------------------- mundo falso

function makeWorld() {
  const world = {
    records: [],
    leads: [],
    emails: [], // avisos internos a OfiRent
    noticeEmails: [], // avisos de primer contacto a la persona recomendada
    leadsMode: 'ok', // ok | fail
    airtableMode: 'ok', // ok | down | failCreate
    resendMode: 'ok', // ok | http403 | throw (aviso interno)
    noticeMode: 'ok', // ok | http403 | throw (aviso al referido)
    unknownFetches: [],
    seq: 0,
  };

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  world.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const headers = init.headers || {};

    if (u.hostname === 'api.resend.com') {
      const body = JSON.parse(init.body);
      // Dos tipos de correo: el aviso interno a OfiRent (world.emails) y el aviso de primer
      // contacto a la persona recomendada (world.noticeEmails), cada uno con su propio modo.
      const internalTo = process.env.NOTIFY_TO || 'contacto@ofirent.com.mx';
      const isNotice = !body.to.includes(internalTo) && !body.to.includes('contacto@ofirent.com.mx');
      const list = isNotice ? world.noticeEmails : world.emails;
      const mode = isNotice ? world.noticeMode : world.resendMode;
      list.push({ url: u.toString(), headers, body });
      if (mode === 'throw') throw new TypeError('fetch failed');
      if (mode === 'http403') {
        return json(403, { statusCode: 403, name: 'validation_error', message: 'Dominio no verificado.' });
      }
      return json(200, { id: 'email_' + (world.emails.length + world.noticeEmails.length) });
    }

    if (u.hostname === 'api.airtable.com') {
      assert.equal(headers.Authorization, 'Bearer tok_test');
      if (world.airtableMode === 'down') return json(500, { error: { type: 'SERVER_ERROR', message: 'x' } });
      const parts = u.pathname.split('/').filter(Boolean); // v0, base, table, [rec]
      assert.equal(parts[1], 'appTEST');
      const recId = parts[3];
      const method = init.method || 'GET';

      if (parts[2] === 'tblLEADS') {
        assert.equal(method, 'GET', 'la tabla Leads solo se lee');
        if (world.leadsMode === 'fail') return json(422, { error: { type: 'UNKNOWN_FIELD_NAME' } });
        const f = u.searchParams.get('filterByFormula') || '';
        const m = f.match(/^FIND\('(\d+)',.*\)>0$/);
        assert.ok(m, 'fórmula de Leads inesperada: ' + f);
        const hit = world.leads.filter((r) => String(r.fields['Teléfono'] || '').replace(/\D/g, '').includes(m[1]));
        return json(200, { records: hit });
      }
      assert.equal(parts[2], 'tblTEST');

      if (method === 'POST') {
        if (world.airtableMode === 'failCreate') return json(422, { error: { type: 'INVALID_VALUE_FOR_COLUMN' } });
        if (world.airtableMode === 'unknownField') {
          return json(422, { error: { type: 'UNKNOWN_FIELD_NAME', message: 'Unknown field name: "Detalles"' } });
        }
        const { fields } = JSON.parse(init.body);
        for (const name of Object.keys(fields)) assert.ok(ALLOWED_FIELDS.has(name), 'campo desconocido: ' + name);
        // Los ids reales de Airtable son "rec" + 14 caracteres.
        const record = { id: 'rec' + String(++world.seq).padStart(14, '0'), createdTime: new Date().toISOString(), fields };
        world.records.push(record);
        return json(200, record);
      }
      if (method === 'PATCH') {
        const record = world.records.find((r) => r.id === recId);
        if (!record) return json(404, { error: 'NOT_FOUND' });
        const { fields } = JSON.parse(init.body);
        for (const name of Object.keys(fields)) assert.ok(ALLOWED_FIELDS.has(name), 'campo desconocido: ' + name);
        for (const [k, v] of Object.entries(fields)) {
          if (v === null) delete record.fields[k];
          else record.fields[k] = v;
        }
        return json(200, record);
      }
      if (method === 'GET' && recId) {
        const record = world.records.find((r) => r.id === recId);
        return record ? json(200, record) : json(404, { error: 'NOT_FOUND' });
      }
      if (method === 'GET') {
        const formula = u.searchParams.get('filterByFormula') || '';
        const max = Number(u.searchParams.get('maxRecords')) || 100;
        let found;
        const folioMatch = formula.match(/^\{Folio\}='(.*)'$/);
        const ipMatch = formula.match(/\{Huella de conexión\}='([^']*)'/);
        const personMatch = formula.match(
          /^AND\(\{Teléfono de quien recomienda\}='([^']*)',\{Estado\}!='No procede',IS_AFTER\(CREATED_TIME\(\),DATEADD\(NOW\(\),-(\d+),'days'\)\)\)$/,
        );
        const referredMatch = formula.match(/^AND\(\{Teléfono del referido\}='([^']*)',\{Estado\}!='No procede'\)$/);
        const emailMatch = formula.match(/^AND\(FIND\('Correo del referido: (.*)' & '\n',\{Detalles\} & '\n'\)>0,(.*)\)$/s);
        const closedMatch = formula.match(
          /^AND\(\{Teléfono de quien recomienda\}='([^']*)',\{Estado\}='Bono aplicado'\)$/,
        );
        if (emailMatch) {
          const wanted = 'Correo del referido: ' + emailMatch[1].replace(/\\'/g, "'") + '\n';
          const optOutQuery = emailMatch[2].startsWith("FIND('ALERTA: Baja:'");
          found = world.records.filter((r) => {
            const hasEmail = ((r.fields['Detalles'] || '') + '\n').includes(wanted);
            if (!hasEmail) return false;
            return optOutQuery ? (r.fields['Detalles'] || '').includes('ALERTA: Baja:') : r.fields['Estado'] !== 'No procede';
          });
        } else if (closedMatch) {
          found = world.records.filter(
            (r) => r.fields['Teléfono de quien recomienda'] === closedMatch[1] && r.fields['Estado'] === 'Bono aplicado',
          );
        } else if (personMatch) {
          const since = Date.now() - Number(personMatch[2]) * 86400 * 1000;
          found = world.records.filter(
            (r) =>
              r.fields['Teléfono de quien recomienda'] === personMatch[1] &&
              r.fields['Estado'] !== 'No procede' &&
              Date.parse(r.createdTime) > since,
          );
        } else if (referredMatch) {
          found = world.records.filter(
            (r) => r.fields['Teléfono del referido'] === referredMatch[1] && r.fields['Estado'] !== 'No procede',
          );
        } else if (folioMatch) {
          found = world.records.filter((r) => r.fields['Folio'] === folioMatch[1]);
        } else if (ipMatch) {
          assert.ok(formula.includes("IS_AFTER(CREATED_TIME(),DATEADD(NOW(),-1,'hours'))"), 'ventana de una hora');
          const since = Date.now() - 3600 * 1000;
          found = world.records.filter(
            (r) => r.fields['Huella de conexión'] === ipMatch[1] && Date.parse(r.createdTime) > since,
          );
        } else if (formula.includes("{Aviso por correo}!='Enviado'")) {
          const days = Number(formula.match(/-(\d+),'days'/)[1]);
          const since = Date.now() - days * 86400 * 1000;
          const requiresFolio = formula.includes("{Folio}!=''");
          found = world.records.filter(
            (r) =>
              (!requiresFolio || (r.fields['Folio'] || '') !== '') &&
              r.fields['Aviso por correo'] !== 'Enviado' &&
              Date.parse(r.createdTime) > since,
          );
        } else {
          throw new Error('fórmula no reconocida por el simulador: ' + formula);
        }
        return json(200, { records: found.slice(0, max) });
      }
    }

    world.unknownFetches.push(u.toString());
    throw new Error('fetch inesperado: ' + u.hostname);
  };
  return world;
}

// Ejecuta fn con fetch falso, variables de entorno y captura de logs.
async function withWorld(fn, envOverrides) {
  const world = makeWorld();
  const realFetch = globalThis.fetch;
  const saved = {};
  const env = Object.assign({}, ENV, envOverrides || {});
  for (const key of Object.keys(ENV)) saved[key] = process.env[key];
  for (const key of Object.keys(env)) {
    if (env[key] === null) delete process.env[key];
    else process.env[key] = env[key];
  }

  const logs = [];
  const realConsole = {};
  for (const level of ['log', 'info', 'warn', 'error']) {
    realConsole[level] = console[level];
    console[level] = (...args) => logs.push(args.map(String).join(' '));
  }
  globalThis.fetch = world.fetch;
  try {
    return await fn(world, logs);
  } finally {
    globalThis.fetch = realFetch;
    for (const level of Object.keys(realConsole)) console[level] = realConsole[level];
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// ---------------------------------------------------------------- req / res

function makeReq({ method = 'POST', headers = {}, body, raw, noBody = false, url = '/' } = {}) {
  const text = raw !== undefined ? raw : JSON.stringify(body);
  const req = Readable.from(noBody ? [] : [Buffer.from(text)]);
  req.method = method;
  req.url = url;
  req.headers = Object.assign(
    { 'content-type': 'application/json', host: HOST, 'x-forwarded-for': '203.0.113.9' },
    headers,
  );
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk || '';
    },
    get json() {
      return JSON.parse(this.body);
    },
  };
}

async function call(h, opts) {
  const res = makeRes();
  await h(makeReq(opts), res);
  return res;
}

function validBody(overrides) {
  return Object.assign(
    {
      referrerName: 'Ana Pérez Soto',
      referrerCompany: 'Estudio Pérez',
      referrerPhone: '+52 55 1234 5678',
      referrerEmail: 'Ana@Empresa.com',
      referredName: 'Luis Mendoza',
      referredPhone: '(55) 8765-4321',
      referredEmail: 'luis@correo.com',
      spaceType: 'fisica',
      zone: 'Del Valle',
      comments: 'Busca una oficina para 3 personas.\nPrefiere planta baja.',
      consent: true,
      website: '',
      fillMs: 6000,
      idempotencyKey: randomUUID(),
    },
    overrides || {},
  );
}

// Teléfonos distintos en cada llamada: el tope es por persona y el duplicado por referido,
// así que las pruebas que envían muchas recomendaciones necesitan personas diferentes.
let phoneSeq = 0;
function uniqueBody(overrides) {
  phoneSeq += 1;
  const n = String(phoneSeq).padStart(4, '0');
  return validBody(
    Object.assign(
      { referrerPhone: '5511' + n + '00', referredPhone: '5522' + n + '00', referredEmail: 'luis' + n + '@correo.com', idempotencyKey: randomUUID() },
      overrides || {},
    ),
  );
}

// ---------------------------------------------------------------- pruebas

test('solicitud válida: guarda, responde 201 y el correo va solo a contacto@ofirent.com.mx', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, { body: validBody() });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json.ok, true);
    assert.match(res.json.reference, /^REF-[A-Z2-9]{8}$/);

    assert.equal(world.records.length, 1);
    const f = world.records[0].fields;
    assert.equal(f['Folio'], res.json.reference);
    assert.equal(f['Estado'], 'Nuevo');
    assert.equal(f['Nombre de quien recomienda'], 'Ana Pérez Soto');
    assert.equal(f['Nombre del referido'], 'Luis Mendoza');
    assert.equal(f['Teléfono de quien recomienda'], '5512345678');
    assert.equal(f['Teléfono del referido'], '5587654321');
    assert.ok(/^[0-9a-f]{64}$/.test(f['Huella de conexión']), 'huella sha256');
    assert.ok(!JSON.stringify(f).includes('203.0.113.9'), 'la IP no se guarda');
    assert.equal(f['Aviso por correo'], 'Enviado');
    // Los datos secundarios van en un solo campo.
    const details = f['Detalles'];
    assert.ok(details.includes('Empresa de quien recomienda: Estudio Pérez'));
    assert.ok(details.includes('Correo de quien recomienda: ana@empresa.com'));
    assert.ok(details.includes('Correo del referido: luis@correo.com'));
    assert.ok(details.includes('Tipo de espacio: Oficina física'));
    assert.ok(details.includes('Zona o sucursal: Del Valle'));
    assert.ok(details.includes('Autorización: quien recomienda confirmó'));
    assert.ok(details.includes('Comentarios: Busca una oficina para 3 personas.\nPrefiere planta baja.'));
    // Solo los 9 campos de la tabla mínima.
    assert.deepEqual(Object.keys(f).sort(), [...ALLOWED_FIELDS].sort());

    assert.equal(world.emails.length, 1);
    const mail = world.emails[0];
    assert.equal(mail.url, 'https://api.resend.com/emails');
    assert.equal(mail.headers.Authorization, 'Bearer re_test');
    assert.deepEqual(mail.body.to, ['contacto@ofirent.com.mx']);
    assert.equal(mail.body.from, ENV.EMAIL_FROM);
    assert.equal(mail.body.subject, 'Nueva recomendación · Campaña OfiRent');
    assert.equal(mail.body.reply_to, 'ana@empresa.com');
    assert.ok(mail.body.html.includes('1. Quién recomienda'));
    assert.ok(mail.body.html.includes('2. Persona recomendada'));
    assert.ok(mail.body.html.includes(res.json.reference));
    assert.ok(mail.body.html.includes('hora de Ciudad de México'));
    assert.ok(mail.body.html.includes('href="tel:5512345678"'));
    assert.ok(mail.body.html.includes('href="mailto:luis@correo.com"'));
    assert.ok(mail.body.text.includes('Folio: ' + res.json.reference));
    assert.ok(mail.body.text.includes('Estado inicial: Nuevo.'));
    assert.ok(!(mail.body.subject + mail.body.html + mail.body.text).includes(EM_DASH), 'sin guion largo');
  });
});

test('campos opcionales vacíos no se envían a Airtable y no hay reply_to', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, {
      body: validBody({ referrerCompany: '', referrerEmail: '', referredEmail: '', spaceType: '', zone: '', comments: '' }),
    });
    assert.equal(res.statusCode, 201);
    const f = world.records[0].fields;
    for (const label of ['Empresa de quien recomienda', 'Correo de quien recomienda', 'Correo del referido', 'Tipo de espacio', 'Zona o sucursal', 'Comentarios']) {
      assert.ok(!f['Detalles'].includes(label + ':'), label);
    }
    assert.ok(f['Detalles'].includes('Autorización:'));
    assert.equal(world.emails[0].body.reply_to, undefined);
    assert.ok(world.emails[0].body.html.includes('No indicado'));
  });
});

test('solicitud inválida: 422 con errores por campo y no guarda ni envía', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, {
      body: validBody({ referrerName: 'A', referredPhone: '123', referrerEmail: 'no-es-correo', consent: false }),
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json.ok, false);
    assert.deepEqual(Object.keys(res.json.errors).sort(), ['consent', 'referredPhone', 'referrerEmail', 'referrerName']);
    assert.equal(res.json.errors.referrerName, 'Escribe tu nombre completo.');
    assert.equal(world.records.length, 0);
    assert.equal(world.emails.length, 0);
  });
});

test('consent distinto de true exacto se rechaza', async () => {
  await withWorld(async (world) => {
    for (const consent of ['true', 1, 'on', null]) {
      const res = await call(handler, { body: validBody({ consent }) });
      assert.equal(res.statusCode, 422, String(consent));
    }
    assert.equal(world.records.length, 0);
  });
});

test('antispam: campo trampa y tiempo de llenado bajo o ausente se rechazan', async () => {
  await withWorld(async (world) => {
    for (const body of [
      validBody({ website: 'http://spam.test' }),
      validBody({ fillMs: 800 }),
      validBody({ fillMs: undefined }),
      validBody({ fillMs: 'rapido' }),
    ]) {
      const res = await call(handler, { body });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json.ok, false);
      assert.equal(res.json.reference, undefined);
    }
    assert.equal(world.records.length, 0);
    assert.equal(world.emails.length, 0);
  });
});

test('clave de idempotencia con formato inválido: 400', async () => {
  await withWorld(async (world) => {
    for (const idempotencyKey of ['corta', 'x'.repeat(65), "abc' OR 1=1 --abcdefgh", 12345678901234567]) {
      const res = await call(handler, { body: validBody({ idempotencyKey }) });
      assert.equal(res.statusCode, 400);
    }
    assert.equal(world.records.length, 0);
  });
});

test('origen ajeno: 403; el mismo origen (incluida una preview) pasa', async () => {
  await withWorld(async (world) => {
    const foreign = await call(handler, { headers: { origin: 'https://sitio-malo.example' }, body: validBody() });
    assert.equal(foreign.statusCode, 403);
    assert.equal(foreign.headers['access-control-allow-origin'], undefined, 'sin CORS');
    assert.equal(world.records.length, 0);

    const same = await call(handler, { headers: { origin: 'https://' + HOST }, body: uniqueBody() });
    assert.equal(same.statusCode, 201);

    const preview = await call(handler, {
      headers: {
        origin: 'https://ofirent-cdmx-site-git-referidos.vercel.app',
        host: 'internal-host',
        'x-forwarded-host': 'ofirent-cdmx-site-git-referidos.vercel.app',
      },
      body: uniqueBody(),
    });
    assert.equal(preview.statusCode, 201);

    const garbage = await call(handler, { headers: { origin: 'no-es-una-url' }, body: validBody() });
    assert.equal(garbage.statusCode, 403);
  });
});

test('JSON roto, cuerpo vacío, cuerpo grande, tipo y método incorrectos', async () => {
  await withWorld(async (world) => {
    assert.equal((await call(handler, { raw: '{"referrerName": ' })).statusCode, 400);
    assert.equal((await call(handler, { noBody: true })).statusCode, 400);
    assert.equal((await call(handler, { raw: '[1,2,3]' })).statusCode, 400);
    assert.equal((await call(handler, { raw: 'null' })).statusCode, 400);

    const big = JSON.stringify(validBody({ comments: 'x'.repeat(20 * 1024) }));
    assert.equal((await call(handler, { raw: big })).statusCode, 413);
    assert.equal((await call(handler, { raw: big, headers: { 'content-length': String(big.length) } })).statusCode, 413);

    assert.equal((await call(handler, { headers: { 'content-type': 'text/plain' }, body: validBody() })).statusCode, 415);
    const get = await call(handler, { method: 'GET', noBody: true });
    assert.equal(get.statusCode, 405);
    assert.equal(get.headers.allow, 'POST');

    assert.equal(world.records.length, 0);
    assert.equal(world.emails.length, 0);
  });
});

test('cuerpo ya leído por la plataforma (req.body) también se acepta', async () => {
  await withWorld(async (world) => {
    const req = makeReq({ noBody: true });
    req.body = validBody();
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(world.records.length, 1);
  });
});

test('misma clave de idempotencia dos veces: un registro y un correo', async () => {
  await withWorld(async (world) => {
    const body = validBody();
    const first = await call(handler, { body });
    const second = await call(handler, { body });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200);
    assert.equal(second.json.ok, true);
    assert.equal(second.json.reference, first.json.reference);
    assert.equal(world.records.length, 1);
    assert.equal(world.emails.length, 1);
  });
});

test('falla de Resend: el registro se conserva, queda Fallido y el reintento reconstruye el correo completo', async () => {
  await withWorld(async (world) => {
    world.resendMode = 'http403';
    const res = await call(handler, { body: validBody() });
    assert.equal(res.statusCode, 201, 'el fallo del correo no cambia la respuesta');
    assert.equal(res.json.ok, true);

    assert.equal(world.records.length, 1);
    let f = world.records[0].fields;
    assert.match(f['Aviso por correo'], /^Fallido: .*403/);

    // Sin autorización no se puede disparar el reintento.
    assert.equal((await call(retryHandler, { method: 'GET', noBody: true })).statusCode, 401);
    assert.equal(
      (await call(retryHandler, { method: 'GET', noBody: true, headers: { authorization: 'Bearer otro' } })).statusCode,
      401,
    );
    assert.equal(world.emails.length, 1, 'rechazos de autorización no envían nada');

    // Con Resend recuperado y el secreto correcto, se reenvía y se marca.
    world.resendMode = 'ok';
    const retry = await call(retryHandler, {
      method: 'GET',
      noBody: true,
      headers: { authorization: 'Bearer cron-secret-test' },
    });
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(
      { attempted: retry.json.attempted, sent: retry.json.sent, failed: retry.json.failed },
      { attempted: 1, sent: 1, failed: 0 },
    );
    f = world.records[0].fields;
    assert.equal(f['Aviso por correo'], 'Enviado');

    // El correo reenviado sale con los mismos datos que el original (salen de "Detalles").
    const first = world.emails[0].body;
    const again1 = world.emails[1].body;
    assert.deepEqual(again1.to, ['contacto@ofirent.com.mx']);
    assert.equal(again1.reply_to, 'ana@empresa.com');
    for (const needle of ['Estudio Pérez', 'ana@empresa.com', 'luis@correo.com', 'Oficina', 'Del Valle', 'Prefiere planta baja.', res.json.reference]) {
      assert.ok(again1.html.includes(needle), 'falta en el reintento: ' + needle);
    }
    const strip = (t) => t.replace(/Recibida: .*\n/, '');
    assert.equal(strip(again1.text), strip(first.text), 'mismo contenido que el primer envío');

    // Ya enviado: un segundo reintento no hace nada.
    const second = await call(retryHandler, {
      method: 'GET',
      noBody: true,
      headers: { authorization: 'Bearer cron-secret-test' },
    });
    assert.equal(second.json.attempted, 0);
    assert.equal(world.emails.length, 2);
  });
});

test('falla de red al enviar el correo: registro conservado y marcado Fallido', async () => {
  await withWorld(async (world) => {
    world.resendMode = 'throw';
    const res = await call(handler, { body: validBody() });
    assert.equal(res.statusCode, 201);
    assert.match(world.records[0].fields['Aviso por correo'], /^Fallido: /);
  });
});

test('reintento: solo registros de los últimos 7 días; sin correo configurado no hace nada', async () => {
  await withWorld(async (world) => {
    world.resendMode = 'http403';
    await call(handler, { body: uniqueBody() });
    await call(handler, { body: uniqueBody({ referredName: 'Marta Gómez' }) });
    assert.equal(world.records.length, 2);
    // El primero se vuelve de hace 8 días: ya salió de la ventana de reintento.
    world.records[0].createdTime = new Date(Date.now() - 8 * 86400 * 1000).toISOString();
    world.resendMode = 'ok';
    const auth = { authorization: 'Bearer cron-secret-test' };
    const run = await call(retryHandler, { method: 'GET', noBody: true, headers: auth });
    assert.equal(run.json.attempted, 1, 'solo el registro reciente');
    assert.equal(world.records[1].fields['Aviso por correo'], 'Enviado');
    assert.match(world.records[0].fields['Aviso por correo'], /^Fallido/, 'el viejo se deja como está');
    assert.equal(world.emails.length, 3);
  });

  await withWorld(
    async (world) => {
      const res = await call(handler, { body: validBody() });
      assert.equal(res.statusCode, 201, 'se guarda aunque no haya correo configurado');
      assert.match(world.records[0].fields['Aviso por correo'], /^Pendiente/);
      assert.equal(world.emails.length, 0);
      const before = JSON.stringify(world.records);
      const retry = await call(retryHandler, {
        method: 'GET',
        noBody: true,
        headers: { authorization: 'Bearer cron-secret-test' },
      });
      assert.equal(retry.statusCode, 200);
      assert.equal(retry.json.skipped, 'email_not_configured');
      assert.equal(JSON.stringify(world.records), before, 'no se tocó ningún registro');
    },
    { RESEND_API_KEY: null },
  );
});

test('reintento: ignora filas sin folio (filas en blanco de una tabla nueva o notas del personal)', async () => {
  await withWorld(async (world) => {
    // Airtable crea 3 filas vacías al crear una tabla; nadie les puso folio ni aviso.
    for (let i = 0; i < 3; i++) {
      world.records.push({ id: 'recBlank' + i, createdTime: new Date().toISOString(), fields: {} });
    }
    world.resendMode = 'http403';
    await call(handler, { body: validBody() });
    world.resendMode = 'ok';
    const emailsBefore = world.emails.length;
    const run = await call(retryHandler, {
      method: 'GET',
      noBody: true,
      headers: { authorization: 'Bearer cron-secret-test' },
    });
    assert.equal(run.statusCode, 200);
    assert.equal(run.json.attempted, 1, 'solo el registro real');
    assert.equal(world.emails.length, emailsBefore + 1);
    assert.ok(world.records.filter((r) => r.id.startsWith('recBlank')).every((r) => !r.fields['Aviso por correo']));
  });
});

test('el folio sale de la clave de envío: misma clave, mismo folio; claves distintas, folios distintos', async () => {
  await withWorld(async (world) => {
    const keyA = randomUUID();
    const a1 = await call(handler, { body: validBody({ idempotencyKey: keyA }) });
    const a2 = await call(handler, { body: validBody({ idempotencyKey: keyA, referredName: 'Otro Nombre' }) });
    const b = await call(handler, { body: uniqueBody({ idempotencyKey: randomUUID() }) });
    assert.equal(a1.json.reference, a2.json.reference);
    assert.notEqual(a1.json.reference, b.json.reference);
    assert.equal(world.records.length, 2);
    assert.ok(world.records.every((r) => !('Clave de envío' in r.fields)), 'no existe campo de clave');
  });
});

test('"Detalles": ida y vuelta sin perder datos, incluso con comentarios que imitan etiquetas', () => {
  const { serializeDetails, parseDetails } = airtable;
  const value = {
    referrerCompany: 'Estudio: Pérez & Co.',
    referrerEmail: 'ana@empresa.com',
    referredEmail: '',
    spaceType: 'coworking',
    zone: 'Roma, Condesa',
    comments: 'Línea 1\nZona o sucursal: falsa\nComentarios: otra\nAutorización: falsa',
  };
  const back = parseDetails(serializeDetails(value));
  assert.deepEqual(back, {
    referrerCompany: 'Estudio: Pérez & Co.',
    referrerEmail: 'ana@empresa.com',
    spaceType: 'coworking',
    zone: 'Roma, Condesa',
    comments: value.comments,
  });
  assert.deepEqual(parseDetails(''), {});
  assert.deepEqual(parseDetails(undefined), {});
  // Texto editado a mano por el personal: no truena y conserva lo que reconoce.
  assert.equal(parseDetails('Zona o sucursal: Del Valle\nnota interna\n').zone, 'Del Valle');
});

test('reintento sin CRON_SECRET configurado siempre responde 401', async () => {
  await withWorld(
    async () => {
      for (const headers of [{}, { authorization: 'Bearer ' }, { authorization: 'Bearer undefined' }]) {
        const res = await call(retryHandler, { method: 'GET', noBody: true, headers });
        assert.equal(res.statusCode, 401);
      }
    },
    { CRON_SECRET: null },
  );
});

test('falla de Airtable: 503 y ningún éxito ni correo', async () => {
  await withWorld(async (world) => {
    world.airtableMode = 'down';
    const res = await call(handler, { body: validBody() });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.reference, undefined);
    assert.equal(world.emails.length, 0);

    world.airtableMode = 'failCreate';
    const res2 = await call(handler, { body: validBody() });
    assert.equal(res2.statusCode, 503);
    assert.equal(res2.json.ok, false);
    assert.equal(world.records.length, 0);
    assert.equal(world.emails.length, 0);
  });

  await withWorld(
    async (world) => {
      const res = await call(handler, { body: validBody() });
      assert.equal(res.statusCode, 503, 'Airtable sin configurar');
      assert.equal(world.emails.length, 0);
    },
    { AIRTABLE_TOKEN: null },
  );
});

test('un "to" enviado en el cuerpo se ignora; el destino sale solo del servidor', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, {
      body: validBody({
        to: 'atacante@malo.test',
        recipient: 'atacante@malo.test',
        NOTIFY_TO: 'atacante@malo.test',
        reply_to: 'atacante@malo.test',
        from: 'ceo@ofirent.com.mx',
      }),
    });
    assert.equal(res.statusCode, 201);
    const mail = world.emails[0].body;
    assert.deepEqual(mail.to, ['contacto@ofirent.com.mx']);
    assert.equal(mail.reply_to, 'ana@empresa.com');
    assert.equal(mail.from, ENV.EMAIL_FROM);
    assert.ok(!JSON.stringify(mail).includes('atacante@malo.test'));
  });

  await withWorld(
    async (world) => {
      await call(handler, { body: validBody() });
      assert.deepEqual(world.emails[0].body.to, ['contacto@ofirent.com.mx'], 'NOTIFY_TO inválido: valor por defecto');
    },
    { NOTIFY_TO: 'esto no es un correo' },
  );
});

test('el HTML escrito por el usuario queda escapado en el correo', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, {
      body: validBody({
        referrerName: '<script>alert(1)</script>',
        referrerCompany: '"><img src=x onerror=alert(2)>',
        referredName: "Robert'); DROP TABLE--",
        zone: '<b>Roma</b> & Condesa',
        comments: 'Línea 1\n<iframe src="https://malo.test"></iframe>',
      }),
    });
    assert.equal(res.statusCode, 201);
    const html = world.emails[0].body.html;
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<iframe'));
    assert.ok(!html.includes('<b>Roma'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('&quot;&gt;&lt;img'));
    assert.ok(html.includes('&lt;b&gt;Roma&lt;/b&gt; &amp; Condesa'));
    assert.ok(html.includes('Línea 1<br>&lt;iframe'));
  });
});

test('los logs no contienen datos personales (solo folio y tipo de error)', async () => {
  await withWorld(async (world, logs) => {
    const body = validBody();
    const secrets = [
      body.referrerName,
      body.referredName,
      '5512345678',
      '5587654321',
      'ana@empresa.com',
      'luis@correo.com',
      'Estudio Pérez',
      'Del Valle',
      'planta baja',
      '203.0.113.9',
      'tok_test',
      're_test',
    ];

    const extra = [uniqueBody(), uniqueBody(), uniqueBody()];
    for (const b of extra) secrets.push(b.referrerPhone, b.referredPhone);

    await call(handler, { body }); // éxito
    world.resendMode = 'http403';
    await call(handler, { body: extra[0] }); // correo fallido
    world.resendMode = 'throw';
    await call(handler, { body: extra[1] }); // red caída
    world.airtableMode = 'down';
    await call(handler, { body: extra[2] }); // Airtable caído
    world.airtableMode = 'ok';
    await call(handler, { body: validBody({ referrerName: 'A' }) }); // 422
    await call(retryHandler, { method: 'GET', noBody: true, headers: { authorization: 'Bearer cron-secret-test' } });

    assert.ok(logs.length > 0, 'se esperaban logs de los fallos');
    const all = logs.join('\n');
    for (const secret of secrets) assert.ok(!all.includes(secret), 'el log contiene: ' + secret);
    assert.match(all, /REF-[A-Z2-9]{8}/);
  });
});

test('límite por conexión: 10 por hora; sin x-forwarded-for se omite', async () => {
  await withWorld(async (world) => {
    for (let i = 0; i < 10; i++) {
      const res = await call(handler, { body: uniqueBody() });
      assert.equal(res.statusCode, 201, 'envío ' + (i + 1));
    }
    const blocked = await call(handler, { body: uniqueBody() });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json.ok, false);
    assert.equal(world.records.length, 10);

    const otherIp = await call(handler, { body: uniqueBody(), headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } });
    assert.equal(otherIp.statusCode, 201, 'otra conexión no está limitada');
  });

  await withWorld(async (world) => {
    for (let i = 0; i < 12; i++) {
      const req = makeReq({ body: uniqueBody() });
      delete req.headers['x-forwarded-for'];
      const res = makeRes();
      await handler(req, res);
      assert.equal(res.statusCode, 201);
    }
    assert.equal(world.records.length, 12);
    assert.ok(world.records.every((r) => r.fields['Huella de conexión'] === undefined));
  });
});

test('un reintento con la misma clave sigue devolviendo el folio aunque la conexión esté al límite', async () => {
  await withWorld(async (world) => {
    const last = uniqueBody();
    for (let i = 0; i < 9; i++) await call(handler, { body: uniqueBody() });
    const tenth = await call(handler, { body: last });
    assert.equal(tenth.statusCode, 201);
    const retry = await call(handler, { body: last });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json.reference, tenth.json.reference);
    assert.equal(world.records.length, 10);
  });
});

test('tope por persona: máximo 4 recomendaciones por teléfono de quien recomienda', async () => {
  await withWorld(async (world) => {
    const MAX = sharedValidation.PROGRAM.maxReferralsPerPerson;
    assert.equal(MAX, 4);
    const referrerPhone = '5599887766';
    for (let i = 0; i < MAX; i++) {
      const res = await call(handler, { body: uniqueBody({ referrerPhone }) });
      assert.equal(res.statusCode, 201, 'recomendación ' + (i + 1));
    }
    const emailsBefore = world.emails.length;
    const over = await call(handler, { body: uniqueBody({ referrerPhone }) });
    assert.equal(over.statusCode, 422);
    assert.equal(over.json.ok, false);
    assert.equal(over.json.code, 'referrer_limit');
    assert.match(over.json.message, /máximo de 4 recomendaciones/);
    assert.equal(over.json.reference, undefined);
    assert.equal(world.records.length, MAX, 'la quinta no se guarda');
    assert.equal(world.emails.length, emailsBefore, 'ni se avisa');

    // Otra persona no se ve afectada.
    const other = await call(handler, { body: uniqueBody({ referrerPhone: '5544332211' }) });
    assert.equal(other.statusCode, 201);

    // Lo que el personal marca "No procede" libera el cupo.
    world.records[0].fields['Estado'] = 'No procede';
    const afterRelease = await call(handler, { body: uniqueBody({ referrerPhone }) });
    assert.equal(afterRelease.statusCode, 201);

    // Los de hace más de 12 meses ya no cuentan.
    const old = new Date(Date.now() - 400 * 86400 * 1000).toISOString();
    world.records.filter((r) => r.fields['Teléfono de quien recomienda'] === referrerPhone).forEach((r) => (r.createdTime = old));
    const afterWindow = await call(handler, { body: uniqueBody({ referrerPhone }) });
    assert.equal(afterWindow.statusCode, 201);
  });
});

test('la misma persona recomendando al mismo referido otra vez no duplica ni gasta cupo', async () => {
  await withWorld(async (world) => {
    const first = await call(handler, { body: uniqueBody() });
    const f = world.records[0].fields;
    const again = await call(handler, {
      body: validBody({
        referrerPhone: f['Teléfono de quien recomienda'],
        referredPhone: f['Teléfono del referido'],
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(first.statusCode, 201);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json.reference, first.json.reference);
    assert.equal(world.records.length, 1);
    assert.equal(world.emails.length, 1);
  });
});

test('referido ya registrado por otra persona: se guarda con alerta de duplicado y el primer folio', async () => {
  await withWorld(async (world) => {
    const referredPhone = '5577665544';
    const first = await call(handler, { body: uniqueBody({ referredPhone }) });
    const second = await call(handler, { body: uniqueBody({ referredPhone }) });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201, 'no se le revela nada a quien envía');
    assert.equal(world.records.length, 2);
    assert.ok(!world.records[0].fields['Detalles'].includes('ALERTA:'));
    const details = world.records[1].fields['Detalles'];
    assert.ok(details.startsWith('ALERTA: Posible duplicado'), details);
    assert.ok(details.includes(first.json.reference));
    const html = world.emails[1].body.html;
    assert.ok(html.includes('Revisar antes de pagar'));
    assert.ok(html.includes(first.json.reference));
    assert.ok(world.emails[1].body.text.includes('REVISAR ANTES DE PAGAR:'));
    assert.ok(!world.emails[0].body.html.includes('Revisar antes de pagar'));

    // Con el primero en "No procede", el duplicado se mide contra el siguiente vigente.
    world.records[0].fields['Estado'] = 'No procede';
    const third = await call(handler, { body: uniqueBody({ referredPhone }) });
    assert.equal(third.statusCode, 201);
    assert.ok(world.records[2].fields['Detalles'].includes(second.json.reference));
    assert.ok(!world.records[2].fields['Detalles'].includes(first.json.reference));

    // Con todos en "No procede", ya no hay duplicado.
    world.records[1].fields['Estado'] = 'No procede';
    world.records[2].fields['Estado'] = 'No procede';
    const fourth = await call(handler, { body: uniqueBody({ referredPhone }) });
    assert.equal(fourth.statusCode, 201);
    assert.ok(!world.records[3].fields['Detalles'].includes('Posible duplicado'));
  });
});

test('teléfono del referido ya en Leads: se guarda con alerta; si Leads falla, igual se guarda', async () => {
  await withWorld(async (world) => {
    world.leads.push({
      id: 'recLead1',
      createdTime: '2026-09-01T15:00:00.000Z',
      fields: { Nombre: 'Prospecto', 'Teléfono': '(55) 4455-6677' },
    });
    const res = await call(handler, { body: uniqueBody({ referredPhone: '5544556677' }) });
    assert.equal(res.statusCode, 201);
    const details = world.records[0].fields['Detalles'];
    assert.match(details, /^ALERTA: Ya era prospecto: .*Leads desde el 0?1\/09\/2026/);

    world.leadsMode = 'fail';
    const res2 = await call(handler, { body: uniqueBody({ referredPhone: '5544556677' }) });
    assert.equal(res2.statusCode, 201, 'Leads caído no bloquea');
    assert.ok(!world.records[1].fields['Detalles'].includes('ALERTA: Ya era prospecto'));
  });
});

test('autorreferido: el teléfono de la persona recomendada no puede ser el de quien recomienda', async () => {
  const same = validateSelf();
  assert.equal(same.ok, false);
  assert.equal(same.errors.referredPhone, sharedValidation.MESSAGES.selfReferral);

  await withWorld(async (world) => {
    const res = await call(handler, {
      body: validBody({ referrerPhone: '+52 55 1234 5678', referredPhone: '(55) 1234-5678' }),
    });
    assert.equal(res.statusCode, 422);
    assert.ok(res.json.errors.referredPhone);
    assert.equal(world.records.length, 0);
  });

  function validateSelf() {
    return sharedValidation.validateReferral(
      validBody({ referrerPhone: '55 1234 5678', referredPhone: '5512345678' }),
    );
  }
});

test('las alertas sobreviven al reintento: el correo reenviado también las lleva', async () => {
  await withWorld(async (world) => {
    const referredPhone = '5533221100';
    await call(handler, { body: uniqueBody({ referredPhone }) });
    world.resendMode = 'http403';
    await call(handler, { body: uniqueBody({ referredPhone }) });
    world.resendMode = 'ok';
    const before = world.emails.length;
    const run = await call(retryHandler, {
      method: 'GET',
      noBody: true,
      headers: { authorization: 'Bearer cron-secret-test' },
    });
    assert.equal(run.json.attempted, 1);
    const resent = world.emails[before].body;
    assert.ok(resent.html.includes('Revisar antes de pagar'));
    assert.ok(resent.html.includes('Posible duplicado'));
  });
});

test('"Detalles" con alertas: ida y vuelta', () => {
  const { serializeDetails, parseDetails } = airtable;
  const text = serializeDetails({ referrerCompany: 'ACME', comments: 'hola' }, ['A uno', 'B dos']);
  assert.ok(text.startsWith('ALERTA: A uno\nALERTA: B dos\n'));
  const back = parseDetails(text);
  assert.deepEqual(back.alerts, ['A uno', 'B dos']);
  assert.equal(back.referrerCompany, 'ACME');
  assert.equal(back.comments, 'hola');
  assert.equal(parseDetails(serializeDetails({}, [])).alerts, undefined);
});

let ipSeq = 0;
test('campo mal escrito en la tabla: 503, el log dice cuál campo y no trae datos de personas', async () => {
  await withWorld(async (world, logs) => {
    world.airtableMode = 'unknownField';
    const body = uniqueBody({ referredEmail: 'luis@correo.com' });
    const res = await call(handler, { body });
    assert.equal(res.statusCode, 503);
    assert.equal(world.records.length, 0);
    const line = logs.find((l) => l.includes('no se pudo guardar'));
    assert.ok(line, 'debe registrar el fallo');
    assert.ok(line.includes('UNKNOWN_FIELD_NAME'), line);
    assert.ok(line.includes('campo="Detalles"'), 'dice cuál campo falta: ' + line);
    for (const personal of [body.referrerName, body.referredName, body.referrerPhone, body.referredPhone, 'luis@correo.com']) {
      assert.ok(!logs.join('\n').includes(personal), 'no debe registrar: ' + personal);
    }
  });
});

// ---------------------------------------------------------------- aviso al referido (primer contacto)

const CRON = { method: 'GET', noBody: true, headers: { authorization: 'Bearer cron-secret-test' } };

test('aviso al referido: con correo válido sale un mensaje aparte, con aviso de privacidad y sin datos de quien recomienda', async () => {
  await withWorld(async (world) => {
    const body = uniqueBody({ referredEmail: 'luis@correo.com' });
    const res = await call(handler, { body });
    assert.equal(res.statusCode, 201);
    assert.equal(world.emails.length, 1, 'un aviso interno');
    assert.equal(world.noticeEmails.length, 1, 'un aviso al referido');

    const n = world.noticeEmails[0].body;
    assert.deepEqual(n.to, ['luis@correo.com']);
    assert.equal(n.from, ENV.EMAIL_FROM);
    assert.equal(n.reply_to, 'contacto@ofirent.com.mx', 'las respuestas llegan a OfiRent');
    assert.equal(n.subject, 'Te recomendaron con OfiRent');
    assert.ok(n.text.startsWith('Hola Luis Mendoza,'));
    assert.ok(n.text.includes('Ana Pérez Soto te recomendó con OfiRent'));
    assert.ok(n.text.includes('contacto@ofirent.com.mx'));
    assert.ok(n.html.includes('href="https://www.ofirent.com.mx/aviso-de-privacidad/"'));

    // De quien recomienda solo viaja su nombre. Nada de su teléfono, correo, empresa,
    // comentarios ni el folio (que junto con su teléfono abre el seguimiento).
    const everything = n.subject + n.html + n.text;
    for (const secret of [body.referrerPhone, 'ana@empresa.com', 'Estudio Pérez', 'Prefiere planta baja', res.json.reference]) {
      assert.ok(!everything.includes(secret), 'no debe incluir: ' + secret);
    }
    assert.ok(!everything.includes(EM_DASH), 'sin guion largo');
    assert.equal(world.records[0].fields['Aviso por correo'], 'Enviado');
  });
});

test('aviso al referido: sin correo del referido no sale ningún aviso', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, { body: uniqueBody({ referredEmail: '' }) });
    assert.equal(res.statusCode, 201);
    assert.equal(world.emails.length, 1);
    assert.equal(world.noticeEmails.length, 0);
    assert.equal(world.records[0].fields['Aviso por correo'], 'Enviado');
  });
});

test('aviso al referido: si ya estaba registrado por otra persona no se le avisa dos veces', async () => {
  await withWorld(async (world) => {
    const referredPhone = '5599887766';
    await call(handler, { body: uniqueBody({ referredPhone, referredEmail: 'luis@correo.com' }) });
    await call(handler, { body: uniqueBody({ referredPhone, referredEmail: 'luis@correo.com' }) });
    assert.equal(world.records.length, 2);
    assert.equal(world.emails.length, 2, 'cada registro avisa al personal');
    assert.equal(world.noticeEmails.length, 1, 'al referido solo una vez');
  });
});

test('aviso al referido: el nombre de quien recomienda no mete enlaces, correos ni HTML', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, {
      body: uniqueBody({
        referrerName: 'Ver https://promo.example/oferta <b>YA</b> info@promo.example',
        referredName: 'Luis <script>x</script> www.malo.example',
      }),
    });
    assert.equal(res.statusCode, 201);
    const n = world.noticeEmails[0].body;
    const everything = n.html + n.text;
    for (const bad of ['promo.example', 'malo.example', 'info@', '<script', '<b>']) {
      assert.ok(!everything.includes(bad), 'no debe incluir: ' + bad);
    }
  });
});

test('aviso al referido: si falla, el aviso interno no se repite y el reintento solo envía el que faltaba', async () => {
  await withWorld(async (world) => {
    world.noticeMode = 'http403';
    const res = await call(handler, { body: uniqueBody({ referredEmail: 'luis@correo.com' }) });
    assert.equal(res.statusCode, 201, 'el fallo no cambia la respuesta');
    assert.equal(world.emails.length, 1);
    assert.equal(world.noticeEmails.length, 1, 'se intentó');
    assert.match(world.records[0].fields['Aviso por correo'], /^Enviado\. Falta el aviso al referido: .*403/);

    world.noticeMode = 'ok';
    const retry = await call(retryHandler, CRON);
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(
      { attempted: retry.json.attempted, sent: retry.json.sent, failed: retry.json.failed },
      { attempted: 1, sent: 1, failed: 0 },
    );
    assert.equal(world.emails.length, 1, 'el aviso interno no se duplica');
    assert.equal(world.noticeEmails.length, 2, 'el aviso al referido se reenvió');
    assert.equal(world.records[0].fields['Aviso por correo'], 'Enviado');

    const again = await call(retryHandler, CRON);
    assert.equal(again.json.attempted, 0);
  });
});

test('aviso al referido: si el aviso interno falla, todavía no se avisa al referido', async () => {
  await withWorld(async (world) => {
    world.resendMode = 'http403';
    const res = await call(handler, { body: uniqueBody({ referredEmail: 'luis@correo.com' }) });
    assert.equal(res.statusCode, 201);
    assert.equal(world.noticeEmails.length, 0);
    assert.match(world.records[0].fields['Aviso por correo'], /^Fallido: /);

    world.resendMode = 'ok';
    const retry = await call(retryHandler, CRON);
    assert.equal(retry.json.sent, 1);
    assert.equal(world.emails.length, 2);
    assert.equal(world.noticeEmails.length, 1);
    assert.equal(world.records[0].fields['Aviso por correo'], 'Enviado');
  });
});

// ---------------------------------------------------------------- teléfono o correo del referido

test('validación: el referido necesita teléfono o correo (con uno basta)', () => {
  const { validateReferral, MESSAGES } = sharedValidation;
  const neither = validateReferral(validBody({ referredPhone: '', referredEmail: '' }));
  assert.equal(neither.ok, false);
  assert.equal(neither.errors.referredPhone, MESSAGES.contactRequired);

  const onlyEmail = validateReferral(validBody({ referredPhone: '', referredEmail: 'Luis@Correo.com' }));
  assert.equal(onlyEmail.ok, true);
  assert.equal(onlyEmail.value.referredPhone, '');
  assert.equal(onlyEmail.value.referredEmail, 'luis@correo.com');

  const onlyPhone = validateReferral(validBody({ referredPhone: '55 8765 4321', referredEmail: '' }));
  assert.equal(onlyPhone.ok, true);
  assert.equal(onlyPhone.value.referredPhone, '5587654321');

  // Un dato escrito pero inválido sigue siendo error, aunque exista el otro.
  assert.equal(validateReferral(validBody({ referredPhone: '123', referredEmail: 'luis@correo.com' })).errors.referredPhone, MESSAGES.referredPhone);
  assert.equal(validateReferral(validBody({ referredPhone: '', referredEmail: 'no-es-correo' })).errors.referredEmail, MESSAGES.email);
  // No puede recomendarse a sí misma por correo.
  const self = validateReferral(validBody({ referrerEmail: 'ana@empresa.com', referredEmail: 'ANA@empresa.com' }));
  assert.equal(self.errors.referredEmail, MESSAGES.selfReferralEmail);
});

test('solo correo: se guarda sin teléfono, sale el aviso al referido y el aviso interno no lleva copia', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, { body: uniqueBody({ referredPhone: '', referredEmail: 'solo.correo@example.test' }) });
    assert.equal(res.statusCode, 201);
    assert.equal(world.records[0].fields['Teléfono del referido'], '');
    assert.equal(world.noticeEmails.length, 1);
    assert.deepEqual(world.noticeEmails[0].body.to, ['solo.correo@example.test']);
    assert.equal(world.emails.length, 1);
    assert.equal(world.emails[0].body.cc, undefined, 'el primer contacto es automático: nadie más lo atiende');
    assert.match(world.emails[0].body.text, /El sistema ya envió un correo de presentación a solo\.correo@example\.test/);
    assert.equal(world.records[0].fields['Aviso por correo'], 'Enviado');
  });
});

test('solo teléfono: no hay aviso al referido y el aviso interno va con copia y trae el paso a paso', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, { body: uniqueBody({ referredEmail: '', spaceType: 'virtual', referredName: 'Luis Mendoza' }) });
    assert.equal(res.statusCode, 201);
    assert.equal(world.noticeEmails.length, 0);
    assert.equal(world.emails.length, 1);
    const mail = world.emails[0].body;
    assert.deepEqual(mail.to, ['contacto@ofirent.com.mx']);
    assert.deepEqual(mail.cc, ['nico@example.test', 'gerencia@example.test']);
    assert.match(mail.html, /Qué hacer ahora: solo dejó teléfono, el primer contacto es manual/);
    assert.match(mail.text, /1\. Contacta a Luis Mendoza al \d{10} por WhatsApp o llamada dentro de las próximas 24 horas hábiles\./);
    assert.match(mail.text, /aviso de privacidad: https:\/\/www\.ofirent\.com\.mx\/aviso-de-privacidad\//);
    assert.match(mail.text, /Mensaje sugerido para WhatsApp:\nHola Luis Mendoza, te escribimos de OfiRent\. Ana Pérez Soto nos compartió tu contacto porque pensó que podríamos ayudarte con una oficina virtual\./);
    // Trae todo lo que dio el cliente.
    for (const needle of ['Ana Pérez Soto', 'Estudio Pérez', 'ana@empresa.com', 'Oficina virtual', 'Del Valle', 'Prefiere planta baja.']) {
      assert.ok(mail.text.includes(needle), 'falta en el aviso interno: ' + needle);
    }
    assert.ok(!(mail.html + mail.text).includes(EM_DASH));
  });
});

test('NOTIFY_CC: solo direcciones válidas, sin repetir ni duplicar al destinatario principal, y sin variable no hay copia', async () => {
  await withWorld(async (world) => {
    process.env.NOTIFY_CC = 'a@example.test; B@Example.test, a@example.test, no-es-correo, contacto@ofirent.com.mx';
    assert.deepEqual(notifyLib.notifyCc(), ['a@example.test', 'b@example.test']);
    process.env.NOTIFY_CC = '';
    assert.deepEqual(notifyLib.notifyCc(), []);
    const res = await call(handler, { body: uniqueBody({ referredEmail: '' }) });
    assert.equal(res.statusCode, 201);
    assert.equal(world.emails[0].body.cc, undefined);
  });
});

test('correo repetido por otra persona: se guarda con alerta de duplicado y no se le escribe dos veces', async () => {
  await withWorld(async (world) => {
    const email = 'repetido@example.test';
    const first = await call(handler, { body: uniqueBody({ referredPhone: '', referredEmail: email }) });
    const second = await call(handler, { body: uniqueBody({ referredPhone: '', referredEmail: email }) });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(world.records.length, 2);
    assert.ok(world.records[1].fields['Detalles'].startsWith('ALERTA: Posible duplicado'));
    assert.ok(world.records[1].fields['Detalles'].includes(first.json.reference));
    assert.equal(world.noticeEmails.length, 1);
    // Sin aviso automático, el primer contacto del segundo registro lo hace el personal (con copia).
    assert.deepEqual(world.emails[1].body.cc, ['nico@example.test', 'gerencia@example.test']);
  });
});

test('el correo al referido trae servicios con precios publicados, invitación al programa y baja, y pone primero lo que busca', async () => {
  await withWorld(async (world) => {
    const res = await call(handler, { body: uniqueBody({ spaceType: 'virtual', referredEmail: 'luis@example.test' }) });
    assert.equal(res.statusCode, 201);
    const n = world.noticeEmails[0].body;
    const html = n.html;
    assert.ok(html.indexOf('Oficina virtual y domicilio fiscal') < html.indexOf('Oficinas equipadas'), 'lo que busca va primero');
    assert.ok(html.includes('Lo que buscas'));
    for (const price of ['Desde $6,500 al mes', 'Desde $799 al mes', 'Desde $2,500 al mes']) assert.ok(html.includes(price), price);
    assert.ok(html.includes('hasta $5,000 MXN'), 'invitación al programa de referidos');
    assert.ok(html.includes('https://www.ofirent.com.mx/programa-de-referidos/?utm_source=correo'));
    assert.ok(html.includes('https://wa.me/525532009907?text='), 'botón principal de WhatsApp');
    assert.match(html, /https:\/\/www\.ofirent\.com\.mx\/assets\/email\/servicio-oficina-virtual\.jpg/);
    assert.ok(html.includes('https://www.ofirent.com.mx/aviso-de-privacidad/'));
    assert.ok(n.text.includes('Somos parte del grupo OfiRent'));
    // Baja de un clic: enlace en el cuerpo y cabeceras para Gmail y Apple Mail.
    assert.match(html, /https:\/\/www\.ofirent\.com\.mx\/api\/referidos-baja\/\?t=rec[A-Za-z0-9]{14}\./);
    assert.match(n.headers['List-Unsubscribe'], /^<https:\/\/www\.ofirent\.com\.mx\/api\/referidos-baja\/\?t=/);
    assert.equal(n.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    // Sin el folio: junto con el teléfono de quien recomienda abre el seguimiento.
    assert.ok(!(n.html + n.text).includes(res.json.reference));
    assert.ok(!(n.html + n.text + n.subject).includes(EM_DASH));
  });
});

test('baja de un clic: el GET solo pregunta, el POST da de baja y ese correo no vuelve a recibir el aviso', async () => {
  await withWorld(async (world) => {
    const email = 'baja@example.test';
    const reg = await call(handler, { body: uniqueBody({ referredEmail: email }) });
    assert.equal(reg.statusCode, 201);
    const link = world.noticeEmails[0].body.headers['List-Unsubscribe'].slice(1, -1);
    const url = new URL(link);
    const token = url.searchParams.get('t');
    const target = '/api/referidos-baja/?t=' + encodeURIComponent(token);

    // Un GET (los filtros de correo abren los enlaces solos) no cambia nada.
    const get = await call(bajaHandler, { method: 'GET', noBody: true, url: target });
    assert.equal(get.statusCode, 200);
    assert.match(get.body, /Confirmar, no quiero recibir más mensajes/);
    assert.equal(world.records[0].fields['Estado'], 'Nuevo');

    // El POST (botón o "un clic") sí.
    const post = await call(bajaHandler, { method: 'POST', noBody: true, url: target });
    assert.equal(post.statusCode, 200);
    assert.match(post.body, /no volveremos a escribirte/);
    assert.equal(world.records[0].fields['Estado'], 'No procede');
    assert.ok(world.records[0].fields['Detalles'].startsWith('ALERTA: Baja: la persona pidió no recibir más mensajes de OfiRent'));
    // Repetirlo no duplica la alerta.
    await call(bajaHandler, { method: 'POST', noBody: true, url: target });
    assert.equal(world.records[0].fields['Detalles'].split('ALERTA: Baja:').length, 2);

    // Otra persona vuelve a recomendar ese correo: se guarda, pero no se le escribe.
    const before = world.noticeEmails.length;
    const again = await call(handler, { body: uniqueBody({ referredEmail: email }) });
    assert.equal(again.statusCode, 201);
    assert.equal(world.noticeEmails.length, before, 'no recibe el aviso');
    const last = world.records[world.records.length - 1].fields['Detalles'];
    assert.ok(last.includes('ALERTA: Baja: este correo ya pidió no recibir mensajes'), last);
    const internal = world.emails[world.emails.length - 1].body;
    assert.match(internal.html, /esta persona pidió no ser contactada/);
  });
});

test('baja: enlace alterado, sin firma o de otro registro se rechaza y no cambia nada', async () => {
  await withWorld(async (world) => {
    const reg = await call(handler, { body: uniqueBody({ referredEmail: 'firma@example.test' }) });
    assert.equal(reg.statusCode, 201);
    const token = new URL(world.noticeEmails[0].body.headers['List-Unsubscribe'].slice(1, -1)).searchParams.get('t');
    const [recId, sig] = token.split('.');
    const bad = [
      '/api/referidos-baja/',
      '/api/referidos-baja/?t=',
      '/api/referidos-baja/?t=' + recId,
      '/api/referidos-baja/?t=' + recId + '.' + 'x'.repeat(sig.length),
      '/api/referidos-baja/?t=recAAAAAAAAAAAAAA.' + sig,
      '/api/referidos-baja/?t=' + encodeURIComponent('REF-ABCDEFGH.' + sig),
    ];
    for (const url of bad) {
      for (const method of ['GET', 'POST']) {
        const r = await call(bajaHandler, { method, noBody: true, url });
        assert.equal(r.statusCode, 400, method + ' ' + url);
      }
    }
    assert.equal(world.records[0].fields['Estado'], 'Nuevo');
    assert.equal((await call(bajaHandler, { method: 'PUT', noBody: true, url: '/api/referidos-baja/?t=' + encodeURIComponent(token) })).statusCode, 405);
  });
});

function trackBody(body, extra) {
  ipSeq += 1;
  return {
    body,
    headers: Object.assign({ 'x-forwarded-for': '198.51.100.' + (ipSeq % 250) + ', 10.0.0.1' }, extra || {}),
  };
}

test('seguimiento: con folio y teléfono correctos muestra la etapa, sin datos personales del referido', async () => {
  await withWorld(async (world) => {
    const created = await call(handler, {
      body: validBody({ referredName: 'Luis Mendoza Ríos', referredEmail: 'luis@correo.com' }),
    });
    const folio = created.json.reference;

    const ok = await call(trackHandler, trackBody({ folio, phone: '+52 55 1234 5678' }));
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json.ok, true);
    assert.equal(ok.json.stage, 'received');
    assert.equal(ok.json.title, 'Recibida');
    assert.equal(ok.json.folio, folio);
    assert.equal(ok.json.referredFirstName, 'Luis');
    assert.equal(ok.json.closed, 0);
    assert.equal(ok.json.ambassador, false);
    assert.equal(ok.json.ambassadorAfter, 2);
    const text = JSON.stringify(ok.json);
    for (const secret of ['5587654321', 'luis@correo.com', 'Mendoza', 'Ríos', 'Estudio Pérez', 'ana@empresa.com']) {
      assert.ok(!text.includes(secret), 'filtra: ' + secret);
    }

    // Cada Estado del personal se traduce a una etapa legible.
    const expected = {
      Contactado: 'contacted',
      'Contrato firmado': 'signed',
      'Bono aplicado': 'paid',
      'No procede': 'rejected',
    };
    for (const [estado, stage] of Object.entries(expected)) {
      world.records[0].fields['Estado'] = estado;
      const r = await call(trackHandler, trackBody({ folio: folio.toLowerCase(), phone: '5512345678' }));
      assert.equal(r.statusCode, 200, estado);
      assert.equal(r.json.stage, stage, estado);
    }
  });
});

test('seguimiento: teléfono incorrecto, folio inexistente o mal formado dan la misma respuesta', async () => {
  await withWorld(async (world) => {
    const created = await call(handler, { body: validBody() });
    const folio = created.json.reference;
    const wrongPhone = await call(trackHandler, trackBody({ folio, phone: '5599999999' }));
    const wrongFolio = await call(trackHandler, trackBody({ folio: 'REF-AAAAAAAA', phone: '5512345678' }));
    const badFolio = await call(trackHandler, trackBody({ folio: "REF-'; DROP", phone: '5512345678' }));
    const noPhone = await call(trackHandler, trackBody({ folio, phone: 'abc' }));
    for (const r of [wrongPhone, wrongFolio, badFolio, noPhone]) {
      assert.equal(r.statusCode, 404);
      assert.equal(r.json.code, 'not_found');
      assert.equal(r.json.message, wrongPhone.json.message, 'mismo mensaje en todos los casos');
      assert.equal(r.json.folio, undefined);
    }
  });
});

test('seguimiento: Embajador al tener 2 recomendaciones con bono aplicado', async () => {
  await withWorld(async (world) => {
    const referrerPhone = '5566778899';
    const a = await call(handler, { body: uniqueBody({ referrerPhone }) });
    const b = await call(handler, { body: uniqueBody({ referrerPhone }) });
    world.records[0].fields['Estado'] = 'Bono aplicado';
    const one = await call(trackHandler, trackBody({ folio: a.json.reference, phone: referrerPhone }));
    assert.equal(one.json.closed, 1);
    assert.equal(one.json.ambassador, false);
    world.records[1].fields['Estado'] = 'Bono aplicado';
    const two = await call(trackHandler, trackBody({ folio: b.json.reference, phone: referrerPhone }));
    assert.equal(two.json.closed, 2);
    assert.equal(two.json.ambassador, true);
  });
});

test('seguimiento: método, origen, cuerpo, Airtable caído y límite de consultas', async () => {
  await withWorld(async (world) => {
    const created = await call(handler, { body: validBody() });
    const good = { folio: created.json.reference, phone: '5512345678' };

    assert.equal((await call(trackHandler, { method: 'GET', noBody: true })).statusCode, 405);
    assert.equal(
      (await call(trackHandler, trackBody(good, { origin: 'https://sitio-malo.example' }))).statusCode,
      403,
    );
    assert.equal((await call(trackHandler, { raw: '{no es json', headers: { 'x-forwarded-for': '198.51.100.201' } })).statusCode, 400);
    assert.equal(
      (await call(trackHandler, { raw: JSON.stringify({ x: 'y'.repeat(5000) }), headers: { 'x-forwarded-for': '198.51.100.202' } }))
        .statusCode,
      413,
    );

    world.airtableMode = 'down';
    const down = await call(trackHandler, trackBody(good));
    assert.equal(down.statusCode, 503);
    assert.equal(down.json.ok, false);
    world.airtableMode = 'ok';

    // Más de 30 consultas por hora desde la misma conexión: se frena.
    let last;
    for (let i = 0; i < 32; i++) {
      last = await call(trackHandler, { body: good, headers: { 'x-forwarded-for': '198.51.100.250' } });
    }
    assert.equal(last.statusCode, 429);
  });
});

test('tipos de espacio: oficina física, oficina virtual y coworking; los valores viejos no rompen el envío', () => {
  const { validateReferral } = sharedValidation;
  for (const [sent, kept] of [['fisica', 'fisica'], ['virtual', 'virtual'], ['coworking', 'coworking'], ['', '']]) {
    const r = validateReferral(validBody({ spaceType: sent }));
    assert.equal(r.ok, true, sent);
    assert.equal(r.value.spaceType, kept, sent);
  }
  // Una página en cache de la primera versión puede seguir mandando estos valores.
  assert.equal(validateReferral(validBody({ spaceType: 'oficina' })).value.spaceType, 'fisica');
  assert.equal(validateReferral(validBody({ spaceType: 'bodega' })).value.spaceType, '');
  assert.equal(validateReferral(validBody({ spaceType: 'otro' })).value.spaceType, '');
  assert.equal(validateReferral(validBody({ spaceType: 'castillo' })).ok, false);
});

test('tipos de espacio: el nombre legible llega a Airtable y al correo, y vuelve igual en el reintento', async () => {
  await withWorld(async (world) => {
    for (const [value, label] of [['virtual', 'Oficina virtual'], ['coworking', 'Espacio de coworking']]) {
      const res = await call(handler, { body: uniqueBody({ spaceType: value }) });
      assert.equal(res.statusCode, 201);
      const rec = world.records[world.records.length - 1];
      assert.ok(rec.fields['Detalles'].includes('Tipo de espacio: ' + label), label);
      const back = airtable.parseDetails(rec.fields['Detalles']);
      assert.equal(back.spaceType, value);
      const mail = world.emails[world.emails.length - 1].body;
      assert.ok(mail.html.includes(label), 'el aviso interno dice ' + label);
    }
  });
});

test('validación compartida: teléfonos y límites', () => {
  const { normalizePhone, validateReferral, LIMITS } = sharedValidation;
  const cases = [
    ['55 1234 5678', '5512345678'],
    ['(55) 1234-5678', '5512345678'],
    ['+52 55 1234 5678', '5512345678'],
    ['52 55 1234 5678', '5512345678'],
    ['+52 1 55 1234 5678', '5512345678'],
    ['521 55 1234 5678', '5512345678'],
    ['+1 415 555 2671', '+14155552671'],
    ['1234', null],
    ['abc', null],
    ['55 1234 567', null],
    ['+123', null],
    ['', null],
  ];
  for (const [input, expected] of cases) assert.equal(normalizePhone(input), expected, input);

  const long = validateReferral(validBody({ referrerName: 'x'.repeat(LIMITS.name + 1), zone: 'z'.repeat(121), comments: 'c'.repeat(1001) }));
  assert.equal(long.ok, false);
  assert.deepEqual(Object.keys(long.errors).sort(), ['comments', 'referrerName', 'zone']);

  const spaced = validateReferral(validBody({ referrerName: '  Ana   \u0007 Pérez  ', spaceType: 'castillo' }));
  assert.equal(spaced.ok, false);
  assert.deepEqual(Object.keys(spaced.errors), ['spaceType']);
  const ok = validateReferral(validBody({ referrerName: '  Ana   \u0007 Pérez  ' }));
  assert.equal(ok.value.referrerName, 'Ana Pérez');
});

test('el mismo archivo de validación corre en el navegador (UMD)', () => {
  const code = fs.readFileSync(path.join(SITE, 'assets', 'referidos', 'validation.js'), 'utf8');
  const sandbox = {};
  sandbox.self = sandbox;
  vm.runInNewContext(code, sandbox);
  assert.equal(typeof sandbox.OfiRentReferidos.validateReferral, 'function');
  assert.equal(sandbox.OfiRentReferidos.normalizePhone('+52 55 1234 5678'), '5512345678');
});

test('ningún archivo del programa contiene guion largo', () => {
  const files = [
    'assets/referidos/validation.js',
    'api/referidos.js',
    'api/referidos-reintento.js',
    'api/referidos-seguimiento.js',
    'api/_lib/airtable.js',
    'api/_lib/email-template.js',
    'api/_lib/notify.js',
    'api/_lib/security.js',
    'api/_lib/validation.js',
    'programa-de-referidos/index.html',
    'programa-de-referidos/terminos/index.html',
    'programa-de-referidos/seguimiento/index.html',
    'assets/site.css',
    'vercel.json',
    'sitemap.xml',
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(SITE, rel), 'utf8');
    assert.ok(!text.includes(EM_DASH), rel + ' contiene guion largo');
  }
});
