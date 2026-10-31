/* Panel: cuentas de jugador y de administrador (crear, cambiar, mandar el enlace de contraseña, borrar). ES5. */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};
  var $ = function (s) { return document.querySelector(s); };
  var me = null, mailOn = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function genPass() {
    var abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '', b = new Uint8Array(12);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b);
    else for (var i = 0; i < 12; i++) b[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < 12; j++) out += abc.charAt(b[j] % abc.length);
    return out;
  }

  function load() {
    return Promise.all([CP.api('GET', '/api/admin/users'), CP.api('GET', '/api/auth/options')]).then(function (r) {
      var users = r[0];
      mailOn = !!(r[1] && r[1].password_reset);
      $('#users-table tbody').innerHTML = users.map(function (u) {
        var self = me && u.id === me;
        return '<tr><td><strong>' + esc(u.email) + '</strong>' + (self ? ' <span class="muted small">(tú)</span>' : '') + '</td>' +
          '<td><span class="state ' + (u.is_admin ? 'running' : 'queued') + '">' + (u.is_admin ? 'Administrador' : 'Jugador') + '</span></td>' +
          '<td class="num">' + u.max_sessions + '</td>' +
          '<td>' + (u.created_at ? new Date(u.created_at).toLocaleDateString('es-ES') : '—') + '</td>' +
          '<td>' +
          (self ? '' : '<button class="btn quiet" data-u="' + esc(u.id) + '" data-act="role" data-admin="' + (u.is_admin ? '0' : '1') + '">' + (u.is_admin ? 'Hacer jugador' : 'Hacer admin') + '</button>') +
          '<button class="btn quiet" data-u="' + esc(u.id) + '" data-act="pass" data-email="' + esc(u.email) + '">' + (mailOn ? 'Contraseña' : 'Nueva contraseña') + '</button>' +
          (self ? '' : '<button class="btn quiet" data-u="' + esc(u.id) + '" data-act="del" data-email="' + esc(u.email) + '">Borrar</button>') +
          '</td></tr>';
      }).join('');
    }).catch(function (e) { CP.toast(e.message); });
  }

  function init() {
    $('#user-gen').addEventListener('click', function () { $('#user-pass').value = genPass(); });
    $('#user-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#user-email').value.trim(), pass = $('#user-pass').value;
      CP.api('POST', '/api/admin/users', { email: email, password: pass, is_admin: $('#user-admin').checked,
        max_sessions: parseInt($('#user-max').value, 10) || 1 }).then(function () {
        CP.toast('Cuenta creada: ' + email + (mailOn ? ' (le llega un correo de bienvenida)' : ' · pásale la contraseña'));
        $('#user-email').value = ''; $('#user-pass').value = ''; $('#user-admin').checked = false; $('#user-max').value = '1';
        return load();
      }).catch(function (e2) { CP.toast(e2.message); });
    });
    $('#users-table').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b) return;
      var id = b.getAttribute('data-u'), act = b.getAttribute('data-act'), email = b.getAttribute('data-email');
      var done = function (msg) { return function () { CP.toast(msg); return load(); }; };
      var fail = function (e2) { CP.toast(e2.message); };
      if (act === 'role') {
        CP.api('PATCH', '/api/admin/users/' + id, { is_admin: b.getAttribute('data-admin') === '1' }).then(done('Rol cambiado')).catch(fail);
      } else if (act === 'pass') {
        if (mailOn && root.confirm('¿Mandar a ' + email + ' un enlace para elegir contraseña?\n(Cancelar = escribirla tú)')) {
          CP.api('POST', '/api/admin/users/' + id + '/reset').then(done('Enlace enviado a ' + email)).catch(fail);
          return;
        }
        var p = root.prompt('Contraseña nueva para ' + email + ' (mín. 8 caracteres):', genPass());
        if (p) CP.api('PATCH', '/api/admin/users/' + id, { password: p }).then(done('Contraseña cambiada · pásasela: ' + p)).catch(fail);
      } else if (act === 'del') {
        if (root.confirm('¿Borrar la cuenta ' + email + '? Sus partidas abiertas se cierran guardando.')) {
          CP.api('DELETE', '/api/admin/users/' + id).then(done('Cuenta borrada')).catch(fail);
        }
      }
    });
  }

  var started = false, origStart = CP.adminStart;
  CP.adminStart = function () {
    if (!started) { started = true; init(); }
    CP.api('GET', '/api/auth/me').then(function (u) { me = u.id; return load(); }).catch(function () { load(); });
    if (origStart) origStart.apply(this, arguments);
  };
})(window);
