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

  // ================================================================ extras de navegación
  var finePointer = false;
  try { finePointer = root.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}
  function tv() { return !!CP.isTV; }

  // ------------------------------------------------ fondo 3D (three.js, carga diferida)
  var scene = null, sceneQueue = [];
  /** Llama a un método del fondo 3D; si aún no ha cargado, se aplica al terminar de cargar. */
  fx.scene = function (method, arg) {
    if (scene) { try { scene[method](arg); } catch (e) {} }
    else sceneQueue.push([method, arg]);
  };
  /** Carga el fondo 3D después del primer pintado. Nunca en teles (salvo ?fx=full) ni con "reducir movimiento". */
  fx.startScene = function () {
    var force = /[?&]fx=full/.test(location.search);
    if (/[?&]fx=lite/.test(location.search) || reduced || (tv() && !force)) return;
    var probe = document.createElement('canvas');
    var gl = null;
    try { gl = probe.getContext('webgl') || probe.getContext('experimental-webgl'); } catch (e) {}
    if (!gl) return;
    var canvas = document.createElement('canvas');
    canvas.id = 'bg3d';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);
    var s = document.createElement('script');
    s.src = 'vendor/cp-scene.min.js';
    s.async = true;
    s.onload = function () {
      if (!root.CPScene) return;
      scene = root.CPScene.start(canvas, { tint: '#5B4BD6', maxDpr: 1.5 });
      if (!scene) { canvas.parentNode.removeChild(canvas); return; }
      document.documentElement.classList.add('has-scene');
      sceneQueue.forEach(function (q) { fx.scene(q[0], q[1]); });
      sceneQueue = [];
    };
    (root.requestIdleCallback || function (f) { setTimeout(f, 300); })(function () { document.body.appendChild(s); });
  };
  fx.PLATFORM_TINT = { all: '#5B4BD6', ps2: '#2F4BDB', gc: '#7A5CFF', wii: '#38C5F2' };

  // ------------------------------------- brillo de foco que viaja (D-pad / teclado / mando)
  var modality = 'pointer';
  /** Un único anillo ámbar que se desliza con muelle hasta el elemento enfocado.
   *  Con ratón no se ve (el ratón ya dice dónde estás); con mando o teclado, siempre. */
  fx.focusGlow = function () {
    if (!M || !fx.hasMotion) return; // sin Motion queda el anillo CSS de siempre
    if (tv()) modality = 'key'; // en la tele todo es mando
    var glow = document.createElement('div');
    glow.className = 'focus-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);
    document.documentElement.classList.add('glow-ready');
    var current = null, shown = false, raf = 0;

    function targetOf(el) { return (el.classList && el.classList.contains('tile') && el.querySelector('.case')) || el; }
    function rectOf(el) {
      var t = targetOf(el), r = t.getBoundingClientRect(), cs = root.getComputedStyle(t);
      return { x: r.left - 5, y: r.top - 5, width: r.width + 10, height: r.height + 10, radius: (parseFloat(cs.borderTopLeftRadius) || 8) + 5 };
    }
    function place(animated) {
      if (!current) return;
      var r = rectOf(current);
      var props = { x: r.x, y: r.y, width: r.width + 'px', height: r.height + 'px', borderRadius: r.radius + 'px' };
      // sin animar también pasa por Motion: así el siguiente muelle sale de la posición real
      fx.animate(glow, props, animated ? { type: M.spring, stiffness: 520, damping: 38, mass: 0.8 } : { duration: 0 });
    }
    function visible(v) {
      if (v === shown) return;
      shown = v;
      document.documentElement.classList.toggle('glow-on', v);
      fx.animate(glow, { opacity: v ? 1 : 0 }, { duration: v ? 0.18 : 0.12 });
    }
    document.addEventListener('focusin', function (e) {
      var el = e.target;
      if (!el || el === document.body || el.tagName === 'VIDEO') { current = null; visible(false); return; }
      var first = !current;
      current = el;
      if (modality === 'pointer' && !tv()) { visible(false); return; }
      place(!first && shown);
      visible(true);
    });
    document.addEventListener('focusout', function (e) {
      if (!e.relatedTarget) { current = null; visible(false); }
    });
    // pegado al elemento mientras se hace scroll o cambia el tamaño
    function follow() {
      if (raf) return;
      raf = root.requestAnimationFrame(function () { raf = 0; if (shown) place(true); });
    }
    document.addEventListener('scroll', follow, true);
    root.addEventListener('resize', follow);
    root.addEventListener('keydown', function (e) {
      if (e.keyCode >= 37 && e.keyCode <= 40 || e.keyCode === 9) { modality = 'key'; if (current && !shown) { place(false); visible(true); } }
    }, true);
    root.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' || e.pointerType === 'touch') { modality = 'pointer'; visible(false); } }, true);
    root.addEventListener('gamepadconnected', function () { modality = 'key'; });
    fx.glowRefresh = function () { if (current && shown) place(false); };
    fx.setModality = function (m) { modality = m; };
  };

  // ------------------------------------------------- inclinación 3D con brillo (solo ratón)
  /** La caja del juego se inclina hacia el puntero y un reflejo la recorre. */
  fx.tilt = function (container, selector) {
    if (!fx.hasMotion || !finePointer || tv() || !container) return;
    var active = null;
    function reset(el) {
      var c = el && el.querySelector('.case');
      if (c) fx.animate(c, { rotateX: 0, rotateY: 0 }, fx.spring(260, 22));
      if (el) el.classList.remove('tilting');
    }
    container.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var el = e.target.closest ? e.target.closest(selector) : null;
      if (el !== active) { reset(active); active = el; }
      if (!el) return;
      var c = el.querySelector('.case');
      if (!c) return;
      var r = c.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      c.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      c.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      el.classList.add('tilting');
      fx.animate(c, { rotateX: (0.5 - py) * 14, rotateY: (px - 0.5) * 16 }, fx.spring(320, 26));
    });
    container.addEventListener('pointerleave', function () { reset(active); active = null; });
  };

  // ------------------------------------------- texto que rueda (inspirado en Skiper UI 58)
  /** Al pasar el ratón cada letra sube y la copia de abajo ocupa su sitio, en cascada. Solo CSS. */
  fx.textRoll = function (els) {
    if (reduced || tv()) return;
    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-roll')) return;
      var text = el.textContent;
      if (!text || el.children.length) return;
      var chars = text.split('').map(function (c, i) {
        return '<span style="transition-delay:' + (i * 0.022).toFixed(3) + 's">' + (c === ' ' ? '&nbsp;' : c.replace(/[&<>]/g, '')) + '</span>';
      }).join('');
      el.setAttribute('data-roll', '1');
      el.setAttribute('aria-label', text);
      el.innerHTML = '<span class="roll" aria-hidden="true"><span class="roll-a">' + chars + '</span><span class="roll-b">' + chars + '</span></span>';
    });
  };

  // --------------------------------------- palabra que va cambiando (inspirado en Skiper UI 62)
  fx.rotateWords = function (el, words, every) {
    if (!el || !words || words.length < 2) return;
    var i = 0;
    el.textContent = words[0];
    if (reduced) return;
    if (el._rot) clearInterval(el._rot);
    el._rot = setInterval(function () {
      if (!document.body.contains(el) || el.offsetParent === null) return;
      i = (i + 1) % words.length;
      fx.animate(el, { opacity: 0, y: -14 }, { duration: 0.22 }).then(function () {
        el.textContent = words[i];
        fx.animate(el, { opacity: [0, 1], y: [14, 0] }, fx.spring(420, 30));
      });
    }, every || 2200);
  };

  // ------------------------------------------------------ código tipo panel de aeropuerto
  /** Cada carácter del código cae como una pala de split-flap; al cambiar, las viejas se pliegan antes. */
  fx.flapCode = function (el, code) {
    var draw = function () {
      el.innerHTML = code.split('').map(function (c) { return '<span class="flap">' + c.replace(/[&<>]/g, '') + '</span>'; }).join('');
      if (!fx.hasMotion) return done();
      return fx.animate(Array.prototype.slice.call(el.children), { rotateX: [-95, 0], opacity: [0, 1] }, { delay: M.stagger(0.06), type: M.spring, stiffness: 300, damping: 20 });
    };
    if (el.children.length && fx.hasMotion) {
      return fx.animate(Array.prototype.slice.call(el.children), { rotateX: 95, opacity: 0 }, { delay: M.stagger(0.03), duration: 0.18 }).then(draw);
    }
    return draw();
  };

  // ------------------------------------------------------------------ ondas al pulsar
  fx.ripple = function (scope) {
    if (reduced || !fx.hasMotion) return;
    scope.addEventListener('pointerdown', function (e) {
      var b = e.target.closest ? e.target.closest('.btn, .filter') : null;
      if (!b) return;
      var r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
      var dot = document.createElement('span');
      dot.className = 'ripple';
      dot.style.width = dot.style.height = size + 'px';
      dot.style.left = (e.clientX - r.left - size / 2) + 'px';
      dot.style.top = (e.clientY - r.top - size / 2) + 'px';
      b.appendChild(dot);
      fx.animate(dot, { scale: [0, 1], opacity: [0.35, 0] }, { duration: 0.6, ease: [0.2, 0.7, 0.3, 1] }).then(function () { if (dot.parentNode) dot.parentNode.removeChild(dot); });
    });
  };

  // ------------------------------------------------------ cambio de pantalla
  /** La pantalla nueva entra desde un poco más cerca y la anterior se va hacia atrás. */
  fx.screenSwap = function (prev, next) {
    if (!fx.hasMotion) return;
    if (prev && prev !== next) {
      prev.classList.add('leaving');
      fx.animate(prev, { opacity: [1, 0], scale: [1, 0.97] }, { duration: 0.22 }).then(function () {
        prev.classList.remove('leaving'); prev.style.opacity = ''; prev.style.transform = '';
      });
    }
    fx.animate(next, { opacity: [0, 1], scale: [1.025, 1] }, { type: M.spring, stiffness: 260, damping: 30 }).then(function () { next.style.transform = ''; });
  };

  // ------------------------------------------- aparecer al entrar en pantalla (Motion inView)
  /** Las carátulas aparecen en cascada a medida que entran en la vista (también al bajar con el mando). */
  fx.revealOnView = function (els, scrollRoot) {
    if (!fx.hasMotion || !M.inView) return;
    var batch = 0, batchTimer = null;
    Array.prototype.forEach.call(els, function (el) {
      el.style.opacity = '0';
      M.inView(el, function () {
        var d = batch++ * 0.035;
        clearTimeout(batchTimer);
        batchTimer = setTimeout(function () { batch = 0; }, 80);
        fx.animate(el, { opacity: [0, 1], y: [26, 0], scale: [0.94, 1] }, { delay: d, type: M.spring, stiffness: 300, damping: 26 }).then(function () { el.style.transform = ''; });
      }, { root: scrollRoot || undefined, amount: 0.15 });
    });
  };

  // ------------------------------------------- barra superior que se condensa con el scroll
  fx.condense = function (scroller, bar, progress) {
    if (!scroller || !bar) return;
    var on = false, raf = 0;
    scroller.addEventListener('scroll', function () {
      if (raf) return;
      raf = root.requestAnimationFrame(function () {
        raf = 0;
        var v = scroller.scrollTop > 12;
        if (v !== on) { on = v; bar.classList.toggle('condensed', v); }
      });
    }, { passive: true });
    // barra de progreso ligada al scroll (Motion scroll)
    if (progress && fx.hasMotion && M.scroll) {
      try { M.scroll(M.animate(progress, { scaleX: [0, 1] }, { ease: 'linear' }), { container: scroller }); } catch (e) {}
    }
  };

  CP.fx = fx;
})(window);
