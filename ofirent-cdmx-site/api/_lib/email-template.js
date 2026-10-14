const NOTIFICATION_SUBJECT = 'Nueva recomendación · Campaña OfiRent';

const SPACE_LABELS = { oficina: 'Oficina', bodega: 'Bodega', otro: 'Otro' };

const GREEN = '#1C8449';
const GREEN_DARK = '#0E5C33';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Fecha y hora de recepción en hora de Ciudad de México.
function formatReceivedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'No disponible';
  const text = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(date);
  return text + ' (hora de Ciudad de México)';
}

function sections(r) {
  return [
    {
      title: '1. Quién recomienda',
      lines: [
        { label: 'Nombre', value: r.referrerName },
        { label: 'Empresa', value: r.referrerCompany },
        { label: 'Teléfono', value: r.referrerPhone, kind: 'phone' },
        { label: 'Correo', value: r.referrerEmail, kind: 'email' },
      ],
    },
    {
      title: '2. Persona recomendada',
      lines: [
        { label: 'Nombre', value: r.referredName },
        { label: 'Teléfono', value: r.referredPhone, kind: 'phone' },
        { label: 'Correo', value: r.referredEmail, kind: 'email' },
        { label: 'Tipo de espacio', value: SPACE_LABELS[r.spaceType] || r.spaceType },
        { label: 'Zona o sucursal de interés', value: r.zone },
        { label: 'Comentarios', value: r.comments },
      ],
    },
  ];
}

// Construye el correo de notificación (HTML con respaldo en texto plano).
// `r` usa las claves camelCase de la validación más reference y createdAt.
function buildNotificationEmail(r) {
  const clean = {};
  for (const key of Object.keys(r)) clean[key] = typeof r[key] === 'string' ? r[key] : '';
  const alerts = (Array.isArray(r.alerts) ? r.alerts : []).filter((a) => typeof a === 'string' && a.trim());
  const receivedAt = formatReceivedAt(clean.createdAt);
  const blocks = sections(clean);

  const htmlSections = blocks
    .map((section) => {
      const rows = section.lines
        .map((line) => {
          const empty = line.value.trim() === '';
          const safe = escapeHtml(line.value).replace(/\n/g, '<br>');
          let content = '<span style="color:#8A948E;">No indicado</span>';
          if (!empty) {
            if (line.kind === 'phone') {
              content =
                '<a href="tel:' +
                escapeHtml(line.value.replace(/[^+\d]/g, '')) +
                '" style="color:' + GREEN_DARK + ';text-decoration:none;font-weight:600;">' +
                safe +
                '</a>';
            } else if (line.kind === 'email') {
              content =
                '<a href="mailto:' + escapeHtml(line.value) + '" style="color:' + GREEN_DARK + ';">' + safe + '</a>';
            } else {
              content = safe;
            }
          }
          return (
            '<tr>' +
            '<td style="padding:8px 12px;border-bottom:1px solid #E3E8E4;color:#5B675F;width:38%;vertical-align:top;">' +
            escapeHtml(line.label) +
            '</td>' +
            '<td style="padding:8px 12px;border-bottom:1px solid #E3E8E4;color:#14201A;vertical-align:top;">' +
            content +
            '</td></tr>'
          );
        })
        .join('');
      return (
        '<h2 style="margin:24px 0 8px;font-size:16px;color:' + GREEN_DARK + ';">' +
        escapeHtml(section.title) +
        '</h2>' +
        '<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border:1px solid #E3E8E4;border-radius:8px;border-collapse:separate;font-size:14px;">' +
        rows +
        '</table>'
      );
    })
    .join('');

  const alertsHtml = alerts.length
    ? '<div style="margin:16px 0 0;padding:12px 14px;background:#FFF4E5;border:1px solid #F0C27B;border-radius:8px;font-size:13px;color:#7A4B00;">' +
      '<strong>Revisar antes de pagar:</strong>' +
      '<ul style="margin:6px 0 0 18px;padding:0;">' +
      alerts.map((a) => '<li style="margin:2px 0;">' + escapeHtml(a) + '</li>').join('') +
      '</ul></div>'
    : '';

  const html =
    '<!doctype html>\n<html lang="es"><body style="margin:0;padding:24px;background:#F4F6F4;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">' +
    '<div style="background:' + GREEN + ';padding:20px 24px;color:#ffffff;">' +
    '<div style="font-size:13px;opacity:.9;">Programa de referidos OfiRent</div>' +
    '<div style="font-size:20px;font-weight:700;margin-top:4px;">Nueva recomendación recibida</div>' +
    '</div>' +
    '<div style="padding:20px 24px;">' +
    '<p style="margin:0 0 4px;font-size:14px;color:#5B675F;">Folio: <strong style="color:#14201A;">' +
    escapeHtml(clean.reference) +
    '</strong></p>' +
    '<p style="margin:0;font-size:14px;color:#5B675F;">Recibida: <strong style="color:#14201A;">' +
    escapeHtml(receivedAt) +
    '</strong></p>' +
    alertsHtml +
    htmlSections +
    '<p style="margin:24px 0 0;font-size:13px;color:#5B675F;">' +
    'Autorización: quien recomienda confirmó que cuenta con autorización para compartir los datos de contacto de la persona recomendada.' +
    '</p>' +
    '<p style="margin:12px 0 0;font-size:12px;color:#8A948E;">' +
    'Estado inicial: Nuevo. Mensaje generado automáticamente por el formulario del programa de referidos.' +
    '</p>' +
    '</div></div></body></html>';

  const text = [
    'NUEVA RECOMENDACIÓN · CAMPAÑA OFIRENT',
    '',
    'Folio: ' + clean.reference,
    'Recibida: ' + receivedAt,
  ]
    .concat(alerts.length ? ['', 'REVISAR ANTES DE PAGAR:'].concat(alerts.map((a) => '- ' + a)) : [])
    .concat(
      blocks.reduce((acc, section) => {
        acc.push('', section.title.toUpperCase());
        for (const line of section.lines) {
          const value = line.value.trim() === '' ? 'No indicado' : line.value.replace(/\n/g, '\n    ');
          acc.push('- ' + line.label + ': ' + value);
        }
        return acc;
      }, []),
    )
    .concat([
      '',
      'Autorización: quien recomienda confirmó que cuenta con autorización para compartir los datos de contacto de la persona recomendada.',
      'Estado inicial: Nuevo.',
    ])
    .join('\n');

  return { subject: NOTIFICATION_SUBJECT, html, text };
}

module.exports = { NOTIFICATION_SUBJECT, escapeHtml, formatReceivedAt, buildNotificationEmail };
