// Función serverless (Vercel). Guarda leads temporales del sitio web en Airtable
// mientras se resuelve el problema del formulario de Kommo (ver historial del proyecto).
// Reusa las mismas variables de entorno / tabla que review.js.
// Acepta peticiones cross-origin desde los sitios de OfiRent y Torre Altius.

const ALLOWED_ORIGINS = [
  'https://ofirent.com.mx',
  'https://www.ofirent.com.mx',
  'https://ofirent-cdmx-site.vercel.app',
  'https://torrealtius.com',
  'https://www.torrealtius.com',
  'https://torre-altius-site.vercel.app'
];

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Reseñas';

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    res.status(500).json({ error: 'Airtable no está configurado todavía en Vercel.' });
    return;
  }

  const { name, company, phone, email, location, teamSize, serviceType, comments, source } = req.body || {};

  if (!name || !phone) {
    res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
    return;
  }

  const commentParts = [
    '[LEAD SITIO WEB - formulario temporal, Kommo caído]',
    source ? `Sitio: ${source}` : '',
    company ? `Empresa: ${company}` : '',
    email ? `Correo: ${email}` : '',
    serviceType ? `Servicio de interés: ${serviceType}` : '',
    teamSize ? `Tamaño de equipo: ${teamSize}` : '',
    comments ? `Comentarios: ${comments}` : ''
  ].filter(Boolean).join(' | ');

  const fields = {
    Nombre: name || '',
    Teléfono: phone || '',
    Comentario: commentParts
  };
  if (location) fields['Ubicación'] = location;

  try {
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      }
    );

    if (!airtableRes.ok) {
      const detail = await airtableRes.text();
      res.status(502).json({ error: 'Airtable rechazó la solicitud', detail });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error de servidor', detail: String(err) });
  }
};
