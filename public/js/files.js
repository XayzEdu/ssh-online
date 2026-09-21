/* Halaman Berkas: daftar SFTP, ikon gaya VS Code, editor dengan pewarnaan
   sintaks, unggah/unduh bertahap, dan operasi berkas lengkap. */
(function (global) {
  'use strict';

  var CHUNK = 192 * 1024;     // potongan unggah: aman untuk batas 4,5 MB Vercel
  var DL_CHUNK = 384 * 1024;

  var state = {
    path: null,
    items: [],
    selected: new Set(),
    lastIndex: -1,
    showHidden: true,
    filter: '',
    editor: null
  };

  var listEl, sideEl, crumbEl, selbarEl, searchEl;

  /* ============================================ pewarnaan sintaks ringan */

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  function build(rules) {
    var src = rules.map(function (r) { return '(' + r[0] + ')'; }).join('|');
    return { re: new RegExp(src, 'gm'), cls: rules.map(function (r) { return r[1]; }) };
  }

  var KW_JS = 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|try|catch|finally|throw|async|await|yield|import|export|from|default|delete|in|of|void|static|get|set';
  var KW_C = 'int|long|short|char|float|double|void|struct|union|enum|typedef|static|const|unsigned|signed|sizeof|return|if|else|for|while|do|switch|case|break|continue|goto|public|private|protected|class|new|delete|namespace|using|template|typename|virtual|override|try|catch|throw|func|package|type|var|defer|go|chan|interface|map|range|fn|let|mut|impl|pub|match|where|self';
  var KW_PY = 'def|class|return|if|elif|else|for|while|break|continue|import|from|as|pass|raise|try|except|finally|with|lambda|yield|global|nonlocal|assert|del|and|or|not|in|is|None|True|False|async|await|self';
  var KW_SH = 'if|then|elif|else|fi|for|while|until|do|done|case|esac|function|return|local|export|source|alias|set|unset|read|echo|printf|cd|exit|shift|trap|declare|readonly|eval|exec';

  var RULES = {
    js: build([
      ['/\\*[\\s\\S]*?\\*/|//.*', 'com'],
      ['`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'', 'str'],
      ['\\b(?:0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b', 'num'],
      ['\\b(?:' + KW_JS + ')\\b', 'key'],
      ['\\b(?:true|false|null|undefined|NaN|Infinity)\\b', 'typ'],
      ['[A-Za-z_$][\\w$]*(?=\\s*\\()', 'fn']
    ]),
    clike: build([
      ['/\\*[\\s\\S]*?\\*/|//.*|^\\s*#.*', 'com'],
      ['"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'', 'str'],
      ['\\b(?:0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b', 'num'],
      ['\\b(?:' + KW_C + ')\\b', 'key'],
      ['\\b(?:true|false|nil|NULL|null)\\b', 'typ'],
      ['[A-Za-z_][\\w]*(?=\\s*\\()', 'fn']
    ]),
    py: build([
      ['#.*', 'com'],
      ['"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'', 'str'],
      ['\\b\\d+(?:\\.\\d+)?\\b', 'num'],
      ['\\b(?:' + KW_PY + ')\\b', 'key'],
      ['@[\\w.]+', 'typ'],
      ['[A-Za-z_][\\w]*(?=\\s*\\()', 'fn']
    ]),
    sh: build([
      ['#.*', 'com'],
      ['"(?:\\\\.|[^"\\\\])*"|\'[^\']*\'', 'str'],
      ['\\$\\{[^}]*\\}|\\$[A-Za-z_][\\w]*|\\$[0-9@*#?$!]', 'var'],
      ['\\b(?:' + KW_SH + ')\\b', 'key'],
      ['(?:^|\\s)-{1,2}[A-Za-z][\\w-]*', 'typ'],
      ['\\b\\d+\\b', 'num']
    ]),
    json: build([
      ['"(?:\\\\.|[^"\\\\])*"(?=\\s*:)', 'att'],
      ['"(?:\\\\.|[^"\\\\])*"', 'str'],
      ['\\b-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b', 'num'],
      ['\\b(?:true|false|null)\\b', 'key']
    ]),
    xml: build([
      ['<!--[\\s\\S]*?-->', 'com'],
      ['"(?:\\\\.|[^"\\\\])*"|\'[^\']*\'', 'str'],
      ['</?[A-Za-z][\\w:.-]*', 'tag'],
      ['[A-Za-z_:][\\w:.-]*(?==)', 'att'],
      ['/?>', 'tag']
    ]),
    css: build([
      ['/\\*[\\s\\S]*?\\*/', 'com'],
      ['"(?:\\\\.|[^"\\\\])*"|\'[^\']*\'', 'str'],
      ['[.#][A-Za-z_-][\\w-]*|@[A-Za-z-]+|:{1,2}[a-z-]+', 'key'],
      ['[-a-zA-Z]+(?=\\s*:)', 'att'],
      ['#[0-9a-fA-F]{3,8}\\b|\\b\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|s|ms|fr|deg)?\\b', 'num']
    ]),
    yaml: build([
      ['#.*', 'com'],
      ['"(?:\\\\.|[^"\\\\])*"|\'[^\']*\'', 'str'],
      ['^\\s*-?\\s*[\\w.$-]+(?=\\s*:)', 'att'],
      ['\\b(?:true|false|null|yes|no|on|off)\\b', 'key'],
      ['\\b-?\\d+(?:\\.\\d+)?\\b', 'num']
    ]),
    conf: build([
      ['[#;].*', 'com'],
      ['"(?:\\\\.|[^"\\\\])*"|\'[^\']*\'', 'str'],
      ['^\\s*\\[[^\\]]+\\]', 'key'],
      ['^\\s*[\\w.$-]+(?=\\s*[=:])', 'att'],
      ['\\b\\d+(?:\\.\\d+)?\\b', 'num']
    ]),
    md: build([
      ['^#{1,6}\\s.*', 'key'],
      ['```[\\s\\S]*?```|`[^`]*`', 'str'],
      ['\\*\\*[^*]+\\*\\*|__[^_]+__', 'typ'],
      ['^\\s*[-*+]\\s|^\\s*\\d+\\.\\s', 'num'],
      ['\\[[^\\]]*\\]\\([^)]*\\)', 'att']
    ]),
    plain: null
  };

  function highlight(code, lang) {
    var def = RULES[lang] || RULES[lang === 'image' ? 'plain' : 'plain'];
    if (!def) return esc(code);
    var out = '', last = 0, m;
    def.re.lastIndex = 0;
    while ((m = def.re.exec(code)) !== null) {
      if (m[0] === '') { def.re.lastIndex++; continue; }
      out += esc(code.slice(last, m.index));
      var cls = 'str';
      for (var i = 1; i < m.length; i++) {
        if (m[i] !== undefined) { cls = def.cls[i - 1]; break; }
      }
      out += '<span class="tok-' + cls + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    out += esc(code.slice(last));
    return out;
  }

  /* ====================================================== daftar berkas */

  function join(dir, name) {
    return dir === '/' ? '/' + name : dir.replace(/\/$/, '') + '/' + name;
  }

  function sftp(op, args) {
    return XayzApi.rpc('sftp', Object.assign({ op: op }, args || {}));
  }
  function fileop(op, args) {
    return XayzApi.rpc('fileop', Object.assign({ op: op }, args || {}));
  }

  function go(path) {
    setBusy(true);
    return sftp('list', { path: path })
      .then(function (r) {
        state.path = r.path;
        state.items = r.items;
        state.selected.clear();
        state.lastIndex = -1;
        render();
        try { history.replaceState(null, '', '#files:' + encodeURIComponent(r.path)); } catch (e) {}
      })
      .catch(function (e) {
        UI.toast('Tidak bisa membuka folder: ' + e.message, 'err');
      })
      .then(function () { setBusy(false); });
  }

  function setBusy(on) {
    var dot = document.getElementById('connDot');
    if (dot) dot.className = 'dot ' + (on ? 'busy' : 'on');
  }

  function visible() {
    var f = state.filter.toLowerCase();
    return state.items.filter(function (it) {
      if (!state.showHidden && it.hidden) return false;
      if (f && it.name.toLowerCase().indexOf(f) === -1) return false;
      return true;
    });
  }

  function renderCrumbs() {
    crumbEl.innerHTML = '';
    var parts = (state.path || '/').split('/').filter(Boolean);
    var root = document.createElement('button');
    root.textContent = '/';
    root.onclick = function () { go('/'); };
    crumbEl.appendChild(root);
    var acc = '';
    parts.forEach(function (p, i) {
      acc += '/' + p;
      var target = acc;
      var sep = document.createElement('span');
      sep.textContent = i === 0 ? '' : '/';
      crumbEl.appendChild(sep);
      var b = document.createElement('button');
      b.textContent = p;
      b.onclick = function () { go(target); };
      crumbEl.appendChild(b);
    });
    crumbEl.scrollLeft = 9999;
  }

  function render() {
    renderCrumbs();
    var rows = visible();
    listEl.innerHTML = '';

    if (!rows.length) {
      var empty = UI.el('div', 'file-empty');
      empty.appendChild(UI.el('strong', null, state.filter ? 'Tidak ada yang cocok' : 'Folder kosong'));
      empty.appendChild(UI.el('div', null, state.filter
        ? 'Hapus kata saring untuk melihat semua isi folder.'
        : 'Gunakan tombol folder baru atau unggah untuk mengisi folder ini.'));
      listEl.appendChild(empty);
      renderSelbar();
      return;
    }

    var frag = document.createDocumentFragment();
    rows.forEach(function (it, idx) {
      var row = document.createElement('div');
      row.className = 'frow' + (it.hidden ? ' hiddenfile' : '') +
        (state.selected.has(it.path) ? ' sel' : '');
      row.dataset.path = it.path;
      row.dataset.index = idx;

      var isDir = it.type === 'dir' || it.linkType === 'dir';
      row.innerHTML =
        XayzIcons.fileIcon(it.name, isDir ? 'dir' : it.type) +
        '<span class="fname">' + esc(it.name) +
        (it.type === 'link' ? ' <span class="link-arrow">→</span>' : '') + '</span>' +
        '<span class="fmeta fsize">' + (it.type === 'dir' ? '' : UI.bytes(it.size)) + '</span>' +
        '<span class="fmeta fmode">' + esc(it.modeStr || '') + '</span>' +
        '<span class="fmeta ftime">' + UI.when(it.mtime) + '</span>';

      row.addEventListener('click', function (e) { onRowClick(e, it, idx, rows); });
      row.addEventListener('dblclick', function () { open(it); });
      row.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (!state.selected.has(it.path)) {
          state.selected.clear();
          state.selected.add(it.path);
          render();
        }
        contextMenu(e, it);
      });
      // Ketukan dua kali di ponsel membuka berkas
      var lastTap = 0;
      row.addEventListener('touchend', function () {
        var now = Date.now();
        if (now - lastTap < 400) open(it);
        lastTap = now;
      });

      frag.appendChild(row);
    });
    listEl.appendChild(frag);
    renderSelbar();
  }

  function onRowClick(e, it, idx, rows) {
    if (e.shiftKey && state.lastIndex >= 0) {
      var a = Math.min(state.lastIndex, idx), b = Math.max(state.lastIndex, idx);
      for (var i = a; i <= b; i++) state.selected.add(rows[i].path);
    } else if (e.ctrlKey || e.metaKey) {
      if (state.selected.has(it.path)) state.selected.delete(it.path);
      else state.selected.add(it.path);
      state.lastIndex = idx;
    } else {
      state.selected.clear();
      state.selected.add(it.path);
      state.lastIndex = idx;
    }
    render();
  }

  function renderSelbar() {
    var n = state.selected.size;
    selbarEl.hidden = n === 0;
    document.getElementById('selCount').textContent =
      n + (n === 1 ? ' berkas dipilih' : ' berkas dipilih');
  }

  function selectedItems() {
    return state.items.filter(function (i) { return state.selected.has(i.path); });
  }

  function open(it) {
    if (it.type === 'dir' || it.linkType === 'dir') return go(it.path);
    if (it.type === 'link' && it.linkType === 'broken') {
      return UI.toast('Tautan ini menunjuk ke target yang tidak ada.', 'warn');
    }
    openEditor(it);
  }

  /* ============================================================= editor */

  function openEditor(it) {
    var lang = XayzIcons.langOf(it.name);
    sideEl.hidden = false;
    sideEl.innerHTML = '';

    var head = UI.el('div', 'ed-head');
    head.innerHTML = XayzIcons.fileIcon(it.name, 'file');
    var pathSpan = UI.el('span', 'ed-path', it.path);
    head.appendChild(pathSpan);

    var dirty = UI.el('span', 'dirty');
    head.appendChild(dirty);

    var saveBtn = UI.el('button', 'ghost-btn', 'Simpan');
    var dlBtn = UI.el('button', 'icon-btn', '↓');
    dlBtn.title = 'Unduh berkas';
    var closeBtn = UI.el('button', 'icon-btn', '×');
    closeBtn.title = 'Tutup';
    head.appendChild(saveBtn); head.appendChild(dlBtn); head.appendChild(closeBtn);
    sideEl.appendChild(head);

    var body = UI.el('div', 'ed-body');
    sideEl.appendChild(body);
    body.innerHTML = '<div class="file-empty">Memuat…</div>';

    closeBtn.onclick = function () { closeEditor(); };
    dlBtn.onclick = function () { download([it]); };

    if (lang === 'image') {
      return sftp('read', { path: it.path, max: 4 * 1024 * 1024 }).then(function (r) {
        if (!r.ok) { body.innerHTML = '<div class="file-empty">' + esc(r.error) + '</div>'; return; }
        var ext = XayzIcons.ext(it.name);
        var mime = ext === 'svg' ? 'image/svg+xml' : 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
        body.className = 'ed-body ed-preview';
        body.innerHTML = '<img alt="' + esc(it.name) + '" src="data:' + mime + ';base64,' +
          (r.encoding === 'base64' ? r.content : btoa(unescape(encodeURIComponent(r.content)))) + '">';
        saveBtn.remove();
      }).catch(function (e) {
        body.innerHTML = '<div class="file-empty">' + esc(e.message) + '</div>';
      });
    }

    sftp('read', { path: it.path }).then(function (r) {
      if (!r.ok) {
        body.innerHTML = '<div class="file-empty"><strong>Tidak bisa dibuka di editor</strong>' +
          esc(r.error || '') + '</div>';
        saveBtn.remove();
        return;
      }
      if (r.binary) {
        body.innerHTML = '<div class="file-empty"><strong>Berkas biner</strong>' +
          'Isinya bukan teks. Unduh berkas untuk membukanya di aplikasi yang sesuai.</div>';
        saveBtn.remove();
        return;
      }

      body.innerHTML = '';
      var stack = UI.el('div', 'ed-stack');
      var pre = UI.el('pre', 'ed-pre');
      var ta = document.createElement('textarea');
      ta.className = 'ed-ta';
      ta.spellcheck = false;
      ta.value = r.content;
      stack.appendChild(pre);
      stack.appendChild(ta);
      body.appendChild(stack);

      var paint = function () {
        pre.innerHTML = highlight(ta.value + '\n', lang);
        stack.style.minHeight = pre.scrollHeight + 'px';
        ta.style.height = pre.scrollHeight + 'px';
      };
      paint();

      var original = r.content;
      ta.addEventListener('input', function () {
        paint();
        dirty.textContent = ta.value === original ? '' : '● belum disimpan';
      });
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          var s = ta.selectionStart, en = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
          ta.selectionStart = ta.selectionEnd = s + 2;
          paint();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          saveBtn.click();
        }
      });

      saveBtn.onclick = function () {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Menyimpan…';
        sftp('write', { path: it.path, content: ta.value, encoding: 'utf8' })
          .then(function () {
            original = ta.value;
            dirty.textContent = '';
            UI.toast('Tersimpan: ' + it.name, 'ok');
            refresh();
          })
          .catch(function (e) { UI.toast('Gagal menyimpan: ' + e.message, 'err'); })
          .then(function () { saveBtn.disabled = false; saveBtn.textContent = 'Simpan'; });
      };

      state.editor = { path: it.path, ta: ta };
      ta.focus();
    }).catch(function (e) {
      body.innerHTML = '<div class="file-empty">' + esc(e.message) + '</div>';
    });
  }

  function closeEditor() {
    sideEl.hidden = true;
    sideEl.innerHTML = '';
    state.editor = null;
  }

  /* ========================================================== operasi */

  function refresh() { return go(state.path || '.'); }

  function newFolder() {
    UI.prompt('Folder baru', 'Nama folder', '', 'Dibuat di ' + state.path).then(function (name) {
      if (!name) return;
      sftp('mkdir', { path: join(state.path, name) })
        .then(function () { UI.toast('Folder dibuat', 'ok'); refresh(); })
        .catch(function (e) { UI.toast(e.message, 'err'); });
    });
  }

  function newFile() {
    UI.prompt('Berkas baru', 'Nama berkas', '', 'Dibuat di ' + state.path).then(function (name) {
      if (!name) return;
      sftp('touch', { path: join(state.path, name) })
        .then(function () { UI.toast('Berkas dibuat', 'ok'); refresh(); })
        .catch(function (e) { UI.toast(e.message, 'err'); });
    });
  }

  function rename() {
    var items = selectedItems();
    if (items.length !== 1) return UI.toast('Pilih satu berkas untuk diubah namanya.', 'warn');
    var it = items[0];
    UI.prompt('Ubah nama', 'Nama baru', it.name).then(function (name) {
      if (!name || name === it.name) return;
      sftp('rename', { from: it.path, to: join(state.path, name) })
        .then(function () { UI.toast('Nama diubah', 'ok'); refresh(); })
        .catch(function (e) { UI.toast(e.message, 'err'); });
    });
  }

  function remove() {
    var items = selectedItems();
    if (!items.length) return;
    var names = items.slice(0, 5).map(function (i) { return i.name; }).join(', ') +
      (items.length > 5 ? ' dan ' + (items.length - 5) + ' lainnya' : '');
    UI.confirm(
      'Hapus permanen?',
      names + '\n\nBerkas dihapus langsung di VPS dan tidak bisa dikembalikan.',
      'Hapus', true
    ).then(function (yes) {
      if (!yes) return;
      fileop('delete', { paths: items.map(function (i) { return i.path; }) })
        .then(function () { UI.toast(items.length + ' berkas dihapus', 'ok'); refresh(); })
        .catch(function (e) { UI.toast(e.message, 'err'); });
    });
  }

  function moveOrCopy(kind) {
    var items = selectedItems();
    if (!items.length) return;
    UI.prompt(
      kind === 'move' ? 'Pindahkan ke' : 'Salin ke',
      'Folder tujuan', state.path,
      items.length + ' berkas akan ' + (kind === 'move' ? 'dipindahkan' : 'disalin') + '.'
    ).then(function (dest) {
      if (!dest) return;
      fileop(kind, { paths: items.map(function (i) { return i.path; }), dest: dest })
        .then(function () { UI.toast('Selesai', 'ok'); refresh(); })
        .catch(function (e) { UI.toast(e.message, 'err'); });
    });
  }

  function archive() {
    var items = selectedItems();
    if (!items.length) return;
    var base = items.length === 1 ? items[0].name : 'arsip';
    UI.modal({
      title: 'Arsipkan',
      text: items.length + ' berkas dari ' + state.path,
      fields: [
        { name: 'output', label: 'Nama arsip', value: base + '.tar.gz' },
        { name: 'format', label: 'Format', type: 'select', options: [
          { value: 'tar.gz', label: 'tar.gz — paling umum di Linux' },
          { value: 'zip', label: 'zip — mudah dibuka di Windows' },
          { value: 'tar.xz', label: 'tar.xz — paling kecil, lebih lambat' },
          { value: 'tar.bz2', label: 'tar.bz2' },
          { value: 'tar', label: 'tar — tanpa kompresi' }
        ] }
      ],
      okText: 'Arsipkan'
    }).then(function (r) {
      if (!r) return;
      UI.progress('Mengarsipkan…', 0.4);
      fileop('archive', {
        cwd: state.path,
        names: items.map(function (i) { return i.name; }),
        output: r.output,
        format: r.format
      }).then(function () {
        UI.progress(null);
        UI.toast('Arsip dibuat: ' + r.output, 'ok');
        refresh();
      }).catch(function (e) { UI.progress(null); UI.toast(e.message, 'err'); });
    });
  }

  function extract() {
    var items = selectedItems();
    if (items.length !== 1) return UI.toast('Pilih satu berkas arsip.', 'warn');
    UI.prompt('Ekstrak', 'Folder tujuan', state.path, items[0].name).then(function (dest) {
      if (!dest) return;
      UI.progress('Mengekstrak…', 0.4);
      fileop('extract', { path: items[0].path, dest: dest })
        .then(function (r) {
          UI.progress(null);
          if (/tidak dikenali|tidak tersedia/.test(r.stdout || '')) {
            UI.toast(r.stdout.trim(), 'warn');
          } else {
            UI.toast('Arsip diekstrak', 'ok');
          }
          refresh();
        })
        .catch(function (e) { UI.progress(null); UI.toast(e.message, 'err'); });
    });
  }

  function chmod() {
    var items = selectedItems();
    if (!items.length) return;
    var cur = items[0].mode ? items[0].mode.toString(8).padStart(3, '0') : '644';
    UI.modal({
      title: 'Izin akses',
      text: items.length === 1 ? items[0].name : items.length + ' berkas',
      fields: [
        { name: 'mode', label: 'Mode oktal (contoh 755 atau 644)', value: cur },
        { name: 'owner', label: 'Pemilik baru, kosongkan jika tidak diubah (user:group)', value: '' }
      ],
      okText: 'Terapkan'
    }).then(function (r) {
      if (!r) return;
      var jobs = items.map(function (i) {
        return sftp('chmod', { path: i.path, mode: r.mode });
      });
      if (r.owner) {
        jobs.push(fileop('chown', {
          paths: items.map(function (i) { return i.path; }),
          owner: r.owner, recursive: true
        }));
      }
      Promise.all(jobs)
        .then(function () { UI.toast('Izin akses diperbarui', 'ok'); refresh(); })
        .catch(function (e) { UI.toast(e.message, 'err'); });
    });
  }

  /* ------------------------------------------------------------- unduh */

  function download(items) {
    items = items || selectedItems();
    if (!items.length) return;
    var dirs = items.filter(function (i) { return i.type === 'dir'; });
    if (dirs.length) {
      return UI.confirm(
        'Folder perlu diarsipkan dulu',
        'Unduhan langsung hanya untuk berkas. Buat arsip tar.gz dari folder terpilih lebih dulu?',
        'Buat arsip'
      ).then(function (yes) { if (yes) archive(); });
    }
    var queue = items.slice();
    (function next() {
      if (!queue.length) { UI.progress(null); return; }
      var it = queue.shift();
      downloadOne(it).then(next).catch(function (e) {
        UI.progress(null);
        UI.toast('Gagal mengunduh ' + it.name + ': ' + e.message, 'err');
      });
    })();
  }

  function downloadOne(it) {
    var parts = [];
    var offset = 0;
    UI.progress('Mengunduh ' + it.name, 0);

    function step() {
      return sftp('chunkDownload', { path: it.path, offset: offset, length: DL_CHUNK })
        .then(function (r) {
          if (r.read > 0) {
            var bin = atob(r.chunk);
            var arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            parts.push(arr);
            offset += r.read;
            UI.progress('Mengunduh ' + it.name + ' · ' + UI.bytes(offset),
              it.size ? offset / it.size : 0.5);
          }
          if (r.eof || r.read === 0) return;
          return step();
        });
    }

    return step().then(function () {
      var blob = new Blob(parts);
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = it.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      UI.progress(null);
      UI.toast('Terunduh: ' + it.name, 'ok');
    });
  }

  /* ------------------------------------------------------------ unggah */

  function readSlice(file, start, end) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var bytes = new Uint8Array(fr.result);
        var bin = '';
        var step = 0x8000;
        for (var i = 0; i < bytes.length; i += step) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
        }
        resolve(btoa(bin));
      };
      fr.onerror = function () { reject(new Error('Berkas tidak terbaca dari perangkat ini.')); };
      fr.readAsArrayBuffer(file.slice(start, end));
    });
  }

  function uploadFiles(fileList, baseDir) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    baseDir = baseDir || state.path;

    var totalBytes = files.reduce(function (a, f) { return a + f.size; }, 0);
    var doneBytes = 0;
    var index = 0;

    // Buat semua folder tujuan sekaligus supaya unggah folder tidak gagal
    var dirs = {};
    files.forEach(function (f) {
      var rel = f.webkitRelativePath || f.relativePath || '';
      if (rel.indexOf('/') > -1) {
        dirs[baseDir + '/' + rel.slice(0, rel.lastIndexOf('/'))] = true;
      }
    });
    var mkdirs = Object.keys(dirs).length
      ? fileop('mkdirp', { path: Object.keys(dirs).join(' ') }).catch(function () {})
      : Promise.resolve();

    // Bila banyak folder, buat satu per satu agar aman terhadap spasi pada nama
    if (Object.keys(dirs).length) {
      mkdirs = Object.keys(dirs).reduce(function (chain, d) {
        return chain.then(function () { return fileop('mkdirp', { path: d }).catch(function () {}); });
      }, Promise.resolve());
    }

    function nextFile() {
      if (index >= files.length) {
        UI.progress(null);
        UI.toast(files.length + ' berkas terunggah', 'ok');
        return refresh();
      }
      var f = files[index++];
      var rel = f.webkitRelativePath || f.name;
      var target = baseDir.replace(/\/$/, '') + '/' + rel;
      var offset = 0;

      function chunk() {
        if (offset >= f.size) {
          if (f.size === 0) {
            return sftp('chunkUpload', { path: target, offset: 0, chunk: '' }).then(nextFile);
          }
          return nextFile();
        }
        var end = Math.min(offset + CHUNK, f.size);
        return readSlice(f, offset, end)
          .then(function (b64) {
            return sftp('chunkUpload', { path: target, offset: offset, chunk: b64 });
          })
          .then(function () {
            doneBytes += (end - offset);
            offset = end;
            UI.progress(
              'Mengunggah ' + f.name + ' · ' + UI.bytes(doneBytes) + ' / ' + UI.bytes(totalBytes),
              totalBytes ? doneBytes / totalBytes : 0
            );
            return chunk();
          });
      }

      return chunk().catch(function (e) {
        UI.progress(null);
        UI.toast('Gagal mengunggah ' + f.name + ': ' + e.message, 'err');
      });
    }

    UI.progress('Menyiapkan unggahan…', 0);
    mkdirs.then(nextFile);
  }

  /* ------------------------------------------------------- menu konteks */

  function contextMenu(e, it) {
    var isDir = it.type === 'dir' || it.linkType === 'dir';
    var actions = [
      isDir ? ['Buka folder', function () { go(it.path); }] : ['Buka di editor', function () { openEditor(it); }],
      ['Unduh', function () { download(); }],
      ['Ubah nama', rename],
      ['Pindahkan', function () { moveOrCopy('move'); }],
      ['Salin', function () { moveOrCopy('copy'); }],
      ['Arsipkan', archive],
      ['Ekstrak', extract],
      ['Izin akses', chmod],
      ['Salin path', function () {
        navigator.clipboard.writeText(it.path);
        UI.toast('Path disalin', 'ok', 1500);
      }],
      ['Buka di terminal', function () {
        XayzTerm.runInTerminal('cd ' + JSON.stringify(isDir ? it.path : state.path));
        global.XayzApp.setView('terminal');
      }],
      ['Hapus', remove, true]
    ];

    var menu = UI.el('div', 'modal');
    menu.style.position = 'fixed';
    menu.style.padding = '6px';
    menu.style.width = 'auto';
    menu.style.minWidth = '190px';
    menu.style.gap = '0';
    menu.style.left = Math.min(e.clientX, innerWidth - 210) + 'px';
    menu.style.top = Math.min(e.clientY, innerHeight - 380) + 'px';

    actions.forEach(function (a) {
      var b = UI.el('button', 'ghost-btn' + (a[2] ? ' danger' : ''), a[0]);
      b.style.background = 'none';
      b.style.border = '0';
      b.style.textAlign = 'left';
      b.style.width = '100%';
      b.style.padding = '7px 10px';
      b.onclick = function () { close(); a[1](); };
      menu.appendChild(b);
    });

    var root = document.getElementById('modalRoot');
    root.innerHTML = '';
    root.hidden = false;
    root.style.background = 'transparent';
    root.appendChild(menu);

    function close() {
      root.hidden = true;
      root.innerHTML = '';
      root.style.background = '';
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    root.onclick = function (ev) { if (ev.target === root) close(); };
    document.addEventListener('keydown', onKey);
  }

  /* ---------------------------------------------------------------- init */

  function init(prefs) {
    listEl = document.getElementById('fileList');
    sideEl = document.getElementById('fileSide');
    crumbEl = document.getElementById('crumbs');
    selbarEl = document.getElementById('selbar');
    searchEl = document.getElementById('fSearch');
    state.showHidden = prefs.showHidden !== false;
    document.getElementById('fHidden').classList.toggle('on', state.showHidden);

    document.getElementById('fUp').onclick = function () {
      if (!state.path || state.path === '/') return;
      go(state.path.replace(/\/[^/]+\/?$/, '') || '/');
    };
    document.getElementById('fHome').onclick = function () {
      go((XayzApi.Session.info && XayzApi.Session.info.home) || '~');
    };
    document.getElementById('fRefresh').onclick = refresh;
    document.getElementById('fNewFolder').onclick = newFolder;
    document.getElementById('fNewFile').onclick = newFile;
    document.getElementById('fHidden').onclick = function () {
      state.showHidden = !state.showHidden;
      this.classList.toggle('on', state.showHidden);
      XayzApi.Prefs.set({ showHidden: state.showHidden });
      render();
    };

    var fileInput = document.getElementById('hiddenFileInput');
    var dirInput = document.getElementById('hiddenDirInput');
    document.getElementById('fUpload').onclick = function () { fileInput.click(); };
    document.getElementById('fUploadDir').onclick = function () { dirInput.click(); };
    fileInput.onchange = function () { uploadFiles(this.files); this.value = ''; };
    dirInput.onchange = function () { uploadFiles(this.files); this.value = ''; };

    searchEl.addEventListener('input', function () {
      state.filter = this.value;
      render();
    });

    selbarEl.addEventListener('click', function (e) {
      var act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      ({
        download: function () { download(); },
        rename: rename,
        move: function () { moveOrCopy('move'); },
        copy: function () { moveOrCopy('copy'); },
        archive: archive,
        extract: extract,
        chmod: chmod,
        delete: remove,
        clear: function () { state.selected.clear(); render(); }
      })[act]();
    });

    // Seret dan lepas untuk mengunggah
    var dropHint = document.getElementById('dropHint');
    var depth = 0;
    var pane = document.getElementById('view-files');
    pane.addEventListener('dragenter', function (e) {
      e.preventDefault(); depth++; dropHint.hidden = false;
    });
    pane.addEventListener('dragover', function (e) { e.preventDefault(); });
    pane.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (!depth) dropHint.hidden = true;
    });
    pane.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      dropHint.hidden = true;
      if (e.dataTransfer.files && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });

    // Pintasan papan ketik di daftar berkas
    listEl.addEventListener('keydown', function (e) {
      if (e.key === 'Delete') { e.preventDefault(); remove(); }
      if (e.key === 'F2') { e.preventDefault(); rename(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        visible().forEach(function (i) { state.selected.add(i.path); });
        render();
      }
      if (e.key === 'Escape') { state.selected.clear(); render(); closeEditor(); }
    });

    var start = (XayzApi.Session.info && (XayzApi.Session.info.cwd || XayzApi.Session.info.home)) || '.';
    var hash = location.hash.match(/#files:(.+)$/);
    if (hash) { try { start = decodeURIComponent(hash[1]); } catch (e) {} }
    return go(start);
  }

  global.XayzFiles = {
    init: init, go: go, refresh: refresh, uploadFiles: uploadFiles,
    get path() { return state.path; }
  };
})(window);
