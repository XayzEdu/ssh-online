'use strict';
/**
 * Pembuat socket TCP menuju VPS.
 * Mendukung: koneksi langsung, HTTP CONNECT proxy, SOCKS5 (+auth), SOCKS4/4a.
 * Mode "auto" mencoba langsung dulu, lalu proxy dari env, lalu proxy manual.
 * Berguna untuk VPS NAT yang portnya terbatas atau jaringan yang memblokir port 22.
 */
const net = require('net');
const tls = require('tls');

const DEFAULT_TIMEOUT = 20000;

function directSocket(host, port, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port, family: 0 });
    let done = false;
    const fail = (err) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      reject(err);
    };
    sock.setTimeout(timeout, () => fail(new Error(`Timeout menghubungi ${host}:${port}`)));
    sock.once('error', (e) => fail(new Error(`Tidak bisa terhubung ke ${host}:${port} (${e.code || e.message})`)));
    sock.once('connect', () => {
      if (done) return;
      done = true;
      sock.setTimeout(0);
      sock.setNoDelay(true);
      sock.setKeepAlive(true, 15000);
      resolve(sock);
    });
  });
}

function httpConnect(proxy, host, port, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const connector = proxy.tls
      ? tls.connect({ host: proxy.host, port: proxy.port, rejectUnauthorized: false })
      : net.connect({ host: proxy.host, port: proxy.port });
    const readyEvent = proxy.tls ? 'secureConnect' : 'connect';
    let buf = '';
    let done = false;

    const fail = (err) => {
      if (done) return;
      done = true;
      try { connector.destroy(); } catch {}
      reject(err);
    };

    connector.setTimeout(timeout, () => fail(new Error(`Timeout ke proxy ${proxy.host}:${proxy.port}`)));
    connector.once('error', (e) => fail(new Error(`Proxy HTTP gagal: ${e.code || e.message}`)));

    connector.once(readyEvent, () => {
      const target = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
      const lines = [
        `CONNECT ${target} HTTP/1.1`,
        `Host: ${target}`,
        'Proxy-Connection: Keep-Alive',
        'User-Agent: Xayz-SSH-Online/1.0',
      ];
      if (proxy.username) {
        const cred = Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');
        lines.push(`Proxy-Authorization: Basic ${cred}`);
      }
      connector.write(lines.join('\r\n') + '\r\n\r\n');
    });

    const onData = (chunk) => {
      buf += chunk.toString('latin1');
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) {
        if (buf.length > 16384) fail(new Error('Balasan proxy HTTP tidak wajar.'));
        return;
      }
      connector.removeListener('data', onData);
      const head = buf.slice(0, idx);
      const code = parseInt((head.split(' ')[1] || '0'), 10);
      if (code !== 200) {
        return fail(new Error(`Proxy HTTP menolak CONNECT (status ${code || '?'}).`));
      }
      const leftover = Buffer.from(buf.slice(idx + 4), 'latin1');
      if (leftover.length) connector.unshift(leftover);
      done = true;
      connector.setTimeout(0);
      connector.setNoDelay(true);
      resolve(connector);
    };
    connector.on('data', onData);
  });
}

function socks5(proxy, host, port, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxy.host, port: proxy.port });
    let stage = 'greet';
    let done = false;
    let pending = Buffer.alloc(0);

    const fail = (err) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      reject(err);
    };

    sock.setTimeout(timeout, () => fail(new Error(`Timeout ke proxy SOCKS ${proxy.host}:${proxy.port}`)));
    sock.once('error', (e) => fail(new Error(`Proxy SOCKS5 gagal: ${e.code || e.message}`)));

    sock.once('connect', () => {
      const methods = proxy.username ? [0x00, 0x02] : [0x00];
      sock.write(Buffer.from([0x05, methods.length, ...methods]));
    });

    const sendRequest = () => {
      stage = 'request';
      const hostBuf = Buffer.from(host, 'utf8');
      const isIPv4 = net.isIPv4(host);
      const isIPv6 = net.isIPv6(host);
      let head;
      if (isIPv4) {
        head = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x01]),
          Buffer.from(host.split('.').map(Number)),
        ]);
      } else if (isIPv6) {
        const parts = [];
        const norm = host.split('::');
        // Penanganan IPv6 sederhana: serahkan ke resolusi nama bila bentuknya rumit
        if (norm.length > 1) {
          head = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
            hostBuf,
          ]);
        } else {
          host.split(':').forEach((h) => {
            const v = parseInt(h || '0', 16);
            parts.push((v >> 8) & 0xff, v & 0xff);
          });
          head = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x04]), Buffer.from(parts)]);
        }
      } else {
        head = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
        ]);
      }
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port, 0);
      sock.write(Buffer.concat([head, portBuf]));
    };

    const onData = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (stage === 'greet') {
        if (pending.length < 2) return;
        const method = pending[1];
        pending = pending.subarray(2);
        if (method === 0x00) return sendRequest();
        if (method === 0x02) {
          if (!proxy.username) return fail(new Error('Proxy SOCKS5 minta autentikasi tapi user/password kosong.'));
          const u = Buffer.from(proxy.username, 'utf8');
          const p = Buffer.from(proxy.password || '', 'utf8');
          stage = 'auth';
          sock.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
          return;
        }
        return fail(new Error('Proxy SOCKS5 tidak menerima metode autentikasi yang tersedia.'));
      }
      if (stage === 'auth') {
        if (pending.length < 2) return;
        const status = pending[1];
        pending = pending.subarray(2);
        if (status !== 0x00) return fail(new Error('User atau password proxy SOCKS5 ditolak.'));
        return sendRequest();
      }
      if (stage === 'request') {
        if (pending.length < 5) return;
        const rep = pending[1];
        if (rep !== 0x00) {
          const map = {
            1: 'kegagalan umum di server proxy',
            2: 'koneksi tidak diizinkan aturan proxy',
            3: 'jaringan tidak terjangkau',
            4: 'host tidak terjangkau',
            5: 'koneksi ditolak host tujuan',
            6: 'TTL habis',
            7: 'perintah tidak didukung',
            8: 'tipe alamat tidak didukung',
          };
          return fail(new Error(`Proxy SOCKS5 menolak: ${map[rep] || 'kode ' + rep}.`));
        }
        const atyp = pending[3];
        let len = 4;
        if (atyp === 0x01) len += 4 + 2;
        else if (atyp === 0x03) len += 1 + pending[4] + 2;
        else if (atyp === 0x04) len += 16 + 2;
        else return fail(new Error('Balasan SOCKS5 tidak dikenali.'));
        if (pending.length < len) return;
        const leftover = pending.subarray(len);
        sock.removeListener('data', onData);
        if (leftover.length) sock.unshift(leftover);
        done = true;
        sock.setTimeout(0);
        sock.setNoDelay(true);
        sock.setKeepAlive(true, 15000);
        resolve(sock);
      }
    };
    sock.on('data', onData);
  });
}

