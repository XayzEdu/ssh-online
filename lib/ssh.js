'use strict';
/**
 * Pembungkus ssh2: koneksi ke VPS dengan dukungan
 *  - password, private key (+passphrase), keyboard-interactive
 *  - jump host berantai (ProxyJump) untuk VPS NAT
 *  - proxy HTTP/SOCKS
 *  - fallback algoritma lama untuk VPS/router tua (dropbear, OpenSSH 5.x)
 */
const { Client } = require('ssh2');
const { dial } = require('./dialer');

const LEGACY = {
  kex: {
    append: [
      'diffie-hellman-group14-sha1',
      'diffie-hellman-group-exchange-sha1',
      'diffie-hellman-group1-sha1',
    ],
  },
  serverHostKey: { append: ['ssh-rsa', 'ssh-dss'] },
  cipher: { append: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'] },
  hmac: { append: ['hmac-sha1', 'hmac-sha1-96', 'hmac-md5'] },
};

function normalizeCreds(input) {
  const c = input || {};
  const proxy = c.proxy && c.proxy.type && c.proxy.type !== 'none' ? {
    type: String(c.proxy.type),
    host: c.proxy.host ? String(c.proxy.host).trim() : '',
    port: Number(c.proxy.port) || (String(c.proxy.type).startsWith('socks') ? 1080 : 8080),
    username: c.proxy.username || undefined,
    password: c.proxy.password || undefined,
    tls: !!c.proxy.tls,
    fallbackType: c.proxy.fallbackType || 'http',
  } : { type: 'none' };

  return {
    host: String(c.host || '').trim(),
    port: Number(c.port) || 22,
    username: String(c.username || c.user || 'root').trim(),
    password: c.password ? String(c.password) : undefined,
    privateKey: c.privateKey ? String(c.privateKey) : undefined,
    passphrase: c.passphrase ? String(c.passphrase) : undefined,
    proxy,
    jump: Array.isArray(c.jump) ? c.jump.filter((j) => j && j.host).map((j) => ({
      host: String(j.host).trim(),
      port: Number(j.port) || 22,
      username: String(j.username || j.user || 'root').trim(),
      password: j.password || undefined,
      privateKey: j.privateKey || undefined,
      passphrase: j.passphrase || undefined,
    })) : [],
    keepalive: c.keepalive !== false,
    timeout: Number(c.timeout) || 25000,
  };
}

function baseConfig(node, sock, legacy) {
  const cfg = {
    sock,
    username: node.username,
    readyTimeout: node.timeout || 25000,
    keepaliveInterval: node.keepalive === false ? 0 : 15000,
    keepaliveCountMax: 6,
    tryKeyboard: true,
    // Buffer kecil = hemat RAM, bagus untuk komputer HDD / RAM pas-pasan
    highWaterMark: 64 * 1024,
  };
  if (node.privateKey) {
    cfg.privateKey = node.privateKey;
    if (node.passphrase) cfg.passphrase = node.passphrase;
    if (node.password) cfg.password = node.password;
  } else {
    cfg.password = node.password || '';
  }
  if (legacy) cfg.algorithms = LEGACY;
  return cfg;
}

function handshake(node, sock, legacy) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    let banner = '';

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch {}
      try { conn.destroy(); } catch {}
      reject(err);
    };

    conn.on('banner', (msg) => { banner += msg; });

    conn.on('keyboard-interactive', (name, instr, lang, prompts, finish) => {
      // Jawab semua prompt dengan password; VPS yang pakai PAM butuh ini
      try {
        finish(prompts.map(() => node.password || ''));
      } catch (e) {
        fail(new Error('Autentikasi keyboard-interactive gagal: ' + e.message));
      }
    });

    conn.on('ready', () => {
      if (settled) return;
      settled = true;
      conn.xayzBanner = banner;
      resolve(conn);
    });

    conn.on('error', (err) => {
      const m = String(err && err.message || err);
      let hint = m;
      if (/All configured authentication methods failed/i.test(m)) {
        hint = 'Login ditolak: user atau password/key salah, atau root login dimatikan di sshd_config (PermitRootLogin).';
      } else if (/Timed out while waiting for handshake/i.test(m)) {
        hint = 'Handshake timeout: port terbuka tapi bukan layanan SSH, atau diblokir firewall/DDoS filter.';
      } else if (/ECONNREFUSED/i.test(m)) {
        hint = 'Koneksi ditolak: port SSH salah atau layanan sshd mati.';
      } else if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(m)) {
        hint = 'Tidak terjangkau: IP salah, firewall menutup port, atau butuh proxy/jump host (VPS NAT).';
      } else if (/ENOTFOUND|EAI_AGAIN/i.test(m)) {
        hint = 'Hostname tidak ditemukan. Cek ejaan domain atau pakai IP langsung.';
      }
      const e = new Error(hint);
      e.raw = m;
      e.legacyRetryable = /handshake|algorithm|kex|cipher|no matching|unsupported/i.test(m);
      fail(e);
    });

    try {
      conn.connect(baseConfig(node, sock, legacy));
    } catch (e) {
      fail(new Error('Konfigurasi SSH ditolak: ' + e.message));
    }
  });
}

