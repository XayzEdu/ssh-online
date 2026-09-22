'use strict';
/**
 * Satu endpoint RPC dipakai oleh server lokal maupun fungsi serverless Vercel.
 * Semua permintaan: POST JSON { action, token, ...args }
 */
const { seal, unseal } = require('./crypto');
const pool = require('./pool');
const { exec } = require('./ssh');

const MAX_BODY = 6 * 1024 * 1024;

/* ---------------------------------------------------------------- utilitas */

function q(str) {
  return "'" + String(str).replace(/'/g, "'\\''") + "'";
}

function isServerless() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string' && req.body.length) {
      try { return resolve(JSON.parse(req.body)); } catch (e) { return reject(new Error('JSON tidak valid.')); }
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Data terlalu besar. Kecilkan ukuran potongan unggahan.'));
        try { req.destroy(); } catch {}
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Body bukan JSON yang valid.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function attrsToEntry(name, attrs, path) {
  const mode = attrs.mode || 0;
  const type =
    (mode & 0o170000) === 0o040000 ? 'dir' :
    (mode & 0o170000) === 0o120000 ? 'link' :
    (mode & 0o170000) === 0o010000 ? 'fifo' :
    (mode & 0o170000) === 0o140000 ? 'socket' :
    (mode & 0o170000) === 0o060000 ? 'block' :
    (mode & 0o170000) === 0o020000 ? 'char' : 'file';
  return {
    name,
    path,
    type,
    size: attrs.size || 0,
    mtime: attrs.mtime || 0,
    atime: attrs.atime || 0,
    uid: attrs.uid,
    gid: attrs.gid,
    mode: mode & 0o7777,
    modeStr: modeString(mode),
    hidden: name.startsWith('.'),
  };
}

function modeString(mode) {
  const t =
    (mode & 0o170000) === 0o040000 ? 'd' :
    (mode & 0o170000) === 0o120000 ? 'l' :
    (mode & 0o170000) === 0o010000 ? 'p' :
    (mode & 0o170000) === 0o140000 ? 's' :
    (mode & 0o170000) === 0o060000 ? 'b' :
    (mode & 0o170000) === 0o020000 ? 'c' : '-';
  const rwx = (n) => (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-');
  return t + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

function sftpCall(sftpClient, method, args) {
  return new Promise((resolve, reject) => {
    sftpClient[method](...args, (err, result) => {
      if (err) {
        const msg = String(err.message || err);
        let friendly = msg;
        if (/No such file/i.test(msg)) friendly = 'Berkas atau folder tidak ditemukan.';
        else if (/Permission denied/i.test(msg)) friendly = 'Akses ditolak. Butuh hak akses lebih tinggi (sudo/root).';
        else if (/Failure/i.test(msg)) friendly = 'Operasi ditolak server (mungkin folder tidak kosong atau nama sudah dipakai).';
        const e = new Error(friendly);
        e.raw = msg;
        return reject(e);
      }
      resolve(result);
    });
  });
}

/* ------------------------------------------------------------- aksi sistem */

async function doConnect(body) {
  const creds = {
    host: body.host,
    port: body.port,
    username: body.username,
    password: body.password,
    privateKey: body.privateKey,
    passphrase: body.passphrase,
    proxy: body.proxy,
    jump: body.jump,
  };
  const conn = await pool.acquire(creds);

  const info = await exec(
    conn,
    'printf "%s\\n" "$(id -un 2>/dev/null)" "$(id -u 2>/dev/null)" "$(pwd 2>/dev/null)" ' +
      '"$(hostname 2>/dev/null)" "$(uname -srm 2>/dev/null)" ' +
      '"$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || echo Linux)" ' +
      '"$(echo $SHELL)" "$HOME"'
  ).catch(() => ({ stdout: '' }));

  const L = info.stdout.split('\n');
  const token = seal({ ...creds, iat: Date.now() });

  return {
    ok: true,
    token,
    mode: isServerless() ? 'serverless' : 'local',
    banner: (conn.xayzBanner || '').slice(0, 2000),
    route: conn.xayzRoute || 'langsung',
    legacy: !!conn.xayzLegacy,
    info: {
      user: L[0] || creds.username,
      uid: L[1] || '',
      cwd: L[2] || '/root',
      hostname: L[3] || creds.host,
      kernel: L[4] || '',
      os: L[5] || 'Linux',
      shell: L[6] || '/bin/bash',
      home: L[7] || (L[0] === 'root' ? '/root' : `/home/${creds.username}`),
      isRoot: L[1] === '0',
    },
  };
}

async function sftpAction(creds, body) {
  const op = body.op;
  const sftpClient = await pool.acquireSftp(creds);

  switch (op) {
    case 'list': {
      const path = body.path || '.';
      const real = await sftpCall(sftpClient, 'realpath', [path]);
      const rows = await sftpCall(sftpClient, 'readdir', [real]);
      const base = real.endsWith('/') ? real : real + '/';
      const items = rows.map((r) => {
        const e = attrsToEntry(r.filename, r.attrs, base + r.filename);
        if (e.type === 'link') e.longname = r.longname;
        return e;
      });
      // Tandai symlink yang menunjuk ke direktori supaya bisa dibuka
      await Promise.all(
        items.filter((i) => i.type === 'link').map(async (i) => {
          try {
            const st = await sftpCall(sftpClient, 'stat', [i.path]);
            i.linkType = (st.mode & 0o170000) === 0o040000 ? 'dir' : 'file';
          } catch { i.linkType = 'broken'; }
        })
      );
      items.sort((a, b) => {
        const ad = a.type === 'dir' || a.linkType === 'dir';
        const bd = b.type === 'dir' || b.linkType === 'dir';
        if (ad !== bd) return ad ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      return { ok: true, path: real, parent: real === '/' ? '/' : real.replace(/\/[^/]+\/?$/, '') || '/', items };
    }

    case 'stat': {
      const st = await sftpCall(sftpClient, 'stat', [body.path]);
      return { ok: true, stat: attrsToEntry(body.path.split('/').pop(), st, body.path) };
    }

    case 'realpath':
      return { ok: true, path: await sftpCall(sftpClient, 'realpath', [body.path || '.']) };

    case 'read': {
      // Baca berkas teks untuk editor (dibatasi supaya ringan)
      const max = Math.min(Number(body.max) || 2 * 1024 * 1024, 4 * 1024 * 1024);
      const st = await sftpCall(sftpClient, 'stat', [body.path]);
      if (st.size > max) {
        return { ok: false, tooLarge: true, size: st.size, error: `Berkas ${(st.size / 1048576).toFixed(1)} MB terlalu besar untuk editor. Unduh saja.` };
      }
      const buf = await readWhole(sftpClient, body.path, st.size);
      const isBinary = buf.subarray(0, 8000).includes(0);
      return {
        ok: true,
        size: st.size,
        binary: isBinary,
        mode: st.mode & 0o7777,
        content: isBinary ? buf.toString('base64') : buf.toString('utf8'),
        encoding: isBinary ? 'base64' : 'utf8',
      };
    }

    case 'write': {
      const data = body.encoding === 'base64'
        ? Buffer.from(body.content || '', 'base64')
        : Buffer.from(body.content || '', 'utf8');
      await writeWhole(sftpClient, body.path, data);
      return { ok: true, size: data.length };
    }

    case 'chunkUpload': {
      // Unggah bertahap: offset 0 membuat berkas baru, selanjutnya menimpa di offset
      const data = Buffer.from(body.chunk || '', 'base64');
      const offset = Number(body.offset) || 0;
      const flags = offset === 0 ? 'w' : 'r+';
      const handle = await sftpCall(sftpClient, 'open', [body.path, flags]);
      try {
        await new Promise((resolve, reject) => {
          if (!data.length) return resolve();
          sftpClient.write(handle, data, 0, data.length, offset, (e) => (e ? reject(e) : resolve()));
        });
      } finally {
        await new Promise((r) => sftpClient.close(handle, () => r()));
      }
      return { ok: true, written: data.length, offset: offset + data.length };
    }

    case 'chunkDownload': {
      const offset = Number(body.offset) || 0;
      const length = Math.min(Number(body.length) || 524288, 2 * 1024 * 1024);
      const handle = await sftpCall(sftpClient, 'open', [body.path, 'r']);
      const buf = Buffer.alloc(length);
      let read = 0;
      try {
        read = await new Promise((resolve, reject) => {
          sftpClient.read(handle, buf, 0, length, offset, (e, bytesRead) => {
            if (e) {
              if (String(e.message).includes('EOF')) return resolve(0);
              return reject(e);
            }
            resolve(bytesRead || 0);
          });
        });
      } finally {
        await new Promise((r) => sftpClient.close(handle, () => r()));
      }
      return { ok: true, chunk: buf.subarray(0, read).toString('base64'), read, eof: read < length };
    }

    case 'mkdir':
      await sftpCall(sftpClient, 'mkdir', [body.path, { mode: 0o755 }]);
      return { ok: true };

    case 'touch': {
      await writeWhole(sftpClient, body.path, Buffer.alloc(0));
      return { ok: true };
    }

    case 'rename':
      await sftpCall(sftpClient, 'rename', [body.from, body.to]);
      return { ok: true };

    case 'chmod':
      await sftpCall(sftpClient, 'chmod', [body.path, parseInt(body.mode, 8)]);
      return { ok: true };

    case 'readlink':
      return { ok: true, target: await sftpCall(sftpClient, 'readlink', [body.path]) };

    default:
      return null; // ditangani lewat shell
  }
}

function readWhole(sftpClient, path, size) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = sftpClient.createReadStream(path, { highWaterMark: 256 * 1024 });
    stream.on('data', (c) => chunks.push(c));
    stream.on('error', (e) => reject(new Error('Gagal membaca berkas: ' + e.message)));
    stream.on('close', () => resolve(Buffer.concat(chunks)));
  });
}

function writeWhole(sftpClient, path, buf) {
  return new Promise((resolve, reject) => {
    const stream = sftpClient.createWriteStream(path, { highWaterMark: 256 * 1024 });
    stream.on('error', (e) => reject(new Error('Gagal menulis berkas: ' + e.message)));
    stream.on('close', () => resolve());
    stream.end(buf);
  });
}

/* ------------------------------------------- operasi berbasis shell (berat) */

async function shellAction(creds, body) {
  const conn = await pool.acquire(creds);
  const op = body.op;
  let cmd;

  switch (op) {
    case 'delete': {
      const targets = (body.paths || []).map(q).join(' ');
      if (!targets) throw new Error('Tidak ada berkas yang dipilih.');
      cmd = `rm -rf -- ${targets}`;
      break;
    }
    case 'move': {
      const targets = (body.paths || []).map(q).join(' ');
      cmd = `mkdir -p ${q(body.dest)} && mv -f -- ${targets} ${q(body.dest)}/`;
      break;
    }
    case 'copy': {
      const targets = (body.paths || []).map(q).join(' ');
      cmd = `mkdir -p ${q(body.dest)} && cp -a -- ${targets} ${q(body.dest)}/`;
      break;
    }
    case 'archive': {
      const dir = body.cwd || '.';
      const names = (body.names || []).map(q).join(' ');
      const out = body.output;
      const fmt = body.format || 'tar.gz';
      if (fmt === 'zip') {
        cmd = `cd ${q(dir)} && (command -v zip >/dev/null && zip -r -q ${q(out)} ${names} || tar czf ${q(out.replace(/\.zip$/, '.tar.gz'))} ${names})`;
      } else if (fmt === 'tar') {
        cmd = `cd ${q(dir)} && tar cf ${q(out)} ${names}`;
      } else if (fmt === 'tar.xz') {
        cmd = `cd ${q(dir)} && tar cJf ${q(out)} ${names}`;
      } else if (fmt === 'tar.bz2') {
        cmd = `cd ${q(dir)} && tar cjf ${q(out)} ${names}`;
      } else {
        cmd = `cd ${q(dir)} && tar czf ${q(out)} ${names}`;
      }
      break;
    }
    case 'extract': {
      const f = body.path;
      const dest = body.dest || '.';
      cmd =
        `mkdir -p ${q(dest)} && cd ${q(dest)} && case ${q(f)} in ` +
        `*.tar.gz|*.tgz) tar xzf ${q(f)} ;; ` +
        `*.tar.xz|*.txz) tar xJf ${q(f)} ;; ` +
        `*.tar.bz2|*.tbz2) tar xjf ${q(f)} ;; ` +
        `*.tar) tar xf ${q(f)} ;; ` +
        `*.zip) (command -v unzip >/dev/null && unzip -o -q ${q(f)}) || (command -v python3 >/dev/null && python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall('.')" ${q(f)}) || echo "unzip tidak tersedia" ;; ` +
        `*.gz) gunzip -kf ${q(f)} ;; ` +
        `*.xz) unxz -kf ${q(f)} ;; ` +
        `*.bz2) bunzip2 -kf ${q(f)} ;; ` +
        `*.7z) 7z x -y ${q(f)} ;; ` +
        `*.rar) unrar x -o+ ${q(f)} ;; ` +
        `*) echo "Format arsip tidak dikenali" ; exit 2 ;; esac`;
      break;
    }
    case 'symlink':
      cmd = `ln -s -- ${q(body.target)} ${q(body.path)}`;
      break;
    case 'chown':
      cmd = `chown ${body.recursive ? '-R ' : ''}${q(body.owner)} -- ${(body.paths || []).map(q).join(' ')}`;
      break;
    case 'du':
      cmd = `du -sh -- ${(body.paths || []).map(q).join(' ')} 2>/dev/null`;
      break;
    case 'disk':
      cmd = `df -h ${q(body.path || '/')} 2>/dev/null; echo '---'; free -m 2>/dev/null | head -3; echo '---'; uptime`;
      break;
    case 'search': {
      const dir = body.path || '.';
      const term = body.query || '';
      cmd = `find ${q(dir)} -maxdepth ${Number(body.depth) || 4} -iname ${q('*' + term + '*')} 2>/dev/null | head -300`;
      break;
    }
    case 'mkdirp':
      cmd = `mkdir -p -- ${q(body.path)}`;
      break;
    case 'raw':
      cmd = String(body.command || '');
      break;
    default:
      throw new Error('Operasi berkas tidak dikenali: ' + op);
  }

  const r = await exec(conn, `LC_ALL=C.UTF-8 ${cmd}`, { limit: 2 * 1024 * 1024 });
  if (r.code !== 0 && op !== 'search' && op !== 'du') {
    const msg = (r.stderr || r.stdout || '').trim().split('\n').slice(0, 4).join('\n');
    throw new Error(msg || `Perintah gagal dengan kode ${r.code}.`);
  }
  return { ok: true, stdout: r.stdout, stderr: r.stderr, code: r.code };
}

/* ---------------------------------------------------------- terminal exec */

const CWD_MARK = '\u0001XAYZ_CWD:';
const RC_MARK = '\u0001XAYZ_RC:';

function buildShellCommand(cwd, command) {
  const c = cwd && cwd !== '~' ? cwd : '$HOME';
  // PENTING: sebelumnya perintah dibungkus "{ command\n}; __xayz_rc=$?; printf...".
  // Itu punya bug tersembunyi — kalau "command" memanggil "exit N" di tengah
  // jalan (mis. skrip pemasang kita sendiri: "[ -z "$VNC" ] && { echo ...; exit 1; }"),
  // perintah "exit" langsung mematikan SELURUH shell seketika, sehingga baris
  // printf penanda cwd/kode-keluar tidak pernah sempat dijalankan. Akibatnya
  // klien menyangka perintah itu SUKSES (kode 0) padahal sebenarnya gagal.
  //
  // Perbaikannya: daftarkan "trap ... EXIT" SEBELUM menjalankan perintah.
  // Trap EXIT di shell POSIX selalu terpicu tepat sebelum shell benar-benar
  // berhenti, entah itu karena mencapai akhir skrip ATAU karena "exit N"
  // dipanggil eksplisit di mana pun — dan saat itu "$?" sudah berisi kode
  // keluar yang benar. Tidak memakai subshell "( )" supaya "cd" di dalam
  // perintah tetap memengaruhi shell ini (perlu diingat lintas perintah).
  return (
    `cd ${c === '$HOME' ? '"$HOME"' : q(c)} 2>/dev/null || cd "$HOME"; ` +
    `trap 'printf "\\n\\001XAYZ_CWD:%s\\001XAYZ_RC:%s\\001" "$PWD" "$?"' EXIT; ` +
    `${command}`
  );
}

async function streamExec(res, creds, body) {
  const conn = await pool.acquire(creds);
  const cols = Math.min(Math.max(Number(body.cols) || 100, 20), 500);
  const rows = Math.min(Math.max(Number(body.rows) || 30, 5), 200);
  const command = String(body.command || '').trim();
  if (!command) return sendJson(res, 200, { ok: true, output: '', cwd: body.cwd, code: 0 });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  const full = buildShellCommand(body.cwd, command);

  await new Promise((resolve) => {
    let finished = false;
    const finish = () => { if (!finished) { finished = true; try { res.end(); } catch {} resolve(); } };

    conn.exec(full, { pty: { cols, rows, term: 'xterm-256color' } }, (err, stream) => {
      if (err) {
        res.write('\r\n\x1b[31mGagal menjalankan perintah: ' + err.message + '\x1b[0m\r\n');
        return finish();
      }
      // PENTING: batas waktu di bawah ini HANYA berlaku bila kode ini sungguh
      // berjalan sebagai fungsi serverless (Vercel mematikan paksa fungsi
      // setelah maxDuration). Di server lokal, GitHub Codespaces, atau VPS
      // sendiri TIDAK ADA batas seperti ini — proses boleh berjalan selama
      // koneksi masih terbuka, persis seperti sesi SSH biasa. Sebelumnya batas
      // ini dipaksakan ke semua mode sehingga perintah wajar seperti
      // "apt install" (yang bisa makan beberapa menit) ikut terpotong padahal
      // sedang berjalan di Codespaces/lokal, bukan di Vercel. Itu bug — sudah
      // diperbaiki di sini.
      let guard = null;
      if (isServerless()) {
        const timeoutMs = Number(process.env.XAYZ_EXEC_TIMEOUT || 50000);
        guard = setTimeout(() => {
          try { stream.signal('KILL'); } catch {}
          res.write(
            '\r\n\x1b[33m[dihentikan: batas waktu fungsi serverless (~' +
            Math.round(timeoutMs / 1000) +
            ' detik) tercapai. Ini batas platform hosting (Vercel), bukan batas aplikasi — ' +
            'jalankan "npm start" atau "start.bat" di komputer/VPS sendiri untuk perintah yang lebih lama.]\x1b[0m\r\n'
          );
          finish();
        }, timeoutMs);
        if (guard.unref) guard.unref();
      }

      stream.on('data', (d) => { try { res.write(d); } catch {} });
      stream.stderr.on('data', (d) => { try { res.write(d); } catch {} });
      stream.on('close', () => { if (guard) clearTimeout(guard); finish(); });
      stream.on('error', () => { if (guard) clearTimeout(guard); finish(); });
      if (body.stdin) { try { stream.write(String(body.stdin)); } catch {} }
      stream.end();
    });
  });
}

/* ----------------------------------------------------------------- desktop */

async function desktopProbe(creds) {
  const conn = await pool.acquire(creds);
  const r = await exec(
    conn,
    `echo "--PORTS--"; (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E ':(590[0-9]|591[0-9]|3389|6080|6081)\\b' ; ` +
      `echo "--BIN--"; for b in x11vnc tigervncserver vncserver Xvfb xrdp websockify novnc xfce4-session gnome-session startlxde; do command -v $b >/dev/null 2>&1 && echo $b; done; ` +
      `echo "--DISPLAY--"; ls /tmp/.X11-unix 2>/dev/null; ` +
      `echo "--OS--"; (. /etc/os-release 2>/dev/null; echo "\${PRETTY_NAME:-tidak diketahui}"; echo "\${ID:-lain}"); ` +
      `echo "--PKG--"; for p in apt-get dnf yum pacman zypper apk; do command -v $p >/dev/null 2>&1 && echo $p; done; ` +
      `echo "--WHO--"; id -u; id -un; ` +
      `echo "--SUDO--"; (sudo -n true >/dev/null 2>&1 && echo tanpa-password) || (command -v sudo >/dev/null 2>&1 && echo butuh-password) || echo tidak-ada; ` +
      `echo "--MEM--"; (free -m 2>/dev/null | awk '/^Mem:/{print $2}') || echo 0; ` +
      `echo "--DISK--"; (df -Pm / 2>/dev/null | awk 'NR==2{print $4}') || echo 0`
  );
  const out = r.stdout;
  const sec = (name) => {
    const m = out.split('--' + name + '--')[1];
    return m ? m.split('--')[0].trim() : '';
  };
  const ports = [];
  sec('PORTS').split('\n').forEach((l) => {
    const m = l.match(/:(\d{3,5})\s/);
    if (m) ports.push(Number(m[1]));
  });
  const osLines = sec('OS').split('\n').map((s) => s.trim()).filter(Boolean);
  const whoLines = sec('WHO').split('\n').map((s) => s.trim()).filter(Boolean);
  const num = (s) => {
    const n = parseInt(String(s).trim(), 10);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    ok: true,
    ports: [...new Set(ports)].sort((a, b) => a - b),
    binaries: sec('BIN').split('\n').filter(Boolean),
    displays: sec('DISPLAY').split(/\s+/).filter(Boolean),
    os: osLines[0] || 'tidak diketahui',
    distro: (osLines[1] || 'lain').toLowerCase(),
    pkg: (sec('PKG').split('\n').map((s) => s.trim()).filter(Boolean)[0]) || '',
    uid: num(whoLines[0]),
    user: whoLines[1] || '',
    isRoot: num(whoLines[0]) === 0,
    sudo: sec('SUDO').trim() || 'tidak-ada',
    memMb: num(sec('MEM')),
    diskFreeMb: num(sec('DISK')),
  };
}

/* ------------------------------------------------------------ handler utama */

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.end();
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Gunakan metode POST.' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: e.message });
  }

  const action = String(body.action || '');

  try {
    if (action === 'ping') {
      return sendJson(res, 200, {
        ok: true,
        mode: isServerless() ? 'serverless' : 'local',
        ws: !isServerless(),
        node: process.version,
        pool: pool.stats(),
        time: Date.now(),
      });
    }

    if (action === 'connect') {
      const result = await doConnect(body);
      res.setHeader(
        'Set-Cookie',
        `xayz_session=${encodeURIComponent(result.token)}; Path=/; Max-Age=86400; SameSite=Lax${isServerless() ? '; Secure' : ''}`
      );
      return sendJson(res, 200, result);
    }

    // Semua aksi berikut butuh token
    const creds = unseal(body.token);

    switch (action) {
      case 'disconnect':
        pool.close(creds);
        res.setHeader('Set-Cookie', 'xayz_session=; Path=/; Max-Age=0; SameSite=Lax');
        return sendJson(res, 200, { ok: true });

      case 'keepalive': {
        const conn = await pool.acquire(creds);
        const r = await exec(conn, 'printf "%s\\n" "$(date +%s)"');
        return sendJson(res, 200, { ok: true, serverTime: r.stdout.trim() });
      }

      case 'exec':
        return await streamExec(res, creds, body);

      case 'execOnce': {
        const conn = await pool.acquire(creds);
        const r = await exec(conn, buildShellCommand(body.cwd, body.command), {
          pty: body.pty === false ? undefined : { cols: 120, rows: 40, term: 'xterm-256color' },
        });
        let out = r.stdout + (r.stderr || '');
        let cwd = body.cwd;
        let code = r.code;
        const ci = out.lastIndexOf(CWD_MARK);
        if (ci !== -1) {
          const tail = out.slice(ci);
          const cm = tail.match(/XAYZ_CWD:([^\u0001]*)\u0001XAYZ_RC:(\d+)/);
          if (cm) { cwd = cm[1]; code = Number(cm[2]); }
          out = out.slice(0, ci).replace(/\r?\n$/, '');
        }
        return sendJson(res, 200, { ok: true, output: out, cwd, code });
      }

      case 'sftp': {
        const direct = await sftpAction(creds, body);
        if (direct) return sendJson(res, 200, direct);
        const viaShell = await shellAction(creds, body);
        return sendJson(res, 200, viaShell);
      }

      case 'fileop':
        return sendJson(res, 200, await shellAction(creds, body));

      case 'desktop.probe':
        return sendJson(res, 200, await desktopProbe(creds));

      case 'desktop.setup': {
        const conn = await pool.acquire(creds);
        const r = await exec(conn, String(body.command || 'echo "tidak ada perintah"'), { limit: 512 * 1024 });
        return sendJson(res, 200, { ok: true, stdout: r.stdout, stderr: r.stderr, code: r.code });
      }

      default:
        return sendJson(res, 400, { ok: false, error: 'Aksi tidak dikenali: ' + action });
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const status = /Token sesi/.test(msg) ? 401 : 500;
    if (res.headersSent) {
      try { res.end('\r\n\x1b[31m' + msg + '\x1b[0m\r\n'); } catch {}
      return;
    }
    return sendJson(res, status, { ok: false, error: msg, raw: e.raw || undefined });
  }
}

module.exports = { handle, isServerless, buildShellCommand, CWD_MARK, RC_MARK };
