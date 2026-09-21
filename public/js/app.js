/* Perekat aplikasi: formulir koneksi, perpindahan antar halaman tanpa memuat
   ulang, papan tombol bantu untuk ponsel, tema, dan layar penuh. */
(function (global) {
  'use strict';

  var prefs = XayzApi.Prefs.get();
  var started = { terminal: false, files: false, desktop: false };
  var currentView = 'terminal';
  var keepaliveTimer = null;

  /* ------------------------------------------------------------- utilitas */

  function $(id) { return document.getElementById(id); }

  function serverMode() {
    return XayzApi.rpc('ping').then(function (r) {
      XayzApi.Session.mode = r.mode;
      return r;
    }).catch(function () {
      return { mode: 'local', ws: true };
    });
  }

  /* --------------------------------------------------------------- login */

  function parseJump(text) {
    if (!text.trim()) return [];
    return text.split(',').map(function (part) {
      part = part.trim();
      if (!part) return null;
      var m = part.match(/^(?:([^:@]+)(?::([^@]*))?@)?([^:]+)(?::(\d+))?$/);
      if (!m) return null;
      return {
        username: m[1] || 'root',
        password: m[2] || '',
        host: m[3],
        port: Number(m[4]) || 22
      };
    }).filter(Boolean);
  }

  function collectForm() {
    var type = $('f_proxytype').value;
    return {
      host: $('f_host').value.trim(),
      port: Number($('f_port').value) || 22,
      username: $('f_user').value.trim() || 'root',
      password: $('f_pass').value,
      privateKey: $('f_key').value.trim() || undefined,
      passphrase: $('f_passphrase').value || undefined,
      proxy: type === 'none' ? { type: 'none' } : {
        type: type,
        host: $('f_proxyhost').value.trim(),
        port: Number($('f_proxyport').value) || (type === 'http' ? 8080 : 1080),
        username: $('f_proxyuser').value.trim() || undefined,
        password: $('f_proxypass').value || undefined
      },
      jump: parseJump($('f_jump').value)
    };
  }

  function showError(msg) {
    var box = $('gateError');
    box.hidden = !msg;
    box.textContent = msg || '';
  }

  function doConnect(creds) {
    var btn = $('connectBtn');
    btn.disabled = true;
    btn.querySelector('.spinner').hidden = false;
    btn.querySelector('.btn-label').textContent = 'Menghubungkan…';
    showError('');

    return XayzApi.rpc('connect', creds)
      .then(function (r) {
        XayzApi.Session.save(r);
        if ($('f_remember').checked) {
          XayzApi.Profiles.add({
            host: creds.host, port: creds.port, username: creds.username,
            proxy: creds.proxy, jump: creds.jump,
            label: r.info.os
          });
        }
        enterApp(r);
      })
      .catch(function (e) {
        showError(e.message + (e.payload && e.payload.raw ? '\n\n' + e.payload.raw : ''));
      })
      .then(function () {
        btn.disabled = false;
        btn.querySelector('.spinner').hidden = true;
        btn.querySelector('.btn-label').textContent = 'Hubungkan';
      });
  }

  function renderSaved() {
    var list = XayzApi.Profiles.all();
    $('savedList').hidden = !list.length;
    var box = $('savedItems');
    box.innerHTML = '';
    list.forEach(function (p, i) {
      var row = UI.el('div', 'saved-item');
      var b = UI.el('b', null, p.username + '@' + p.host + ':' + p.port);
      var use = UI.el('button', null, 'Pakai');
      var del = UI.el('button', 'del', 'Hapus');
      use.onclick = function () {
        $('f_host').value = p.host;
        $('f_port').value = p.port;
        $('f_user').value = p.username;
        if (p.proxy && p.proxy.type !== 'none') {
          $('f_proxytype').value = p.proxy.type;
          $('f_proxyhost').value = p.proxy.host || '';
          $('f_proxyport').value = p.proxy.port || '';
          syncProxyFields();
          $('advNet').open = true;
        }
        if (p.jump && p.jump.length) {
          $('f_jump').value = p.jump.map(function (j) {
            return j.username + '@' + j.host + ':' + j.port;
          }).join(', ');
          $('advNet').open = true;
        }
        $('f_pass').focus();
      };
      del.onclick = function () { XayzApi.Profiles.remove(i); renderSaved(); };
      row.appendChild(b); row.appendChild(use); row.appendChild(del);
      box.appendChild(row);
    });
  }

  function syncProxyFields() {
    var type = $('f_proxytype').value;
    var show = type !== 'none';
    document.querySelectorAll('.proxy-only').forEach(function (n) {
      n.classList.toggle('hidden', !show);
    });
    if (show && !$('f_proxyport').value) {
      $('f_proxyport').value = type === 'http' ? '8080' : '1080';
    }
  }

  /* ---------------------------------------------------------- masuk app */

  function enterApp(session) {
    $('gate').hidden = true;
    $('app').hidden = false;
    document.body.dataset.view = 'app';

    var info = session.info || XayzApi.Session.info || {};
    $('connWho').textContent = (info.user || '?') + '@' + (info.hostname || '?');
    $('connOs').textContent = info.os || '';
    $('connDot').className = 'dot on';
    $('modeTag').textContent = XayzApi.Session.mode === 'local'
      ? 'shell penuh' : 'mode serverless';

    if (session.route && session.route !== 'langsung') {
      UI.toast('Terhubung lewat ' + session.route, 'ok', 4000);
    }
    if (session.legacy) {
      UI.toast('VPS memakai algoritma SSH lama. Koneksi tetap jalan tapi sebaiknya perbarui OpenSSH.', 'warn', 7000);
    }

    // Selalu mulai dari Terminal. Halaman Tampilan hanya terbuka kalau
    // pengguna sendiri yang menekannya.
    setView('terminal');

    // Jaga sesi tetap hidup supaya koneksi tidak diputus server
    clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(function () {
      XayzApi.rpc('keepalive').catch(function () {});
    }, 45000);
  }

  function setView(view) {
    currentView = view;
    ['terminal', 'files', 'desktop'].forEach(function (v) {
      $('view-' + v).hidden = v !== view;
    });
    document.querySelectorAll('.rail-btn[data-view]').forEach(function (b) {
      var on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    XayzApi.Prefs.set({ view: view });
    try { history.replaceState(null, '', '#' + view); } catch (e) {}

    if (view === 'terminal') {
      if (!started.terminal) { started.terminal = true; XayzTerm.init(prefs); }
      else XayzTerm.focus();
    } else if (view === 'files') {
      if (!started.files) { started.files = true; XayzFiles.init(prefs); }
    } else if (view === 'desktop') {
      if (!started.desktop) { started.desktop = true; XayzDesktop.init(); }
    }
  }

  function logout() {
    UI.confirm('Putuskan koneksi?', 'Sesi terminal, berkas, dan layar akan ditutup.', 'Putuskan', true)
      .then(function (yes) {
        if (!yes) return;
        clearInterval(keepaliveTimer);
        try { XayzTerm.disposeAll(); } catch (e) {}
        try { XayzDesktop.disconnect(); } catch (e) {}
        XayzApi.rpc('disconnect').catch(function () {});
        XayzApi.Session.clear();
        location.hash = '';
        location.reload();
      });
  }

  /* ------------------------------------------------- papan tombol bantu */

  var KEYPAD = [
    ['Esc', '\u001b'], ['Tab', '\t'], ['Ctrl', 'MOD:ctrl'], ['Alt', 'MOD:alt'],
    ['↑', '\u001b[A'], ['↓', '\u001b[B'], ['←', '\u001b[D'], ['→', '\u001b[C'],
    ['Home', '\u001b[H'], ['End', '\u001b[F'], ['PgUp', '\u001b[5~'], ['PgDn', '\u001b[6~'],
    ['^C', '\u0003'], ['^D', '\u0004'], ['^Z', '\u001a'], ['^L', '\u000c'],
    ['^R', '\u0012'], ['^A', '\u0001'], ['^E', '\u0005'], ['^K', '\u000b'],
    ['/', '/'], ['-', '-'], ['_', '_'], ['|', '|'], ['~', '~'], ['*', '*'],
    ['$', '$'], ['&', '&'], ['"', '"'], ["'", "'"], ['`', '`'], [';', ';'],
    ['{', '{'], ['}', '}'], ['[', '['], [']', ']'], ['<', '<'], ['>', '>'],
    ['F1', '\u001bOP'], ['F2', '\u001bOQ'], ['F3', '\u001bOR'], ['F4', '\u001bOS'],
    ['F5', '\u001b[15~'], ['F6', '\u001b[17~'], ['F7', '\u001b[18~'], ['F8', '\u001b[19~'],
    ['F9', '\u001b[20~'], ['F10', '\u001b[21~'], ['F11', '\u001b[23~'], ['F12', '\u001b[24~']
  ];

  var mods = { ctrl: false, alt: false };

  function buildKeypad() {
    var pad = $('keypad');
    pad.innerHTML = '';
    KEYPAD.forEach(function (k) {
      var b = UI.el('button', null, k[0]);
      b.type = 'button';
      b.onclick = function () {
        if (k[1].startsWith('MOD:')) {
          var name = k[1].slice(4);
          mods[name] = !mods[name];
          b.classList.toggle('sticky-on', mods[name]);
          return;
        }
        var seq = k[1];
        if (mods.ctrl && seq.length === 1 && /[a-z]/i.test(seq)) {
          seq = String.fromCharCode(seq.toUpperCase().charCodeAt(0) - 64);
        }
        if (mods.alt) seq = '\u001b' + seq;
        mods.ctrl = false; mods.alt = false;
        pad.querySelectorAll('.sticky-on').forEach(function (n) { n.classList.remove('sticky-on'); });
        XayzTerm.sendKey(seq);
      };
      pad.appendChild(b);
    });
  }

  /* ----------------------------------------------------------------- init */

  function bindApp() {
    document.querySelectorAll('.rail-btn[data-view]').forEach(function (b) {
      b.onclick = function () { setView(b.dataset.view); };
    });

    $('logoutBtn').onclick = logout;

    $('themeBtn').onclick = function () {
      var light = document.body.classList.toggle('light');
      XayzApi.Prefs.set({ theme: light ? 'light' : 'dark' });
      document.querySelector('meta[name=theme-color]').content = light ? '#f4f6fa' : '#12161d';
      if (started.terminal) XayzTerm.applyTheme();
    };

    $('newTermBtn').onclick = function () { XayzTerm.newSession(); };
    $('clearTermBtn').onclick = function () { XayzTerm.clear(); };

    $('fontPlus').onclick = function () {
      var s = XayzTerm.setFontSize(XayzTerm.fontSize + 1);
      $('fontSizeLabel').textContent = s;
      XayzApi.Prefs.set({ fontSize: s });
    };
    $('fontMinus').onclick = function () {
      var s = XayzTerm.setFontSize(XayzTerm.fontSize - 1);
      $('fontSizeLabel').textContent = s;
      XayzApi.Prefs.set({ fontSize: s });
    };
    $('fontSizeLabel').textContent = prefs.fontSize || 14;

    $('keysBtn').onclick = function () {
      var pad = $('keypad');
      pad.hidden = !pad.hidden;
      this.classList.toggle('on', !pad.hidden);
      XayzTerm.focus();
    };

    $('termFsBtn').onclick = function () {
      UI.fullscreen($('view-terminal'));
      setTimeout(function () { XayzTerm.focus(); }, 200);
    };
    $('dFsBtn').onclick = function () { UI.fullscreen($('view-desktop')); };

    $('statsBtn').onclick = function () {
      UI.progress('Membaca status VPS…', 0.5);
      XayzApi.rpc('fileop', { op: 'disk', path: '/' }).then(function (r) {
        UI.progress(null);
        var info = XayzApi.Session.info || {};
        UI.modal({
          title: 'Status VPS',
          text: [
            info.os || '',
            info.kernel || '',
            'Pengguna: ' + (info.user || '') + (info.isRoot ? ' (root)' : ''),
            'Shell: ' + (info.shell || ''),
            '',
            (r.stdout || '').trim()
          ].join('\n'),
          okText: 'Tutup'
        });
      }).catch(function (e) {
        UI.progress(null);
        UI.toast(e.message, 'err');
      });
    };

    // Pintasan global
    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === '1') { e.preventDefault(); setView('terminal'); }
        if (e.key === '2') { e.preventDefault(); setView('files'); }
        if (e.key === '3') { e.preventDefault(); setView('desktop'); }
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't') && currentView === 'terminal') {
        e.preventDefault();
        XayzTerm.newSession();
      }
    });

    // Tombol bantu otomatis tampil di perangkat sentuh
    buildKeypad();
    var touch = matchMedia('(pointer: coarse)').matches;
    if (touch) {
      $('keypad').hidden = false;
      $('keysBtn').classList.add('on');
    }

    window.addEventListener('beforeunload', function () {
      // Sesi sengaja tidak diputus: token tetap tersimpan supaya tidak perlu login ulang
      clearInterval(keepaliveTimer);
    });
  }

  function bindGate() {
    $('connectForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var creds = collectForm();
      if (!creds.host) return showError('IP atau host VPS wajib diisi.');
      if (!creds.password && !creds.privateKey) {
        return showError('Isi password, atau tempelkan private key di bagian lanjutan.');
      }
      doConnect(creds);
    });

    $('pwToggle').onclick = function () {
      var i = $('f_pass');
      i.type = i.type === 'password' ? 'text' : 'password';
      this.textContent = i.type === 'password' ? 'Lihat' : 'Sembunyi';
    };

    $('f_proxytype').onchange = syncProxyFields;

    $('f_keyfile').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        $('f_key').value = String(fr.result);
        UI.toast('Private key dimuat dari ' + f.name, 'ok');
      };
      fr.readAsText(f);
    };

    renderSaved();
  }

  function describeMode(mode) {
    return mode === 'local'
      ? 'Mode lokal · terminal penuh, SFTP, dan tampilan desktop aktif'
      : 'Mode serverless · terminal perintah dan SFTP aktif, shell interaktif hanya di mode lokal';
  }

  /** Sesi lama tidak pernah langsung membuka aplikasi. Pengguna selalu melihat
   *  layar login dulu, dengan satu tombol untuk melanjutkan tanpa mengetik ulang. */
  function showResume() {
    var info = XayzApi.Session.info || {};
    var card = $('resumeCard');
    card.hidden = false;
    $('resumeWho').textContent = (info.user || 'pengguna') + '@' + (info.hostname || 'vps');
    $('resumeNote').textContent = 'Sesi sebelumnya masih tersimpan. Tekan Lanjutkan untuk masuk tanpa login ulang.';

    $('resumeBtn').onclick = function () {
      var b = this;
      b.disabled = true;
      b.textContent = 'Memeriksa…';
      XayzApi.rpc('keepalive').then(function () {
        if (!XayzApi.Session.info) {
          XayzApi.Session.info = { user: 'pengguna', hostname: 'vps', home: '/root' };
        }
        enterApp({ info: XayzApi.Session.info, mode: XayzApi.Session.mode });
      }).catch(function (e) {
        XayzApi.Session.clear();
        card.hidden = true;
        showError('Sesi sebelumnya tidak bisa dilanjutkan: ' + e.message + ' Silakan login lagi.');
        $('f_host').focus();
      }).then(function () {
        b.disabled = false;
        b.textContent = 'Lanjutkan';
      });
    };

    $('resumeDrop').onclick = function () {
      XayzApi.rpc('disconnect').catch(function () {});
      XayzApi.Session.clear();
      card.hidden = true;
      $('f_host').focus();
    };
  }

  function boot() {
    if (prefs.theme === 'light') {
      document.body.classList.add('light');
      document.querySelector('meta[name=theme-color]').content = '#f4f6fa';
    }

    bindGate();
    bindApp();

    // Layar login selalu yang pertama muncul, apa pun isi penyimpanan.
    $('gate').hidden = false;
    $('app').hidden = true;

    serverMode().then(function (r) {
      $('gateMode').textContent = describeMode(r.mode);
      if (XayzApi.Session.restore()) showResume();
      else if (!matchMedia('(pointer: coarse)').matches) $('f_host').focus();
    });
  }

  global.XayzApp = { setView: setView, logout: logout };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
