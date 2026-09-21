/* Halaman Terminal.
   Mode lokal  : WebSocket -> shell PTY sungguhan (vim, htop, nano jalan).
   Mode Vercel : perintah dikirim satu per satu, keluaran dialirkan balik
                 dengan warna ANSI utuh dan direktori kerja tetap diingat. */
(function (global) {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/';
  var XTERM_JS = CDN + '@xterm/xterm@5.5.0/lib/xterm.js';
  var XTERM_CSS = CDN + '@xterm/xterm@5.5.0/css/xterm.css';
  var FIT_JS = CDN + '@xterm/addon-fit@0.10.0/lib/addon-fit.js';
  var LINKS_JS = CDN + '@xterm/addon-web-links@0.11.0/lib/addon-web-links.js';

  var THEME_DARK = {
    background: '#12161d', foreground: '#dde3ee', cursor: '#35c2a8',
    cursorAccent: '#12161d', selectionBackground: '#23405a',
    black: '#2a3242', red: '#e2666b', green: '#4fbf7b', yellow: '#e0a341',
    blue: '#6ea3e8', magenta: '#b07be8', cyan: '#35c2a8', white: '#c4ccda',
    brightBlack: '#5d6678', brightRed: '#ef8287', brightGreen: '#6fd396',
    brightYellow: '#f0bb63', brightBlue: '#8cb9f2', brightMagenta: '#c79af0',
    brightCyan: '#5fd6c0', brightWhite: '#f0f4fa'
  };
  var THEME_LIGHT = {
    background: '#ffffff', foreground: '#1d2431', cursor: '#0d8f78',
    cursorAccent: '#ffffff', selectionBackground: '#cfe3f7',
    black: '#3b4252', red: '#c0393e', green: '#2f7d32', yellow: '#9a6a12',
    blue: '#2b5fa8', magenta: '#7a3fb0', cyan: '#0d8f78', white: '#6b7280',
    brightBlack: '#8b93a5', brightRed: '#d9534f', brightGreen: '#3f9d46',
    brightYellow: '#b78320', brightBlue: '#3b77c8', brightMagenta: '#9052c9',
    brightCyan: '#189e87', brightWhite: '#1d2431'
  };

  var host, ready = false;
  var sessions = [];
  var activeId = null;
  var seq = 1;
  var fontSize = 14;

  function loadDeps() {
    if (ready) return Promise.resolve();
    UI.loadStyle(XTERM_CSS);
    return UI.loadScript(XTERM_JS)
      .then(function () {
        return Promise.all([UI.loadScript(FIT_JS), UI.loadScript(LINKS_JS)]);
      })
      .then(function () { ready = true; });
  }

  function theme() {
    return document.body.classList.contains('light') ? THEME_LIGHT : THEME_DARK;
  }

  /* -------------------------------------------------------------- sesi */

  function createSession(name) {
    var id = 's' + (seq++);
    var wrap = document.createElement('div');
    wrap.className = 'term-wrap';
    wrap.id = 'tw_' + id;
    host.appendChild(wrap);

    var term = new global.Terminal({
      fontFamily: getComputedStyle(document.body).getPropertyValue('--mono').trim() || 'monospace',
      fontSize: fontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 4000,          // cukup panjang tapi tetap hemat memori
      allowProposedApi: true,
      convertEol: false,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      theme: theme(),
      windowsMode: false
    });

    var fit = new global.FitAddon.FitAddon();
    term.loadAddon(fit);
    try { term.loadAddon(new global.WebLinksAddon.WebLinksAddon()); } catch (e) {}
    term.open(wrap);

    var s = {
      id: id,
      name: name || 'sesi ' + (sessions.length + 1),
      term: term,
      fit: fit,
      wrap: wrap,
      ws: null,
      mode: XayzApi.Session.mode,
      cwd: (XayzApi.Session.info && XayzApi.Session.info.home) || '~',
      line: '',
      cursor: 0,
      history: [],
      histIdx: -1,
      running: false,
      abort: null,
      connected: false
    };
    sessions.push(s);

    // Salin-tempel ala terminal: Ctrl+Shift+C / V, plus klik kanan tempel
    term.attachCustomKeyEventHandler(function (e) {
      if (e.type !== 'keydown') return true;
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        var sel = term.getSelection();
        if (sel) { navigator.clipboard.writeText(sel); UI.toast('Disalin', 'ok', 1400); }
        return false;
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        navigator.clipboard.readText().then(function (t) { if (t) write(s, t); });
        return false;
      }
      return true;
    });

    if (s.mode === 'local') attachWs(s);
    else attachExec(s);

    term.onData(function (d) { onInput(s, d); });
    term.onResize(function (dim) {
      if (s.ws && s.ws.readyState === 1) {
        s.ws.send('\u0000' + JSON.stringify({ t: 'resize', cols: dim.cols, rows: dim.rows }));
      }
    });

    return s;
  }

  /* ------------------------------------------------------ mode lokal WS */

  function attachWs(s) {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var url = proto + location.host + '/ws/term?token=' +
      encodeURIComponent(XayzApi.Session.token) +
      '&cols=' + (s.term.cols || 100) + '&rows=' + (s.term.rows || 30);

    s.term.writeln('\x1b[2m  menghubungkan ke shell…\x1b[0m');
    var ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    s.ws = ws;

    ws.onopen = function () { s.connected = true; };
    ws.onmessage = function (ev) {
      if (typeof ev.data === 'string') {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { s.term.write(ev.data); return; }
        if (msg.t === 'ready') {
          s.term.write('\x1b[2K\r');
          s.term.write('\x1b[2m  terhubung lewat ' + (msg.route || 'langsung') +
            (msg.legacy ? ' · algoritma lama' : '') + '\x1b[0m\r\n');
          fitSoon(s);
        } else if (msg.t === 'error') {
          s.term.write('\r\n\x1b[31m  ' + msg.m + '\x1b[0m\r\n');
        } else if (msg.t === 'exit') {
          s.term.write('\r\n\x1b[2m  sesi berakhir. Tekan Enter untuk membuka ulang.\x1b[0m\r\n');
          s.connected = false;
        }
        return;
      }
      s.term.write(new Uint8Array(ev.data));
    };
    ws.onerror = function () {
      s.term.write('\r\n\x1b[31m  koneksi WebSocket terputus.\x1b[0m\r\n');
    };
    ws.onclose = function () {
      s.connected = false;
      s.term.write('\r\n\x1b[2m  koneksi ditutup. Tekan Enter untuk menyambung lagi.\x1b[0m\r\n');
    };
  }

  /* ------------------------------------------ mode serverless (exec) --- */

  function prompt(s) {
    var info = XayzApi.Session.info || {};
    var u = info.user || 'user';
    var h = info.hostname || 'vps';
    var home = info.home || '/root';
    var cwd = s.cwd === home ? '~' : (s.cwd || '~').replace(home + '/', '~/');
    var mark = info.isRoot ? '#' : '$';
    return '\x1b[38;2;53;194;168m' + u + '\x1b[0m\x1b[2m@\x1b[0m' +
      '\x1b[38;2;124;140;255m' + h + '\x1b[0m \x1b[38;2;224;163;65m' + cwd + '\x1b[0m ' + mark + ' ';
  }

  function redraw(s) {
    var p = prompt(s);
    s.term.write('\r\x1b[2K' + p + s.line);
    var back = s.line.length - s.cursor;
    if (back > 0) s.term.write('\x1b[' + back + 'D');
  }

  function attachExec(s) {
    var info = XayzApi.Session.info || {};
    s.cwd = info.cwd || info.home || '/root';
    s.term.writeln('\x1b[2m  Mode serverless: perintah dijalankan satu per satu.');
    s.term.writeln('  Aplikasi layar penuh seperti vim atau htop tidak bisa di mode ini —');
    s.term.writeln('  jalankan aplikasi ini di komputer sendiri (npm start) untuk shell penuh.\x1b[0m');
    s.term.writeln('');
    s.connected = true;
    redraw(s);
  }

  function runCommand(s, cmd) {
    s.running = true;
    var controller = new AbortController();
    s.abort = controller;
    var started = Date.now();

    XayzApi.execStream(cmd, s.cwd, s.term.cols, s.term.rows, function (chunk) {
      // Tandai posisi direktori kerja tanpa menampilkannya
      var mark = chunk.indexOf('\u0001XAYZ_CWD:');
      if (mark !== -1) {
        var tail = chunk.slice(mark);
        var m = tail.match(/XAYZ_CWD:([^\u0001]*)\u0001XAYZ_RC:(\d+)/);
        if (m) { s.cwd = m[1]; s.lastCode = Number(m[2]); }
        chunk = chunk.slice(0, mark);
      }
      if (chunk) s.term.write(chunk);
    }, controller.signal)
      .catch(function (e) {
        if (e.name === 'AbortError') {
          s.term.write('\r\n\x1b[33m^C dibatalkan\x1b[0m');
        } else {
          s.term.write('\r\n\x1b[31m' + e.message + '\x1b[0m');
        }
      })
      .then(function () {
        s.running = false;
        s.abort = null;
        var ms = Date.now() - started;
        if (ms > 3000) s.term.write('\x1b[2m  (' + (ms / 1000).toFixed(1) + ' detik)\x1b[0m');
        s.term.write('\r\n');
        redraw(s);
      });
  }

  function handleExecKey(s, data) {
    // Saat perintah berjalan, hanya Ctrl+C yang diproses
    if (s.running) {
      if (data === '\u0003' && s.abort) s.abort.abort();
      return;
    }

    for (var i = 0; i < data.length; i++) {
      var ch = data[i];

      if (ch === '\r') {
        var cmd = s.line.trim();
        s.term.write('\r\n');
        s.line = ''; s.cursor = 0; s.histIdx = -1;
        if (!cmd) { redraw(s); continue; }
        if (cmd === 'clear' || cmd === 'cls') { s.term.clear(); redraw(s); continue; }
        if (cmd === 'exit' || cmd === 'logout') {
          s.term.write('\x1b[2m  gunakan tombol Putus di bilah kiri untuk mengakhiri sesi.\x1b[0m\r\n');
          redraw(s); continue;
        }
        s.history.unshift(cmd);
        if (s.history.length > 200) s.history.pop();
        runCommand(s, cmd);
        return;
      }

      if (ch === '\u007f' || ch === '\b') {
        if (s.cursor > 0) {
          s.line = s.line.slice(0, s.cursor - 1) + s.line.slice(s.cursor);
          s.cursor--;
          redraw(s);
        }
        continue;
      }

      if (ch === '\u0003') { // Ctrl+C
        s.term.write('^C\r\n');
        s.line = ''; s.cursor = 0;
        redraw(s);
        continue;
      }
      if (ch === '\u000c') { s.term.clear(); redraw(s); continue; }   // Ctrl+L
      if (ch === '\u0001') { s.cursor = 0; redraw(s); continue; }      // Ctrl+A
      if (ch === '\u0005') { s.cursor = s.line.length; redraw(s); continue; } // Ctrl+E
      if (ch === '\u0015') { s.line = s.line.slice(s.cursor); s.cursor = 0; redraw(s); continue; } // Ctrl+U
      if (ch === '\u000b') { s.line = s.line.slice(0, s.cursor); redraw(s); continue; } // Ctrl+K
      if (ch === '\u0017') { // Ctrl+W
        var left = s.line.slice(0, s.cursor).replace(/\S+\s*$/, '');
        s.line = left + s.line.slice(s.cursor);
        s.cursor = left.length;
        redraw(s);
        continue;
      }

      if (ch === '\u001b') { // urutan escape (panah)
        var rest = data.slice(i);
        if (rest.startsWith('\u001b[A')) {           // atas
          if (s.history.length) {
            s.histIdx = Math.min(s.histIdx + 1, s.history.length - 1);
            s.line = s.history[s.histIdx]; s.cursor = s.line.length; redraw(s);
          }
          i += 2; continue;
        }
        if (rest.startsWith('\u001b[B')) {           // bawah
          s.histIdx--;
          if (s.histIdx < 0) { s.histIdx = -1; s.line = ''; }
          else s.line = s.history[s.histIdx];
          s.cursor = s.line.length; redraw(s);
          i += 2; continue;
        }
        if (rest.startsWith('\u001b[C')) { if (s.cursor < s.line.length) { s.cursor++; s.term.write('\x1b[C'); } i += 2; continue; }
        if (rest.startsWith('\u001b[D')) { if (s.cursor > 0) { s.cursor--; s.term.write('\x1b[D'); } i += 2; continue; }
        if (rest.startsWith('\u001b[H')) { s.cursor = 0; redraw(s); i += 2; continue; }
        if (rest.startsWith('\u001b[F')) { s.cursor = s.line.length; redraw(s); i += 2; continue; }
        if (rest.startsWith('\u001b[3~')) {
          if (s.cursor < s.line.length) {
            s.line = s.line.slice(0, s.cursor) + s.line.slice(s.cursor + 1);
            redraw(s);
          }
          i += 3; continue;
        }
        i += rest.length - 1;
        continue;
      }

      if (ch === '\t') { continue; } // penyelesaian otomatis tidak tersedia di mode ini

      if (ch >= ' ' || ch === '\n') {
        s.line = s.line.slice(0, s.cursor) + ch + s.line.slice(s.cursor);
        s.cursor++;
        if (s.cursor === s.line.length) s.term.write(ch);
        else redraw(s);
      }
    }
  }

  function onInput(s, data) {
    if (s.mode === 'local') {
      if (!s.connected) {
        if (data === '\r') { s.term.clear(); attachWs(s); }
        return;
      }
      if (s.ws && s.ws.readyState === 1) s.ws.send(data);
      return;
    }
    handleExecKey(s, data);
  }

  function write(s, text) {
    if (s.mode === 'local') {
      if (s.ws && s.ws.readyState === 1) s.ws.send(text);
    } else {
      handleExecKey(s, text);
    }
  }

  /* --------------------------------------------------------- tata letak */

  function fitSoon(s) {
    requestAnimationFrame(function () {
      try {
        s.fit.fit();
        if (s.ws && s.ws.readyState === 1) {
          s.ws.send('\u0000' + JSON.stringify({ t: 'resize', cols: s.term.cols, rows: s.term.rows }));
        }
      } catch (e) {}
    });
  }

  function renderTabs() {
    var bar = document.getElementById('termTabs');
    bar.innerHTML = '';
    sessions.forEach(function (s) {
      var t = document.createElement('div');
      t.className = 'tab' + (s.id === activeId ? ' active' : '');
      var b = document.createElement('b');
      b.textContent = s.name;
      t.appendChild(b);
      if (sessions.length > 1) {
        var x = document.createElement('i');
        x.textContent = '×';
        x.title = 'Tutup sesi';
        x.onclick = function (e) { e.stopPropagation(); closeSession(s.id); };
        t.appendChild(x);
      }
      t.onclick = function () { activate(s.id); };
      bar.appendChild(t);
    });
  }

  function activate(id) {
    activeId = id;
    sessions.forEach(function (s) {
      s.wrap.hidden = s.id !== id;
    });
    renderTabs();
    var s = current();
    if (s) { fitSoon(s); setTimeout(function () { s.term.focus(); }, 30); }
  }

  function closeSession(id) {
    var i = sessions.findIndex(function (s) { return s.id === id; });
    if (i === -1) return;
    var s = sessions[i];
    try { s.ws && s.ws.close(); } catch (e) {}
    try { s.abort && s.abort.abort(); } catch (e) {}
    try { s.term.dispose(); } catch (e) {}
    s.wrap.remove();
    sessions.splice(i, 1);
    if (!sessions.length) { newSession(); return; }
    activate(sessions[Math.max(0, i - 1)].id);
  }

  function current() {
    return sessions.find(function (s) { return s.id === activeId; }) || sessions[0];
  }

  function newSession() {
    return loadDeps().then(function () {
      var s = createSession();
      activate(s.id);
      fitSoon(s);
      return s;
    }).catch(function (e) {
      UI.toast(e.message, 'err');
    });
  }

  /* ---------------------------------------------------------- API luar */

  function init(prefs) {
    host = document.getElementById('termHost');
    fontSize = prefs.fontSize || 14;
    window.addEventListener('resize', function () {
      var s = current();
      if (s) fitSoon(s);
    });
    return newSession();
  }

  function setFontSize(px) {
    fontSize = Math.max(9, Math.min(28, px));
    sessions.forEach(function (s) {
      s.term.options.fontSize = fontSize;
      fitSoon(s);
    });
    return fontSize;
  }

  function applyTheme() {
    sessions.forEach(function (s) { s.term.options.theme = theme(); });
  }

  function sendKey(seqStr) {
    var s = current();
    if (!s) return;
    write(s, seqStr);
    s.term.focus();
  }

  function sendSignal(name) {
    var s = current();
    if (!s) return;
    if (s.mode === 'local' && s.ws && s.ws.readyState === 1) {
      s.ws.send('\u0000' + JSON.stringify({ t: 'signal', name: name }));
    } else if (s.abort) {
      s.abort.abort();
    }
  }

  function clear() {
    var s = current();
    if (!s) return;
    s.term.clear();
    if (s.mode === 'serverless') redraw(s);
  }

  function runInTerminal(cmd) {
    var s = current();
    if (!s) return;
    if (s.mode === 'local') write(s, cmd + '\n');
    else {
      s.line = cmd; s.cursor = cmd.length;
      redraw(s);
      handleExecKey(s, '\r');
    }
  }

  function focus() {
    var s = current();
    if (s) { fitSoon(s); s.term.focus(); }
  }

  function disposeAll() {
    sessions.slice().forEach(function (s) {
      try { s.ws && s.ws.close(); } catch (e) {}
      try { s.abort && s.abort.abort(); } catch (e) {}
      try { s.term.dispose(); } catch (e) {}
      s.wrap.remove();
    });
    sessions.length = 0;
    activeId = null;
  }

  global.XayzTerm = {
    init: init, newSession: newSession, setFontSize: setFontSize,
    applyTheme: applyTheme, sendKey: sendKey, sendSignal: sendSignal,
    clear: clear, focus: focus, runInTerminal: runInTerminal,
    disposeAll: disposeAll,
    get fontSize() { return fontSize; }
  };
})(window);
