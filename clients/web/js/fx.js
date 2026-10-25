/* Capa de animación: Motion (motion.dev) para la UI y GSAP + MorphSVG para las siluetas.
 * Todo degrada a "sin animación" si las librerías no cargan o si el usuario pide menos movimiento. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var M = root.Motion, G = root.gsap;
  var reduced = false;
  try { reduced = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (G && root.MorphSVGPlugin) { try { G.registerPlugin(root.MorphSVGPlugin); } catch (e) { G = null; } }
  else G = null;
  // Plugins opcionales: si alguno no carga, solo se pierde ese efecto
  var F = null, ST = null;
  if (G && root.Flip) { try { G.registerPlugin(root.Flip); F = root.Flip; } catch (e) {} }
  if (G && root.SplitText) { try { G.registerPlugin(root.SplitText); ST = root.SplitText; } catch (e) {} }

  // Siluetas genéricas en un viewBox de 200×200 (ninguna reproduce logos ni marcas)
  var SHAPES = {
    cloud: 'M52,140 C30,140 18,124 22,106 C25,92 38,84 52,86 C56,62 76,48 100,50 C124,52 140,70 142,90 C160,88 178,102 176,120 C174,134 162,140 150,140 Z',
    ps2: 'M68,28 L132,28 L132,94 L126,94 L126,106 L132,106 L132,172 L68,172 L68,106 L74,106 L74,94 L68,94 Z',
    gc: 'M100,34 L156,64 L156,134 L100,166 L44,134 L44,64 Z',
    wii: 'M86,24 C86,16 114,16 114,24 L118,170 C118,182 82,182 82,170 Z',
    play: 'M76,52 L152,100 L76,148 Z',
    warn: 'M100,30 L172,160 L28,160 Z'
  };
  var DETAILS = {
    cloud: '',
    ps2: 'M80,52 L120,52 M80,148 L120,148',
    gc: 'M100,34 L100,100 M44,64 L100,100 L156,64 M100,100 L100,166',
    wii: 'M100,48 L100,68 M90,58 L110,58 M100,96 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0',
    play: '',
    warn: 'M100,78 L100,120 M100,136 L100,142'
  };
  var ICONS = {
    plus: 'M44,20 L56,20 L56,44 L80,44 L80,56 L56,56 L56,80 L44,80 L44,56 L20,56 L20,44 L44,44 Z',
    star: 'M50,8 L61,37 L92,38 L68,57 L77,88 L50,70 L23,88 L32,57 L8,38 L39,37 Z'
  };

  var fx = {
    reduced: reduced,
    hasMotion: !!M && !reduced,
    hasMorph: !!G && !reduced,
    SHAPES: SHAPES,
    DETAILS: DETAILS,
    ICONS: ICONS
  };

  function done() { return Promise.resolve(); }

  /** Motion.animate con fallback: aplica el último fotograma y resuelve. */
  fx.animate = function (el, keyframes, opts) {
    if (!el || (el.length === 0)) return done();
    if (fx.hasMotion) {
      try {
        var a = M.animate(el, keyframes, opts || {});
        return a && a.finished ? a.finished.catch(function () {}) : done();
      } catch (e) { /* cae al fallback */ }
    }
    var els = el.length !== undefined && !el.style ? Array.prototype.slice.call(el) : [el];
    els.forEach(function (node) {
      Object.keys(keyframes).forEach(function (k) {
        var v = keyframes[k];
        v = Array.isArray(v) ? v[v.length - 1] : v;
        if (k === 'opacity') node.style.opacity = v;
        else if (k === 'scale') node.style.transform = 'scale(' + v + ')';
        else if (k === 'y') node.style.transform = 'translateY(' + (typeof v === 'number' ? v + 'px' : v) + ')';
        else if (k === 'x') node.style.transform = 'translateX(' + (typeof v === 'number' ? v + 'px' : v) + ')';
        else node.style[k] = v;
      });
    });
    return done();
  };

  fx.spring = function (stiffness, damping) {
    return fx.hasMotion ? { type: M.spring, stiffness: stiffness || 420, damping: damping || 28 } : {};
  };
  fx.stagger = function (step, opts) { return fx.hasMotion ? M.stagger(step, opts) : 0; };

  /** Morph de un <path> a una forma (nombre de SHAPES/ICONS o un "d" directo). */
  fx.morph = function (path, to, opts) {
    var d = SHAPES[to] || ICONS[to] || to;
    if (!path) return done();
    if (fx.hasMorph) {
      return new Promise(function (resolve) {
        G.to(path, Object.assign({ morphSVG: { shape: d, type: 'rotational' }, duration: 0.9, ease: 'expo.inOut', onComplete: resolve }, opts || {}));
      });
    }
    path.setAttribute('d', d);
    return done();
  };

  /** Contador numérico animado (posición en la cola, métricas del panel). */
  fx.count = function (el, to) {
    var from = parseInt(el.textContent, 10);
    if (isNaN(from) || !G || reduced) { el.textContent = to; return; }
    var o = { v: from };
    G.to(o, { v: to, duration: 0.6, ease: 'power2.out', onUpdate: function () { el.textContent = Math.round(o.v); } });
  };

  /** Escala con muelle al recibir foco (navegación con mando / mando de la tele). */
  fx.focusSpring = function (container, selector, scale) {
    if (!fx.hasMotion) return;
    container.addEventListener('focusin', function (e) {
      var t = e.target.closest && e.target.closest(selector);
      if (t) fx.animate(t, { scale: scale || 1.07 }, fx.spring(500, 30));
    });
    container.addEventListener('focusout', function (e) {
      var t = e.target.closest && e.target.closest(selector);
      if (t) fx.animate(t, { scale: 1 }, fx.spring(500, 34));
    });
  };

  // ---------------------------------------------------------------- Flip
  /** Guarda posiciones antes de re-renderizar (los elementos se emparejan por data-flip-id). */
  fx.flipState = function (selector) {
    if (!F || reduced) return null;
    try { return F.getState(selector); } catch (e) { return null; }
  };
  /** Anima del estado guardado al layout nuevo: lo que se queda se desliza, lo nuevo entra y lo que sale se va. */
  fx.flipFrom = function (state, selector) {
    if (!state || !F) return;
    try {
      F.from(state, {
        targets: selector,
        duration: 0.55,
        ease: 'expo.out',
        absolute: true,
        nested: true,
        prune: true,
        onEnter: function (els) { return G.fromTo(els, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.4, stagger: 0.02, ease: 'expo.out' }); },
        onLeave: function (els) { return G.to(els, { opacity: 0, scale: 0.86, duration: 0.25 }); }
      });
    } catch (e) {}
  };

  /** Elemento compartido: una copia de `el` vuela desde su sitio hasta `to` (rect) y se desvanece. */
  fx.flyTo = function (el, to, fromRect) {
    if (!el || !G || reduced) return done();
    var r = fromRect || el.getBoundingClientRect();
    var ghost = el.cloneNode(true);
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.cssText = 'position:fixed;margin:0;z-index:60;pointer-events:none;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;padding-top:0';
    document.body.appendChild(ghost);
    return new Promise(function (resolve) {
      G.timeline({ onComplete: function () { ghost.parentNode && ghost.parentNode.removeChild(ghost); resolve(); } })
        .to(ghost, { left: to.left, top: to.top, width: to.width, height: to.height, borderRadius: 28, duration: 0.6, ease: 'expo.inOut' })
        .to(ghost, { opacity: 0, scale: 0.7, duration: 0.3, ease: 'power2.in' }, '-=0.1');
    });
  };

  // ----------------------------------------------------------- SplitText
  /** Revela un titular letra a letra (o palabra a palabra). Idempotente: deshace el split anterior. */
  fx.splitReveal = function (el, opts) {
    opts = opts || {};
    if (!el || !ST || reduced) return;
    try {
      if (el._split) el._split.revert();
      var s = el._split = new ST(el, { type: opts.type || 'chars', charsClass: 'ch', wordsClass: 'wd' });
      var parts = opts.type === 'words' ? s.words : s.chars;
      G.fromTo(parts, { yPercent: 70, opacity: 0 }, {
        yPercent: 0, opacity: 1, duration: opts.duration || 0.5, ease: 'expo.out',
        stagger: opts.stagger || 0.02, delay: opts.delay || 0,
        onComplete: function () { if (opts.revert !== false && el._split) { el._split.revert(); el._split = null; } }
      });
    } catch (e) {}
  };

  // ------------------------------------------- Motion hover/press (ratón y táctil)
  /** Elevación al pasar el ratón y "hundido" al pulsar. En la tele no hay puntero: no se activa. */
  fx.pointer = function (selector) {
    if (!fx.hasMotion || !M.hover || !M.press) return;
    try {
      M.hover(selector, function (el) {
        fx.animate(el, { y: -4 }, fx.spring(520, 30));
        return function () { fx.animate(el, { y: 0 }, fx.spring(520, 34)); };
      });
      M.press(selector, function (el) {
        fx.animate(el, { scale: 0.96 }, fx.spring(700, 30));
        return function () { fx.animate(el, { scale: 1 }, fx.spring(500, 22)); };
      });
    } catch (e) {}
  };

  CP.fx = fx;
})(window);
