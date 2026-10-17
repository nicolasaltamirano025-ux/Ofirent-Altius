/*
 * Validación del formulario del Programa de referidos.
 * Un solo archivo para dos entornos: el navegador (window.OfiRentReferidos) y la
 * función serverless api/referidos.js (require). Las reglas son las mismas en
 * ambos lados; el servidor es quien decide qué se guarda.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfiRentReferidos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SPACE_TYPES = ['fisica', 'virtual', 'coworking'];
  // Valores de la primera version del formulario (una pagina abierta o guardada en cache puede
  // seguir mandandolos): 'oficina' es oficina fisica; 'bodega' y 'otro' ya no existen y se
  // ignoran en lugar de rechazar el envio.
  var LEGACY_SPACE_TYPES = { oficina: 'fisica', bodega: '', otro: '' };

  var LIMITS = { name: 120, company: 120, email: 254, zone: 120, comments: 1000 };

  // Reglas del programa que comparten la página (texto visible) y el servidor (las aplica).
  // Cada persona (teléfono de quien recomienda) puede recomendar a cuantas personas quiera;
  // el bono se paga hasta por este número de recomendaciones cerradas. Para cambiarlo basta
  // editar esta cifra.
  var PROGRAM = {
    maxBonusesPerPerson: 4,
    maxBonus: 5000, // tope por referido, en MXN
    clientCreditExtraPct: 20, // clientes actuales que eligen crédito en su renta
    ambassadorAfter: 2, // recomendaciones cerradas para ser Embajador
  };

  var MESSAGES = {
    referrerName: 'Escribe tu nombre completo.',
    referrerPhone: 'Escribe tu teléfono de contacto a 10 dígitos (por ejemplo, 55 1234 5678).',
    email: 'Escribe un correo válido, por ejemplo nombre@empresa.com.',
    referredName: 'Escribe el nombre completo de la persona que recomiendas.',
    referredPhone:
      'Escribe el teléfono de la persona que recomiendas a 10 dígitos (por ejemplo, 55 1234 5678).',
    selfReferral: 'El teléfono de la persona que recomiendas no puede ser el tuyo.',
    selfReferralEmail: 'El correo de la persona que recomiendas no puede ser el tuyo.',
    contactRequired: 'Escribe el teléfono o el correo de la persona que recomiendas (con uno basta).',
    spaceType: 'Selecciona una opción válida.',
    consent: 'Confirma que cuentas con la autorización de la persona recomendada para compartir sus datos.',
    tooLong: function (max) {
      return 'Escribe máximo ' + max + ' caracteres.';
    },
  };

  // Orden en que aparecen los campos (para enfocar el primer error).
  var FIELD_ORDER = [
    'referrerName',
    'referrerCompany',
    'referrerPhone',
    'referrerEmail',
    'referredName',
    'referredPhone',
    'referredEmail',
    'spaceType',
    'zone',
    'comments',
    'consent',
  ];

  // Caracteres de control (salvo salto de línea y tabulador en comentarios).
  // eslint-disable-next-line no-control-regex
  var CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

  function asString(value) {
    return typeof value === 'string' ? value : '';
  }

  // Texto de una sola línea: sin controles, espacios colapsados, recortado.
  function cleanLine(value) {
    return asString(value).replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  }

  // Texto multilínea (comentarios): conserva saltos de línea.
  function cleanMultiline(value) {
    return asString(value)
      .replace(CONTROL_CHARS, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  var EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

  function isValidEmail(value) {
    return value.length <= LIMITS.email && value.indexOf('..') === -1 && EMAIL_RE.test(value);
  }

  /*
   * Normaliza un teléfono. Devuelve:
   *  - 10 dígitos para números de México (acepta +52, 52 y 521 al inicio);
   *  - "+<dígitos>" para números internacionales escritos con "+" (8 a 15 dígitos);
   *  - null si no es un teléfono válido.
   */
  function normalizePhone(raw) {
    var text = asString(raw).trim();
    if (!/^[+\d\s().-]+$/.test(text)) return null;
    var digits = text.replace(/\D/g, '');
    if (!digits) return null;

    if (text.charAt(0) === '+') {
      if (digits.indexOf('52') === 0) {
        var national = digits.indexOf('521') === 0 && digits.length === 13 ? digits.slice(3) : digits.slice(2);
        if (national.length === 10) return national;
      }
      return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
    }
    if (digits.length === 10) return digits;
    if (digits.length === 12 && digits.indexOf('52') === 0) return digits.slice(2);
    if (digits.length === 13 && digits.indexOf('521') === 0) return digits.slice(3);
    return null;
  }

  // Valida y normaliza. `raw` es cualquier cosa que llegue del cliente.
  function validateReferral(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var errors = {};

    var value = {
      referrerName: cleanLine(src.referrerName),
      referrerCompany: cleanLine(src.referrerCompany),
      referrerPhone: cleanLine(src.referrerPhone),
      referrerEmail: cleanLine(src.referrerEmail).toLowerCase(),
      referredName: cleanLine(src.referredName),
      referredPhone: cleanLine(src.referredPhone),
      referredEmail: cleanLine(src.referredEmail).toLowerCase(),
      spaceType: '',
      zone: cleanLine(src.zone),
      comments: cleanMultiline(src.comments),
      consent: src.consent === true,
    };

    var spaceType = cleanLine(src.spaceType);
    if (spaceType) {
      if (Object.prototype.hasOwnProperty.call(LEGACY_SPACE_TYPES, spaceType)) value.spaceType = LEGACY_SPACE_TYPES[spaceType];
      else if (SPACE_TYPES.indexOf(spaceType) !== -1) value.spaceType = spaceType;
      else errors.spaceType = MESSAGES.spaceType;
    }

    // Quien recomienda
    if (value.referrerName.length < 2) errors.referrerName = MESSAGES.referrerName;
    else if (value.referrerName.length > LIMITS.name) errors.referrerName = MESSAGES.tooLong(LIMITS.name);

    if (value.referrerCompany.length > LIMITS.company) errors.referrerCompany = MESSAGES.tooLong(LIMITS.company);

    var referrerPhone = normalizePhone(value.referrerPhone);
    if (!referrerPhone) errors.referrerPhone = MESSAGES.referrerPhone;
    else value.referrerPhone = referrerPhone;

    if (value.referrerEmail && !isValidEmail(value.referrerEmail)) errors.referrerEmail = MESSAGES.email;

    // Persona recomendada
    if (value.referredName.length < 2) errors.referredName = MESSAGES.referredName;
    else if (value.referredName.length > LIMITS.name) errors.referredName = MESSAGES.tooLong(LIMITS.name);

    // Con teléfono o con correo basta: hace falta al menos uno para poder contactar a la persona.
    if (value.referredPhone) {
      var referredPhone = normalizePhone(value.referredPhone);
      if (!referredPhone) errors.referredPhone = MESSAGES.referredPhone;
      else if (referrerPhone && referredPhone === referrerPhone) errors.referredPhone = MESSAGES.selfReferral;
      else value.referredPhone = referredPhone;
    }

    if (value.referredEmail) {
      if (!isValidEmail(value.referredEmail)) errors.referredEmail = MESSAGES.email;
      else if (value.referrerEmail && value.referrerEmail === value.referredEmail) errors.referredEmail = MESSAGES.selfReferralEmail;
    }

    if (!value.referredPhone && !value.referredEmail) errors.referredPhone = MESSAGES.contactRequired;

    if (value.zone.length > LIMITS.zone) errors.zone = MESSAGES.tooLong(LIMITS.zone);
    if (value.comments.length > LIMITS.comments) errors.comments = MESSAGES.tooLong(LIMITS.comments);

    if (!value.consent) errors.consent = MESSAGES.consent;

    return Object.keys(errors).length > 0 ? { ok: false, errors: errors } : { ok: true, value: value };
  }

  return {
    SPACE_TYPES: SPACE_TYPES,
    LIMITS: LIMITS,
    PROGRAM: PROGRAM,
    MESSAGES: MESSAGES,
    FIELD_ORDER: FIELD_ORDER,
    isValidEmail: isValidEmail,
    normalizePhone: normalizePhone,
    validateReferral: validateReferral,
  };
});
