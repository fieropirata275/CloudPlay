/* Panel: "Acceso desde Internet" (cómo se llega a la plataforma y cómo publicarla con Cloudflare) y "Correo"
 * (proveedor, dominio y sus DNS, qué correos salen, a quién avisar, prueba, vista previa y registro). ES5. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var $ = function (s) { return document.querySelector(s); };
  var state = null, previewLoaded = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function when(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }
  var STATUS = { sent: ['Enviado', 'online'], failed: ['Falló', 'failed'], skipped: ['No enviado', 'queued'],
    verified: ['Verificado', 'online'], pending: ['Pendiente', 'queued'], not_started: ['Sin empezar', 'queued'],
    failure: ['Falló', 'failed'], failed_dns: ['Falló', 'failed'], temporary_failure: ['Reintentando', 'queued'] };
  function pill(st) {
    var s = STATUS[st] || [st || '—', 'queued'];
    return '<span class="state ' + s[1] + '">' + esc(s[0]) + '</span>';
  }

  // ------------------------------------------------------------ acceso desde Internet
  function renderSystem(s) {
    var html;
    if (s.exposure === 'tunnel') {
      html = '<p class="sys-line"><b>Publicado con Cloudflare Tunnel</b> <span class="state online">En Internet</span>' + '</p>' +
        '<p>Desde cualquier sitio: <a href="' + esc(s.public_url) + '">' + esc(s.public_url) + '</a>' +
        (s.lan_url ? ' · en tu red, también <a href="' + esc(s.lan_url) + '">' + esc(s.lan_url) + '</a>' : '') + '</p>' +
        '<p class="muted small">Vídeo de las partidas: ' + (s.turn === 'cloudflare' ? 'TURN de Cloudflare (sin abrir puertos).' :
          'sin TURN de Cloudflare: fuera de tu red puede no verse. En el máster: <code>sudo cloudplay cloudflare</code> otra vez con un token que tenga permiso de Realtime/Calls.') + '</p>' +
        '<p class="muted small">Estado del túnel o quitarlo, en el máster: <code>sudo cloudplay cloudflare status</code> · <code>sudo cloudplay cloudflare off</code></p>';
    } else if (s.exposure === 'lan') {
      html = '<p class="sys-line"><b>Solo en tu red local</b> <span class="state queued">Sin publicar</span>' + '</p>' +
        '<p>Ahora se entra por <a href="' + esc(s.public_url) + '">' + esc(s.public_url) + '</a>. Para abrirlo a Internet con tu dominio, ' +
        'sin abrir puertos en el router, en la consola del máster:</p><pre>sudo cloudplay cloudflare</pre>' +
        '<p class="muted small">Te pide un token de API de Cloudflare y el nombre (p. ej. play.tudominio.com) y crea solo el túnel, ' +
        'los DNS y el TURN para el vídeo. La red local sigue funcionando igual.</p>';
    } else {
      html = '<p class="sys-line"><b>Publicado con tu dominio</b> <span class="state online">En Internet</span>' + '</p>' +
        '<p><a href="' + esc(s.public_url) + '">' + esc(s.public_url) + '</a> (certificado de Let\'s Encrypt, puertos 80 y 443 abiertos).</p>' +
        '<p class="muted small">Para no abrir puertos, pásalo a Cloudflare Tunnel: <code>sudo cloudplay cloudflare</code> en el máster.</p>';
    }
    $('#sys-card').innerHTML = html;
  }

  // ------------------------------------------------------------ correo
  function renderMail(m) {
    var html;
    if (!m.configured) {
      html = '<p class="sys-line"><b>Sin correo</b> <span class="state queued">Sin configurar</span>' + '</p>' +
        '<p>Sin correo no se puede recuperar la contraseña ni avisar al NOC. Para montarlo, en la consola del máster:</p>' +
        '<pre>sudo cloudplay mail setup</pre>' +
        '<p class="muted small">Con <b>Resend</b> lo deja todo hecho: da de alta tu dominio, escribe SPF, DKIM y DMARC en Cloudflare, ' +
        'lo verifica y te manda un correo de prueba. También vale cualquier SMTP (Gmail, Brevo, SES, Mailgun…).</p>';
    } else {
      html = '<p class="sys-line"><b>' + (m.provider === 'resend' ? 'Resend' : 'SMTP') + '</b> <span class="state online">Activo</span>' +
        '<span class="muted">desde ' + esc(m.from) + (m.smtp ? ' · ' + esc(m.smtp) : '') + '</span></p>';
      if (m.domain && m.domain.error) {
        html += '<p class="error">No se pudo consultar el dominio en Resend: ' + esc(m.domain.error) + '</p>';
      } else if (m.domain) {
        html += '<p>Dominio <b>' + esc(m.domain.name) + '</b> ' + pill(m.domain.status) +
          (m.domain.status !== 'verified' ? ' <button class="btn quiet" id="mail-verify" type="button">Comprobar otra vez</button>' : '') + '</p>' +
          '<table class="dns"><tbody>' + (m.domain.records || []).map(function (r) {
            return '<tr><td>' + esc(r.record) + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.value) + '</td><td>' + pill(r.status) + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      html += '<p class="muted small">Cambiar de proveedor o de dominio: <code>sudo cloudplay mail setup</code> en el máster.</p>';
    }
    $('#mail-card').innerHTML = html;
    var v = $('#mail-verify');
    if (v) v.addEventListener('click', function () {
      v.disabled = true;
      CP.api('POST', '/api/admin/mail/verify').then(function () { return load(); }).catch(function (e) { v.disabled = false; CP.toast(e.message); });
    });

    $('#mail-grid').hidden = false;
    $('#mail-kinds').innerHTML = m.kinds.map(function (k) {
      var on = k.locked || m.prefs.types[k.kind];
      return '<label><input type="checkbox" data-kind="' + esc(k.kind) + '"' + (on ? ' checked' : '') + (k.locked ? ' disabled' : '') +
        '> <span>' + esc(k.label) + ' <small>· ' + esc(k.to) + (k.locked ? ' · siempre' : '') + '</small></span></label>';
    }).join('');
    $('#mail-notify').value = (m.prefs.notify || []).join(', ');
    $('#mail-notify').placeholder = m.recipients.length ? 'todos los administradores (' + m.recipients.join(', ') + ')' : 'todos los administradores';
    $('#mail-sender').value = m.prefs.sender_name || '';
    $('#mail-reply').value = m.prefs.reply_to || '';
    if (!$('#mail-test-to').value && state && state.me) $('#mail-test-to').value = state.me;
    $('#mail-test').disabled = !m.configured;
    var sel = $('#mail-preview-kind');
    if (!sel.options.length) {
      sel.innerHTML = m.kinds.map(function (k) { return '<option value="' + esc(k.kind) + '">' + esc(k.label) + '</option>'; }).join('');
    }
    if (previewLoaded !== sel.value) preview();

    var tb = $('#mail-log tbody');
    $('#mail-log').hidden = !m.log.length;
    tb.innerHTML = m.log.map(function (l) {
      return '<tr><td>' + when(l.at) + '</td><td>' + esc(l.kind) + '</td><td>' + esc(l.to) + '</td><td>' + pill(l.status) +
        (l.error ? ' <span class="muted small">' + esc(l.error) + '</span>' : '') + '</td></tr>';
    }).join('');
  }

  function preview() {
    var kind = $('#mail-preview-kind').value;
    previewLoaded = kind;
    CP.api('GET', '/api/admin/mail/preview/' + encodeURIComponent(kind)).then(function (p) {
      $('#mail-preview').setAttribute('srcdoc', p.html);
    }).catch(function () {});
  }

  function load() {
    return Promise.all([CP.api('GET', '/api/admin/system'), CP.api('GET', '/api/admin/mail')]).then(function (r) {
      renderSystem(r[0]);
      renderMail(r[1]);
    }).catch(function (e) { $('#mail-card').innerHTML = '<p class="error">' + esc(e.message) + '</p>'; });
  }

  function init() {
    $('#mail-save').addEventListener('click', function () {
      var types = {};
      Array.prototype.forEach.call(document.querySelectorAll('#mail-kinds input[data-kind]'), function (i) {
        if (!i.disabled) types[i.getAttribute('data-kind')] = i.checked;
      });
      var notify = $('#mail-notify').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      CP.api('PUT', '/api/admin/mail', { types: types, notify: notify, sender_name: $('#mail-sender').value.trim(), reply_to: $('#mail-reply').value.trim() })
        .then(function () { CP.toast('Ajustes del correo guardados'); return load(); })
        .catch(function (e) { CP.toast(e.message); });
    });
    $('#mail-test').addEventListener('click', function () {
      var b = $('#mail-test');
      b.disabled = true;
      CP.api('POST', '/api/admin/mail/test', { to: $('#mail-test-to').value.trim() || null })
        .then(function (r) { CP.toast('Prueba enviada a ' + r.to); })
        .catch(function (e) { CP.toast('No se ha enviado: ' + e.message); })
        .then(function () { b.disabled = false; return load(); });
    });
    $('#mail-preview-kind').addEventListener('change', preview);
  }

  var started = false;
  var origStart = CP.adminStart;
  CP.adminStart = function () {
    if (!started) { started = true; init(); }
    state = { me: null };
    CP.api('GET', '/api/auth/me').then(function (me) { state.me = me.email; if (!$('#mail-test-to').value) $('#mail-test-to').value = me.email; }).catch(function () {});
    load();
    if (origStart) origStart.apply(this, arguments);
  };
})(window);
