// Función serverless (Vercel). Guarda leads temporales del sitio web en Airtable
// mientras se resuelve el problema del formulario de Kommo (ver historial del proyecto).
// Escribe en la tabla "Leads" (separada de "Reseñas"), misma base y token que review.js.
// Acepta peticiones cross-origin desde los sitios de OfiRent y Torre Altius.

const LEADS_TABLE_ID = 'tbl6E6ipJTHkb2YBV';

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

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    res.status(500).json({ error: 'Airtable no está configurado todavía en Vercel.' });
    return;
  }

  const { name, company, phone, email, location, serviceType, comments, source } = req.body || {};

  if (!name || !phone) {
    res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
    return;
  }

  const fields = { Nombre: name || '', 'Teléfono': phone || '' };
  if (email) fields['Correo'] = email;
  if (company) fields['Empresa'] = company;
  if (location) fields['Ubicacion Ofirent'] = location;
  if (serviceType) fields['Servicio de interés'] = serviceType;
  const comentarios = [source ? `[${source}]` : '', comments || ''].filter(Boolean).join(' ');
  if (comentarios) fields['Comentarios'] = comentarios;

  try {
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${LEADS_TABLE_ID}`,
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
