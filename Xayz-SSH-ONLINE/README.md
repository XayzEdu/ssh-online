# Xayz SSH Online

Website SSH + SFTP + Desktop (VNC/RDP) untuk komputer yang **tidak punya klien SSH**, ringan dan cepat walau disk-nya **HDD**. Dibangun dengan **Node.js (CommonJS)**, tanpa framework berat, tanpa build step, tanpa font unduhan.

Ada juga **versi `.bat` tanpa membuka browser** (`ssh-console.bat`) — SSH langsung di jendela Command Prompt.

---

## Isi singkat

| Halaman | Fungsi |
|---|---|
| **Terminal** | Shell VPS dengan warna ANSI penuh, tab banyak sesi, tombol fullscreen, keypad ala JuiceSSH untuk HP |
| **Berkas (SFTP)** | Ikon gaya VS Code, syntax color, file/folder tersembunyi, upload file **dan folder**, move/rename/delete/archive/extract/chmod/copy/search |
| **Tampilan** | Desktop VPS lewat noVNC (XFCE, GNOME, x11vnc, xrdp) + pemindai port otomatis dan panduan pemasangan |

Sesi disimpan di **cookie + localStorage**, jadi pindah halaman **tidak perlu login ulang** dan sesi tidak hilang saat tab di-refresh.

---

## 1. Menjalankan di komputer sendiri (paling lengkap)

Butuh Node.js 20 atau lebih baru (Node 24 disarankan): <https://nodejs.org>

### Windows

Klik dua kali:

```
start.bat
```

Skrip itu memeriksa Node, menjalankan `npm install` bila `node_modules` belum ada, menyalakan server, lalu membuka browser ke `http://127.0.0.1:8787`.

### Tanpa browser (mode konsol)

```
ssh-console.bat
```

Ini menjalankan `node cli.js`: SSH interaktif langsung di Command Prompt, lengkap dengan penyimpan profil (`profiles.json`) dan password yang tidak tampil saat diketik.

### Linux / macOS

```bash
./start.sh
# atau
npm install && npm start
```

### Perintah npm

```bash
npm start     # server web (127.0.0.1:8787)
npm run dev   # sama, dengan log lebih cerewet
npm run cli   # konsol SSH tanpa browser
```

Ubah port/host bila perlu:

```bash
PORT=9000 HOST=0.0.0.0 npm start
```

> Secara bawaan server hanya mendengarkan `127.0.0.1` demi keamanan. Pakai `HOST=0.0.0.0` hanya jika Anda memang ingin diakses dari komputer lain di jaringan.

---

## 2. Deploy ke Vercel (akun **Free/Hobby**)

1. Push folder ini ke GitHub.
2. Di Vercel: **Add New → Project → Import** repo tersebut. Framework: **Other**. Build command dikosongkan.
3. **Settings → Environment Variables**, tambahkan:

   | Nama | Nilai |
   |---|---|
   | `XAYZ_SECRET` | teks acak panjang, mis. hasil `openssl rand -hex 32` |

4. Deploy.

`vercel.json` sudah disetel di dalam batas akun Free: `memory: 1024`, `maxDuration: 60`, tanpa cron, tanpa region berbayar.

### Yang perlu Anda tahu tentang Vercel Free

Vercel Hobby **tidak mendukung WebSocket maupun koneksi TCP persisten**. Karena itu aplikasi ini punya **dua mode yang dipilih otomatis**:

| | Mode Lokal (`npm start`) | Mode Serverless (Vercel) |
|---|---|---|
| Terminal biasa (`ls`, `apt`, `git`, `docker`) | ✅ | ✅ (streaming, warna ANSI, `cd` diingat) |
| Aplikasi layar penuh (`vim`, `nano`, `htop`, `top`) | ✅ | ❌ — pakai mode lokal |
| SFTP lengkap (upload/download/edit) | ✅ | ✅ |
| Desktop / Tampilan | ✅ lewat tunnel SSH | hanya bila VPS punya **websockify** publik |

Server mendeteksi sendiri lewat variabel lingkungan `VERCEL`, jadi tidak ada yang perlu Anda ubah.

Kalau Anda ingin semua fitur lewat internet, deploy-lah di VPS/Railway/Render/Fly yang mengizinkan WebSocket, atau cukup jalankan `start.bat` di komputer sendiri.

---

## 3. Menghubungkan VPS

Saat pertama membuka web, isi:

- **Host/IP** dan **Port** (bawaan 22)
- **User** (`root`, `ubuntu`, `admin`, dll.)
- **Password** *atau* **Private Key** (`.pem` / OpenSSH, boleh pakai passphrase)

### VPS NAT / port terbatas / di balik proxy

Buka bagian **Lanjutan** pada form login:

- **Proxy**: `auto`, `http` (CONNECT), `socks5`, `socks4`.
  Mode **auto** mencoba berurutan: koneksi langsung → proxy yang Anda isi → proxy dari variabel lingkungan (`HTTPS_PROXY`, `ALL_PROXY`, `SOCKS_PROXY`).
