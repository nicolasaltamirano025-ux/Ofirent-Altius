/* Galería de fotos por sede: carrusel con flechas, miniaturas, teclado, deslizar en pantallas táctiles y ampliación.
   Mejora progresiva: sin JavaScript el carrusel sigue siendo una tira de fotos que se desliza. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lightbox = null;

  function clamp(i, n) { return Math.max(0, Math.min(n - 1, i)); }

  function getLightbox() {
    if (lightbox) return lightbox;
    if (typeof HTMLDialogElement === 'undefined') return null;
    var dlg = document.createElement('dialog');
    dlg.className = 'gal-lightbox';
    dlg.setAttribute('aria-label', 'Foto ampliada');
    dlg.innerHTML =
      '<button type="button" class="gal-lb-close" aria-label="Cerrar">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<button type="button" class="gal-btn gal-lb-prev" aria-label="Foto anterior">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<button type="button" class="gal-btn gal-lb-next" aria-label="Foto siguiente">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>' +
      '<figure class="gal-lb-figure"><img class="gal-lb-img" alt="" decoding="async"><figcaption class="gal-lb-cap"></figcaption></figure>';
    document.body.appendChild(dlg);

    var state = { items: [], idx: 0, onChange: null };
    var img = dlg.querySelector('.gal-lb-img');
    var cap = dlg.querySelector('.gal-lb-cap');
    var prev = dlg.querySelector('.gal-lb-prev');
    var next = dlg.querySelector('.gal-lb-next');

    function render() {
      var it = state.items[state.idx];
      img.src = it.src;
      img.alt = it.alt;
      cap.textContent = (state.idx + 1) + ' / ' + state.items.length + '  ·  ' + it.alt;
      prev.disabled = state.idx === 0;
      next.disabled = state.idx === state.items.length - 1;
      [state.idx - 1, state.idx + 1].forEach(function (j) {
        if (state.items[j]) { var p = new Image(); p.src = state.items[j].src; }
      });
    }
    function step(d) {
      var j = clamp(state.idx + d, state.items.length);
      if (j === state.idx) return;
      state.idx = j;
      render();
    }
    function close() { dlg.close(); }

    dlg.querySelector('.gal-lb-close').addEventListener('click', close);
    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });
    dlg.addEventListener('close', function () {
      document.documentElement.classList.remove('gal-lock');
      if (state.onChange) state.onChange(state.idx);
    });
    var startX = null;
    dlg.addEventListener('touchstart', function (e) { startX = e.changedTouches[0].clientX; }, { passive: true });
    dlg.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    }, { passive: true });

    lightbox = {
      open: function (items, idx, onChange) {
        state.items = items; state.idx = idx; state.onChange = onChange;
        render();
        document.documentElement.classList.add('gal-lock');
        dlg.showModal();
      }
    };
    return lightbox;
  }

  function init(root) {
    var track = root.querySelector('.gal-track');
    var slides = [].slice.call(track.children);
    var n = slides.length;
    if (n < 2) { root.classList.add('is-single'); }
    var prev = root.querySelector('.gal-prev');
    var next = root.querySelector('.gal-next');
    var count = root.querySelector('.gal-count');
    var zoom = root.querySelector('.gal-zoom');
    var thumbsBox = root.querySelector('.gal-thumbs');
    var thumbs = [].slice.call(root.querySelectorAll('.gal-thumb'));
    var idx = 0;

    function paint(i) {
      idx = i;
      if (count) count.textContent = (i + 1) + ' / ' + n;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === n - 1;
      thumbs.forEach(function (t, k) {
        if (k === i) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
      });
      var t = thumbs[i];
      if (t && thumbsBox) {
        var target = t.offsetLeft - (thumbsBox.clientWidth - t.offsetWidth) / 2;
        thumbsBox.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    }
    var settle = 0;
    function go(i, smooth) {
      i = clamp(i, n);
      track.scrollTo({ left: i * track.clientWidth, behavior: (smooth && !reduceMotion) ? 'smooth' : 'auto' });
      paint(i);
      // Si el navegador cancela la animación (p. ej. al cargar la página), se coloca la foto sin animar.
      clearTimeout(settle);
      settle = setTimeout(function () {
        if (Math.abs(track.scrollLeft - i * track.clientWidth) > 2) {
          track.scrollTo({ left: i * track.clientWidth, behavior: 'auto' });
        }
      }, 1100);
    }
    function current() {
      var w = track.clientWidth || 1;
      return clamp(Math.round(track.scrollLeft / w), n);
    }

    track.addEventListener('scroll', function () {
      var i = current();
      if (i !== idx) paint(i);
    }, { passive: true });
    ['touchstart', 'wheel', 'pointerdown'].forEach(function (ev) {
      track.addEventListener(ev, function () { clearTimeout(settle); }, { passive: true });
    });
    window.addEventListener('resize', function () { go(idx, false); });

    if (prev) prev.addEventListener('click', function () { go(idx - 1, true); });
    if (next) next.addEventListener('click', function () { go(idx + 1, true); });
    thumbs.forEach(function (t, k) { t.addEventListener('click', function () { go(k, true); }); });
    root.addEventListener('keydown', function (e) {
      if (e.target.closest && e.target.closest('dialog')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1, true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1, true); }
    });

    function items() {
      return slides.map(function (s) {
        var im = s.querySelector('img');
        return { src: im.getAttribute('data-full') || im.currentSrc || im.src, alt: im.alt };
      });
    }
    function openZoom() {
      var lb = getLightbox();
      if (!lb) return;
      lb.open(items(), idx, function (i) { go(i, false); });
    }
    if (zoom) zoom.addEventListener('click', openZoom);
    slides.forEach(function (s) {
      var im = s.querySelector('img');
      im.addEventListener('click', openZoom);
    });
    if (typeof HTMLDialogElement === 'undefined') root.classList.add('no-zoom');

    root.classList.add('is-ready');
    paint(0);
  }

  function boot() {
    [].forEach.call(document.querySelectorAll('[data-gallery]'), init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
