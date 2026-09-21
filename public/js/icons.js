/* Ikon berkas bergaya VS Code (tema Seti).
   Semua digambar sebagai SVG inline: tidak ada unduhan, tidak ada font ikon,
   jadi daftar berkas tetap ringan di komputer berdisk HDD. */
(function (global) {
  'use strict';

  var C = {
    js: '#e8c14b', ts: '#4a9fe0', json: '#e8c14b', py: '#4b93d1', rb: '#d4544b',
    php: '#8b8fd6', java: '#e0834b', c: '#6ba6e8', cpp: '#5f9ee0', cs: '#66b95c',
    go: '#4bc4d6', rs: '#d68b4b', swift: '#e8734b', kt: '#b07be8', lua: '#4a68d6',
    html: '#e0714b', css: '#4b9be0', sass: '#d6699e', vue: '#4bc48a', svelte: '#e0574b',
    md: '#7f96b5', txt: '#9aa5b8', yml: '#d15f6b', toml: '#9c8a6b', xml: '#8ac46b',
    sh: '#5fbf7a', sql: '#e0a34b', env: '#e8c14b', dock: '#4ba3e0', git: '#e0603a',
    img: '#c96fd6', vid: '#e07a9e', aud: '#7ad6c4', zip: '#c9a14b', pdf: '#e05a5a',
    font: '#d67ab5', lock: '#b5a05f', db: '#7f9ce0', bin: '#8a94a8', dir: '#7f9ce0',
    log: '#8a94a8', conf: '#9c8a6b', key: '#e0a34b', nginx: '#4bbf7a'
  };

  // Bentuk dasar: lembar berkas, folder, dan beberapa siluet khusus.
  function doc(color, inner) {
    return '<svg class="ficon" viewBox="0 0 24 24" fill="none">' +
      '<path d="M6 2.5h7.2L19 8.3V20a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 20V4A1.5 1.5 0 016.5 2.5z" fill="' + color + '" opacity=".14"/>' +
      '<path d="M6.5 2.5h6.8L19 8.3V20a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 20V4a1.5 1.5 0 011.5-1.5z" stroke="' + color + '" stroke-width="1.3"/>' +
      '<path d="M13.2 2.6V8.4H19" stroke="' + color + '" stroke-width="1.3" stroke-linejoin="round"/>' +
      (inner || '') + '</svg>';
  }

  function label(color, text) {
    var size = text.length > 2 ? 4.6 : 5.6;
    return '<text x="12" y="17.4" text-anchor="middle" font-family="ui-monospace,monospace" ' +
      'font-size="' + size + '" font-weight="700" fill="' + color + '">' + text + '</text>';
  }

  var SHAPES = {
    folder: function (color, open) {
      return '<svg class="ficon" viewBox="0 0 24 24" fill="none">' +
        (open
          ? '<path d="M3 7.5A1.5 1.5 0 014.5 6h4.2l1.9 2h7.9A1.5 1.5 0 0120 9.5v1H6.6a1.5 1.5 0 00-1.45 1.1L3 19z" fill="' + color + '" opacity=".2"/>' +
            '<path d="M3 18.5V7.5A1.5 1.5 0 014.5 6h4.2l1.9 2h7.9A1.5 1.5 0 0120 9.5v1" stroke="' + color + '" stroke-width="1.35" stroke-linejoin="round"/>' +
            '<path d="M6.6 10.6h14.2l-2.6 7.3a1.5 1.5 0 01-1.42 1.1H4.5a1.5 1.5 0 01-1.42-2l2.1-5.3a1.5 1.5 0 011.42-1.1z" stroke="' + color + '" stroke-width="1.35" stroke-linejoin="round"/>'
          : '<path d="M3 7.5A1.5 1.5 0 014.5 6h4.2l1.9 2h7.9A1.5 1.5 0 0120 9.5v8a1.5 1.5 0 01-1.5 1.5h-14A1.5 1.5 0 013 17.5z" fill="' + color + '" opacity=".18"/>' +
            '<path d="M3 7.5A1.5 1.5 0 014.5 6h4.2l1.9 2h7.9A1.5 1.5 0 0120 9.5v8a1.5 1.5 0 01-1.5 1.5h-14A1.5 1.5 0 013 17.5z" stroke="' + color + '" stroke-width="1.35" stroke-linejoin="round"/>') +
        '</svg>';
    },
    image: function (color) {
      return doc(color,
        '<rect x="7.4" y="11.6" width="9.2" height="7" rx="1" stroke="' + color + '" stroke-width="1.2"/>' +
        '<circle cx="10" cy="14" r="1.1" fill="' + color + '"/>' +
        '<path d="M7.6 17.6l2.8-2.6 2.3 2 1.8-1.5 2.1 2.1" stroke="' + color + '" stroke-width="1.2" stroke-linejoin="round"/>');
    },
    video: function (color) {
      return doc(color,
        '<path d="M9.6 12.4l6 3.3-6 3.3z" fill="' + color + '" opacity=".85"/>');
    },
    audio: function (color) {
      return doc(color,
        '<path d="M10 18.4v-5.3l5-1.1v5" stroke="' + color + '" stroke-width="1.2" stroke-linejoin="round"/>' +
        '<circle cx="8.9" cy="18.4" r="1.4" fill="' + color + '"/><circle cx="13.9" cy="17" r="1.4" fill="' + color + '"/>');
    },
    archive: function (color) {
      return '<svg class="ficon" viewBox="0 0 24 24" fill="none">' +
        '<path d="M4 8.2A1.2 1.2 0 015.2 7h13.6A1.2 1.2 0 0120 8.2V19a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 19z" fill="' + color + '" opacity=".16"/>' +
        '<path d="M4 8.2A1.2 1.2 0 015.2 7h13.6A1.2 1.2 0 0120 8.2V19a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 19z" stroke="' + color + '" stroke-width="1.3"/>' +
        '<path d="M3.6 7l1.3-3.2A1 1 0 015.8 3.2h12.4a1 1 0 01.93.63L20.4 7" stroke="' + color + '" stroke-width="1.3" stroke-linejoin="round"/>' +
        '<path d="M11 11.4h2v2.4h-2zM11 14.6h2V17h-2z" fill="' + color + '"/></svg>';
    },
    lock: function (color) {
      return doc(color,
        '<rect x="8.6" y="14" width="6.8" height="5" rx="1.1" stroke="' + color + '" stroke-width="1.2"/>' +
        '<path d="M10.2 14v-1.6a1.8 1.8 0 013.6 0V14" stroke="' + color + '" stroke-width="1.2"/>');
    },
    db: function (color) {
      return '<svg class="ficon" viewBox="0 0 24 24" fill="none">' +
        '<ellipse cx="12" cy="6.4" rx="7" ry="2.9" fill="' + color + '" opacity=".18"/>' +
        '<ellipse cx="12" cy="6.4" rx="7" ry="2.9" stroke="' + color + '" stroke-width="1.3"/>' +
        '<path d="M5 6.4v11.2c0 1.6 3.13 2.9 7 2.9s7-1.3 7-2.9V6.4" stroke="' + color + '" stroke-width="1.3"/>' +
        '<path d="M5 12c0 1.6 3.13 2.9 7 2.9s7-1.3 7-2.9" stroke="' + color + '" stroke-width="1.3"/></svg>';
    },
    terminal: function (color) {
      return doc(color,
        '<path d="M8.4 12.6l2.4 2.3-2.4 2.3" stroke="' + color + '" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M12.4 17.6h3.6" stroke="' + color + '" stroke-width="1.35" stroke-linecap="round"/>');
    },
    braces: function (color) {
      return doc(color,
        '<path d="M10.3 11.8c-1.1 0-1.4.5-1.4 1.4v1.3c0 .9-.3 1.3-1 1.3.7 0 1 .4 1 1.3v1.3c0 .9.3 1.4 1.4 1.4" stroke="' + color + '" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
        '<path d="M13.7 11.8c1.1 0 1.4.5 1.4 1.4v1.3c0 .9.3 1.3 1 1.3-.7 0-1 .4-1 1.3v1.3c0 .9-.3 1.4-1.4 1.4" stroke="' + color + '" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" fill="none"/>');
    },
    markup: function (color) {
      return doc(color,
        '<path d="M10 12.6l-2.2 2.9L10 18.4M14 12.6l2.2 2.9L14 18.4" stroke="' + color + '" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>');
    },
    binary: function (color) {
      return doc(color,
        '<path d="M8.4 12.8h2.2v6H8.4zM13.4 12.8h2.2v6h-2.2z" stroke="' + color + '" stroke-width="1.15"/>');
    },
    git: function (color) {
      return '<svg class="ficon" viewBox="0 0 24 24" fill="none">' +
        '<circle cx="7" cy="7" r="2.4" stroke="' + color + '" stroke-width="1.35"/>' +
        '<circle cx="7" cy="17.6" r="2.4" stroke="' + color + '" stroke-width="1.35"/>' +
        '<circle cx="17" cy="10.4" r="2.4" stroke="' + color + '" stroke-width="1.35"/>' +
        '<path d="M7 9.4v5.8M9.2 8.4c2.6 0 5.3.4 5.6 2M7 15.2c0-2.6 3.4-2.8 7.4-3.3" stroke="' + color + '" stroke-width="1.35" stroke-linecap="round"/></svg>';
    }
  };

  // ext -> [pembuat ikon, warna, label opsional]
  var MAP = {
    // kode
    js: ['label', C.js, 'JS'], mjs: ['label', C.js, 'JS'], cjs: ['label', C.js, 'JS'],
    jsx: ['label', C.js, 'JSX'], ts: ['label', C.ts, 'TS'], tsx: ['label', C.ts, 'TSX'],
    py: ['label', C.py, 'PY'], pyc: ['binary', C.py], rb: ['label', C.rb, 'RB'],
    php: ['label', C.php, 'PHP'], java: ['label', C.java, 'JAV'], class: ['binary', C.java],
    c: ['label', C.c, 'C'], h: ['label', C.c, 'H'], cpp: ['label', C.cpp, 'C++'],
    cc: ['label', C.cpp, 'C++'], hpp: ['label', C.cpp, 'H++'], cs: ['label', C.cs, 'C#'],
    go: ['label', C.go, 'GO'], rs: ['label', C.rs, 'RS'], swift: ['label', C.swift, 'SWF'],
    kt: ['label', C.kt, 'KT'], lua: ['label', C.lua, 'LUA'], pl: ['label', C.rb, 'PL'],
    r: ['label', C.c, 'R'], dart: ['label', C.ts, 'DRT'], scala: ['label', C.rb, 'SC'],
    // markup & gaya
    html: ['markup', C.html], htm: ['markup', C.html], xhtml: ['markup', C.html],
    vue: ['markup', C.vue], svelte: ['markup', C.svelte], jsp: ['markup', C.java],
    css: ['label', C.css, 'CSS'], scss: ['label', C.sass, 'SASS'], sass: ['label', C.sass, 'SASS'],
    less: ['label', C.css, 'LESS'], styl: ['label', C.sass, 'STY'],
    xml: ['markup', C.xml], svg: ['image', C.img], rss: ['markup', C.xml],
    // data & konfigurasi
    json: ['braces', C.json], jsonc: ['braces', C.json], json5: ['braces', C.json],
    yml: ['label', C.yml, 'YML'], yaml: ['label', C.yml, 'YML'],
    toml: ['label', C.toml, 'TML'], ini: ['label', C.conf, 'INI'],
    conf: ['label', C.conf, 'CFG'], cfg: ['label', C.conf, 'CFG'],
    properties: ['label', C.conf, 'PRP'], env: ['label', C.env, 'ENV'],
    csv: ['label', C.sql, 'CSV'], tsv: ['label', C.sql, 'TSV'],
    sql: ['db', C.sql], db: ['db', C.db], sqlite: ['db', C.db], sqlite3: ['db', C.db],
    // dokumen
    md: ['label', C.md, 'MD'], markdown: ['label', C.md, 'MD'], rst: ['label', C.md, 'RST'],
    txt: ['label', C.txt, 'TXT'], log: ['label', C.log, 'LOG'], nfo: ['label', C.txt, 'NFO'],
    pdf: ['label', C.pdf, 'PDF'], doc: ['label', '#4a7fd1', 'DOC'], docx: ['label', '#4a7fd1', 'DOC'],
    xls: ['label', '#4bbf7a', 'XLS'], xlsx: ['label', '#4bbf7a', 'XLS'],
    ppt: ['label', '#e0743a', 'PPT'], pptx: ['label', '#e0743a', 'PPT'],
    // skrip shell
    sh: ['terminal', C.sh], bash: ['terminal', C.sh], zsh: ['terminal', C.sh],
    fish: ['terminal', C.sh], bat: ['terminal', C.sh], cmd: ['terminal', C.sh],
    ps1: ['terminal', '#4a9fe0'], service: ['label', C.conf, 'SVC'],
    // gambar
    png: ['image', C.img], jpg: ['image', C.img], jpeg: ['image', C.img],
    gif: ['image', C.img], webp: ['image', C.img], bmp: ['image', C.img],
    ico: ['image', C.img], avif: ['image', C.img], tiff: ['image', C.img],
    // media
    mp4: ['video', C.vid], mkv: ['video', C.vid], avi: ['video', C.vid],
    mov: ['video', C.vid], webm: ['video', C.vid], flv: ['video', C.vid],
    mp3: ['audio', C.aud], wav: ['audio', C.aud], flac: ['audio', C.aud],
    ogg: ['audio', C.aud], m4a: ['audio', C.aud], aac: ['audio', C.aud],
    // arsip
    zip: ['archive', C.zip], tar: ['archive', C.zip], gz: ['archive', C.zip],
    tgz: ['archive', C.zip], bz2: ['archive', C.zip], xz: ['archive', C.zip],
    '7z': ['archive', C.zip], rar: ['archive', C.zip], deb: ['archive', '#d14b6b'],
    rpm: ['archive', '#d14b6b'], apk: ['archive', '#66b95c'], iso: ['archive', C.bin],
    // biner & kunci
    exe: ['binary', C.bin], dll: ['binary', C.bin], so: ['binary', C.bin],
    bin: ['binary', C.bin], o: ['binary', C.bin], a: ['binary', C.bin],
    pem: ['lock', C.key], key: ['lock', C.key], crt: ['lock', C.key],
    cer: ['lock', C.key], pub: ['lock', C.key], p12: ['lock', C.key],
    ttf: ['label', C.font, 'TTF'], otf: ['label', C.font, 'OTF'],
    woff: ['label', C.font, 'WF'], woff2: ['label', C.font, 'WF2'],
    lock: ['lock', C.lock], pid: ['label', C.log, 'PID'], sock: ['binary', C.bin]
  };

  // Nama berkas persis (lebih diutamakan daripada ekstensi)
  var EXACT = {
    'dockerfile': ['label', C.dock, 'DOC'],
    'docker-compose.yml': ['label', C.dock, 'DC'],
    'docker-compose.yaml': ['label', C.dock, 'DC'],
    '.gitignore': ['git', C.git], '.gitattributes': ['git', C.git],
    '.gitmodules': ['git', C.git], '.git': ['git', C.git],
    'package.json': ['braces', '#8bc34a'], 'package-lock.json': ['lock', '#8bc34a'],
    'yarn.lock': ['lock', '#4a9fe0'], 'pnpm-lock.yaml': ['lock', '#e0a34b'],
    'readme.md': ['label', '#4a9fe0', 'MD'], 'license': ['label', C.lock, 'LIC'],
    'makefile': ['label', '#d1704b', 'MK'], 'cmakelists.txt': ['label', '#d1704b', 'CMK'],
    '.bashrc': ['terminal', C.sh], '.bash_profile': ['terminal', C.sh],
    '.zshrc': ['terminal', C.sh], '.profile': ['terminal', C.sh],
    '.env': ['label', C.env, 'ENV'], '.npmrc': ['label', C.conf, 'NPM'],
    'nginx.conf': ['label', C.nginx, 'NGX'], 'authorized_keys': ['lock', C.key],
    'known_hosts': ['lock', C.key], 'id_rsa': ['lock', C.key], 'id_ed25519': ['lock', C.key],
    'passwd': ['lock', C.key], 'shadow': ['lock', C.key], 'hosts': ['label', C.conf, 'HST'],
    'crontab': ['label', C.conf, 'CRN'], 'requirements.txt': ['label', C.py, 'PIP'],
    'vercel.json': ['braces', '#8a94a8'], 'tsconfig.json': ['braces', C.ts],
    '.vscode': ['folder', '#4a9fe0']
  };

  // Folder khusus dengan warna sendiri, seperti tema ikon VS Code
  var DIR_TINT = {
    'node_modules': '#7f8b9e', '.git': C.git, 'src': '#4bbf9e', 'dist': '#c9a14b',
    'build': '#c9a14b', 'public': '#e0a34b', 'assets': '#c96fd6', 'images': '#c96fd6',
    'img': '#c96fd6', 'css': '#4b9be0', 'js': C.js, 'lib': '#8b8fd6', 'bin': '#8a94a8',
    'etc': '#9c8a6b', 'var': '#9c8a6b', 'log': '#8a94a8', 'logs': '#8a94a8',
    'home': '#4bbf7a', 'root': '#e05a5a', 'tmp': '#8a94a8', 'usr': '#7f9ce0',
    'backup': '#c9a14b', 'backups': '#c9a14b', 'config': '#9c8a6b', 'conf': '#9c8a6b',
    'docs': '#4a9fe0', 'test': '#66b95c', 'tests': '#66b95c', 'www': '#e0714b',
    'html': '#e0714b', 'downloads': '#4bc4d6', 'media': '#e07a9e', 'opt': '#8b8fd6'
  };

  function ext(name) {
    var n = name.toLowerCase();
    if (n.endsWith('.tar.gz')) return 'tgz';
    if (n.endsWith('.tar.xz')) return 'xz';
    if (n.endsWith('.tar.bz2')) return 'bz2';
    var i = n.lastIndexOf('.');
    if (i <= 0) return '';
    return n.slice(i + 1);
  }

  function render(spec) {
    var kind = spec[0], color = spec[1], text = spec[2];
    if (kind === 'label') return doc(color, label(color, text));
    if (kind === 'folder') return SHAPES.folder(color, false);
    if (SHAPES[kind]) return SHAPES[kind](color);
    return doc(color, '');
  }

  /**
   * fileIcon(name, type, open) -> string SVG
   * type: 'dir' | 'file' | 'link' | lainnya
   */
  function fileIcon(name, type, open) {
    var lower = String(name || '').toLowerCase();

    if (type === 'dir') {
      return SHAPES.folder(DIR_TINT[lower] || C.dir, !!open);
    }
    if (type === 'link') {
      return SHAPES.folder('#7c8cff', false);
    }
    if (type === 'socket' || type === 'fifo' || type === 'block' || type === 'char') {
      return render(['binary', C.bin]);
    }
    if (EXACT[lower]) return render(EXACT[lower]);

    var e = ext(lower);
    if (MAP[e]) return render(MAP[e]);

    // Berkas tanpa ekstensi yang umum di Linux dianggap skrip/konfigurasi
    if (!e) return render(['label', C.txt, '']);
    return render(['label', '#8a94a8', e.slice(0, 3).toUpperCase()]);
  }

  /** Bahasa untuk pewarnaan sintaks di editor. */
  function langOf(name) {
    var e = ext(String(name || '').toLowerCase());
    var n = String(name || '').toLowerCase();
    if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].indexOf(e) > -1) return 'js';
    if (['json', 'jsonc', 'json5'].indexOf(e) > -1) return 'json';
    if (['py'].indexOf(e) > -1) return 'py';
    if (['sh', 'bash', 'zsh', 'fish', 'bashrc', 'profile'].indexOf(e) > -1) return 'sh';
    if (n.startsWith('.bashrc') || n.startsWith('.profile') || n.startsWith('.zshrc')) return 'sh';
    if (['html', 'htm', 'xml', 'svg', 'vue', 'svelte'].indexOf(e) > -1) return 'xml';
    if (['css', 'scss', 'sass', 'less'].indexOf(e) > -1) return 'css';
    if (['yml', 'yaml'].indexOf(e) > -1) return 'yaml';
    if (['conf', 'cfg', 'ini', 'toml', 'properties', 'env', 'service'].indexOf(e) > -1) return 'conf';
    if (['md', 'markdown'].indexOf(e) > -1) return 'md';
    if (['c', 'h', 'cpp', 'cc', 'hpp', 'go', 'rs', 'java', 'cs', 'php', 'rb', 'sql'].indexOf(e) > -1) return 'clike';
    if (['png','jpg','jpeg','gif','webp','bmp','ico','avif','svg'].indexOf(e) > -1) return 'image';
    return 'plain';
  }

  global.XayzIcons = { fileIcon: fileIcon, langOf: langOf, ext: ext };
})(window);