function socks4(proxy, host, port, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxy.host, port: proxy.port });
    let done = false;
    let pending = Buffer.alloc(0);
    const fail = (err) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      reject(err);
    };
    sock.setTimeout(timeout, () => fail(new Error('Timeout ke proxy SOCKS4.')));
    sock.once('error', (e) => fail(new Error(`Proxy SOCKS4 gagal: ${e.code || e.message}`)));
    sock.once('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port, 0);
      const user = Buffer.from(proxy.username || 'xayz', 'utf8');
      let body;
      if (net.isIPv4(host)) {
        body = Buffer.concat([
          Buffer.from([0x04, 0x01]), portBuf,
          Buffer.from(host.split('.').map(Number)),
          user, Buffer.from([0x00]),
        ]);
      } else {
        // SOCKS4a
        body = Buffer.concat([
          Buffer.from([0x04, 0x01]), portBuf,
          Buffer.from([0, 0, 0, 1]),
          user, Buffer.from([0x00]),
          Buffer.from(host, 'utf8'), Buffer.from([0x00]),
        ]);
      }
      sock.write(body);
    });
    const onData = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < 8) return;
      const rep = pending[1];
      const leftover = pending.subarray(8);
      sock.removeListener('data', onData);
      if (rep !== 0x5a) return fail(new Error(`Proxy SOCKS4 menolak (kode ${rep}).`));
      if (leftover.length) sock.unshift(leftover);
      done = true;
      sock.setTimeout(0);
      sock.setNoDelay(true);
      resolve(sock);
    };
    sock.on('data', onData);
  });
}

function envProxy() {
  const url =
    process.env.XAYZ_PROXY ||
    process.env.ALL_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (!url) return null;
  try {
    const u = new URL(url);
    const type = u.protocol.startsWith('socks5') ? 'socks5'
      : u.protocol.startsWith('socks4') ? 'socks4'
      : 'http';
    return {
      type,
      host: u.hostname,
      port: Number(u.port) || (type === 'http' ? 8080 : 1080),
      username: decodeURIComponent(u.username || '') || undefined,
      password: decodeURIComponent(u.password || '') || undefined,
      tls: u.protocol === 'https:',
    };
  } catch {
    return null;
  }
}

async function viaProxy(proxy, host, port, timeout) {
  if (proxy.type === 'socks5') return socks5(proxy, host, port, timeout);
  if (proxy.type === 'socks4') return socks4(proxy, host, port, timeout);
  return httpConnect(proxy, host, port, timeout);
}

/**
 * dial({host, port, proxy, timeout}) -> net.Socket siap pakai untuk ssh2.
 * proxy.type: 'none' | 'auto' | 'http' | 'socks5' | 'socks4'
 */
async function dial({ host, port, proxy, timeout = DEFAULT_TIMEOUT }) {
  const attempts = [];
  const p = proxy && proxy.type && proxy.type !== 'none' ? proxy : null;

  if (!p) {
    attempts.push({ label: 'langsung', fn: () => directSocket(host, port, timeout) });
    const ep = envProxy();
    if (ep) attempts.push({ label: `proxy env ${ep.type}`, fn: () => viaProxy(ep, host, port, timeout) });
  } else if (p.type === 'auto') {
    attempts.push({ label: 'langsung', fn: () => directSocket(host, port, Math.min(timeout, 8000)) });
    if (p.host) attempts.push({ label: 'proxy manual', fn: () => viaProxy({ ...p, type: p.fallbackType || 'http' }, host, port, timeout) });
    if (p.host) attempts.push({ label: 'proxy manual (socks5)', fn: () => viaProxy({ ...p, type: 'socks5' }, host, port, timeout) });
    const ep = envProxy();
    if (ep) attempts.push({ label: `proxy env ${ep.type}`, fn: () => viaProxy(ep, host, port, timeout) });
  } else {
    attempts.push({ label: `proxy ${p.type}`, fn: () => viaProxy(p, host, port, timeout) });
    if (p.allowFallbackDirect !== false) {
      attempts.push({ label: 'langsung', fn: () => directSocket(host, port, timeout) });
    }
  }

  const errors = [];
  for (const a of attempts) {
    try {
      const sock = await a.fn();
      sock.xayzRoute = a.label;
      return sock;
    } catch (e) {
      errors.push(`${a.label}: ${e.message}`);
    }
  }
  const err = new Error('Semua jalur koneksi gagal.\n  - ' + errors.join('\n  - '));
  err.routes = errors;
  throw err;
}

module.exports = { dial, directSocket, httpConnect, socks5, socks4, envProxy };
