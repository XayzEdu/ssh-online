/* Komponen antarmuka kecil: notifikasi, dialog, bilah progres,
   pemuat skrip yang hanya berjalan saat benar-benar dibutuhkan. */
(function (global) {
  'use strict';

  var toastRoot = null;
  var modalRoot = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function toast(message, kind, ms) {
    toastRoot = toastRoot || document.getElementById('toasts');
    if (!toastRoot) return;
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''), String(message));
    toastRoot.appendChild(t);
    var life = ms || (kind === 'err' ? 7000 : 3600);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity .2s';
      setTimeout(function () { t.remove(); }, 220);
    }, life);
    return t;
  }

  function closeModal() {
    modalRoot = modalRoot || document.getElementById('modalRoot');
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
  }

  function modal(opts) {
    modalRoot = modalRoot || document.getElementById('modalRoot');
    modalRoot.innerHTML = '';
    modalRoot.hidden = false;

    var box = el('div', 'modal');
    box.appendChild(el('h3', null, opts.title || ''));
    if (opts.text) box.appendChild(el('p', null, opts.text));

    var inputs = [];
    (opts.fields || []).forEach(function (f) {
      var lab = el('label', 'field');
      lab.appendChild(el('span', null, f.label));
      var input;
      if (f.type === 'select') {
        input = document.createElement('select');
        (f.options || []).forEach(function (o) {
          var op = document.createElement('option');
          op.value = o.value; op.textContent = o.label;
          input.appendChild(op);
        });
      } else if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = f.rows || 4;
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
      }
      input.value = f.value == null ? '' : f.value;
      if (f.placeholder) input.placeholder = f.placeholder;
      input.spellcheck = false;
      lab.appendChild(input);
      box.appendChild(lab);
      inputs.push({ name: f.name, el: input });
    });

    var actions = el('div', 'modal-actions');
    var cancel = el('button', 'ghost-btn', opts.cancelText || 'Batal');
    var ok = el('button', 'ghost-btn' + (opts.danger ? ' danger' : ''), opts.okText || 'Lanjut');
    ok.style.borderColor = opts.danger ? 'var(--danger)' : 'var(--accent)';
    ok.style.color = opts.danger ? 'var(--danger)' : 'var(--accent)';

    return new Promise(function (resolve) {
      function done(value) { closeModal(); resolve(value); }
      cancel.onclick = function () { done(null); };
      ok.onclick = function () {
        var out = {};
        inputs.forEach(function (i) { out[i.name] = i.el.value; });
        done(opts.fields && opts.fields.length ? out : true);
      };
      modalRoot.onclick = function (e) { if (e.target === modalRoot) done(null); };
      document.addEventListener('keydown', function esc(e) {
        if (modalRoot.hidden) { document.removeEventListener('keydown', esc); return; }
        if (e.key === 'Escape') { document.removeEventListener('keydown', esc); done(null); }
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
          document.removeEventListener('keydown', esc);
          ok.click();
        }
      });
      actions.appendChild(cancel);
      actions.appendChild(ok);
      box.appendChild(actions);
      modalRoot.appendChild(box);
      if (inputs.length) { inputs[0].el.focus(); inputs[0].el.select && inputs[0].el.select(); }
      else ok.focus();
    });
  }

  function confirm(title, text, okText, danger) {
    return modal({ title: title, text: text, okText: okText || 'Ya', danger: danger }).then(Boolean);
  }

  function prompt(title, label, value, text) {
    return modal({
      title: title, text: text,
      fields: [{ name: 'value', label: label, value: value }],
      okText: 'Simpan'
    }).then(function (r) { return r ? r.value : null; });
  }

  /* ------------------------------------------------------------ progres */

  var progEl, progFill, progText;
  function progress(text, ratio) {
    progEl = progEl || document.getElementById('progress');
    progFill = progFill || document.getElementById('progressFill');
    progText = progText || document.getElementById('progressText');
    if (!progEl) return;
    if (text == null) { progEl.hidden = true; return; }
    progEl.hidden = false;
    progText.textContent = text;
    progFill.style.width = Math.max(0, Math.min(100, (ratio || 0) * 100)) + '%';
  }

  /* -------------------------------------------------------- pemuat aset */

  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        delete loaded[src];
        reject(new Error('Gagal memuat ' + src + '. Periksa koneksi internet.'));
      };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  function loadStyle(href) {
    if (loaded['css:' + href]) return loaded['css:' + href];
    loaded['css:' + href] = new Promise(function (resolve) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = resolve;
      l.onerror = resolve;
      document.head.appendChild(l);
    });
    return loaded['css:' + href];
  }

  /* ------------------------------------------------------------ format */

  function bytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }

  function when(unix) {
    if (!unix) return '';
    var d = new Date(unix * 1000);
    var now = new Date();
    var sameYear = d.getFullYear() === now.getFullYear();
    var pad = function (x) { return String(x).padStart(2, '0'); };
    var date = pad(d.getDate()) + ' ' +
      ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][d.getMonth()];
    return sameYear
      ? date + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      : date + ' ' + d.getFullYear();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fullscreen(node) {
    if (document.fullscreenElement) {
      document.exitFullscreen && document.exitFullscreen();
      return false;
    }
    var fn = node.requestFullscreen || node.webkitRequestFullscreen || node.msRequestFullscreen;
    if (fn) { try { fn.call(node); } catch (e) {} }
    return true;
  }

  global.UI = {
    el: el, toast: toast, modal: modal, confirm: confirm, prompt: prompt,
    closeModal: closeModal, progress: progress,
    loadScript: loadScript, loadStyle: loadStyle,
    bytes: bytes, when: when, escapeHtml: escapeHtml, fullscreen: fullscreen
  };
})(window);
