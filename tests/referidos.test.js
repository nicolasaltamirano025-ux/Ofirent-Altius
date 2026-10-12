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
const airtable = require(path.join(SITE, 'api', '_lib', 'airtable.js'));
const sharedValidation = require(path.join(SITE, 'assets', 'referidos', 'validation.js'));

const EM_DASH = String.fromCharCode(0x2014);
const HOST = 'www.ofirent.com.mx';
const ENV = {
  AIRTABLE_TOKEN: 'tok_test',
  AIRTABLE_BASE_ID: 'appTEST',
  AIRTABLE_REFERIDOS_TABLE_ID: 'tblTEST',
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'OfiRent Referidos <referidos@example.test>',
  NOTIFY_TO: 'contacto@ofirent.com.mx',
  CRON_SECRET: 'cron-secret-test',
  IP_HASH_SALT: 'salt-test',
};
const ALLOWED_FIELDS = new Set(Object.values(airtable.F));

// ---------------------------------------------------------------- mundo falso

function makeWorld() {
  const world = {
    records: [],
    emails: [],
    airtableMode: 'ok', // ok | down | failCreate
    resendMode: 'ok', // ok | http403 | throw
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
      world.emails.push({ url: u.toString(), headers, body });
      if (world.resendMode === 'throw') throw new TypeError('fetch failed');
      if (world.resendMode === 'http403') {
        return json(403, { statusCode: 403, name: 'validation_error', message: 'Dominio no verificado.' });
      }
      return json(200, { id: 'email_' + world.emails.length });
    }

    if (u.hostname === 'api.airtable.com') {
      assert.equal(headers.Authorization, 'Bearer tok_test');
      if (world.airtableMode === 'down') return json(500, { error: { type: 'SERVER_ERROR', message: 'x' } });
      const parts = u.pathname.split('/').filter(Boolean); // v0, base, table, [rec]
      assert.equal(parts[1], 'appTEST');
      assert.equal(parts[2], 'tblTEST');
      const recId = parts[3];
      const method = init.method || 'GET';

      if (method === 'POST') {
        if (world.airtableMode === 'failCreate') return json(422, { error: { type: 'INVALID_VALUE_FOR_COLUMN' } });
        const { fields } = JSON.parse(init.body);
        for (const name of Object.keys(fields)) assert.ok(ALLOWED_FIELDS.has(name), 'campo desconocido: ' + name);
        const record = { id: 'rec' + ++world.seq, createdTime: new Date().toISOString(), fields };
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
      if (method === 'GET') {
        const formula = u.searchParams.get('filterByFormula') || '';
        const max = Number(u.searchParams.get('maxRecords')) || 100;
        let found;
        const keyMatch = formula.match(/^\{Clave de envío\}='(.*)'$/);
        const ipMatch = formula.match(/\{Huella de conexión\}='([^']*)'/);
        if (keyMatch) {
          found = world.records.filter((r) => r.fields['Clave de envío'] === keyMatch[1]);
        } else if (ipMatch) {
          const since = Date.now() - 3600 * 1000;
          found = world.records.filter(
            (r) => r.fields['Huella de conexión'] === ipMatch[1] && Date.parse(r.fields['Fecha de recepción']) > since,
          );
        } else if (formula.includes("{Notificación}!='Enviada'")) {
          const cap = Number(formula.match(/\{Intentos\}<(\d+)/)[1]);
          found = world.records.filter((r) => {
            const attempts = r.fields['Intentos'];
            return (
              r.fields['Notificación'] !== 'Enviada' && (attempts === undefined || attempts === null || attempts < cap)
            );
          });
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

function makeReq({ method = 'POST', headers = {}, body, raw, noBody = false } = {}) {
  const text = raw !== undefined ? raw : JSON.stringify(body);
  const req = Readable.from(noBody ? [] : [Buffer.from(text)]);
  req.method = method;
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
      spaceType: 'oficina',
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
    assert.equal(f['Autorización confirmada'], true);
    assert.equal(f['Sitio'], 'OfiRent CDMX / Programa de referidos');
    assert.equal(f['Teléfono de quien recomienda'], '5512345678');
    assert.equal(f['Teléfono del referido'], '5587654321');
    assert.equal(f['Correo de quien recomienda'], 'ana@empresa.com');
    assert.equal(f['Tipo de espacio'], 'Oficina');
    assert.ok(/^[0-9a-f]{64}$/.test(f['Huella de conexión']), 'huella sha256');
    assert.ok(!JSON.stringify(f).includes('203.0.113.9'), 'la IP no se guarda');
    assert.equal(f['Notificación'], 'Enviada');
    assert.equal(f['Intentos'], 1);
    assert.equal(f['Último error'], undefined);

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
    for (const name of ['Empresa de quien recomienda', 'Correo de quien recomienda', 'Correo del referido', 'Tipo de espacio', 'Zona o sucursal', 'Comentarios']) {
      assert.equal(f[name], undefined, name);
    }
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

    const same = await call(handler, { headers: { origin: 'https://' + HOST }, body: validBody() });
    assert.equal(same.statusCode, 201);

    const preview = await call(handler, {
      headers: {
        origin: 'https://ofirent-cdmx-site-git-referidos.vercel.app',
        host: 'internal-host',
        'x-forwarded-host': 'ofirent-cdmx-site-git-referidos.vercel.app',
      },
      body: validBody(),
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

test('falla de Resend: el registro se conserva, queda Fallida y el reintento la marca Enviada', async () => {
  await withWorld(async (world) => {
    world.resendMode = 'http403';
    const res = await call(handler, { body: validBody() });
    assert.equal(res.statusCode, 201, 'el fallo del correo no cambia la respuesta');
    assert.equal(res.json.ok, true);

    assert.equal(world.records.length, 1);
    let f = world.records[0].fields;
    assert.equal(f['Notificación'], 'Fallida');
    assert.equal(f['Intentos'], 1);
    assert.match(f['Último error'], /403/);

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
    assert.equal(f['Notificación'], 'Enviada');
    assert.equal(f['Intentos'], 2);
    assert.equal(f['Último error'], undefined);
    assert.deepEqual(world.emails[1].body.to, ['contacto@ofirent.com.mx']);
    assert.ok(world.emails[1].body.html.includes(res.json.reference));

    // Ya enviada: un segundo reintento no hace nada.
    const again = await call(retryHandler, {
      method: 'GET',
      noBody: true,
      headers: { authorization: 'Bearer cron-secret-test' },
    });
    assert.equal(again.json.attempted, 0);
    assert.equal(world.emails.length, 2);
  });
});

test('falla de red al enviar el correo: registro conservado y marcado Fallida', async () => {
  await withWorld(async (world) => {
    world.resendMode = 'throw';
    const res = await call(handler, { body: validBody() });
    assert.equal(res.statusCode, 201);
    assert.equal(world.records[0].fields['Notificación'], 'Fallida');
    assert.equal(world.records[0].fields['Intentos'], 1);
  });
});

test('reintento: respeta el tope de 5 intentos y no gasta intentos sin correo configurado', async () => {
  await withWorld(async (world) => {
    world.resendMode = 'http403';
    await call(handler, { body: validBody() });
    world.records[0].fields['Intentos'] = 5;
    world.resendMode = 'ok';
    const auth = { authorization: 'Bearer cron-secret-test' };
    const capped = await call(retryHandler, { method: 'GET', noBody: true, headers: auth });
    assert.equal(capped.json.attempted, 0, 'con 5 intentos ya no se reintenta solo');
    assert.equal(world.emails.length, 1);
  });

  await withWorld(
    async (world) => {
      const res = await call(handler, { body: validBody() });
      assert.equal(res.statusCode, 201, 'se guarda aunque no haya correo configurado');
      assert.equal(world.records[0].fields['Notificación'], 'Pendiente');
      assert.equal(world.records[0].fields['Intentos'], 0);
      assert.equal(world.emails.length, 0);
      const retry = await call(retryHandler, {
        method: 'GET',
        noBody: true,
        headers: { authorization: 'Bearer cron-secret-test' },
      });
      assert.equal(retry.statusCode, 200);
      assert.equal(retry.json.skipped, 'email_not_configured');
      assert.equal(world.records[0].fields['Intentos'], 0);
    },
    { RESEND_API_KEY: null },
  );
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

    await call(handler, { body }); // éxito
    world.resendMode = 'http403';
    await call(handler, { body: validBody() }); // correo fallido
    world.resendMode = 'throw';
    await call(handler, { body: validBody() }); // red caída
    world.airtableMode = 'down';
    await call(handler, { body: validBody() }); // Airtable caído
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
      const res = await call(handler, { body: validBody() });
      assert.equal(res.statusCode, 201, 'envío ' + (i + 1));
    }
    const blocked = await call(handler, { body: validBody() });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json.ok, false);
    assert.equal(world.records.length, 10);

    const otherIp = await call(handler, { body: validBody(), headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } });
    assert.equal(otherIp.statusCode, 201, 'otra conexión no está limitada');
  });

  await withWorld(async (world) => {
    for (let i = 0; i < 12; i++) {
      const req = makeReq({ body: validBody() });
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
    const last = validBody();
    for (let i = 0; i < 9; i++) await call(handler, { body: validBody() });
    const tenth = await call(handler, { body: last });
    assert.equal(tenth.statusCode, 201);
    const retry = await call(handler, { body: last });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json.reference, tenth.json.reference);
    assert.equal(world.records.length, 10);
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
    'api/_lib/airtable.js',
    'api/_lib/email-template.js',
    'api/_lib/notify.js',
    'api/_lib/security.js',
    'api/_lib/validation.js',
    'programa-de-referidos/index.html',
    'assets/site.css',
    'vercel.json',
    'sitemap.xml',
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(SITE, rel), 'utf8');
    assert.ok(!text.includes(EM_DASH), rel + ' contiene guion largo');
  }
});
