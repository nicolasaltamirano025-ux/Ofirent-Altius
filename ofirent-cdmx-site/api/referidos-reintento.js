// Cron diario de Vercel: reintenta las notificaciones que no salieron.
// Exige Authorization: Bearer CRON_SECRET (Vercel lo envía solo a los crons).

const airtable = require('./_lib/airtable');
const { MAX_AUTO_ATTEMPTS, emailConfig, notifyRecord } = require('./_lib/notify');
const { safeEqual } = require('./_lib/security');

const BATCH_LIMIT = 25;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { ok: false });
  }

  const secret = (process.env.CRON_SECRET || '').trim();
  const header = String(req.headers.authorization || '');
  const expected = 'Bearer ' + secret;
  if (!secret || !safeEqual(header, expected)) {
    return send(res, 401, { ok: false });
  }

  const cfg = airtable.config();
  if (!cfg) {
    console.error('[referidos-reintento] airtable_not_configured');
    return send(res, 503, { ok: false, code: 'storage_unavailable' });
  }
  if (!emailConfig()) {
    // Sin correo configurado no hay nada que reintentar: no se gastan intentos.
    return send(res, 200, { ok: true, attempted: 0, sent: 0, failed: 0, pending: 0, skipped: 'email_not_configured' });
  }

  try {
    const queue = await airtable.listUnsent(cfg, MAX_AUTO_ATTEMPTS, BATCH_LIMIT);
    const summary = { ok: true, attempted: queue.length, sent: 0, failed: 0, pending: 0 };
    // En serie: volumen bajo y evita rebasar límites de tasa del proveedor.
    for (const record of queue) {
      const outcome = await notifyRecord(cfg, record);
      if (outcome === 'sent') summary.sent += 1;
      else if (outcome === 'failed') summary.failed += 1;
      else summary.pending += 1;
    }
    return send(res, 200, summary);
  } catch (error) {
    const kind = error && error.name === 'AirtableError' ? 'airtable_' + error.status : error && error.name ? error.name : 'unknown';
    console.error('[referidos-reintento] fallo ' + kind);
    return send(res, 503, { ok: false, code: 'storage_unavailable' });
  }
};
