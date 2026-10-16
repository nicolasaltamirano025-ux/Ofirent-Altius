// Baja de la persona recomendada (enlace del correo de presentacion).
//  GET  /api/referidos-baja/?t=<token>  -> pagina con un boton para confirmar (un GET nunca da de baja:
//                                          los filtros de correo abren los enlaces solos).
//  POST /api/referidos-baja/?t=<token>  -> da de baja. Tambien lo usa el "un clic" de Gmail/Apple Mail
//                                          (cabecera List-Unsubscribe-Post), que manda el POST sin pagina.
// Da de baja = la recomendacion pasa a "No procede" y queda una alerta en "Detalles"; el mismo correo
// no vuelve a recibir el aviso automatico. El token lleva el id del registro y una firma, ver _lib/unsubscribe.js.

const airtable = require('./_lib/airtable');
const { verifyToken } = require('./_lib/unsubscribe');

function dateEs() {
  return new Date().toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(res, status, title, bodyHtml) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta name="robots" content="noindex"><title>' + escapeHtml(title) + ' | OfiRent</title></head>' +
      '<body style="margin:0;background:#F5F6F4;font-family:Arial,Helvetica,sans-serif;color:#13201A;">' +
      '<div style="max-width:480px;margin:48px auto;padding:0 20px;">' +
      '<div style="background:#ffffff;border:1px solid #DBE0DA;border-top:5px solid #1C8449;border-radius:16px;padding:28px;">' +
      '<div style="font-size:20px;font-weight:bold;color:#0E5C33;margin-bottom:14px;">OfiRent</div>' +
      bodyHtml +
      '</div></div></body></html>',
  );
}

function tokenOf(req) {
  try {
    return new URL(req.url, 'https://www.ofirent.com.mx').searchParams.get('t') || '';
  } catch {
    return '';
  }
}

module.exports = async (req, res) => {
  const token = tokenOf(req);
  const checked = verifyToken(token);
  if (!checked.ok) {
    return page(res, 400, 'Enlace no válido', '<h1 style="font-size:20px;margin:0 0 10px;">Este enlace no es válido</h1><p style="line-height:1.6;margin:0;">Si quieres que no te contactemos, escríbenos a <a href="mailto:contacto@ofirent.com.mx" style="color:#0E5C33;">contacto@ofirent.com.mx</a> y no volveremos a escribirte.</p>');
  }

  if (req.method === 'GET') {
    return page(
      res,
      200,
      'Dejar de recibir mensajes',
      '<h1 style="font-size:20px;margin:0 0 10px;">¿Ya no quieres que te contactemos?</h1>' +
        '<p style="line-height:1.6;margin:0 0 18px;">Confirma y no volveremos a escribirte por esta recomendación.</p>' +
        '<form method="post" action="/api/referidos-baja/?t=' + encodeURIComponent(token) + '">' +
        '<button type="submit" style="background:#1C8449;color:#ffffff;border:0;border-radius:10px;padding:13px 22px;font-size:15px;font-weight:bold;cursor:pointer;">Confirmar, no quiero recibir más mensajes</button>' +
        '</form>',
    );
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return page(res, 405, 'Método no permitido', '<p style="margin:0;">Método no permitido.</p>');
  }

  const cfg = airtable.config();
  if (!cfg) {
    console.error('[baja] airtable_not_configured');
    return page(res, 503, 'Inténtalo más tarde', '<p style="line-height:1.6;margin:0;">No pudimos procesar tu solicitud en este momento. Escríbenos a <a href="mailto:contacto@ofirent.com.mx" style="color:#0E5C33;">contacto@ofirent.com.mx</a> y lo hacemos por ti.</p>');
  }

  try {
    const record = await airtable.getRecord(cfg, checked.recordId);
    // Si el registro ya no existe se responde igual: no se revela nada.
    if (record) await airtable.markOptOut(cfg, record, dateEs());
    return page(
      res,
      200,
      'Listo',
      '<h1 style="font-size:20px;margin:0 0 10px;">Listo, no volveremos a escribirte</h1><p style="line-height:1.6;margin:0;">Registramos tu solicitud. Si cambias de opinión, puedes escribirnos a <a href="mailto:contacto@ofirent.com.mx" style="color:#0E5C33;">contacto@ofirent.com.mx</a>.</p>',
    );
  } catch (error) {
    const kind = error && error.name === 'AirtableError' ? 'airtable_' + error.status : error && error.name ? error.name : 'unknown';
    console.error('[baja] no se pudo registrar ' + kind);
    return page(res, 503, 'Inténtalo más tarde', '<p style="line-height:1.6;margin:0;">No pudimos procesar tu solicitud en este momento. Escríbenos a <a href="mailto:contacto@ofirent.com.mx" style="color:#0E5C33;">contacto@ofirent.com.mx</a> y lo hacemos por ti.</p>');
  }
};
