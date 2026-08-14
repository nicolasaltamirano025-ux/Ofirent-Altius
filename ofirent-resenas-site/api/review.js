// Función serverless (Vercel). Guarda las reseñas negativas/internas en Airtable.
// El token de Airtable vive en variables de entorno de Vercel, nunca en el código
// ni en el navegador del usuario.

module.exports = async (req, res) => {
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

  const { rating, location, comment, name, phone } = req.body || {};

  try {
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            Calificación: Number(rating) || null,
            Ubicación: location || '',
            Comentario: comment || '',
            Nombre: name || '',
            Teléfono: phone || ''
          }
        })
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
