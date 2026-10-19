const NOTIFICATION_SUBJECT = 'Nueva recomendación · Campaña OfiRent';
const REFERRED_NOTICE_SUBJECT = 'Te recomendaron con OfiRent';

const SITE = 'https://www.ofirent.com.mx';
const WHATSAPP = '525532009907';
const PHONE_TEXT = '55 3200 9907';
const CONTACT_EMAIL = 'contacto@ofirent.com.mx';
const PRIVACY_URL = SITE + '/aviso-de-privacidad/';
const PROGRAM_URL = SITE + '/programa-de-referidos/?utm_source=correo&utm_medium=aviso-referido&utm_campaign=referidos';

const SPACE_LABELS = {
  fisica: 'Oficina física',
  virtual: 'Oficina virtual',
  coworking: 'Espacio de coworking',
  oficina: 'Oficina física', // valor de la primera versión del formulario
};
// Cómo se nombra lo que busca la persona dentro de una frase ("ayudarte con ...").
const SPACE_PHRASE = {
  fisica: 'una oficina física',
  virtual: 'una oficina virtual',
  coworking: 'un espacio de coworking',
  oficina: 'una oficina física',
};

const GREEN = '#1C8449';
const GREEN_DARK = '#0E5C33';
// Public Sans (la fuente de la marca) llega a Apple Mail y iPhone; Gmail y Outlook usan la primera fuente
// del sistema disponible (Segoe UI en Windows, la del sistema en Mac y Android) en lugar de Arial.
// Sin comillas en los nombres para poder usarla dentro de atributos style="...".
const FONT = 'Public Sans,Segoe UI,-apple-system,BlinkMacSystemFont,Roboto,Helvetica Neue,Arial,sans-serif';
const FONT_FACE_CSS =
  '@font-face{font-family:"Public Sans";src:url(' + SITE + '/assets/public.woff2) format("woff2");font-weight:100 900;font-style:normal;}';

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

