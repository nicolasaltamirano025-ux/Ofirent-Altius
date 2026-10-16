// Notificación por correo (Resend, API REST, sin SDK).
// Dos correos por recomendación:
//  1. Aviso interno a OfiRent: el destinatario sale SIEMPRE de NOTIFY_TO en el servidor, nunca
//     del formulario. Cuando el primer contacto con el referido es manual (solo dejaron su
//     teléfono, o el aviso automático no aplica) va además con copia a NOTIFY_CC, con el paso
//     a paso para contactarlo.
//  2. Aviso de primer contacto a la persona recomendada, solo si quien recomienda dejó su
//     correo: presenta OfiRent, invita al programa de referidos y trae enlace de baja.
// Los logs llevan solo folio y tipo de error, nunca datos de las personas.
//
// El resultado queda en un solo campo de Airtable, "Aviso por correo":
//   Pendiente | Enviado | Fallido: <motivo> | Enviado. Falta el aviso al referido: <motivo>
// Todo lo que no sea "Enviado" se reintenta cada dia durante 7 dias. En el ultimo estado el
// aviso interno ya salio y el reintento solo envia el aviso al referido.

const airtable = require('./airtable');
const { isValidEmail } = require('./validation');
const { buildNotificationEmail, buildReferredNoticeEmail } = require('./email-template');
const { unsubscribeUrl } = require('./unsubscribe');

const DEFAULT_NOTIFY_TO = 'contacto@ofirent.com.mx';
const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10000;
const NOT_CONFIGURED = 'Pendiente: correo no configurado (faltan RESEND_API_KEY o EMAIL_FROM).';
const SENT = 'Enviado';
const NOTICE_PENDING = 'Enviado. Falta el aviso al referido';
const MAX_CC = 5;

function notifyRecipient() {
  const configured = (process.env.NOTIFY_TO || '').trim();
  return configured && isValidEmail(configured.toLowerCase()) ? configured : DEFAULT_NOTIFY_TO;
}

// Copias del aviso interno cuando el primer contacto es manual. Solo direcciones válidas,
// sin repetir y sin duplicar al destinatario principal.
function notifyCc() {
  const main = notifyRecipient().toLowerCase();
  const out = [];
  for (const raw of String(process.env.NOTIFY_CC || '').split(/[,;]/)) {
    const email = raw.trim().toLowerCase();
    if (email && isValidEmail(email) && email !== main && !out.includes(email)) out.push(email);
  }
  return out.slice(0, MAX_CC);
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

// Qué hace el sistema con este registro (se decide solo con lo que quedó guardado, así el
// reintento llega a la misma conclusión que el primer envío).
function plan(referral) {
  const alerts = referral.alerts || [];
  const hasEmail = Boolean(referral.referredEmail) && isValidEmail(referral.referredEmail);
  const duplicate = alerts.some((a) => /^Posible duplicado/.test(a));
  const optedOut = alerts.some((a) => /^Baja:/.test(a));
  // El aviso automático solo sale con correo válido, sin duplicado y sin baja previa.
  const autoNotice = hasEmail && !duplicate && !optedOut;
  return { hasEmail, duplicate, optedOut, autoNotice, manualFirstContact: !autoNotice };
}

// Aviso interno a OfiRent.
async function sendEmail(mail, referral, decision) {
  const message = buildNotificationEmail(referral, { noticeSent: decision.autoNotice, optedOut: decision.optedOut });
  const payload = { to: [notifyRecipient()], subject: message.subject, html: message.html, text: message.text };
  // Si el primer contacto es manual, quien debe hacerlo recibe copia.
  const cc = decision.manualFirstContact ? notifyCc() : [];
  if (cc.length) payload.cc = cc;
  // Reply-To solo si el correo de quien recomienda es válido.
  if (referral.referrerEmail && isValidEmail(referral.referrerEmail)) payload.reply_to = referral.referrerEmail;
  await postEmail(mail, payload);
}

// Aviso de primer contacto a la persona recomendada. Las respuestas llegan a OfiRent.
async function sendReferredNotice(mail, referral) {
  const link = unsubscribeUrl(referral.id);
  const message = buildReferredNoticeEmail(referral, { unsubscribeUrl: link });
  const payload = {
    to: [referral.referredEmail],
    reply_to: notifyRecipient(),
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (link) {
    payload.headers = {
      'List-Unsubscribe': '<' + link + '>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  await postEmail(mail, payload);
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
  const decision = plan(referral);

  if (!mail) {
    await airtable.updateRecord(cfg, record.id, { [F.mail]: NOT_CONFIGURED }).catch(() => undefined);
    console.warn('[referidos] correo no configurado; queda pendiente ' + referral.reference);
    return 'pending';
  }

  if (!internalDone) {
    try {
      await sendEmail(mail, referral, decision);
    } catch (error) {
      console.error('[referidos] notificacion fallida ' + referral.reference + ' ' + logKind(error));
      await airtable.updateRecord(cfg, record.id, { [F.mail]: 'Fallido: ' + reasonOf(error) }).catch(() => undefined);
      return 'failed';
    }
  }

  if (decision.autoNotice) {
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

module.exports = { DEFAULT_NOTIFY_TO, notifyRecipient, notifyCc, emailConfig, notifyRecord };
