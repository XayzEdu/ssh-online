'use strict';
/**
 * Token sesi: kredensial VPS dienkripsi AES-256-GCM dengan secret server,
 * lalu disimpan di cookie + localStorage sebagai blob base64url.
 * Browser tidak pernah menyimpan password dalam bentuk terbaca.
 */
const crypto = require('crypto');

let cachedKey = null;

function secretKey() {
  if (cachedKey) return cachedKey;
  const raw =
    process.env.XAYZ_SECRET ||
    process.env.SESSION_SECRET ||
    // fallback stabil per-deployment supaya token tidak invalid tiap cold start
    (process.env.VERCEL_URL || 'xayz-ssh-online-local') + '::xayz::v1';
  cachedKey = crypto.createHash('sha256').update(String(raw)).digest();
  return cachedKey;
}

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(obj), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

function unseal(token) {
  if (typeof token !== 'string' || token.length < 40) {
    throw new Error('Token sesi tidak valid. Hubungkan ulang ke VPS.');
  }
  let buf;
  try {
    buf = Buffer.from(token, 'base64url');
  } catch {
    throw new Error('Token sesi rusak. Hubungkan ulang ke VPS.');
  }
  try {
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const body = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(body), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch {
    throw new Error(
      'Token sesi kedaluwarsa atau secret server berubah. Hubungkan ulang ke VPS.'
    );
  }
}

/** ID pendek stabil untuk keperluan pooling koneksi hangat. */
function fingerprint(creds) {
  return crypto
    .createHash('sha256')
    .update(
      [
        creds.host,
        creds.port,
        creds.username,
        creds.password || '',
        creds.privateKey ? crypto.createHash('sha1').update(creds.privateKey).digest('hex') : '',
        JSON.stringify(creds.proxy || {}),
        JSON.stringify(creds.jump || []),
      ].join('\u0000')
    )
    .digest('hex')
    .slice(0, 32);
}

module.exports = { seal, unseal, fingerprint };
