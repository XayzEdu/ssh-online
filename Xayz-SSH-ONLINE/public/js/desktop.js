/* Halaman Tampilan: menampilkan desktop VPS (XFCE, GNOME, LXDE, atau xrdp)
   melalui VNC. Dua jalur:
   1. Tunnel SSH  — hanya di mode lokal, VNC tidak perlu terbuka ke internet.
   2. Websockify   — VPS menyediakan ws://ip:6080/websockify, jalan di Vercel juga. */
(function (global) {
  'use strict';

  var RFB_URLS = [
    'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/lib/rfb.js',
    'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js'
  ];

  var rfb = null;
  var RFBClass = null;
  var hostEl, emptyEl;

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

  function setupCards(probe) {
    var lines = [];

    if (probe && probe.ports && probe.ports.length) {
      lines.push({
        title: 'Layanan terdeteksi',
        text: 'Port yang sedang mendengarkan di VPS: ' + probe.ports.join(', ') +
          (probe.binaries && probe.binaries.length ? '. Program terpasang: ' + probe.binaries.join(', ') + '.' : '.'),
        code: null
      });
    }

    lines.push({
      title: 'Pasang desktop ringan + VNC (Debian/Ubuntu)',
      text: 'XFCE dipilih karena paling ringan. Jalankan sekali saja, lalu setel password VNC.',
      code:
        'sudo apt update\n' +
        'sudo apt install -y xfce4 xfce4-goodies tigervnc-standalone-server tigervnc-common\n' +
        'vncpasswd\n' +
        "printf '#!/bin/sh\\nunset SESSION_MANAGER\\nunset DBUS_SESSION_BUS_ADDRESS\\nstartxfce4 &\\n' > ~/.vnc/xstartup\n" +
        'chmod +x ~/.vnc/xstartup\n' +
        'vncserver -localhost yes -geometry 1280x720 -depth 24 :1'
    });

    lines.push({
      title: 'Layar yang sudah berjalan (x11vnc)',
      text: 'Kalau VPS sudah punya desktop aktif dan Anda ingin melihat layar yang sama persis.',
      code:
        'sudo apt install -y x11vnc\n' +
        'x11vnc -storepasswd\n' +
        'x11vnc -display :0 -rfbauth ~/.vnc/passwd -localhost -forever -shared -bg'
    });

    lines.push({
      title: 'Agar bisa dibuka dari Vercel (websockify)',
      text: 'Mode tunnel hanya tersedia saat aplikasi dijalankan di komputer sendiri. Untuk versi yang dideploy di Vercel, VPS harus menyediakan titik WebSocket sendiri.',
      code:
        'sudo apt install -y novnc websockify\n' +
        'websockify --web=/usr/share/novnc 6080 localhost:5901 &\n' +
        '# lalu isi kolom di atas dengan: ws://IP-VPS:6080/websockify\n' +
        '# sangat disarankan pasang TLS (wss://) sebelum membukanya ke internet'
    });

    var wrap = document.getElementById('deskSetup');
    wrap.innerHTML = '';
    lines.forEach(function (l) {
      var card = UI.el('div', 'setup-card');
      card.appendChild(UI.el('h3', null, l.title));
      card.appendChild(UI.el('p', null, l.text));
      if (l.code) {
        var pre = UI.el('pre', null, l.code);
        card.appendChild(pre);
        var row = UI.el('div');
        row.style.display = 'flex';
        row.style.gap = '8px';
        var copy = UI.el('button', 'ghost-btn', 'Salin perintah');
        copy.onclick = function () {
          navigator.clipboard.writeText(l.code);
          UI.toast('Perintah disalin', 'ok', 1500);
        };
        var run = UI.el('button', 'ghost-btn', 'Jalankan di terminal');
        run.onclick = function () {
          global.XayzApp.setView('terminal');
          UI.toast('Perintah dikirim ke terminal. Periksa dulu sebelum menekan Enter.', 'warn', 5000);
          XayzTerm.sendKey(l.code.split('\n').filter(function (x) {
            return x && x[0] !== '#';
          }).join('\n'));
        };
        row.appendChild(copy);
        row.appendChild(run);
        card.appendChild(row);
      }
      wrap.appendChild(card);
    });
  }

  function disconnect() {
    if (rfb) {
      try { rfb.disconnect(); } catch (e) {}
      rfb = null;
    }
    var canvasHost = document.getElementById('deskCanvas');
    if (canvasHost) canvasHost.remove();
    emptyEl.hidden = false;
  }

  function connect() {
    var source = document.getElementById('dSource').value;
    var password = document.getElementById('dPass').value;
    var scale = document.getElementById('dScale').checked;
    var viewOnly = document.getElementById('dView').checked;

    var url;
    if (source === 'tunnel') {
      if (XayzApi.Session.mode !== 'local') {
        return UI.toast(
          'Tunnel SSH butuh WebSocket, yang tidak tersedia di Vercel. Jalankan aplikasi ini di komputer sendiri, atau pilih mode websockify.',
          'warn', 8000
        );
      }
      var port = Number(document.getElementById('dPort').value) || 5901;
      url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
        '/ws/vnc?token=' + encodeURIComponent(XayzApi.Session.token) +
        '&host=127.0.0.1&port=' + port;
    } else {
      url = document.getElementById('dUrl').value.trim();
      if (!url) return UI.toast('Isi alamat websockify, contoh ws://1.2.3.4:6080/websockify', 'warn');
      if (location.protocol === 'https:' && url.startsWith('ws://')) {
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
      rfb.compressionLevel = 4;   // kompresi lebih tinggi = hemat bandwidth

      rfb.addEventListener('connect', function () {
        UI.progress(null);
        UI.toast('Layar tersambung', 'ok');
      });
      rfb.addEventListener('disconnect', function (e) {
        UI.progress(null);
        var clean = e.detail && e.detail.clean;
        UI.toast(clean ? 'Layar terputus.' : 'Layar terputus tanpa sebab yang jelas. Periksa port VNC, password, dan apakah vncserver masih berjalan.', clean ? '' : 'err', 7000);
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

  function probe() {
    UI.progress('Memeriksa VPS…', 0.5);
    XayzApi.rpc('desktop.probe').then(function (r) {
      UI.progress(null);
      setupCards(r);
      if (r.ports.length) {
        var vnc = r.ports.find(function (p) { return p >= 5900 && p < 5920; });
        if (vnc) {
          document.getElementById('dPort').value = vnc;
          UI.toast('VNC terdeteksi di port ' + vnc + '. Isi password lalu tekan Sambungkan layar.', 'ok', 6000);
        } else {
          UI.toast('Port terkait ditemukan: ' + r.ports.join(', '), 'ok', 5000);
        }
      } else {
        UI.toast('Belum ada layanan layar yang berjalan. Ikuti panduan pemasangan di bawah.', 'warn', 6000);
      }
    }).catch(function (e) {
      UI.progress(null);
      UI.toast(e.message, 'err');
    });
  }

  function init() {
    hostEl = document.getElementById('deskHost');
    emptyEl = document.getElementById('deskEmpty');
    setupCards(null);

    var sourceSel = document.getElementById('dSource');
    var portInput = document.getElementById('dPort');
    var urlInput = document.getElementById('dUrl');

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

    document.getElementById('dConnect').onclick = connect;
    document.getElementById('dProbe').onclick = probe;
    document.getElementById('dCtrlAltDel').onclick = function () {
      if (rfb) rfb.sendCtrlAltDel();
      else UI.toast('Sambungkan layar dulu.', 'warn');
    };
    document.getElementById('dScale').onchange = function () {
      if (rfb) { rfb.scaleViewport = this.checked; rfb.resizeSession = !this.checked; }
    };
    document.getElementById('dView').onchange = function () {
      if (rfb) rfb.viewOnly = this.checked;
    };
  }

  global.XayzDesktop = { init: init, connect: connect, disconnect: disconnect, probe: probe };
})(window);
