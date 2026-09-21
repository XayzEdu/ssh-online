'use strict';
/**
 * Fungsi serverless Vercel (Hobby/Free).
 * Semua RPC masuk lewat satu fungsi supaya tetap di bawah batas akun gratis.
 */
const { handle } = require('../lib/api');

module.exports = async function (req, res) {
  try {
    await handle(req, res);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    try {
      res.end(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
    } catch {}
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '6mb' } } };
