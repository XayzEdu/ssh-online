'use strict';
/**
 * Server lokal Xayz SSH Online.
 * Menyediakan: berkas statis, endpoint RPC yang sama dengan Vercel,
 * plus WebSocket untuk terminal interaktif penuh dan tunnel VNC.
 *
 * Jalankan: npm start   (atau klik start.bat di Windows)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { WebSocketServer } = require('ws');

const { handle, buildShellCommand } = require('./lib/api');
const { unseal } = require('./lib/crypto');
const pool = require('./lib/pool');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------------ berkas statis */

function serveStatic(req, res) {
  let pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname.includes('..') || pathname.includes('\0')) {
    res.statusCode = 400;
    return res.end('Permintaan tidak valid.');
  }
  const file = path.join(PUBLIC, pathname);
  if (!file.startsWith(PUBLIC)) {
    res.statusCode = 403;
    return res.end('Terlarang.');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA: arahkan rute tak dikenal ke index.html tanpa memuat ulang sesi
      const index = path.join(PUBLIC, 'index.html');
      return fs.readFile(index, (e2, buf) => {
        if (e2) { res.statusCode = 404; return res.end('Tidak ditemukan.'); }
        res.setHeader('Content-Type', MIME['.html']);
        res.end(buf);
      });
    }
    const ext = path.extname(file).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=3600');
    res.setHeader('Content-Length', st.size);
    // Streaming langsung dari disk: hemat RAM, aman untuk komputer HDD
    fs.createReadStream(file, { highWaterMark: 128 * 1024 }).pipe(res);
  });
}

/* ------------------------------------------------------------------ server */

const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname || '/';
  if (pathname === '/api' || pathname === '/api/' || pathname === '/api/index' || pathname.startsWith('/api/')) {
    return handle(req, res).catch((e) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
      }
      try { res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); } catch {}
    });
  }
  serveStatic(req, res);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

/* --------------------------------------------------------- WebSocket shell */

const wssTerm = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 });
const wssVnc = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
const wssExec = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const { pathname, query } = url.parse(req.url, true);
  if (pathname === '/ws/term') {
    wssTerm.handleUpgrade(req, socket, head, (ws) => openShell(ws, query));
  } else if (pathname === '/ws/vnc') {
    wssVnc.handleUpgrade(req, socket, head, (ws) => openVnc(ws, query));
  } else if (pathname === '/ws/exec') {
    wssExec.handleUpgrade(req, socket, head, (ws) => openExec(ws, query));
  } else {
    socket.destroy();
  }
});

function wsSend(ws, obj) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

async function openShell(ws, query) {
  let creds;
  try {
    creds = unseal(query.token);
  } catch (e) {
    wsSend(ws, { t: 'error', m: e.message });
    return ws.close();
  }

  const cols = Math.min(Math.max(Number(query.cols) || 100, 20), 500);
  const rows = Math.min(Math.max(Number(query.rows) || 30, 5), 200);

  let stream = null;
  let alive = true;

  ws.on('close', () => {
    alive = false;
    try { stream && stream.end(); } catch {}
  });

  try {
    const conn = await pool.acquire(creds);
    if (!alive) return;

    conn.shell(
      { term: 'xterm-256color', cols, rows, modes: {} },
      (err, s) => {
        if (err) {
          wsSend(ws, { t: 'error', m: 'Gagal membuka shell: ' + err.message });
          return ws.close();
        }
        if (!alive) { s.end(); return; }
        stream = s;
        wsSend(ws, { t: 'ready', route: conn.xayzRoute, legacy: !!conn.xayzLegacy });

        s.on('data', (d) => {
          if (ws.readyState === 1) {
            try { ws.send(d); } catch {}
          }
        });
        s.stderr.on('data', (d) => {
          if (ws.readyState === 1) {
            try { ws.send(d); } catch {}
          }
        });
        s.on('close', () => {
          wsSend(ws, { t: 'exit' });
          try { ws.close(); } catch {}
        });
        s.on('error', (e) => wsSend(ws, { t: 'error', m: e.message }));
      }
    );
  } catch (e) {
    wsSend(ws, { t: 'error', m: e.message });
    try { ws.close(); } catch {}
    return;
  }

  ws.on('message', (data, isBinary) => {
    if (!stream) return;
    if (isBinary) {
      try { stream.write(data); } catch {}
      return;
    }
    const text = data.toString();
    if (text.startsWith('\u0000')) {
      // Pesan kontrol JSON
      try {
        const msg = JSON.parse(text.slice(1));
        if (msg.t === 'resize') {
          stream.setWindow(
            Math.min(Math.max(msg.rows | 0, 5), 200),
            Math.min(Math.max(msg.cols | 0, 20), 500),
            0, 0
          );
        } else if (msg.t === 'signal') {
          stream.signal(msg.name || 'INT');
        }
      } catch {}
      return;
    }
    try { stream.write(text); } catch {}
  });
}

