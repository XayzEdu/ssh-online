'use strict';
/**
 * Cache koneksi SSH di memori instance.
 * Lokal: koneksi bertahan selama server hidup -> sangat cepat.
 * Vercel: bertahan selama instance hangat -> tetap mempercepat operasi beruntun.
 */
const { connect, sftp } = require('./ssh');
const { fingerprint } = require('./crypto');

const IDLE_MS = Number(process.env.XAYZ_IDLE_MS || 120000);
const MAX_ENTRIES = Number(process.env.XAYZ_MAX_CONN || 12);

/** @type {Map<string, {conn:any, sftp:any, last:number, creating:Promise<any>|null}>} */
const pool = new Map();
let sweeper = null;

function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pool) {
      if (now - entry.last > IDLE_MS) {
        drop(key);
      }
    }
    if (pool.size === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = null;
    }
  }, 30000);
  if (sweeper.unref) sweeper.unref();
}

function drop(key) {
  const entry = pool.get(key);
  pool.delete(key);
  if (!entry) return;
  try { entry.sftp && entry.sftp.end(); } catch {}
  try { entry.conn && entry.conn.end(); } catch {}
}

function evictOldest() {
  let oldestKey = null;
  let oldest = Infinity;
  for (const [k, v] of pool) {
    if (v.last < oldest) { oldest = v.last; oldestKey = k; }
  }
  if (oldestKey) drop(oldestKey);
}

/** Ambil koneksi (buat baru kalau belum ada / sudah mati). */
async function acquire(creds) {
  const key = fingerprint(creds);
  let entry = pool.get(key);

  if (entry && entry.creating) {
    await entry.creating;
    entry = pool.get(key);
  }
  if (entry && entry.conn && !entry.dead) {
    entry.last = Date.now();
    return entry.conn;
  }

  if (pool.size >= MAX_ENTRIES) evictOldest();

  const placeholder = { conn: null, sftp: null, last: Date.now(), creating: null, dead: false };
  const promise = (async () => {
    const conn = await connect(creds);
    placeholder.conn = conn;
    conn.on('close', () => { placeholder.dead = true; pool.delete(key); });
    conn.on('error', () => { placeholder.dead = true; pool.delete(key); });
    return conn;
  })();
  placeholder.creating = promise;
  pool.set(key, placeholder);
  startSweeper();

  try {
    const conn = await promise;
    placeholder.creating = null;
    placeholder.last = Date.now();
    return conn;
  } catch (e) {
    pool.delete(key);
    throw e;
  }
}

/** Ambil channel SFTP yang dipakai ulang. */
async function acquireSftp(creds) {
  const key = fingerprint(creds);
  const conn = await acquire(creds);
  const entry = pool.get(key);
  if (entry && entry.sftp && !entry.sftp.closed) {
    entry.last = Date.now();
    return entry.sftp;
  }
  const s = await sftp(conn);
  s.on('close', () => { if (entry) entry.sftp = null; });
  s.on('error', () => { if (entry) entry.sftp = null; });
  if (entry) { entry.sftp = s; entry.last = Date.now(); }
  return s;
}

function release(creds) {
  const key = fingerprint(creds);
  const entry = pool.get(key);
  if (entry) entry.last = Date.now();
}

function close(creds) {
  drop(fingerprint(creds));
}

function stats() {
  return { size: pool.size, idleMs: IDLE_MS, max: MAX_ENTRIES };
}

module.exports = { acquire, acquireSftp, release, close, stats };
