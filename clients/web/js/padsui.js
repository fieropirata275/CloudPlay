/* Hoja "Mandos": prueba en vivo de cada mando conectado y asistente "Configurar mando".
 * app.js la abre desde la biblioteca, desde el menú de la partida y al conectar un mando desconocido. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var P = CP.Pads, $ = function (s) { return document.querySelector(s); };
  var h = null, opts = {}, open = false, raf = 0, sig = '', wizard = null, wizPad = null, startHeld = 0;
  var KIND = {
    custom: ['Tu configuración', 'Configurado en este dispositivo.'],
    standard: ['Estándar', 'El navegador ya lo reconoce: no hace falta configurarlo.'],
    profile: ['Perfil automático', 'Reconocido por su adaptador. Pruébalo: si algún botón no cuadra, configúralo.'],
    unknown: ['Sin configurar', 'No lo conocemos todavía: configúralo, es un minuto.']
  };

  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) {} }

  /** Qué nombres de botón enseñar: los de la consola con la que se configuró, o adivinados por el nombre */
  function layoutOf(gp, d) {
    var saved = lsGet('cp.padlayout.' + gp.id);
    if (saved && P.LAYOUTS[saved]) return saved;
    var n = (d && d.name ? d.name : '') + ' ' + gp.id;
    if (/game ?cube|\bgc\b|ngc/i.test(n)) return 'gc';
    if (/ps2|ps1|psx|playstation|dual ?box|dualshock 2|super joy/i.test(n)) return 'ps2';
    return 'std';
  }

  function up(node, sel) {
    if (node && node.closest) return node.closest(sel);
    var m = sel.charAt(0) === '.' ? function (n) { return n.classList && n.classList.contains(sel.slice(1)); }
                                   : function (n) { return n.hasAttribute && n.hasAttribute(sel.slice(1, -1)); };
    while (node && node !== document) { if (m(node)) return node; node = node.parentNode; }
    return null;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function show(view) {
    $('#pads-main').hidden = view !== 'main';
    $('#pads-pick').hidden = view !== 'pick';
    $('#pads-wizard').hidden = view !== 'wizard';
    setTimeout(function () {
      var first = view === 'main' ? $('#pads-close') : view === 'pick' ? $('#pads-pick .btn') : $('#wiz-skip');
      if (first && first.focus) first.focus();
    }, 30);
  }

  // ------------------------------------------------------------------ lista y prueba en vivo
  function render() {
    var pads = P.list(), box = $('#pads-list');
    box.innerHTML = '';
    $('#pads-empty').hidden = pads.length > 0;
    pads.forEach(function (gp) {
      var d = P.describe(gp), lay = layoutOf(gp, d), labels = P.LABELS[lay];
      var card = el('div', 'pad-card');
      card.setAttribute('data-index', gp.index);
      var head = el('div', 'pad-head');
      head.appendChild(el('strong', '', (gp.index + 1) + ' · ' + d.name));
      head.appendChild(el('span', 'badge ' + d.kind, KIND[d.kind][0]));
      card.appendChild(head);
      card.appendChild(el('p', 'pad-sub', KIND[d.kind][1]));
      var chips = el('div', 'chips');
      for (var i = 0; i < 17; i++) {
        if (!labels[i]) continue;
        var c = el('span', 'chip', labels[i]);
        c.setAttribute('data-b', i);
        chips.appendChild(c);
      }
      card.appendChild(chips);
      var sticks = el('div', 'sticks');
      ['L', 'R'].forEach(function (s) {
        var st = el('span', 'stick');
        st.setAttribute('data-s', s);
        st.setAttribute('title', s === 'L' ? 'Stick izquierdo' : lay === 'gc' ? 'C-Stick' : 'Stick derecho');
        st.appendChild(el('i'));
        sticks.appendChild(st);
      });
      [['lt', labels[6] || 'LT'], ['rt', labels[7] || 'RT']].forEach(function (t) {
        var tr = el('span', 'trig');
        tr.appendChild(el('small', '', t[1]));
        var bar = el('b');
        var fill = el('i');
        fill.setAttribute('data-t', t[0]);
        bar.appendChild(fill);
        tr.appendChild(bar);
        sticks.appendChild(tr);
      });
      card.appendChild(sticks);
      var actions = el('div', 'pad-actions');
      var cfg = el('button', 'btn', d.kind === 'unknown' ? 'Configurar ahora' : 'Configurar');
      cfg.setAttribute('data-act', 'setup');
      actions.appendChild(cfg);
      if (d.kind === 'custom') {
        var rs = el('button', 'btn quiet', 'Quitar mi configuración');
        rs.setAttribute('data-act', 'reset');
        actions.appendChild(rs);
      }
      card.appendChild(actions);
      box.appendChild(card);
    });
    sig = signature();
  }
  function signature() {
    return P.list().map(function (gp) { return gp.index + gp.id + P.describe(gp).kind; }).join('|');
  }

  function live() {
    if (!open) return;
    if (!wizard) {
      if (signature() !== sig) render();
      var anyStart = false;
      P.list().forEach(function (gp) {
        var card = document.querySelector('.pad-card[data-index="' + gp.index + '"]');
        if (!card) return;
        var n = P.read(gp), chips = card.querySelectorAll('.chip');
        for (var i = 0; i < chips.length; i++) {
          var b = +chips[i].getAttribute('data-b');
          var on = b === 16 ? n.guide : !!((n.buttons >> b) & 1);
          if (chips[i].classList.contains('on') !== on) chips[i].classList.toggle('on', on);
        }
        var sticks = card.querySelectorAll('.stick i');
        sticks[0].style.transform = 'translate(' + (n.lx * 1.1) + 'rem,' + (n.ly * 1.1) + 'rem)';
        sticks[1].style.transform = 'translate(' + (n.rx * 1.1) + 'rem,' + (n.ry * 1.1) + 'rem)';
        card.querySelector('[data-t="lt"]').style.width = Math.round(n.lt * 100) + '%';
        card.querySelector('[data-t="rt"]').style.width = Math.round(n.rt * 100) + '%';
        if ((n.buttons >> 9) & 1) anyStart = true;
      });
      // START mantenido 1,5 s cierra la hoja (para quien solo tiene el mando a mano)
      if (anyStart) { if (!startHeld) startHeld = Date.now(); else if (Date.now() - startHeld > 1500) { startHeld = 0; close(); return; } }
      else startHeld = 0;
    }
    raf = root.requestAnimationFrame(live);
  }

  // ------------------------------------------------------------------ asistente
  function pick(index) {
    wizPad = index;
    show('pick');
  }
  function startWizard(layout) {
    var gp = P.find(wizPad);
    if (!gp) { h.toast('El mando se ha desconectado'); return show('main'); }
    var name = P.describe(gp).name;
    $('#wiz-pad').textContent = name;
    show('wizard');
    wizard = new P.Wizard({
      index: wizPad,
      layout: layout,
      onStep: function (step, i, total) {
        $('#wiz-progress').textContent = 'Paso ' + (i + 1) + ' de ' + total;
        $('#wiz-bar').style.width = Math.round(i / total * 100) + '%';
        var pr = $('#wiz-prompt');
        pr.textContent = step.label;
        if (CP.fx && CP.fx.animate) CP.fx.animate(pr, { opacity: [0, 1], y: [10, 0] }, { duration: 0.22 });
        var stick = /^(l|r)[xy]$/.test(step.slot), trig = /^(l|r)t$/.test(step.slot);
        $('#wiz-hint').textContent = (stick ? 'Empújalo hasta el tope y suéltalo. ' : trig ? 'Hasta el fondo y suelta. ' : 'Pulsa y suelta. ') +
          (step.optional ? 'Si tu mando no lo tiene, se salta solo en unos segundos.' : '');
        $('#wiz-back').disabled = i === 0;
      },
      onDone: function (map) {
        wizard = null;
        var pad = P.find(wizPad);
        if (pad) {
          P.save(pad, map);
          lsSet('cp.padlayout.' + pad.id, layout);
        }
        $('#wiz-bar').style.width = '100%';
        h.toast('Mando configurado: pruébalo aquí');
        render();
        show('main');
      }
    });
    wizard.start();
  }
  function cancelWizard() {
    if (wizard) { wizard.stop(); wizard = null; }
    render();
    show('main');
  }

  // ------------------------------------------------------------------ abrir / cerrar
  function openSheet(o) {
    opts = o || {};
    if (open) return;
    open = true;
    CP.navSetActive(true);
    CP.navPadPause(true);
    CP.navOnBack(function () {
      if (wizard || !$('#pads-pick').hidden) cancelWizard(); else close();
    });
    P.ensureDb(function () { if (open && !wizard) render(); });
    render();
    show('main');
    h.openSheet($('#pads-sheet'));
    raf = root.requestAnimationFrame(live);
    if (opts.setup !== undefined) pick(opts.setup);
  }
  function close() {
    if (!open) return;
    if (wizard) { wizard.stop(); wizard = null; }
    open = false;
    root.cancelAnimationFrame(raf);
    CP.navPadPause(false);
    h.closeSheet($('#pads-sheet'));
    if (opts.onClose) opts.onClose();
  }

  function init(helpers) {
    h = helpers;
    $('#pads-close').addEventListener('click', close);
    $('#pads-list').addEventListener('click', function (e) {
      var b = up(e.target, '[data-act]');
      if (!b) return;
      var card = up(b, '.pad-card'), index = +card.getAttribute('data-index'), gp = P.find(index);
      if (!gp) return;
      if (b.getAttribute('data-act') === 'setup') pick(index);
      else { P.reset(gp); h.toast('Vuelve a su perfil automático'); render(); }
    });
    $('#pads-pick').addEventListener('click', function (e) {
      var l = e.target.getAttribute && e.target.getAttribute('data-layout');
      if (l) startWizard(l);
    });
    $('#pick-cancel').addEventListener('click', function () { show('main'); });
    $('#wiz-skip').addEventListener('click', function () { if (wizard) wizard.skip(); });
    $('#wiz-back').addEventListener('click', function () { if (wizard) wizard.back(); });
    $('#wiz-cancel').addEventListener('click', cancelWizard);

    // Mando nuevo: si lo conocemos, se avisa; si no, se ofrece configurarlo
    P.onConnect(function (gp, d) {
      if (open) return;
      if (d.kind === 'profile') h.toast('Mando reconocido: ' + d.name);
      else if (d.kind === 'unknown') {
        if (h.inGame && h.inGame()) h.toast('Mando nuevo: configúralo en Menú → Configurar mando');
        else h.modal('Mando nuevo', d.name + ' no está en nuestra lista. Dile qué es cada botón y quedará guardado en este dispositivo.', [
          { label: 'Configurarlo', action: function () { openSheet({ setup: gp.index }); } },
          { label: 'Ahora no', action: function () {} }
        ]);
      }
    });
  }

  CP.PadsUI = { init: init, open: openSheet, close: close, isOpen: function () { return open; } };
})(window);