function forwardSocket(conn, host, port) {
  return new Promise((resolve, reject) => {
    conn.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
      if (err) return reject(new Error(`Jump host tidak bisa meneruskan ke ${host}:${port} (${err.message})`));
      resolve(stream);
    });
  });
}

/** Buka koneksi ke VPS. Mengembalikan ssh2 Client yang siap dipakai. */
async function connect(rawCreds) {
  const creds = normalizeCreds(rawCreds);
  if (!creds.host) throw new Error('Host atau IP VPS wajib diisi.');
  if (!creds.username) throw new Error('Username VPS wajib diisi.');
  if (!creds.password && !creds.privateKey) {
    throw new Error('Isi password atau private key untuk login.');
  }

  const chain = [];
  let sock = null;

  try {
    // 1) Rantai jump host (kalau ada)
    for (let i = 0; i < creds.jump.length; i++) {
      const node = { ...creds.jump[i], timeout: creds.timeout };
      const hopSock = i === 0
        ? await dial({ host: node.host, port: node.port, proxy: creds.proxy, timeout: creds.timeout })
        : await forwardSocket(chain[i - 1], node.host, node.port);
      let hop;
      try {
        hop = await handshake(node, hopSock, false);
      } catch (e) {
        if (!e.legacyRetryable) throw new Error(`Jump host ${node.host}: ${e.message}`);
        const retrySock = i === 0
          ? await dial({ host: node.host, port: node.port, proxy: creds.proxy, timeout: creds.timeout })
          : await forwardSocket(chain[i - 1], node.host, node.port);
        hop = await handshake(node, retrySock, true);
      }
      chain.push(hop);
    }

    // 2) Socket menuju VPS target
    sock = chain.length
      ? await forwardSocket(chain[chain.length - 1], creds.host, creds.port)
      : await dial({ host: creds.host, port: creds.port, proxy: creds.proxy, timeout: creds.timeout });

    const route = sock.xayzRoute || (chain.length ? 'jump host' : 'langsung');

    // 3) Handshake ke VPS, dengan retry algoritma lama
    let conn;
    try {
      conn = await handshake(creds, sock, false);
    } catch (e) {
      if (!e.legacyRetryable) throw e;
      const sock2 = chain.length
        ? await forwardSocket(chain[chain.length - 1], creds.host, creds.port)
        : await dial({ host: creds.host, port: creds.port, proxy: creds.proxy, timeout: creds.timeout });
      conn = await handshake(creds, sock2, true);
      conn.xayzLegacy = true;
    }

    conn.xayzRoute = route;
    conn.xayzChain = chain;
    conn.xayzCreds = creds;
    const origEnd = conn.end.bind(conn);
    conn.end = function () {
      try { origEnd(); } catch {}
      chain.forEach((c) => { try { c.end(); } catch {} });
    };
    return conn;
  } catch (err) {
    chain.forEach((c) => { try { c.end(); } catch {} });
    try { if (sock) sock.destroy(); } catch {}
    throw err;
  }
}

/** Jalankan satu perintah, kumpulkan output. */
function exec(conn, command, opts = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, opts.pty ? { pty: opts.pty } : {}, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      let code = null;
      const limit = opts.limit || 8 * 1024 * 1024;
      stream.on('data', (d) => {
        if (out.length < limit) out += d.toString('utf8');
      });
      stream.stderr.on('data', (d) => {
        if (errOut.length < limit) errOut += d.toString('utf8');
      });
      stream.on('close', (c) => {
        code = c;
        resolve({ stdout: out, stderr: errOut, code: code == null ? 0 : code });
      });
      stream.on('error', reject);
      if (opts.stdin != null) { stream.write(opts.stdin); stream.end(); }
    });
  });
}

function sftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(new Error('SFTP tidak tersedia di VPS ini: ' + err.message)) : resolve(s)));
  });
}

module.exports = { connect, exec, sftp, normalizeCreds };
