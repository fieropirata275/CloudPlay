/* Cliente HTTP del control plane */
(function (root) {
  'use strict';
  var CP = root.CP = root.CP || {};

  function store(k, v) {
    try {
      if (v === undefined) return root.localStorage.getItem(k);
      if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v);
    } catch (e) { /* almacenamiento bloqueado */ }
    return null;
  }
  CP.store = store;

  CP.serverUrl = function () {
    var s = store('cp_server') || (root.CP_CONFIG && root.CP_CONFIG.server) || '';
    if (!s && root.location.protocol.indexOf('http') === 0) s = root.location.origin;
    return s.replace(/\/+$/, '');
  };
  CP.token = function (t) { return t === undefined ? store('cp_token') : store('cp_token', t); };

  function ApiError(status, message) { this.status = status; this.message = message; }
  ApiError.prototype = Object.create(Error.prototype);
  CP.ApiError = ApiError;

  CP.api = function (method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var tok = CP.token();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    return fetch(CP.serverUrl() + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { detail: txt }; }
        if (!r.ok) {
          var msg = data && data.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : 'Error ' + r.status;
          if (r.status === 401 && path.indexOf('/api/auth/') !== 0) {
            CP.token(null);
            root.location.hash = '#/login';
          }
          throw new ApiError(r.status, msg);
        }
        return data;
      });
    });
  };
})(window);
