/* Panel del NOC: métricas, nodos y sesiones en vivo (refresco cada 5 s). */
(function (root) {
  'use strict';
  var CP = root.CP;
  var timer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ago(iso) {
    if (!iso) return '—';
    var t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'hace ' + s + ' s';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    return 'hace ' + Math.round(s / 3600) + ' h';
  }
  var STATE = { online: 'En línea', offline: 'Sin conexión', queued: 'En cola', starting: 'Arrancando', running: 'Jugando', ending: 'Cerrando', pending: 'Pendiente' };

  function kpi(id, value, label, cls) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.innerHTML = '<b>0</b><span></span>';
      document.getElementById('kpis').appendChild(el);
    }
    el.className = 'kpi ' + (cls || '');
    el.lastChild.textContent = label;
    CP.fx.count(el.firstChild, value);
  }

  function refresh() {
    return Promise.all([
      CP.api('GET', '/api/admin/stats'),
      CP.api('GET', '/api/admin/nodes'),
      CP.api('GET', '/api/admin/sessions')
    ]).then(function (r) {
      var st = r[0], nodes = r[1], sessions = r[2];
      kpi('k-nodes', st.nodes_online, 'nodos en línea de ' + st.nodes_total, st.nodes_online < st.nodes_total ? 'warn' : '');
      kpi('k-cap', st.capacity_online - st.placed, 'huecos libres de ' + st.capacity_online, st.capacity_online && st.placed >= st.capacity_online ? 'warn' : '');
      kpi('k-play', st.placed, 'partidas en curso');
      kpi('k-queue', st.queued, 'en la cola', st.queued ? 'warn' : '');
      kpi('k-24', st.sessions_24h, 'partidas en 24 h');
      kpi('k-fail', st.failed_24h, 'fallidas en 24 h', st.failed_24h ? 'bad' : '');

      document.querySelector('#nodes-table tbody').innerHTML = nodes.length ? nodes.map(function (n) {
        var pct = n.capacity ? Math.round(n.load / n.capacity * 100) : 0;
        return '<tr><td><strong>' + esc(n.name) + '</strong></td>' +
          '<td><span class="state ' + esc(n.status) + '">' + esc(STATE[n.status] || n.status) + '</span></td>' +
          '<td>' + esc(n.gpu) + '</td><td>' + esc(n.platforms.join(', ')) + '</td>' +
          '<td class="num"><span class="load' + (pct >= 100 ? ' full' : '') + '"><i style="width:' + pct + '%"></i></span>' + n.load + ' / ' + n.capacity + '</td>' +
          '<td>' + ago(n.last_seen) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">Ningún nodo dado de alta. Crea uno con <code>python -m app.cli create-node</code>.</td></tr>';

      document.querySelector('#sessions-table tbody').innerHTML = sessions.length ? sessions.map(function (s) {
        var st2 = STATE[s.status] || s.status;
        if (s.status === 'queued' && s.queue_position) st2 += ' (' + s.queue_position + 'º)';
        return '<tr><td>' + esc(s.user) + '</td><td>' + esc(s.game) + '</td>' +
          '<td><span class="state ' + esc(s.status) + '">' + esc(st2) + '</span></td>' +
          '<td>' + esc(s.node || '—') + '</td><td>' + ago(s.started_at || s.created_at) + '</td>' +
          '<td><button class="btn quiet" data-kill="' + esc(s.id) + '">Cerrar</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">Nadie jugando ahora mismo.</td></tr>';

      document.getElementById('admin-updated').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-ES');
    }).catch(function (e) { CP.toast(e.message); });
  }

  document.getElementById('sessions-table').addEventListener('click', function (e) {
    var id = e.target.getAttribute && e.target.getAttribute('data-kill');
    if (!id) return;
    e.target.disabled = true;
    CP.api('DELETE', '/api/admin/sessions/' + id).then(function () { CP.toast('Partida cerrada'); refresh(); });
  });

  CP.adminStart = function () {
    CP.adminStop();
    refresh();
    timer = setInterval(refresh, 5000);
  };
  CP.adminStop = function () { if (timer) { clearInterval(timer); timer = null; } };
})(window);