// Un nombre sale en un mensaje enviado desde el dominio de OfiRent: sin enlaces, sin
// correos y con largo acotado, para que el formulario no sirva para mandar publicidad ajena.
const NAME_MAX = 60;
function safeName(value, fallback) {
  const text = String(value || '')
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/gi, ' ')
    .replace(/[<>"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return text.length >= 2 ? text : fallback;
}

// ---------------------------------------------------------------- aviso interno a OfiRent

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

// Qué debe hacer el equipo ahora. Con correo del referido el sistema ya le escribió;
// con solo teléfono, el primer contacto (y el aviso de privacidad) es manual.
// `noticeSent`: el aviso automático al referido ya salió o va a salir con este mismo registro.
function nextSteps(r, noticeSent, optedOut) {
  const referred = safeName(r.referredName, 'la persona recomendada');
  const referrer = safeName(r.referrerName, 'quien la recomendó');
  if (optedOut) {
    return {
      title: 'Qué hacer ahora: esta persona pidió no ser contactada',
      steps: [
        referred + ' ya había pedido no recibir mensajes de OfiRent. No la contactes ni se le envió el correo de presentación.',
        'Cambia el Estado en Airtable a "No procede".',
      ],
      template: '',
    };
  }
  const phrase = SPACE_PHRASE[r.spaceType] || 'una oficina o un espacio de trabajo';
  const phone = r.referredPhone || '';
  const steps = [];
  if (noticeSent) {
    steps.push('El sistema ya envió un correo de presentación a ' + r.referredEmail + ' (qué es OfiRent, servicios, aviso de privacidad y baja).');
    if (phone) steps.push('Contacta a ' + referred + ' por WhatsApp o llamada al ' + phone + ' dentro de las próximas 24 horas hábiles.');
  } else {
    steps.push('Contacta a ' + referred + (phone ? ' al ' + phone : '') + ' por WhatsApp o llamada dentro de las próximas 24 horas hábiles.');
    steps.push('En tu primer mensaje dile que ' + referrer + ' lo recomendó y comparte el aviso de privacidad: ' + PRIVACY_URL + '. Este primer mensaje es obligatorio.');
  }
  steps.push('Revisa las alertas de arriba (si las hay) antes de contactar.');
  steps.push('Si te dice que no quiere que lo contacten, cambia el Estado en Airtable a "No procede" y no le escribas de nuevo.');
  steps.push('Cuando ya hayas hablado con ' + referred + ', cambia el Estado en Airtable a "Contactado".');
  const template = noticeSent
    ? ''
    : 'Hola ' + referred + ', te escribimos de OfiRent. ' + referrer + ' nos compartió tu contacto porque pensó que podríamos ayudarte con ' + phrase +
      '. ¿Te gustaría que te cuente las opciones? Si prefieres que no te contactemos, avísanos y no volveremos a escribirte. Nuestro aviso de privacidad: ' + PRIVACY_URL;
  return {
    title: noticeSent ? 'Qué hacer ahora' : 'Qué hacer ahora: solo dejó teléfono, el primer contacto es manual',
    steps,
    template,
  };
}

// Construye el correo de notificación interna (HTML con respaldo en texto plano).
// `r` usa las claves camelCase de la validación más reference y createdAt.
// `opts.noticeSent` indica si el aviso automático al referido ya salió (cambia el paso a paso).
function buildNotificationEmail(r, opts) {
  const options = opts || {};
  const clean = {};
  for (const key of Object.keys(r)) clean[key] = typeof r[key] === 'string' ? r[key] : '';
  const alerts = (Array.isArray(r.alerts) ? r.alerts : []).filter((a) => typeof a === 'string' && a.trim());
  const receivedAt = formatReceivedAt(clean.createdAt);
  const blocks = sections(clean);
  const guide = nextSteps(clean, Boolean(options.noticeSent), Boolean(options.optedOut));

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

  const guideHtml =
    '<div style="margin:18px 0 0;padding:14px 16px;background:#EAF5EE;border:1px solid #BFE0CB;border-radius:8px;font-size:14px;color:#14201A;">' +
    '<strong style="color:' + GREEN_DARK + ';">' + escapeHtml(guide.title) + '</strong>' +
    '<ol style="margin:8px 0 0 18px;padding:0;">' +
    guide.steps.map((s) => '<li style="margin:4px 0;">' + escapeHtml(s) + '</li>').join('') +
    '</ol>' +
    (guide.template
      ? '<p style="margin:12px 0 4px;font-size:12px;color:#5B675F;">Mensaje sugerido para WhatsApp (cópialo y pégalo):</p>' +
        '<div style="padding:10px 12px;background:#ffffff;border:1px solid #DCE5DE;border-radius:6px;font-size:13px;color:#14201A;">' +
        escapeHtml(guide.template) +
        '</div>'
      : '') +
    '</div>';

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
    guideHtml +
    htmlSections +
    '<p style="margin:24px 0 0;font-size:13px;color:#5B675F;">' +
    'Autorización: quien recomienda confirmó que cuenta con autorización para compartir los datos de contacto de la persona recomendada.' +
    '</p>' +
    '<p style="margin:12px 0 0;font-size:12px;color:#8A948E;">' +
    'Estado inicial: Nuevo. Mensaje generado automáticamente por el formulario del programa de referidos.' +
    '</p>' +
    '</div></div></body></html>';

  const textGuide = ['', guide.title.toUpperCase()]
    .concat(guide.steps.map((s, i) => (i + 1) + '. ' + s))
    .concat(guide.template ? ['', 'Mensaje sugerido para WhatsApp:', guide.template] : []);

  const text = [
    'NUEVA RECOMENDACIÓN · CAMPAÑA OFIRENT',
    '',
    'Folio: ' + clean.reference,
    'Recibida: ' + receivedAt,
  ]
    .concat(alerts.length ? ['', 'REVISAR ANTES DE PAGAR:'].concat(alerts.map((a) => '- ' + a)) : [])
    .concat(textGuide)
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

// ---------------------------------------------------------------- aviso a la persona recomendada
//
// Primer contacto automático cuando quien recomienda deja el correo de su referido: se le
// avisa quién lo recomendó, se le presenta OfiRent (servicios con precios publicados), se le
// invita al programa de referidos y se le da el aviso de privacidad y una baja de un clic.
// Lo único que escribe otra persona es su nombre, que se limpia antes de entrar al mensaje.

const SERVICES = [
  {
    key: 'fisica',
    title: 'Oficinas equipadas',
    blurb: 'Privados listos para trabajar, con mobiliario, internet, recepción, limpieza y mantenimiento incluidos.',
    price: 'Desde $6,500 al mes',
    image: '/assets/email/servicio-oficina-fisica.jpg',
    alt: 'Oficinas equipadas listas para trabajar: mobiliario, internet y recepción incluidos. Desde $6,500 al mes.',
    path: '/servicios/renta-oficinas-equipadas-cdmx/',
    cta: 'Ver oficinas equipadas',
  },
  {
    key: 'virtual',
    title: 'Oficina virtual y domicilio fiscal',
    blurb: 'Una dirección profesional, recepción de correspondencia y atención de llamadas sin ocupar una oficina todos los días.',
    price: 'Desde $799 al mes',
    image: '/assets/email/servicio-oficina-virtual.jpg',
    alt: 'Domicilio fiscal y comercial en CDMX: recepción de correspondencia y atención de llamadas. Desde $799 al mes.',
    path: '/servicios/renta-oficinas-virtuales-cdmx/',
    cta: 'Ver oficinas virtuales',
  },
  {
    key: 'coworking',
    title: 'Coworking',
    blurb: 'Espacio compartido sin renta fija, con internet, coffee station y horas de sala de juntas, en Roma, Del Valle y Narvarte.',
    price: 'Desde $2,500 al mes',
    image: '/assets/email/servicio-coworking.jpg',
    alt: 'Coworking sin renta fija: internet, coffee station y salas de juntas. Desde $2,500 al mes.',
    path: '/servicios/renta-salas-juntas-y-coworking/',
    cta: 'Ver coworking',
  },
];

// El servicio que dijo buscar va primero; sin dato, el orden de siempre.
function orderedServices(spaceType) {
  const key = spaceType === 'oficina' ? 'fisica' : spaceType;
  const first = SERVICES.find((s) => s.key === key);
  return first ? [first].concat(SERVICES.filter((s) => s !== first)) : SERVICES.slice();
}

function button(href, label, primary) {
  const bg = primary ? GREEN : '#ffffff';
  const color = primary ? '#ffffff' : GREEN_DARK;
  return (
    '<a href="' + escapeHtml(href) + '" target="_blank" style="display:inline-block;background:' + bg + ';color:' + color +
    ';border:2px solid ' + GREEN + ';border-radius:10px;padding:14px 24px;font-family:' + FONT + ';font-size:15px;line-height:1.2;font-weight:700;letter-spacing:.2px;text-decoration:none;margin:0 8px 8px 0;">' +
    escapeHtml(label) + '</a>'
  );
}

// `opts.unsubscribeUrl`: enlace firmado de baja (si no hay, solo se ofrece responder al correo).
function buildReferredNoticeEmail(r, opts) {
  const options = opts || {};
  const referred = safeName(r.referredName, '');
  const referrer = safeName(r.referrerName, 'Una persona');
  const hello = referred ? 'Hola ' + referred + ',' : 'Hola,';
  const services = orderedServices(r.spaceType);
  const wantedKey = r.spaceType === 'oficina' ? 'fisica' : r.spaceType;
  const hasWanted = SERVICES.some((s) => s.key === wantedKey);

  const waText = 'Hola, ' + referrer + ' me recomendó OfiRent y me gustaría recibir información.';
  const waUrl = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(waText);
  const locationsUrl = SITE + '/ubicaciones/';

  const introHtml =
    'Compartió tus datos de contacto con nosotros para que un asesor pueda ayudarte a encontrar el espacio que necesitas. ' +
    'Somos parte del grupo OfiRent: oficinas equipadas, oficinas virtuales y coworking en 6 ubicaciones de la Ciudad de México.';
  const intro = referrer + ' te recomendó con OfiRent. ' + introHtml;
  const nextLine = 'No tienes que hacer nada: un asesor se pondrá en contacto contigo. Si prefieres adelantarte, escríbenos o llámanos al ' + PHONE_TEXT + '.';
  const invite =
    '¿Conoces a alguien más que necesite una oficina? Recomienda OfiRent y gana el equivalente a una mensualidad de renta de tu referido, hasta $5,000 MXN.';
  const inviteFine =
    'Vigencia del 14 de octubre de 2026 al 14 de enero de 2027. El bono se paga hasta por 4 recomendaciones cerradas por persona. Aplican términos y condiciones.';
  const dataLine =
    'Qué datos recibimos: tu nombre, tu teléfono o correo y, si lo indicó, el tipo de espacio y la zona que podrían interesarte. ' +
    'Los usamos solo para contactarte por esta recomendación y, si te interesa, atender tu solicitud.';
  const optOutLine = options.unsubscribeUrl
    ? 'Si no quieres que te contactemos, usa este enlace y no volveremos a escribirte: '
    : 'Si no quieres que te contactemos, responde a este correo y no volveremos a escribirte.';
  const footer = 'OfiRent · Álvaro Obregón 270, Colonia Condesa, Ciudad de México · ' + PHONE_TEXT + ' · ' + CONTACT_EMAIL;

  const serviceHtml = services
    .map((s, i) => {
      const badge =
        hasWanted && i === 0
          ? '<div style="font-size:11px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:' + GREEN + ';margin:0 0 6px;">Lo que buscas</div>'
          : '';
      // El flyer ya trae el título y el precio; abajo va solo la descripción y el enlace.
      return (
        '<tr><td style="padding:0 0 22px;">' + badge +
        '<a href="' + SITE + s.path + '" target="_blank" style="display:block;text-decoration:none;">' +
        '<img src="' + SITE + s.image + '" width="556" alt="' + escapeHtml(s.alt) + '" style="display:block;width:100%;max-width:556px;height:auto;border-radius:12px;border:0;">' +
        '</a>' +
        '<div style="padding-top:10px;">' +
        '<div style="font-size:14px;line-height:1.55;color:#5B675F;margin:0 0 6px;">' + escapeHtml(s.blurb) + '</div>' +
        '<a href="' + SITE + s.path + '" target="_blank" style="font-size:14px;font-weight:bold;color:' + GREEN + ';">' + escapeHtml(s.cta) + ' →</a>' +
        '</div></td></tr>'
      );
    })
    .join('');

  const html =
    '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + FONT_FACE_CSS + '</style></head>' +
    '<body style="margin:0;padding:0;background:#F4F6F4;font-family:' + FONT + ';-webkit-font-smoothing:antialiased;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + escapeHtml(referrer + ' te recomendó con OfiRent. Conoce nuestros servicios.') + '</div>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F4F6F4;"><tr><td align="center" style="padding:20px 10px;">' +
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">' +
    '<tr><td style="padding:22px 22px 0;border-top:6px solid ' + GREEN + ';">' +
    '<img src="' + SITE + '/assets/logo.png" width="150" alt="OfiRent" style="display:block;width:150px;height:auto;border:0;">' +
    '</td></tr>' +
    '<tr><td style="padding:22px 22px 6px;font-family:' + FONT + ';">' +
    '<div style="font-size:12px;line-height:1;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:' + GREEN + ';margin:0 0 12px;">Una recomendación para ti</div>' +
    '<div style="font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-.4px;color:#14201A;"><span style="color:' + GREEN_DARK + ';">' + escapeHtml(referrer) + '</span> te recomendó con OfiRent</div>' +
    '<p style="font-size:17px;line-height:1.5;font-weight:600;color:#14201A;margin:20px 0 8px;">' + escapeHtml(hello) + '</p>' +
    '<p style="font-size:16px;line-height:1.7;color:#33413A;margin:0 0 22px;">' + escapeHtml(introHtml) + '</p>' +
    button(waUrl, 'Escríbenos por WhatsApp', true) +
    button(locationsUrl, 'Ver ubicaciones', false) +
    '<p style="font-size:13.5px;line-height:1.6;color:#66736B;margin:8px 0 24px;">' + escapeHtml(nextLine) + '</p>' +
    '</td></tr>' +
    '<tr><td style="font-family:' + FONT + ';padding:0 22px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + serviceHtml + '</table></td></tr>' +
    '<tr><td style="font-family:' + FONT + ';padding:0 22px 22px;">' +
    '<a href="' + escapeHtml(PROGRAM_URL) + '" target="_blank" style="display:block;text-decoration:none;">' +
    '<img src="' + SITE + '/assets/email/programa-referidos.jpg" width="556" alt="' + escapeHtml(invite + ' ' + inviteFine) + '" style="display:block;width:100%;max-width:556px;height:auto;border-radius:12px;border:0;">' +
    '</a>' +
    '<div style="padding-top:10px;">' + button(PROGRAM_URL, 'Conocer el programa', false) + '</div>' +
    '</td></tr>' +
    '<tr><td style="font-family:' + FONT + ';padding:0 22px 22px;border-top:1px solid #E3E8E4;">' +
    '<p style="font-size:12px;line-height:1.6;color:#5B675F;margin:16px 0 8px;">' + escapeHtml(dataLine) + ' ' +
    'Aviso de privacidad completo: <a href="' + PRIVACY_URL + '" target="_blank" style="color:' + GREEN_DARK + ';">' + PRIVACY_URL + '</a></p>' +
    '<p style="font-size:12px;line-height:1.6;color:#5B675F;margin:0 0 8px;">' + escapeHtml(optOutLine) +
    (options.unsubscribeUrl
      ? '<a href="' + escapeHtml(options.unsubscribeUrl) + '" target="_blank" style="color:' + GREEN_DARK + ';">No quiero recibir más mensajes</a>'
      : '') +
    '</p>' +
    '<p style="font-size:11px;color:#8A948E;margin:0;">' + escapeHtml(footer) + '</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  const textLines = [hello, '', intro, '', 'Escríbenos por WhatsApp: ' + waUrl, 'Ver ubicaciones: ' + locationsUrl, '', nextLine, ''];
  for (const s of services) {
    textLines.push((hasWanted && s === services[0] ? 'LO QUE BUSCAS: ' : '') + s.title.toUpperCase(), s.blurb, s.price, s.cta + ': ' + SITE + s.path, '');
  }
  textLines.push('PROGRAMA DE REFERIDOS', invite, 'Conocer el programa: ' + PROGRAM_URL, inviteFine, '');
  textLines.push(dataLine, 'Aviso de privacidad completo: ' + PRIVACY_URL, '');
  textLines.push(optOutLine + (options.unsubscribeUrl ? ' ' + options.unsubscribeUrl : ''), '', footer);

  return { subject: REFERRED_NOTICE_SUBJECT, html, text: textLines.join('\n') };
}

module.exports = {
  NOTIFICATION_SUBJECT,
  REFERRED_NOTICE_SUBJECT,
  SPACE_LABELS,
  escapeHtml,
  formatReceivedAt,
  nextSteps,
  buildNotificationEmail,
  buildReferredNoticeEmail,
};