- **Jump host** (`ProxyJump`/bastion): isi dengan format
  ```
  user:password@host:port
  ```
  Boleh berantai, pisahkan dengan koma. Berguna untuk VPS NAT yang hanya bisa dicapai lewat server perantara.
- **Algoritma lama**: bila VPS memakai OpenSSH tua/Dropbear, aplikasi otomatis mencoba ulang dengan `ssh-rsa`, `diffie-hellman-group14-sha1`, `aes-cbc`, `hmac-sha1`.

Pesan galat ditulis dalam bahasa Indonesia beserta saran perbaikannya (port salah, password salah, host tidak dikenal, firewall, dan seterusnya).

---

## 4. Halaman Tampilan (desktop)

Tombol **Pindai** akan memeriksa port 5900–5919, 3389, dan 6080 di VPS Anda.

Belum ada desktop? Kartu panduan di halaman itu menyediakan perintah siap salin, misalnya:

```bash
sudo apt update
sudo apt install -y xfce4 xfce4-goodies tigervnc-standalone-server
vncpasswd
vncserver :1 -geometry 1280x720 -localhost yes
```

Karena `-localhost yes`, port VNC **tidak terbuka ke internet** — aplikasi ini menembusnya lewat tunnel SSH (mode lokal). Ini cara paling aman.

Untuk mode serverless, VPS perlu `websockify` yang bisa diakses publik:

```bash
sudo apt install -y websockify
websockify 6080 localhost:5901
```

---

## 5. Pintasan keyboard

| Pintasan | Fungsi |
|---|---|
| `Alt+1 / Alt+2 / Alt+3` | Terminal / Berkas / Tampilan |
| `Ctrl+Shift+T` | Tab terminal baru |
| `F11` atau tombol layar | Fullscreen |
| `Ctrl+C/D/Z/L/R/A/E/K/U/W` | Diteruskan apa adanya ke VPS |

Di HP tersedia **keypad 48 tombol** (Esc, Tab, Ctrl/Alt sticky, panah, Home/End, PgUp/PgDn, F1–F12, simbol `| / \ ~ - _ * & ^ $ #`) seperti JuiceSSH.

---

## 6. Keamanan

- Kredensial **tidak pernah disimpan di server**. Setelah login, data dibungkus jadi token **AES-256-GCM** (`lib/crypto.js`) yang hanya disimpan di browser Anda.
- Token dibuka kembali setiap permintaan memakai kunci `XAYZ_SECRET`. **Selalu isi `XAYZ_SECRET` di produksi** — tanpa itu dipakai kunci acak per-proses dan sesi akan hangus tiap deploy.
- Koneksi hangat dipakai ulang maksimum 12 dan menganggur 120 detik (`lib/pool.js`) supaya cepat tanpa boros memori.
- Header `Cache-Control: no-store` untuk seluruh respons API.
- Kalau memakainya lewat internet, **pasang HTTPS**. Password yang dikirim lewat HTTP polos bisa disadap.

---

## 7. Struktur berkas

```
server.js              server lokal: statis + /api/* + WebSocket /ws/term & /ws/vnc
api/index.js           entry serverless untuk Vercel
cli.js                 konsol SSH tanpa browser
lib/crypto.js          segel/buka token AES-256-GCM
lib/dialer.js          koneksi langsung, HTTP CONNECT, SOCKS5, SOCKS4/4a, mode auto
lib/ssh.js             autentikasi, jump host berantai, retry algoritma lama
lib/pool.js            cache koneksi hangat
lib/api.js             seluruh aksi RPC (exec, sftp, fileop, desktop)
public/js/icons.js     ikon file/folder gaya VS Code
public/js/term.js      xterm.js, tab, mode WS & mode exec
public/js/files.js     penjelajah SFTP, editor, syntax color, upload/download berpotongan
public/js/desktop.js   noVNC, pemindai port, panduan pemasangan
public/js/app.js       boot, login, sesi, keypad HP, tema
start.bat              peluncur Windows (dengan browser)
ssh-console.bat        peluncur Windows (tanpa browser)
```

---

## 8. Masalah yang sering muncul

| Gejala | Penyebab & solusi |
|---|---|
| `Token sesi tidak valid` | `XAYZ_SECRET` berubah atau server restart. Login ulang. |
| `vim`/`htop` tampil berantakan di Vercel | Wajar — mode serverless tidak punya PTY. Pakai mode lokal. |
| Upload folder tidak jalan | Pakai Chrome/Edge (perlu dukungan `webkitdirectory`). |
| Desktop gelap/kosong | Sesi VNC belum jalan: `vncserver :1`. Cek dengan tombol **Pindai**. |
| Koneksi lambat pertama kali | Handshake SSH. Berikutnya dipercepat oleh pool koneksi. |
| `npm install` gagal | Perbarui Node ke versi 20+ lalu hapus `node_modules` dan ulangi. |

---

Dibuat untuk Xayz. Selamat memakai.
