/* Lapisan komunikasi ke server + penyimpanan sesi.
   Sesi disimpan ganda (cookie dan localStorage) supaya berpindah halaman
   atau menyegarkan tab tidak pernah meminta login ulang. */
(function (global) {
  'use strict';

  var ENDPOINT = '/api/index';
  var SKEY = 'xayz.session';
  var PKEY = 'xayz.profiles';
  var UKEY = 'xayz.ui';

  /* ------------------------------------------------------------- cookie */

  function setCookie(name, value, days) {
    var exp = new Date(Date.now() + (days || 1) * 864e5).toUTCString();
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; Path=/; Expires=' + exp + '; SameSite=Lax' + secure;
  }
  function getCookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m[2]) : '';
  }
  function delCookie(name) {
    document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax';
  }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  /* ------------------------------------------------------------- sesi */

  var Session = {
    token: '',
    info: null,
    mode: 'local',

    save: function (data) {
      this.token = data.token;
      this.info = data.info || this.info;
      this.mode = data.mode || this.mode;
      setCookie('xayz_session', data.token, 1);
      store(SKEY, { token: data.token, info: this.info, mode: this.mode, at: Date.now() });
      // Cadangan sementara untuk tab ini saja
      try { sessionStorage.setItem(SKEY, data.token); } catch (e) {}
    },

    restore: function () {
      var saved = load(SKEY, null);
      var cookie = getCookie('xayz_session');
      var tab = '';
      try { tab = sessionStorage.getItem(SKEY) || ''; } catch (e) {}
      var token = (saved && saved.token) || cookie || tab;
      if (!token) return false;
      this.token = token;
      this.info = saved ? saved.info : null;
      this.mode = saved ? saved.mode : 'local';
      return true;
    },

    clear: function () {
      this.token = '';
      this.info = null;
      delCookie('xayz_session');
      try { localStorage.removeItem(SKEY); } catch (e) {}
      try { sessionStorage.removeItem(SKEY); } catch (e) {}
    }
  };

  /* -------------------------------------------------------------- RPC */

  function rpc(action, payload, opts) {
    opts = opts || {};
    var body = Object.assign({ action: action }, payload || {});
    if (Session.token && action !== 'connect' && action !== 'ping') {
      body.token = Session.token;
    }
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal: opts.signal
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') === -1) {
        return res.text().then(function (t) {
          if (!res.ok) throw new Error(t.slice(0, 400) || ('HTTP ' + res.status));
          return { ok: true, text: t };
        });
      }
      return res.json().then(function (j) {
        if (!res.ok || j.ok === false) {
          var err = new Error(j.error || ('HTTP ' + res.status));
          err.status = res.status;
          err.payload = j;
          throw err;
        }
        return j;
      });
    });
  }

  /** Jalankan perintah dan terima keluarannya sepotong demi sepotong. */
  function execStream(command, cwd, cols, rows, onChunk, signal) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: signal,
      body: JSON.stringify({
        action: 'exec', token: Session.token,
        command: command, cwd: cwd, cols: cols, rows: rows
      })
    }).then(function (res) {
      if (!res.body || !res.body.getReader) {
        return res.text().then(function (t) { onChunk(t); return t; });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var all = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var tail = decoder.decode();
            if (tail) { all += tail; onChunk(tail); }
            return all;
          }
          var text = decoder.decode(r.value, { stream: true });
          all += text;
          onChunk(text);
          return pump();
        });
      }
      return pump();
    });
  }

  /* --------------------------------------------------------- profil VPS */

  var Profiles = {
    all: function () { return load(PKEY, []); },
    add: function (p) {
      var list = this.all().filter(function (x) {
        return !(x.host === p.host && x.username === p.username && x.port === p.port);
      });
      list.unshift(p);
      store(PKEY, list.slice(0, 8));
    },
    remove: function (i) {
      var list = this.all();
      list.splice(i, 1);
      store(PKEY, list);
    }
  };

  var Prefs = {
    get: function () {
      return load(UKEY, { theme: 'dark', fontSize: 14, showHidden: true, view: 'terminal' });
    },
    set: function (patch) {
      var p = Object.assign(this.get(), patch);
      store(UKEY, p);
      return p;
    }
  };

  global.XayzApi = {
    rpc: rpc,
    execStream: execStream,
    Session: Session,
    Profiles: Profiles,
    Prefs: Prefs,
    endpoint: ENDPOINT
  };
})(window);
