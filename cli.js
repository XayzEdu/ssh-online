'use strict';
/**
 * Xayz SSH Console — terminal SSH langsung di Command Prompt / PowerShell / bash.
 * Tidak membuka browser sama sekali. Dipakai oleh ssh-console.bat.
 *
 * Profil koneksi disimpan di profiles.json (password opsional, hanya lokal).
 */
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { connect } = require('./lib/ssh');

const PROFILES = path.join(__dirname, 'profiles.json');
const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  cy: (s) => `\x1b[36m${s}\x1b[0m`,
  gr: (s) => `\x1b[32m${s}\x1b[0m`,
  rd: (s) => `\x1b[31m${s}\x1b[0m`,
  yl: (s) => `\x1b[33m${s}\x1b[0m`,
};

function loadProfiles() {
  try { return JSON.parse(fs.readFileSync(PROFILES, 'utf8')); } catch { return []; }
}
function saveProfiles(list) {
  try { fs.writeFileSync(PROFILES, JSON.stringify(list, null, 2)); } catch {}
}

function ask(rl, question, def) {
  return new Promise((resolve) => {
    rl.question(def ? `${question} ${C.dim('[' + def + ']')}: ` : `${question}: `, (a) => {
      resolve((a || '').trim() || def || '');
    });
  });
}

function askHidden(rl, question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    process.stdout.write(question + ': ');
    let value = '';
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          if (stdin.setRawMode) stdin.setRawMode(!!wasRaw);
          stdin.pause();
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(0); }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        value += ch;
        process.stdout.write('*');
      }
    };
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function banner() {
  console.log('');
  console.log(C.cy('  ┌──────────────────────────────────────────────┐'));
  console.log(C.cy('  │') + C.b('  Xayz SSH Console                            ') + C.cy('│'));
  console.log(C.cy('  │') + C.dim('  Terminal VPS tanpa browser                  ') + C.cy('│'));
  console.log(C.cy('  └──────────────────────────────────────────────┘'));
  console.log('');
}

async function pickProfile(rl) {
  const profiles = loadProfiles();
  if (!profiles.length) return null;
  console.log(C.b('  Profil tersimpan:'));
  profiles.forEach((p, i) => {
    console.log(`   ${C.gr(String(i + 1))}. ${p.username}@${p.host}:${p.port}${p.label ? C.dim('  — ' + p.label) : ''}`);
  });
  console.log(`   ${C.gr('n')}. Koneksi baru`);
  console.log('');
  const choice = await ask(rl, '  Pilih', 'n');
  const idx = parseInt(choice, 10);
  if (!isNaN(idx) && profiles[idx - 1]) return profiles[idx - 1];
  return null;
}

async function gather(rl) {
  const saved = await pickProfile(rl);
  if (saved) {
    const creds = { ...saved };
    if (!creds.password && !creds.privateKey) {
      creds.password = await askHidden(rl, `  Password untuk ${creds.username}@${creds.host}`);
    }
    return { creds, fromSaved: true };
  }

  const host = await ask(rl, '  IP / Host VPS');
  if (!host) { console.log(C.rd('  Host wajib diisi.')); process.exit(1); }
  const port = Number(await ask(rl, '  Port SSH', '22')) || 22;
  const username = await ask(rl, '  Username', 'root');
  const keyPath = await ask(rl, '  Path private key (kosongkan jika pakai password)', '');
  let privateKey, passphrase, password;
  if (keyPath) {
    try {
      privateKey = fs.readFileSync(keyPath.replace(/^["']|["']$/g, ''), 'utf8');
    } catch (e) {
      console.log(C.rd('  Private key tidak terbaca: ' + e.message));
      process.exit(1);
    }
    passphrase = await askHidden(rl, '  Passphrase key (Enter jika tidak ada)');
  } else {
    password = await askHidden(rl, '  Password');
  }
  const useProxy = (await ask(rl, '  Pakai proxy? (kosong/http/socks5)', '')).toLowerCase();
  let proxy = { type: 'none' };
  if (useProxy === 'http' || useProxy === 'socks5' || useProxy === 'socks4') {
    proxy = {
      type: useProxy,
      host: await ask(rl, '  Host proxy'),
      port: Number(await ask(rl, '  Port proxy', useProxy === 'http' ? '8080' : '1080')),
      username: await ask(rl, '  User proxy (opsional)', ''),
      password: await ask(rl, '  Password proxy (opsional)', ''),
    };
  }

  const creds = { host, port, username, password, privateKey, passphrase, proxy };

  const save = (await ask(rl, '  Simpan profil ini? (y/N)', 'N')).toLowerCase();
  if (save === 'y') {
    const withPw = (await ask(rl, '  Simpan password juga? (y/N)', 'N')).toLowerCase() === 'y';
    const list = loadProfiles();
    list.push({
      label: await ask(rl, '  Nama profil (opsional)', ''),
      host, port, username, proxy,
      privateKey: privateKey ? privateKey : undefined,
      password: withPw ? password : undefined,
    });
    saveProfiles(list);
    console.log(C.dim('  Profil disimpan di profiles.json'));
  }
  return { creds, fromSaved: false };
}

async function main() {
  banner();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const { creds } = await gather(rl);
  rl.close();

  process.stdout.write('\n' + C.yl(`  Menghubungkan ke ${creds.username}@${creds.host}:${creds.port} …\n`));

  let conn;
  try {
    conn = await connect(creds);
  } catch (e) {
    console.log(C.rd('\n  Koneksi gagal:\n  ' + String(e.message).split('\n').join('\n  ') + '\n'));
    process.exit(1);
  }

  console.log(C.gr(`  Terhubung lewat ${conn.xayzRoute}${conn.xayzLegacy ? ' (mode algoritma lama)' : ''}.`));
  if (conn.xayzBanner) process.stdout.write(C.dim(conn.xayzBanner));
  console.log(C.dim('  Tekan Ctrl+D atau ketik exit untuk keluar.\n'));

  const cols = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;

  conn.shell({ term: process.env.TERM || 'xterm-256color', cols, rows }, (err, stream) => {
    if (err) {
      console.log(C.rd('  Gagal membuka shell: ' + err.message));
      process.exit(1);
    }
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.pipe(stream);
    stream.pipe(process.stdout);
    stream.stderr.pipe(process.stderr);

    process.stdout.on('resize', () => {
      try { stream.setWindow(process.stdout.rows, process.stdout.columns, 0, 0); } catch {}
    });

    const cleanup = (code) => {
      if (process.stdin.setRawMode) process.stdin.setRawMode(false);
      process.stdin.pause();
      try { conn.end(); } catch {}
      console.log(C.dim('\n  Sesi ditutup.\n'));
      process.exit(code || 0);
    };

    stream.on('close', () => cleanup(0));
    conn.on('error', (e) => { console.log(C.rd('\n  ' + e.message)); cleanup(1); });
  });
}

main().catch((e) => {
  console.log(C.rd('\n  Terjadi kesalahan: ' + e.message + '\n'));
  process.exit(1);
});
