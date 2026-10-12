// Notificación por correo (Resend, API REST, sin SDK).
// El destinatario sale SIEMPRE de NOTIFY_TO en el servidor, nunca del formulario.
// Los logs llevan solo folio y tipo de error, nunca datos de las personas.
//
// El resultado queda en un solo campo de Airtable, "Aviso por correo":
//   Pendiente | Enviado | Fallido: <motivo>
// Todo lo que no sea "Enviado" se reintenta cada dia durante 7 dias.

const airtable = require('./airtable');
const { isValidEmail } = require('./validation');
const { buildNotificationEmail } = require('./email-template');

const DEFAULT_NOTIFY_TO = 'contacto@ofirent.com.mx';
const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10000;
const NOT_CONFIGURED = 'Pendiente: correo no configurado (faltan RESEND_API_KEY o EMAIL_FROM).';

function notifyRecipient() {
  const configured = (process.env.NOTIFY_TO || '').trim();
  return configured && isValidEmail(configured.toLowerCase()) ? configured : DEFAULT_NOTIFY_TO;
}

function emailConfig() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.EMAIL_FROM || '').trim();
  return apiKey && from ? { apiKey, from } : null;
}

async function sendEmail(mail, referral) {
  const message = buildNotificationEmail(referral);
  const body = {
    from: mail.from,
    to: [notifyRecipient()],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  // Reply-To solo si el correo de quien recomienda es válido.
  if (referral.referrerEmail && isValidEmail(referral.referrerEmail)) body.reply_to = referral.referrerEmail;

  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + mail.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

function logKind(error) {
  if (error && error.name === 'ResendError') return 'resend_http_' + error.status;
  return error && error.name ? error.name : 'unknown';
}

// Envía la notificación de UN registro y deja el resultado en Airtable. Nunca lanza.
// Devuelve 'sent' | 'failed' | 'pending'.
async function notifyRecord(cfg, record) {
  const referral = airtable.toReferral(record);
  const F = airtable.F;
  const mail = emailConfig();

  if (!mail) {
    await airtable.updateRecord(cfg, record.id, { [F.mail]: NOT_CONFIGURED }).catch(() => undefined);
    console.warn('[referidos] correo no configurado; queda pendiente ' + referral.reference);
    return 'pending';
  }

  try {
    await sendEmail(mail, referral);
  } catch (error) {
    console.error('[referidos] notificacion fallida ' + referral.reference + ' ' + logKind(error));
    const reason = error && error.message ? String(error.message).slice(0, 250) : 'error desconocido';
    await airtable.updateRecord(cfg, record.id, { [F.mail]: 'Fallido: ' + reason }).catch(() => undefined);
    return 'failed';
  }

  try {
    await airtable.updateRecord(cfg, record.id, { [F.mail]: 'Enviado' });
  } catch (error) {
    // El correo ya salió; si no se pudo marcar, el reintento podría duplicarlo.
    console.error('[referidos] correo enviado pero sin marcar ' + referral.reference + ' ' + logKind(error));
  }
  return 'sent';
}

module.exports = { DEFAULT_NOTIFY_TO, notifyRecipient, emailConfig, notifyRecord };
