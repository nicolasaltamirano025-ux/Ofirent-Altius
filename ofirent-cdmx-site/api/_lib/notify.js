// Notificación por correo (Resend, API REST, sin SDK).
// El destinatario del aviso interno sale SIEMPRE de NOTIFY_TO en el servidor, nunca del
// formulario. El único otro correo que sale es el aviso de primer contacto a la persona
// recomendada (texto fijo, solo si quien recomienda dejó su correo; ver email-template.js).
// Los logs llevan solo folio y tipo de error, nunca datos de las personas.
//
// El resultado queda en un solo campo de Airtable, "Aviso por correo":
//   Pendiente | Enviado | Fallido: <motivo> | Enviado. Falta el aviso al referido: <motivo>
// Todo lo que no sea "Enviado" se reintenta cada dia durante 7 dias. En el ultimo estado el
// aviso interno ya salio y el reintento solo envia el aviso al referido.

const airtable = require('./airtable');
const { isValidEmail } = require('./validation');
const { buildNotificationEmail, buildReferredNoticeEmail } = require('./email-template');

const DEFAULT_NOTIFY_TO = 'contacto@ofirent.com.mx';
const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10000;
const NOT_CONFIGURED = 'Pendiente: correo no configurado (faltan RESEND_API_KEY o EMAIL_FROM).';
const SENT = 'Enviado';
const NOTICE_PENDING = 'Enviado. Falta el aviso al referido';

function notifyRecipient() {
  const configured = (process.env.NOTIFY_TO || '').trim();
  return configured && isValidEmail(configured.toLowerCase()) ? configured : DEFAULT_NOTIFY_TO;
}

function emailConfig() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.EMAIL_FROM || '').trim();
  return apiKey && from ? { apiKey, from } : null;
}

async function postEmail(mail, payload) {
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + mail.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ from: mail.from }, payload)),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 200);
    } catch {
      detail = '';
    }
    const error = new Error('Resend respondió HTTP ' + response.status + (detail ? ': ' + detail : ''));
    error.name = 'ResendError';
    error.status = response.status;
    throw error;
  }
}

// Aviso interno a OfiRent.
async function sendEmail(mail, referral) {
  const message = buildNotificationEmail(referral);
  const payload = { to: [notifyRecipient()], subject: message.subject, html: message.html, text: message.text };
  // Reply-To solo si el correo de quien recomienda es válido.
  if (referral.referrerEmail && isValidEmail(referral.referrerEmail)) payload.reply_to = referral.referrerEmail;
  await postEmail(mail, payload);
}

// Aviso de primer contacto a la persona recomendada. Las respuestas llegan a OfiRent.
async function sendReferredNotice(mail, referral) {
  const message = buildReferredNoticeEmail(referral);
  await postEmail(mail, {
    to: [referral.referredEmail],
    reply_to: notifyRecipient(),
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
}

// Solo si hay un correo válido, y no cuando el referido ya estaba registrado por otra persona
// (a esa persona ya se le avisó cuando se registró por primera vez).
function needsReferredNotice(referral) {
  if (!referral.referredEmail || !isValidEmail(referral.referredEmail)) return false;
  return !referral.alerts.some((a) => /^Posible duplicado/.test(a));
}

function logKind(error) {
  if (error && error.name === 'ResendError') return 'resend_http_' + error.status;
  return error && error.name ? error.name : 'unknown';
}

function reasonOf(error) {
  return error && error.message ? String(error.message).slice(0, 250) : 'error desconocido';
}

// Envía los avisos de UN registro y deja el resultado en Airtable. Nunca lanza.
// Devuelve 'sent' | 'failed' | 'pending'.
async function notifyRecord(cfg, record) {
  const referral = airtable.toReferral(record);
  const F = airtable.F;
  const mail = emailConfig();
  const current = String((record.fields || {})[F.mail] || '');
  const internalDone = current === SENT || current.startsWith(NOTICE_PENDING);

  if (!mail) {
    await airtable.updateRecord(cfg, record.id, { [F.mail]: NOT_CONFIGURED }).catch(() => undefined);
    console.warn('[referidos] correo no configurado; queda pendiente ' + referral.reference);
    return 'pending';
  }

  if (!internalDone) {
    try {
      await sendEmail(mail, referral);
    } catch (error) {
      console.error('[referidos] notificacion fallida ' + referral.reference + ' ' + logKind(error));
      await airtable.updateRecord(cfg, record.id, { [F.mail]: 'Fallido: ' + reasonOf(error) }).catch(() => undefined);
      return 'failed';
    }
  }

  if (needsReferredNotice(referral)) {
    try {
      await sendReferredNotice(mail, referral);
    } catch (error) {
      console.error('[referidos] aviso al referido fallido ' + referral.reference + ' ' + logKind(error));
      await airtable
        .updateRecord(cfg, record.id, { [F.mail]: NOTICE_PENDING + ': ' + reasonOf(error) })
        .catch(() => undefined);
      return 'failed';
    }
  }

  try {
    await airtable.updateRecord(cfg, record.id, { [F.mail]: SENT });
  } catch (error) {
    // Los correos ya salieron; si no se pudo marcar, el reintento podría duplicarlos.
    console.error('[referidos] correo enviado pero sin marcar ' + referral.reference + ' ' + logKind(error));
  }
  return 'sent';
}

module.exports = { DEFAULT_NOTIFY_TO, notifyRecipient, emailConfig, notifyRecord };
