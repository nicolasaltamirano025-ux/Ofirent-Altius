// Aviso informativo de cookies. Google Tag Manager carga sin esperar
// interacción del visitante (pedido explícito del cliente, 2026-09: el
// widget de WhatsApp y el chatbot viven en GTM y no deben depender de
// que el visitante acepte cookies, para no perder leads). Como ya no
// hay nada que bloquear ni permitir, el banner solo informa y se cierra,
// no ofrece un "Rechazar" que no tendría ningún efecto.
(function () {
  var GTM_ID = 'GTM-MLSS9VN';
  var STORAGE_KEY = 'ofirent_cookie_notice_seen';

  function loadGTM() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var f = document.getElementsByTagName('script')[0];
    var j = document.createElement('script');
    j.async = true;
    j.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    f.parentNode.insertBefore(j, f);
  }

  loadGTM();

  function hideBanner() {
    var el = document.getElementById('cookie-consent-banner');
    if (el) el.remove();
  }

  function dismissNotice() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
    hideBanner();
  }

  function renderBanner() {
    var style = document.createElement('style');
    style.textContent =
      '#cookie-consent-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:200;' +
      'max-width:560px;margin:0 auto;background:#153e2b;color:#eaf1ec;border-radius:16px;' +
      'padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:"Public Sans",-apple-system,sans-serif;}' +
      '#cookie-consent-banner p{margin:0 0 14px;font-size:13.5px;line-height:1.55;}' +
      '#cookie-consent-banner a{color:#8fd6b0;text-decoration:underline;}' +
      '#cookie-consent-banner .cc-actions{display:flex;gap:10px;flex-wrap:wrap;}' +
      '#cookie-consent-banner button{font-family:inherit;font-weight:700;font-size:13px;border:none;' +
      'border-radius:999px;padding:10px 18px;cursor:pointer;}' +
      '#cookie-consent-banner .cc-accept{background:#1f5d40;color:#fff;}' +
      '@media (max-width:480px){ #cookie-consent-banner{left:10px;right:10px;bottom:10px;padding:16px;} }';
    document.head.appendChild(style);

    var banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Aviso de cookies');
    banner.innerHTML =
      '<p>Usamos cookies propias y de terceros para analizar el uso del sitio, mejorar tu experiencia y dar seguimiento a tu interés en nuestros servicios. ' +
      'Puedes bloquearlas desde la configuración de tu navegador. Más información en nuestro <a href="/aviso-de-privacidad/">aviso de privacidad</a>.</p>' +
      '<div class="cc-actions">' +
      '<button class="cc-accept" type="button">Entendido</button>' +
      '</div>';
    document.body.appendChild(banner);

    banner.querySelector('.cc-accept').addEventListener('click', dismissNotice);
  }

  var existing = null;
  try { existing = localStorage.getItem(STORAGE_KEY); } catch (e) {}

  if (existing !== '1') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderBanner);
    } else {
      renderBanner();
    }
  }
})();