async function openVnc(ws, query) {
  let creds;
  try {
    creds = unseal(query.token);
  } catch (e) {
    wsSend(ws, { t: 'error', m: e.message });
    return ws.close();
  }
  const host = query.host || '127.0.0.1';
  const port = Number(query.port) || 5901;
  let stream = null;
  let alive = true;
  // Antrean: noVNC sering mengirim handshake sebelum tunnel selesai dibuka.
  // Tanpa antrean, byte pertama (mis. versi RFB) hilang dan layar tidak muncul.
  let queue = [];
  const MAX_QUEUE = 1 << 20; // 1 MB
  let queued = 0;

  ws.on('close', () => {
    alive = false;
    try { stream && stream.end(); } catch {}
  });

  try {
    const conn = await pool.acquire(creds);
    if (!alive) return;
    conn.forwardOut('127.0.0.1', 0, host, port, (err, s) => {
      if (err) {
        wsSend(ws, { t: 'error', m: `Tidak bisa membuka tunnel ke ${host}:${port} — ${err.message}` });
        return ws.close();
      }
      if (!alive) { s.end(); return; }
      stream = s;
      if (queue.length) {
        for (const chunk of queue) { try { s.write(chunk); } catch {} }
      }
      queue = [];
      queued = 0;
      s.on('data', (d) => {
        if (ws.readyState === 1) { try { ws.send(d, { binary: true }); } catch {} }
      });
      s.on('close', () => { try { ws.close(); } catch {} });
      s.on('error', () => { try { ws.close(); } catch {} });
    });
  } catch (e) {
    wsSend(ws, { t: 'error', m: e.message });
    try { ws.close(); } catch {}
    return;
  }

  ws.on('message', (data) => {
    const buf = Buffer.isBuffer(data)
      ? data
      : (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data));
    if (!buf.length) return;
    if (!stream) {
      if (queued + buf.length <= MAX_QUEUE) { queue.push(buf); queued += buf.length; }
      return;
    }
    try { stream.write(buf); } catch {}
  });
}

/**
 * WebSocket untuk perintah SATU KALI yang bisa berjalan lama (mis. apt install
 * saat pemasangan desktop). Bedanya dengan /ws/term: tidak ada shell interaktif
 * bolak-balik, hanya satu perintah, PTY penuh, dan yang paling penting —
 * TIDAK ADA batas waktu buatan. Selama koneksi WebSocket masih terbuka (yaitu
 * selama tab Anda masih terbuka), perintah boleh berjalan berjam-jam kalau
 * memang perlu, sama seperti sesi SSH biasa di JuiceSSH atau PuTTY.
 *
 * Ini hanya masuk akal di server lokal (Codespaces, komputer sendiri, VPS
 * sendiri) karena Vercel tidak mendukung WebSocket sama sekali — di sana
 * klien otomatis memakai jalur HTTP streaming yang memang dibatasi waktu.
 */
async function openExec(ws, query) {
  let creds;
  try {
    creds = unseal(query.token);
  } catch (e) {
    wsSend(ws, { t: 'error', m: e.message });
    return ws.close();
  }

  let stream = null;
  let alive = true;
  let started = false;

  ws.on('close', () => {
    alive = false;
    try { stream && stream.signal('KILL'); } catch {}
    try { stream && stream.end(); } catch {}
  });

  ws.on('message', (raw) => {
    if (started) {
      // Setelah berjalan, pesan teks dianggap kontrol (mis. hentikan paksa).
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.t === 'stop' && stream) { try { stream.signal('KILL'); } catch {} }
      } catch {}
      return;
    }
    started = true;

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { msg = {}; }
    const command = String(msg.command || '').trim();
    const cwd = msg.cwd || '~';
    const cols = Math.min(Math.max(Number(msg.cols) || 100, 20), 500);
    const rows = Math.min(Math.max(Number(msg.rows) || 30, 5), 200);

    if (!command) {
      wsSend(ws, { t: 'exit', code: 0 });
      return ws.close();
    }

    const full = buildShellCommand(cwd, command);

    (async () => {
      try {
        const conn = await pool.acquire(creds);
        if (!alive) return;

        conn.exec(full, { pty: { cols, rows, term: 'xterm-256color' } }, (err, s) => {
          if (err) {
            wsSend(ws, { t: 'error', m: 'Gagal menjalankan perintah: ' + err.message });
            return ws.close();
          }
          if (!alive) { s.end(); return; }
          stream = s;
          wsSend(ws, { t: 'ready' });

          // Batas keamanan saja (bukan batas produk): mencegah proses yang
          // benar-benar tak berkesudahan menggantung selamanya bila tab
          // ditinggal tanpa ditutup. Jauh lebih longgar daripada 55 detik.
          const safety = setTimeout(() => {
            try { s.signal('KILL'); } catch {}
            if (ws.readyState === 1) {
              ws.send('\r\n\x1b[33m[dihentikan: tidak ada aktivitas selama batas keamanan 45 menit]\x1b[0m\r\n');
            }
          }, Number(process.env.XAYZ_EXEC_TIMEOUT_LOCAL || 45 * 60 * 1000));
          if (safety.unref) safety.unref();

          s.on('data', (d) => {
            if (ws.readyState === 1) { try { ws.send(d); } catch {} }
          });
          s.stderr.on('data', (d) => {
            if (ws.readyState === 1) { try { ws.send(d); } catch {} }
          });
          s.on('close', (code) => {
            clearTimeout(safety);
            wsSend(ws, { t: 'exit', code: code || 0 });
            try { ws.close(); } catch {}
          });
          s.on('error', (e) => {
            clearTimeout(safety);
            wsSend(ws, { t: 'error', m: e.message });
            try { ws.close(); } catch {}
          });
        });
      } catch (e) {
        wsSend(ws, { t: 'error', m: e.message });
        try { ws.close(); } catch {}
      }
    })();
  });
}

/* ------------------------------------------------------------------- start */

server.listen(PORT, HOST, () => {
  const line = '─'.repeat(52);
  console.log(`\n\x1b[36m${line}\x1b[0m`);
  console.log('  \x1b[1mXayz SSH Online\x1b[0m — mode lokal (WebSocket penuh)');
  console.log(`  Buka: \x1b[4mhttp://${HOST}:${PORT}\x1b[0m`);
  console.log(`  Node ${process.version} · terminal, SFTP, dan desktop aktif`);
  console.log(`\x1b[36m${line}\x1b[0m\n`);
});

process.on('SIGINT', () => {
  console.log('\nMenutup server…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});
