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

Sesi disimpan di **cookie + localStorage**. Pindah antar ketiga halaman **tidak pernah minta login ulang** dan sesi tidak hilang saat tab di-refresh.

Saat aplikasi dibuka, yang pertama muncul **selalu layar login SSH** — tidak pernah langsung melompat ke halaman terakhir. Kalau ada sesi tersimpan, di layar login muncul kartu "Lanjutkan sesi `user@host`": satu ketukan untuk masuk tanpa mengetik ulang apa pun, atau "Sesi baru" untuk membuangnya. Setelah masuk, aplikasi selalu mulai dari halaman Terminal.

Tata letaknya bekerja penuh dalam **mode potret di HP** — tidak perlu memiringkan layar.

---

## 1. Menjalankan di komputer sendiri (paling lengkap)

### Windows — klik dua kali saja

```
start.bat          → server + browser
ssh-console.bat    → SSH langsung di Command Prompt, tanpa browser
```

**Komputer tidak perlu punya OpenSSH.** Tidak perlu ada perintah `ssh`, tidak perlu "OpenSSH Client" di Optional Features, tidak perlu PuTTY. Seluruh protokol SSH dikerjakan oleh pustaka `ssh2` (JavaScript murni) di dalam aplikasi ini.

**Node.js juga tidak wajib terpasang.** Kedua `.bat` di atas memanggil `bootstrap.bat` yang bekerja begini:

1. Cari Node.js di sistem. Ada → pakai itu.
2. Tidak ada → cari Node portabel di `runtime\node\`.
3. Masih tidak ada → unduh Node portabel (file zip biasa) dari nodejs.org ke folder `runtime\`, ekstrak dengan PowerShell bawaan Windows.
4. Pasang pustaka `ssh2` lewat npm bila belum ada.

Tidak ada yang dipasang ke sistem, registry tidak disentuh, **hak admin tidak dibutuhkan**. Hapus folder `runtime\` dan jejaknya hilang. Kalau Node 22 menolak jalan (Windows 7/8), skrip otomatis mundur ke Node 16 yang masih mendukungnya.

Satu-satunya yang dibutuhkan saat pertama kali: koneksi internet untuk mengunduh. Sesudah itu folder aplikasi bisa disalin ke flashdisk dan dijalankan di komputer lain yang sama sekali tidak punya Node maupun SSH.

`ssh-console.bat` menjalankan `cli.js`: SSH interaktif di Command Prompt, lengkap dengan penyimpan profil (`profiles.json`) dan password yang tidak tampil saat diketik.

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

## 4. Halaman Tampilan (desktop) — pemasangan otomatis

Begitu halaman Tampilan dibuka, aplikasi langsung memeriksa VPS sendiri: port 5900–5919, 3389, 6080, program yang sudah terpasang, distro, manajer paket, RAM, sisa disk, dan apakah Anda root atau butuh sudo.

**Kalau sudah ada VNC** → halaman langsung menawarkan kolom password dan tombol sambungkan.

**Kalau belum ada desktop** → muncul pertanyaan "Belum ada desktop di VPS ini. Pasang sekarang?" beserta pilihan:

| Pilihan | Untuk siapa |
|---|---|
| XFCE + TigerVNC | VPS 1 GB ke atas, desktop lengkap tapi ringan |
| LXDE + TigerVNC | VPS kecil atau koneksi lambat, paling hemat RAM |
| x11vnc | VPS yang sudah punya layar aktif, ditampilkan apa adanya |

Ditambah pilihan resolusi, password VNC (dibuatkan otomatis, bisa diganti), dan kolom password sudo yang hanya muncul kalau memang dibutuhkan.

Tekan **Pasang otomatis sekarang**, lalu semuanya berjalan di halaman itu: daftar langkah dengan tanda centang, log pemasangan yang mengalir langsung dari VPS, deteksi kegagalan (password sudo salah, disk penuh, paket tidak ada), dan setelah selesai layar tersambung sendiri. **Tidak perlu membuka terminal, tidak perlu mengetik satu perintah pun.** Kalau Anda tetap ingin melakukannya manual, ada tombol "Lihat perintah manual".

VNC dipasang dengan `-localhost yes`, jadi port VNC **tidak terbuka ke internet** — aplikasi menembusnya lewat tunnel SSH (mode lokal). Ini cara paling aman.

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
bootstrap.bat          penyiap Node portabel — untuk komputer tanpa Node & tanpa SSH
```

---

## 8. Masalah yang sering muncul

| Gejala | Penyebab & solusi |
|---|---|
| `Token sesi tidak valid` | `XAYZ_SECRET` berubah atau server restart. Login ulang. |
| `vim`/`htop` tampil berantakan di Vercel | Wajar — mode serverless tidak punya PTY. Pakai mode lokal. |
| Upload folder tidak jalan | Pakai Chrome/Edge (perlu dukungan `webkitdirectory`). |
| Desktop gelap/kosong | Buka halaman Tampilan lalu tekan **Deteksi**; kalau belum ada, pakai pemasang otomatis di halaman itu. |
| Pemasangan desktop berhenti di langkah paket | Baca log di halaman: umumnya disk VPS penuh, VPS tidak punya internet, atau password sudo salah. |
| `bootstrap.bat` gagal mengunduh Node | Jaringan memblokir nodejs.org. Unduh zip-nya manual, ekstrak ke `runtime\node\` sampai ada `runtime\node\node.exe`. |
| Koneksi lambat pertama kali | Handshake SSH. Berikutnya dipercepat oleh pool koneksi. |
| `npm install` gagal | Perbarui Node ke versi 20+ lalu hapus `node_modules` dan ulangi. |

---

Dibuat untuk Xayz. Selamat memakai.
