// Banner de consentimiento de cookies + carga condicional de Google Analytics 4.
// PENDIENTE: reemplazar GA_MEASUREMENT_ID por el Measurement ID real (formato G-XXXXXXXXXX)
// cuando exista la propiedad de GA4. Mientras tanto, el banner funciona normal pero
// no carga ningún script de analítica real (evita mandar datos a un ID inventado).
(function () {
  var GA_MEASUREMENT_ID = 'G-PENDIENTE';
  var STORAGE_KEY = 'altius_cookie_consent';

  function loadGA() {
    if (GA_MEASUREMENT_ID === 'G-PENDIENTE') {
      console.log('[cookie-consent] Consentimiento otorgado, pero GA_MEASUREMENT_ID sigue siendo un placeholder. No se carga ningún script.');
      return;
    }
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
  }

  function hideBanner() {
    var el = document.getElementById('cookie-consent-banner');
    if (el) el.remove();
  }

  function setConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    hideBanner();
    if (value === 'granted') loadGA();
  }

  function renderBanner() {
    var style = document.createElement('style');
    style.textContent =
      '#cookie-consent-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:200;' +
      'max-width:560px;margin:0 auto;background:#0e2233;color:#eaf1f5;border-radius:16px;' +
      'padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.35);font-family:"Public Sans",-apple-system,sans-serif;}' +
      '#cookie-consent-banner p{margin:0 0 14px;font-size:13.5px;line-height:1.55;}' +
      '#cookie-consent-banner .cc-actions{display:flex;gap:10px;flex-wrap:wrap;}' +
      '#cookie-consent-banner button{font-family:inherit;font-weight:700;font-size:13px;border:none;' +
      'border-radius:999px;padding:10px 18px;cursor:pointer;}' +
      '#cookie-consent-banner .cc-accept{background:#0071ae;color:#fff;}' +
      '#cookie-consent-banner .cc-reject{background:transparent;color:#eaf1f5;border:1px solid rgba(255,255,255,.35) !important;}' +
      '@media (max-width:480px){ #cookie-consent-banner{left:10px;right:10px;bottom:10px;padding:16px;} }';
    document.head.appendChild(style);

    var banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Aviso de cookies');
    banner.innerHTML =
      '<p>Usamos cookies propias y de terceros para analizar el uso del sitio y mejorar tu experiencia. ' +
      'Puedes aceptarlas o rechazarlas.</p>' +
      '<div class="cc-actions">' +
      '<button class="cc-accept" type="button">Aceptar</button>' +
      '<button class="cc-reject" type="button">Rechazar</button>' +
      '</div>';
    document.body.appendChild(banner);

    banner.querySelector('.cc-accept').addEventListener('click', function () { setConsent('granted'); });
    banner.querySelector('.cc-reject').addEventListener('click', function () { setConsent('denied'); });
  }

  var existing = null;
  try { existing = localStorage.getItem(STORAGE_KEY); } catch (e) {}

  if (existing === 'granted') {
    loadGA();
  } else if (existing !== 'denied') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderBanner);
    } else {
      renderBanner();
    }
  }
})();
