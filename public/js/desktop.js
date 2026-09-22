/* Halaman Tampilan: menampilkan desktop VPS (XFCE, LXDE, GNOME, atau layar
   yang sudah berjalan) melalui VNC, lengkap dengan pemasang otomatis.

   Dua jalur tampilan:
   1. Tunnel SSH  — hanya di mode lokal, VNC tidak perlu terbuka ke internet.
   2. Websockify  — VPS menyediakan ws://ip:6080/websockify, jalan di Vercel juga.

   Seluruh pemasangan desktop dikerjakan di halaman ini: pertanyaan, pilihan,
   password, log pemasangan, sampai layar tersambung. Tidak perlu membuka
   terminal sama sekali. */
(function (global) {
  'use strict';

  var RFB_URLS = [
    'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/lib/rfb.js',
    'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js'
  ];

  var rfb = null;
  var RFBClass = null;
  var hostEl, emptyEl;
  var lastProbe = null;
  var installing = false;

  function $(id) { return document.getElementById(id); }

  /** Bungkus teks menjadi argumen shell yang aman. */
  function q(s) {
    return "'" + String(s == null ? '' : s).replace(/'/g, "'\\''") + "'";
  }

  function loadRfb() {
    if (RFBClass) return Promise.resolve(RFBClass);
    var i = 0;
    function attempt() {
      if (i >= RFB_URLS.length) {
        return Promise.reject(new Error('Pustaka noVNC tidak bisa dimuat. Periksa koneksi internet.'));
      }
      var url = RFB_URLS[i++];
      return import(/* webpackIgnore: true */ url)
        .then(function (m) { RFBClass = m.default || m.RFB; return RFBClass; })
        .catch(attempt);
    }
    return attempt();
  }

  /* ------------------------------------------------- menjalankan perintah */

  /** Jalankan satu perintah di VPS sambil mengalirkan keluarannya ke panel log.
   *  Di mode lokal (Codespaces, komputer sendiri) dipakai jalur WebSocket yang
   *  TIDAK punya batas waktu buatan — cocok untuk "apt install" yang bisa makan
   *  beberapa menit. Di mode serverless (Vercel) baru dipakai jalur HTTP yang
   *  memang dibatasi oleh platform hosting.
   *  Mengembalikan { output, code, stop }. */
  function run(command, onChunk) {
    var all = '';
    var buf = ''; // baris yang sedang berjalan, sebelum \n atau \r berikutnya
    var stopFn = null;

    function feed(chunk) {
      all += chunk;
      var mark = chunk.indexOf('\u0001XAYZ_CWD:');
      var visible = mark === -1 ? chunk : chunk.slice(0, mark);
      // Buang kode escape ANSI (warna/kursor) yang tidak berarti apa-apa di <pre> polos.
      visible = visible.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
      if (!visible) return;
      // "\r" pada keluaran apt/curl berarti "timpa baris ini" (progress bar),
      // bukan baris baru. Tanpa penanganan ini teks progres saling menimpa
      // jadi satu baris panjang yang tidak terbaca.
      var parts = visible.split(/\r\n|\r|\n/);
      var hadTrailingBreak = /[\r\n]$/.test(visible);
      buf = (buf + parts[0]);
      if (parts.length > 1) {
        if (onChunk) onChunk(buf + '\n', true);
        buf = '';
        for (var i = 1; i < parts.length - 1; i++) { if (onChunk) onChunk(parts[i] + '\n', true); }
        buf = parts[parts.length - 1];
      }
      if (buf && !hadTrailingBreak && onChunk) onChunk(buf, false);
    }

    var mode = XayzApi.Session.mode;
    var task = (mode === 'local' ? XayzApi.execWs : XayzApi.execStream)(
      command, '~', 100, 30, feed
    );
    if (task && typeof task.stop === 'function') stopFn = task.stop;

    var result = task.then(function () {
      var code = 0;
      var m = all.match(/XAYZ_CWD:([^\u0001]*)\u0001XAYZ_RC:(\d+)/);
      if (m) code = Number(m[2]);
      var ci = all.indexOf('\u0001XAYZ_CWD:');
      return { output: ci === -1 ? all : all.slice(0, ci), code: code };
    });
    // .stop() harus bisa dipanggil SELAGI perintah masih berjalan, jadi
    // ditempelkan di promise yang benar-benar dikembalikan ke pemanggil,
    // bukan hanya disimpan di dalam nilai hasil resolve.
    result.stop = function () { if (stopFn) stopFn(); };
    return result;
  }

  /** Tambahkan hak root sesuai keadaan VPS. */
  function asRoot(cmd, sudoPass) {
    var p = lastProbe || {};
    if (p.isRoot) return cmd;
    if (p.sudo === 'tanpa-password') return 'sudo -n sh -c ' + q(cmd);
    return 'printf %s\\\\n ' + q(sudoPass || '') + ' | sudo -S -p "" sh -c ' + q(cmd);
  }

  /** Perintah pemasangan paket sesuai manajer paket yang ada. */
  function installCmd(packages) {
    var pkg = (lastProbe && lastProbe.pkg) || 'apt-get';
    var list = packages.join(' ');
    if (pkg === 'apt-get') {
      return 'export DEBIAN_FRONTEND=noninteractive; apt-get update -y && ' +
        'apt-get install -y --no-install-recommends ' + list;
    }
    if (pkg === 'dnf' || pkg === 'yum') return pkg + ' install -y ' + list;
    if (pkg === 'pacman') return 'pacman -Sy --noconfirm ' + list;
    if (pkg === 'zypper') return 'zypper --non-interactive install ' + list;
    if (pkg === 'apk') return 'apk add --no-cache ' + list;
    return 'echo "Manajer paket tidak dikenali. Pasang manual: ' + list + '"; exit 1';
  }

  /** Daftar paket untuk tiap pilihan dan tiap distro. */
  function packagesFor(choice) {
    var pkg = (lastProbe && lastProbe.pkg) || 'apt-get';
    var apt = pkg === 'apt-get';
    var rpm = pkg === 'dnf' || pkg === 'yum';
    var arch = pkg === 'pacman';

    var vnc = apt ? ['tigervnc-standalone-server', 'tigervnc-common']
      : rpm ? ['tigervnc-server'] : arch ? ['tigervnc'] : ['tigervnc'];

    if (choice === 'x11vnc') return ['x11vnc'];
    if (choice === 'lxde') {
      return (apt ? ['lxde-core', 'lxterminal', 'dbus-x11']
        : rpm ? ['@lxde-desktop'] : arch ? ['lxde'] : ['lxde']).concat(vnc);
    }
    // xfce (bawaan)
    return (apt ? ['xfce4', 'xfce4-terminal', 'dbus-x11']
      : rpm ? ['@xfce-desktop'] : arch ? ['xfce4'] : ['xfce4']).concat(vnc);
  }

  function sessionExec(choice) {
    return choice === 'lxde' ? 'startlxde' : 'startxfce4';
  }

  /* --------------------------------------------------- panel & tampilan */

  function setEmptyState(node) {
    emptyEl.innerHTML = '';
    emptyEl.appendChild(node);
    emptyEl.hidden = false;
  }

  function infoLine() {
    var p = lastProbe || {};
    var bits = [];
    if (p.os) bits.push(p.os);
    if (p.memMb) bits.push('RAM ' + p.memMb + ' MB');
    if (p.diskFreeMb) bits.push('sisa disk ' + Math.round(p.diskFreeMb / 1024 * 10) / 10 + ' GB');
    bits.push(p.isRoot ? 'akses root' : 'pengguna biasa (' + (p.user || '?') + ')');
    return bits.join(' · ');
  }

  /** Tampilan saat VNC sudah berjalan: tinggal isi password. */
  function readyPanel(port) {
    var box = UI.el('div', 'wiz');
    box.appendChild(UI.el('h2', null, 'Desktop sudah berjalan di VPS'));
    box.appendChild(UI.el('p', null,
      'Layanan VNC terdeteksi di port ' + port + '. Masukkan password VNC lalu sambungkan. ' + infoLine()));

    var field = UI.el('label', 'field');
    field.appendChild(UI.el('span', null, 'Password VNC'));
    var pw = document.createElement('input');
    pw.type = 'password';
    pw.placeholder = 'password yang dipakai saat memasang';
    field.appendChild(pw);
    box.appendChild(field);

    var row = UI.el('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.flexWrap = 'wrap';

    var go = UI.el('button', 'ghost-btn', 'Sambungkan layar');
    go.onclick = function () {
      $('dPort').value = port;
      $('dPass').value = pw.value;
      connect();
    };
    var again = UI.el('button', 'ghost-btn', 'Pasang ulang / pilihan lain');
    again.onclick = function () { wizardPanel(true); };
    row.appendChild(go);
    row.appendChild(again);
    box.appendChild(row);

    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });
    setEmptyState(box);
    setTimeout(function () { pw.focus(); }, 50);
  }

  /** Pertanyaan pemasangan: semuanya dijawab di halaman ini. */
  function wizardPanel(force) {
    var p = lastProbe || {};
    var box = UI.el('div', 'wiz');

    box.appendChild(UI.el('h2', null,
      force ? 'Pasang atau ganti desktop VPS' : 'Belum ada desktop di VPS ini. Pasang sekarang?'));
    box.appendChild(UI.el('p', null,
      'Semua langkah dikerjakan dari halaman ini — tidak perlu membuka terminal. ' + infoLine()));

    if (p.memMb && p.memMb < 700) {
      var warn = UI.el('p', null,
        'Catatan: RAM VPS hanya ' + p.memMb + ' MB. Pilih LXDE supaya tetap lancar.');
      warn.style.color = 'var(--warn)';
      box.appendChild(warn);
    }

    var choices = [
      ['xfce', 'XFCE + TigerVNC (disarankan)',
        'Desktop lengkap tapi ringan. Cocok untuk kebanyakan VPS dengan RAM 1 GB ke atas.'],
      ['lxde', 'LXDE + TigerVNC (paling ringan)',
        'Paling hemat RAM dan paling cepat di VPS kecil atau koneksi lambat.'],
      ['x11vnc', 'Pakai desktop yang sudah ada (x11vnc)',
        'Untuk VPS yang sudah punya layar aktif. Menampilkan layar yang sama persis.']
    ];
    var choice = p.binaries && p.binaries.some(function (b) {
      return b === 'xfce4-session' || b === 'gnome-session' || b === 'startlxde';
    }) ? 'x11vnc' : (p.memMb && p.memMb < 700 ? 'lxde' : 'xfce');

    var optNodes = [];
    choices.forEach(function (c) {
      var lab = UI.el('label', 'wiz-opt' + (c[0] === choice ? ' on' : ''));
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'xayz-de';
      radio.value = c[0];
      radio.checked = c[0] === choice;
      radio.onchange = function () {
        choice = c[0];
        optNodes.forEach(function (n) { n.classList.toggle('on', n.dataset.v === choice); });
        geoWrap.hidden = choice === 'x11vnc';
      };
      var txt = UI.el('div');
      txt.appendChild(UI.el('b', null, c[1]));
      txt.appendChild(UI.el('span', null, c[2]));
      lab.appendChild(radio);
      lab.appendChild(txt);
      lab.dataset.v = c[0];
      optNodes.push(lab);
      box.appendChild(lab);
    });

    // Resolusi
    var geoWrap = UI.el('label', 'field');
    geoWrap.appendChild(UI.el('span', null, 'Ukuran layar'));
    var geo = document.createElement('select');
    [['1280x720', '1280 × 720 — seimbang'],
     ['1024x600', '1024 × 600 — paling ringan'],
     ['1366x768', '1366 × 768'],
     ['1600x900', '1600 × 900'],
     ['1920x1080', '1920 × 1080 — butuh bandwidth besar']].forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      geo.appendChild(op);
    });
    geoWrap.appendChild(geo);
    geoWrap.hidden = choice === 'x11vnc';
    box.appendChild(geoWrap);

    // Password VNC
    var pwWrap = UI.el('label', 'field');
    pwWrap.appendChild(UI.el('span', null, 'Password VNC baru (6–8 karakter)'));
    var pw = document.createElement('input');
    pw.type = 'text';
    pw.value = randomPass();
    pw.spellcheck = false;
    pwWrap.appendChild(pw);
    box.appendChild(pwWrap);

    // Password sudo bila perlu
    var sudoWrap = UI.el('label', 'field');
    sudoWrap.appendChild(UI.el('span', null, 'Password sudo untuk ' + (p.user || 'pengguna ini')));
    var sudoPw = document.createElement('input');
    sudoPw.type = 'password';
    sudoPw.placeholder = 'password login VPS Anda';
    sudoWrap.appendChild(sudoPw);
    sudoWrap.hidden = !!p.isRoot || p.sudo === 'tanpa-password';
    box.appendChild(sudoWrap);

    if (!p.isRoot && p.sudo === 'tidak-ada') {
      var bad = UI.el('p', null,
        'Pengguna ini bukan root dan sudo tidak tersedia, jadi pemasangan paket tidak bisa dilakukan. ' +
        'Login ulang sebagai root, atau minta penyedia VPS memberi akses sudo.');
      bad.style.color = 'var(--danger)';
      box.appendChild(bad);
    }

    var row = UI.el('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.flexWrap = 'wrap';

    var install = UI.el('button', 'ghost-btn', 'Pasang otomatis sekarang');
    install.style.borderColor = 'var(--accent)';
    install.style.color = 'var(--accent)';
    install.onclick = function () {
      if (pw.value.length < 6) return UI.toast('Password VNC minimal 6 karakter.', 'warn');
      if (!p.isRoot && p.sudo === 'butuh-password' && !sudoPw.value) {
        return UI.toast('Isi password sudo dulu.', 'warn');
      }
      startInstall({
        choice: choice,
        geometry: geo.value,
        vncPass: pw.value.slice(0, 8),
        sudoPass: sudoPw.value
      });
    };

    var manual = UI.el('button', 'ghost-btn', 'Lihat perintah manual');
    manual.onclick = function () { manualPanel(); };

    var recheck = UI.el('button', 'ghost-btn', 'Periksa ulang VPS');
    recheck.onclick = function () { probe(true); };

    row.appendChild(install);
    row.appendChild(recheck);
    row.appendChild(manual);
    box.appendChild(row);

    setEmptyState(box);
  }

  function randomPass() {
    var abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    var s = '';
    for (var i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  /* -------------------------------------------------- pemasangan otomatis */

  function startInstall(opts) {
    if (installing) return;
    installing = true;

    var box = UI.el('div', 'wiz');
    box.appendChild(UI.el('h2', null, 'Memasang desktop…'));
    box.appendChild(UI.el('p', null,
      XayzApi.Session.mode === 'local'
        ? 'Jangan tutup halaman ini. Bergantung kecepatan VPS dan koneksi internetnya, proses ini bisa memakan beberapa menit — tidak ada batas waktu buatan selama tab ini tetap terbuka.'
        : 'Jangan tutup halaman ini. Mode serverless (Vercel) membatasi setiap langkah sekitar 50 detik. Bila VPS Anda lambat, sebagian langkah bisa gagal karena batas ini — jalankan aplikasi di komputer/VPS sendiri (npm start) untuk pemasangan tanpa batas waktu.'));

    var stepsBox = UI.el('div', 'wiz-steps');
    box.appendChild(stepsBox);

    var log = UI.el('pre', 'wiz-log');
    box.appendChild(log);

    var actions = UI.el('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.flexWrap = 'wrap';
    box.appendChild(actions);

    setEmptyState(box);

    var committedLog = '';
    var liveLine = '';
    function write(text, committed) {
      if (committed) { committedLog += text; liveLine = ''; }
      else { liveLine = text; }
      var shown = committedLog + liveLine;
      if (shown.length > 120000) {
        committedLog = committedLog.slice(-80000);
        shown = committedLog + liveLine;
      }
      log.textContent = shown;
      log.scrollTop = log.scrollHeight;
    }

    var home = '"$HOME"';
    var pkgs = packagesFor(opts.choice);
    var sess = sessionExec(opts.choice);
    var port = opts.choice === 'x11vnc' ? 5900 : 5901;

    var vncSetup =
      'mkdir -p ' + home + '/.vnc && ' +
      'printf %s\\\\n ' + q(opts.vncPass) + ' | vncpasswd -f > ' + home + '/.vnc/passwd && ' +
      'chmod 600 ' + home + '/.vnc/passwd && ' +
      'printf %s\\\\n ' +
      q('#!/bin/sh') + ' ' +
      q('unset SESSION_MANAGER') + ' ' +
      q('unset DBUS_SESSION_BUS_ADDRESS') + ' ' +
      q('export XDG_SESSION_TYPE=x11') + ' ' +
      q('[ -x /usr/bin/dbus-launch ] && eval "$(dbus-launch --sh-syntax --exit-with-session)"') + ' ' +
      q('exec ' + sess) +
      ' > ' + home + '/.vnc/xstartup && chmod +x ' + home + '/.vnc/xstartup && ' +
      'echo "berkas VNC siap"';

    var vncStart =
      'VNC=$(command -v vncserver || command -v tigervncserver); ' +
      '[ -z "$VNC" ] && { echo "vncserver tidak ditemukan"; exit 1; }; ' +
      '"$VNC" -kill :1 >/dev/null 2>&1; ' +
      '"$VNC" :1 -localhost yes -geometry ' + opts.geometry + ' -depth 24 ' +
      '-SecurityTypes VncAuth -rfbauth ' + home + '/.vnc/passwd 2>&1 | tail -20; ' +
      'sleep 2; (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep 5901 || echo "port 5901 belum terbuka"';

    var x11Start =
      'x11vnc -storepasswd ' + q(opts.vncPass) + ' ' + home + '/.vnc/passwd >/dev/null 2>&1; ' +
      'pkill x11vnc >/dev/null 2>&1; ' +
      'x11vnc -display :0 -rfbauth ' + home + '/.vnc/passwd -localhost -forever -shared -bg -o /tmp/x11vnc.log; ' +
      'sleep 2; tail -5 /tmp/x11vnc.log; ' +
      '(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep 5900 || echo "port 5900 belum terbuka"';

    var steps = [
      ['Memeriksa sistem', 'uname -a; echo "manajer paket: ' + (lastProbe.pkg || 'tidak diketahui') + '"'],
      ['Memasang paket (' + pkgs.join(', ') + ')', asRoot(installCmd(pkgs), opts.sudoPass)]
    ];
    if (opts.choice === 'x11vnc') {
      steps.push(['Menyalakan x11vnc', 'mkdir -p ' + home + '/.vnc; ' + x11Start]);
    } else {
      steps.push(['Menyiapkan password dan sesi VNC', vncSetup]);
      steps.push(['Menyalakan layar VNC', vncStart]);
    }

    var marks = steps.map(function (s) {
      var line = UI.el('div');
      var icon = UI.el('i', null, '○');
      line.appendChild(icon);
      line.appendChild(document.createTextNode(' ' + s[0]));
      stepsBox.appendChild(line);
      return icon;
    });

    var i = 0;
    var currentTask = null;
    var userStopped = false;

    var stopBtn = UI.el('button', 'ghost-btn danger', 'Berhenti');
    stopBtn.onclick = function () {
      userStopped = true;
      if (currentTask) currentTask.stop();
    };
    actions.appendChild(stopBtn);

    function next() {
      if (i >= steps.length) return finish(true);
      marks[i].className = 'run';
      marks[i].textContent = '●';
      write('\n$ ' + steps[i][0] + '\n', true);
      UI.progress('Pemasangan: ' + steps[i][0], (i + 0.5) / steps.length);

      currentTask = run(steps[i][1], write);
      currentTask.then(function (r) {
        if (userStopped) {
          marks[i].className = 'fail';
          marks[i].textContent = '✕';
          return finish(false, 'Pemasangan dihentikan.');
        }
        var failed = r.code !== 0 ||
          /belum terbuka|tidak ditemukan|Manajer paket tidak dikenali/.test(r.output);
        // Password sudo salah punya pesan khas
        if (/incorrect password|Sorry, try again/i.test(r.output)) {
          marks[i].className = 'fail';
          marks[i].textContent = '✕';
          return finish(false, 'Password sudo salah. Coba lagi dengan password yang benar.');
        }
        if (failed && i === 1) {
          marks[i].className = 'fail';
          marks[i].textContent = '✕';
          return finish(false, 'Pemasangan paket gagal. Baca log di atas — biasanya karena disk penuh, tidak ada koneksi internet di VPS, atau repositori belum diperbarui.');
        }
        marks[i].className = failed ? 'fail' : 'done';
        marks[i].textContent = failed ? '✕' : '✓';
        if (failed) return finish(false, 'Langkah "' + steps[i][0] + '" gagal. Rincian ada di log.');
        i++;
        next();
      }).catch(function (e) {
        marks[i].className = 'fail';
        marks[i].textContent = '✕';
        finish(false, userStopped ? 'Pemasangan dihentikan.' : e.message);
      });
    }

    function finish(ok, msg) {
      installing = false;
      UI.progress(null);
      actions.innerHTML = '';

      if (ok) {
        write('\nSelesai. Menyambungkan layar…\n', true);
        UI.toast('Desktop terpasang. Password VNC: ' + opts.vncPass, 'ok', 12000);
        $('dPort').value = port;
        $('dPass').value = opts.vncPass;
        var back = UI.el('button', 'ghost-btn', 'Tutup log');
        back.onclick = function () { probe(true); };
        actions.appendChild(back);
        setTimeout(function () { connect(); }, 1200);
      } else {
        write('\n' + (msg || 'Pemasangan berhenti.') + '\n', true);
        UI.toast(msg || 'Pemasangan gagal.', 'err', 9000);
        var retry = UI.el('button', 'ghost-btn', 'Coba lagi');
        retry.onclick = function () { wizardPanel(true); };
        var manual = UI.el('button', 'ghost-btn', 'Lihat perintah manual');
        manual.onclick = function () { manualPanel(); };
        actions.appendChild(retry);
        actions.appendChild(manual);
      }
    }

    next();
  }

  /* ----------------------------------------------------- panduan manual */

  function manualPanel() {
    var cards = [
      {
        title: 'Pasang desktop ringan + VNC (Debian/Ubuntu)',
        text: 'Sama persis dengan yang dikerjakan tombol pemasangan otomatis.',
        code:
          'sudo apt update\n' +
          'sudo apt install -y --no-install-recommends xfce4 xfce4-terminal dbus-x11 tigervnc-standalone-server\n' +
          'vncpasswd\n' +
          "printf '#!/bin/sh\\nunset SESSION_MANAGER\\nunset DBUS_SESSION_BUS_ADDRESS\\nexec startxfce4\\n' > ~/.vnc/xstartup\n" +
          'chmod +x ~/.vnc/xstartup\n' +
          'vncserver :1 -localhost yes -geometry 1280x720 -depth 24'
      },
      {
        title: 'Layar yang sudah berjalan (x11vnc)',
        text: 'Untuk VPS yang sudah punya desktop aktif dan ingin dilihat apa adanya.',
        code:
          'sudo apt install -y x11vnc\n' +
          'x11vnc -storepasswd\n' +
          'x11vnc -display :0 -rfbauth ~/.vnc/passwd -localhost -forever -shared -bg'
      },
      {
        title: 'Agar bisa dibuka dari Vercel (websockify)',
        text: 'Mode tunnel hanya ada saat aplikasi dijalankan di komputer sendiri. Versi Vercel butuh titik WebSocket di VPS.',
        code:
          'sudo apt install -y novnc websockify\n' +
          'websockify --web=/usr/share/novnc 6080 localhost:5901 &\n' +
          '# lalu isi kolom alamat di atas: ws://IP-VPS:6080/websockify'
      }
    ];

    var box = UI.el('div', 'desk-setup');
    var back = UI.el('button', 'ghost-btn', '← Kembali ke pemasangan otomatis');
    back.style.alignSelf = 'flex-start';
    back.onclick = function () { wizardPanel(true); };
    box.appendChild(back);

    cards.forEach(function (l) {
      var card = UI.el('div', 'setup-card');
      card.appendChild(UI.el('h3', null, l.title));
      card.appendChild(UI.el('p', null, l.text));
      card.appendChild(UI.el('pre', null, l.code));
      var row = UI.el('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.flexWrap = 'wrap';
      var copy = UI.el('button', 'ghost-btn', 'Salin perintah');
      copy.onclick = function () {
        try { navigator.clipboard.writeText(l.code); UI.toast('Perintah disalin', 'ok', 1500); }
        catch (e) { UI.toast('Salin manual dari kotak di atas.', 'warn'); }
      };
      var runIt = UI.el('button', 'ghost-btn', 'Kirim ke terminal');
      runIt.onclick = function () {
        global.XayzApp.setView('terminal');
        UI.toast('Perintah dikirim ke terminal. Periksa dulu sebelum menekan Enter.', 'warn', 5000);
        XayzTerm.sendKey(l.code.split('\n').filter(function (x) {
          return x && x[0] !== '#';
        }).join('\n'));
      };
      row.appendChild(copy);
      row.appendChild(runIt);
      card.appendChild(row);
      box.appendChild(card);
    });

    setEmptyState(box);
  }

  /* ------------------------------------------------------ sambung layar */

  function disconnect() {
    if (rfb) {
      try { rfb.disconnect(); } catch (e) {}
      rfb = null;
    }
    var canvasHost = $('deskCanvas');
    if (canvasHost) canvasHost.remove();
    if (emptyEl) emptyEl.hidden = false;
  }

  function connect() {
    var source = $('dSource').value;
    var password = $('dPass').value;
    var scale = $('dScale').checked;
    var viewOnly = $('dView').checked;

    var url;
    if (source === 'tunnel') {
      if (XayzApi.Session.mode !== 'local') {
        return UI.toast(
          'Tunnel SSH butuh WebSocket, yang tidak tersedia di Vercel. Jalankan aplikasi ini di komputer sendiri, atau pilih mode websockify.',
          'warn', 8000
        );
      }
      var port = Number($('dPort').value) || 5901;
      url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
        '/ws/vnc?token=' + encodeURIComponent(XayzApi.Session.token) +
        '&host=127.0.0.1&port=' + port;
    } else {
      url = $('dUrl').value.trim();
      if (!url) return UI.toast('Isi alamat websockify, contoh ws://1.2.3.4:6080/websockify', 'warn');
      if (location.protocol === 'https:' && url.indexOf('ws://') === 0) {
        return UI.toast(
          'Halaman ini memakai HTTPS, jadi alamat VNC harus wss:// (bukan ws://). Pasang sertifikat di websockify atau buka aplikasi lewat http lokal.',
          'err', 9000
        );
      }
    }

    disconnect();
    UI.progress('Menyambungkan layar…', 0.5);

    loadRfb().then(function (RFB) {
      var canvasHost = UI.el('div');
      canvasHost.id = 'deskCanvas';
      canvasHost.style.position = 'absolute';
      canvasHost.style.inset = '0';
      hostEl.appendChild(canvasHost);
      emptyEl.hidden = true;

      rfb = new RFB(canvasHost, url, {
        credentials: { password: password },
        wsProtocols: ['binary']
      });
      rfb.viewOnly = viewOnly;
      rfb.scaleViewport = scale;
      rfb.resizeSession = !scale;
      rfb.clipViewport = false;
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 4;

      rfb.addEventListener('connect', function () {
        UI.progress(null);
        UI.toast('Layar tersambung', 'ok');
      });
      rfb.addEventListener('disconnect', function (e) {
        UI.progress(null);
        var clean = e.detail && e.detail.clean;
        UI.toast(clean ? 'Layar terputus.'
          : 'Layar terputus. Periksa port VNC, password, dan apakah vncserver masih berjalan.',
          clean ? '' : 'err', 7000);
        disconnect();
      });
      rfb.addEventListener('credentialsrequired', function () {
        UI.prompt('Password VNC', 'Password', '').then(function (p) {
          if (p != null) rfb.sendCredentials({ password: p });
        });
      });
      rfb.addEventListener('securityfailure', function (e) {
        UI.toast('Autentikasi VNC gagal: ' + ((e.detail && e.detail.reason) || 'password salah'), 'err');
      });
    }).catch(function (e) {
      UI.progress(null);
      UI.toast(e.message, 'err');
    });
  }

  /* ------------------------------------------------------------- deteksi */

  function checkingPanel() {
    var box = UI.el('div', 'wiz');
    box.appendChild(UI.el('h2', null, 'Memeriksa VPS…'));
    box.appendChild(UI.el('p', null,
      'Mencari desktop dan layanan VNC yang sudah berjalan. Sebentar saja.'));
    setEmptyState(box);
  }

  /** Dijalankan otomatis setiap kali halaman Tampilan dibuka. */
  function probe(loud) {
    if (installing) return Promise.resolve();
    checkingPanel();
    return XayzApi.rpc('desktop.probe').then(function (r) {
      lastProbe = r;
      var vnc = (r.ports || []).filter(function (p) { return p >= 5900 && p < 5920; })[0];
      if (vnc) {
        $('dPort').value = vnc;
        readyPanel(vnc);
        if (loud) UI.toast('VNC terdeteksi di port ' + vnc + '.', 'ok', 4000);
      } else {
        wizardPanel(false);
        if (loud) UI.toast('Belum ada desktop. Ikuti pertanyaan di halaman ini.', 'warn', 5000);
      }
    }).catch(function (e) {
      lastProbe = lastProbe || {};
      var box = UI.el('div', 'wiz');
      box.appendChild(UI.el('h2', null, 'Gagal memeriksa VPS'));
      box.appendChild(UI.el('p', null, e.message));
      var again = UI.el('button', 'ghost-btn', 'Coba lagi');
      again.style.alignSelf = 'flex-start';
      again.onclick = function () { probe(true); };
      box.appendChild(again);
      setEmptyState(box);
    });
  }

  function init() {
    hostEl = $('deskHost');
    emptyEl = $('deskEmpty');


    var sourceSel = $('dSource');
    var portInput = $('dPort');
    var urlInput = $('dUrl');

    if (XayzApi.Session.mode !== 'local') {
      sourceSel.value = 'direct';
      sourceSel.options[0].textContent = 'Tunnel SSH (hanya saat dijalankan lokal)';
    }
    function syncSource() {
      var direct = sourceSel.value === 'direct';
      urlInput.hidden = !direct;
      portInput.hidden = direct;
    }
    sourceSel.onchange = syncSource;
    syncSource();

    $('dConnect').onclick = connect;
    $('dProbe').onclick = function () { probe(true); };
    $('dCtrlAltDel').onclick = function () {
      if (rfb) rfb.sendCtrlAltDel();
      else UI.toast('Sambungkan layar dulu.', 'warn');
    };
    $('dScale').onchange = function () {
      if (rfb) { rfb.scaleViewport = this.checked; rfb.resizeSession = !this.checked; }
    };
    $('dView').onchange = function () {
      if (rfb) rfb.viewOnly = this.checked;
    };

    // Deteksi otomatis begitu halaman dibuka.
    probe(false);
  }

  global.XayzDesktop = { init: init, connect: connect, disconnect: disconnect, probe: probe };
})(window);
