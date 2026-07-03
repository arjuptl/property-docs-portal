/* ===========================================================================
 *  Property Documents Portal — front-end logic (vanilla JS, no dependencies)
 * =========================================================================== */
(function () {
  'use strict';

  var CFG = window.PORTAL_CONFIG || {};
  var API = CFG.API_URL || '';
  var DUE_SOON_DAYS = CFG.DUE_SOON_DAYS || 30;

  var state = {
    properties: [],
    docTypes: [],          // nested: [{name, renewalMonths}] or [{name, subs:[…]}]
    flat: [],              // flattened: [{name(label), category, sub, renewalMonths}]
    uploadRequiresKey: false,
    maxFileMb: 40,
    files: [],             // chosen upload files
    items: [],             // dashboard files
    passcode: '',
  };

  var $ = function (id) { return document.getElementById(id); };
  var configured = API && API.indexOf('PASTE_') === -1;
  // Deep-link support: ?property=X&type=Y&lock=1 pre-fills (and locks) the form.
  var params = new URLSearchParams(location.search);

  /* -------------------------- tiny API client --------------------------- *
   * POST with a plain-string body and NO custom headers. The browser then
   * sends Content-Type: text/plain, which is a "simple" CORS request and
   * avoids a preflight that Apps Script can't answer. The Apps Script reads
   * e.postData.contents and JSON.parse()s it.
   * --------------------------------------------------------------------- */
  function api(payload) {
    return fetch(API, { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) {
        if (!r.ok) throw new Error('Network error ' + r.status);
        return r.json();
      });
  }

  /* ------------------------------- nav ---------------------------------- */
  function activateTab(name) {
    document.querySelectorAll('.tab').forEach(function (x) {
      x.classList.toggle('active', x.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    $('view-' + name).classList.add('active');
    // Keep the URL shareable: managers can bookmark …/#dashboard directly.
    history.replaceState(null, '', location.pathname + location.search + (name === 'dashboard' ? '#dashboard' : ''));
  }
  function initNav() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { activateTab(t.dataset.view); });
    });
    if (location.hash === '#dashboard') activateTab('dashboard');
  }

  /* ----------------------------- bootstrap ------------------------------ */
  var CFG_CACHE_KEY = 'portal_cfg_v1';

  function applyConfig(res) {
    state.properties = res.properties || [];
    state.docTypes = res.docTypes || [];
    state.flat = normalizeFlat(res.flatTypes || res.docTypes || []);
    state.uploadRequiresKey = !!res.uploadRequiresKey;
    state.maxFileMb = res.maxFileMb || 40;
    populateDropdowns();
  }

  function boot() {
    initNav();
    if (!configured) { $('configBanner').classList.add('show'); return; }
    $('orgName').textContent = CFG.ORG_NAME || 'Property Documents Portal';
    document.title = (CFG.ORG_NAME ? CFG.ORG_NAME + ' — ' : '') + 'Documents Portal';

    // Paint instantly from the last-known config; refresh silently in the
    // background and only re-render if something actually changed.
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CFG_CACHE_KEY) || 'null'); } catch (ignore) {}
    if (cached && cached.api === API && cached.res) applyConfig(cached.res);

    api({ action: 'config' })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Could not load config');
        try { localStorage.setItem(CFG_CACHE_KEY, JSON.stringify({ api: API, res: res })); } catch (ignore) {}
        if (!cached || JSON.stringify(cached.res) !== JSON.stringify(res)) applyConfig(res);
      })
      .catch(function (err) {
        if (!cached) showMsg('uploadMsg', 'error', 'Could not reach the server. Check API_URL and that the Apps Script is deployed for "Anyone". (' + err.message + ')');
      });

    initUpload();
    initDashboard();
  }

  // Works with both backend shapes: old flat entries pass through unchanged.
  function normalizeFlat(list) {
    return (list || []).map(function (t) {
      return { name: t.name, category: t.category || t.name, sub: t.sub || '',
               renewalMonths: t.renewalMonths || 0 };
    });
  }

  function populateDropdowns() {
    var prop = $('property'), dt = $('docType');
    var fp = $('filterProperty');
    prop.innerHTML = '<option value="">Select a property…</option>';
    dt.innerHTML = '<option value="">Select a document type…</option>';
    fp.innerHTML = '<option value="">All properties</option>';   // reset: this can run twice (cache, then fresh)
    state.properties.forEach(function (p) {
      prop.appendChild(opt(p, p));
      fp.appendChild(opt(p, p));
    });
    state.docTypes.forEach(function (d) { dt.appendChild(opt(d.name, d.name)); });
    dt.addEventListener('change', onCategoryChange);
    refreshTypeFilter();
    if (state.uploadRequiresKey) $('uploadKeyField').style.display = '';
    $('dropHint').textContent = 'PDF, images, Word, Excel… up to ' + state.maxFileMb + 'MB each';
    applyLinkPresets();
  }

  // Show the subcategory dropdown only when the chosen category has subs.
  function onCategoryChange() {
    var cat = state.docTypes.filter(function (d) { return d.name === $('docType').value; })[0];
    var sub = $('docSub');
    if (cat && cat.subs && cat.subs.length) {
      sub.innerHTML = '<option value="">Which kind of ' + escapeHtml(cat.name) + '?</option>';
      cat.subs.forEach(function (s) { sub.appendChild(opt(s.name, s.name)); });
      sub.style.display = '';
    } else {
      sub.innerHTML = '';
      sub.style.display = 'none';
    }
  }

  function refreshTypeFilter() {
    var fd = $('filterDocType');
    var keep = fd.value;
    fd.innerHTML = '<option value="">All document types</option>';
    state.flat.forEach(function (f) { fd.appendChild(opt(f.name, f.name)); });
    fd.value = keep;
  }

  /* Pre-select property/doc-type from a share link, e.g.
     ?property=Hampton%20Inn%20Sturgis&lock=1&type=Fire%20Inspection  */
  function applyLinkPresets() {
    var wantP = (params.get('property') || '').trim().toLowerCase();
    var wantT = (params.get('type') || '').trim().toLowerCase();
    if (wantP) {
      var prop = state.properties.filter(function (p) { return p.toLowerCase() === wantP; })[0];
      if (prop) {
        $('property').value = prop;
        if (params.get('lock') === '1') {
          $('property').disabled = true;
          var note = $('propertyNote');
          note.textContent = '🔒 This link files everything under “' + prop + '”.';
          note.style.display = '';
        }
      }
    }
    if (wantT) {
      // Match a flat label ("Inspection — Fire") or a bare category ("Utilities").
      var ft = state.flat.filter(function (f) { return f.name.toLowerCase() === wantT; })[0];
      if (ft) {
        $('docType').value = ft.category;
        onCategoryChange();
        if (ft.sub) $('docSub').value = ft.sub;
      }
    }
  }

  function opt(value, label) {
    var o = document.createElement('option');
    o.value = value; o.textContent = label;
    return o;
  }

  /* =============================== UPLOAD =============================== */
  function initUpload() {
    var drop = $('drop'), input = $('fileInput');
    drop.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { addFiles(input.files); });
    ['dragover', 'dragenter'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (ev) { addFiles(ev.dataTransfer.files); });
    $('cameraBtn').addEventListener('click', function () { $('cameraInput').click(); });
    $('cameraInput').addEventListener('change', function () { addFiles($('cameraInput').files); });
    $('uploadBtn').addEventListener('click', doUpload);

    // Remember the uploader's name on this device.
    try {
      $('uploadedBy').value = localStorage.getItem('portal_name') || '';
      $('uploadedBy').addEventListener('input', function () {
        localStorage.setItem('portal_name', $('uploadedBy').value);
      });
    } catch (ignore) { /* private browsing */ }
  }

  function addFiles(fileList) {
    var max = state.maxFileMb * 1024 * 1024;
    Array.prototype.forEach.call(fileList, function (f) {
      if (f.size > max) {
        showMsg('uploadMsg', 'error', '"' + f.name + '" is too large (' + mb(f.size) + 'MB). Limit ' + state.maxFileMb + 'MB.');
        return;
      }
      state.files.push(f);
    });
    renderFileList();
  }

  function renderFileList() {
    var box = $('fileList');
    box.innerHTML = '';
    state.files.forEach(function (f, i) {
      var row = document.createElement('div');
      row.innerHTML = '<span>📄 ' + escapeHtml(f.name) + ' <span class="hint">(' + mb(f.size) + 'MB)</span></span>';
      var rm = document.createElement('a');
      rm.href = '#'; rm.textContent = 'remove'; rm.style.color = 'var(--over)';
      rm.addEventListener('click', function (e) { e.preventDefault(); state.files.splice(i, 1); renderFileList(); });
      row.appendChild(rm);
      box.appendChild(row);
    });
  }

  function doUpload() {
    var property = $('property').value;
    var category = $('docType').value;
    var needsSub = $('docSub').style.display !== 'none';
    var sub = needsSub ? $('docSub').value : '';
    if (!property) return showMsg('uploadMsg', 'error', 'Please choose a property.');
    if (!category) return showMsg('uploadMsg', 'error', 'Please choose a document type.');
    if (needsSub && !sub) return showMsg('uploadMsg', 'error', 'Please choose which kind of ' + escapeHtml(category) + '.');
    if (!state.files.length) return showMsg('uploadMsg', 'error', 'Please choose at least one file.');
    if (state.uploadRequiresKey && !$('uploadKey').value.trim()) {
      return showMsg('uploadMsg', 'error', 'An upload key is required.');
    }

    var label = sub ? category + ' — ' + sub : category;
    var common = {
      action: 'upload',
      property: property,
      docCategory: category,
      docSub: sub,
      docType: label,          // also sent flat, so an older backend still accepts it
      reportDate: $('reportDate').value || '',
      uploadedBy: $('uploadedBy').value.trim(),
      note: $('note').value.trim(),
      uploadKey: $('uploadKey') ? $('uploadKey').value.trim() : '',
    };

    var btn = $('uploadBtn');
    btn.disabled = true;
    var total = state.files.length, done = 0, failed = [];

    showMsg('uploadMsg', 'info', '<span class="spin"></span>Uploading 0 / ' + total + '…');

    // Upload up to 3 files at once — multi-file batches finish about 3x sooner
    // than one-at-a-time, and Apps Script handles parallel requests fine.
    var queue = state.files.slice(), active = 0, finished = false;
    function progress() {
      showMsg('uploadMsg', 'info', '<span class="spin"></span>Uploading ' + (done + failed.length) + ' / ' + total + '…');
    }
    function startOne(f) {
      active++;
      fileToBase64(f).then(function (b64) {
        return api(Object.assign({}, common, { fileName: f.name, mimeType: f.type, dataBase64: b64 }));
      }).then(function (res) {
        if (res.ok) { done++; } else { failed.push(f.name + ': ' + res.error); }
      }).catch(function (err) {
        failed.push(f.name + ': ' + err.message);
      }).then(function () {
        active--; progress(); next();
      });
    }
    function next() {
      if (!queue.length && active === 0) {
        if (!finished) { finished = true; finish(); }
        return;
      }
      while (active < 3 && queue.length) startOne(queue.shift());
    }

    function finish() {
      btn.disabled = false;
      if (!failed.length) {
        showMsg('uploadMsg', 'success', '✅ Uploaded ' + done + ' file' + (done === 1 ? '' : 's') + ' to ' + escapeHtml(label) + ' → ' + escapeHtml(property) + '.');
        state.files = []; renderFileList();
        $('note').value = ''; $('reportDate').value = '';
      } else {
        showMsg('uploadMsg', 'error', 'Uploaded ' + done + ' of ' + total + '. Problems:<br>• ' + failed.map(escapeHtml).join('<br>• '));
        state.files = state.files.filter(function (f) {
          return failed.some(function (x) { return x.indexOf(f.name) === 0; });
        });
        renderFileList();
      }
    }
    next();
  }

  /* ============================= DASHBOARD ============================= */
  function initDashboard() {
    $('unlockBtn').addEventListener('click', unlock);
    $('passcode').addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
    $('refreshBtn').addEventListener('click', loadList);
    $('exportBtn').addEventListener('click', exportCsv);
    ['search', 'filterProperty', 'filterDocType', 'onlyProblems'].forEach(function (id) {
      $(id).addEventListener('input', render);
    });
    $('modalClose').addEventListener('click', closeModal);
    $('modalBg').addEventListener('click', function (e) { if (e.target === $('modalBg')) closeModal(); });
  }

  var LIST_CACHE_KEY = 'portal_list_v1';

  function shaHex(s) {
    try {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (x) {
          return ('0' + x.toString(16)).slice(-2);
        }).join('');
      });
    } catch (e) { return Promise.resolve(null); }
  }

  function showBoard() {
    $('lockMsg').classList.remove('show');
    $('lock').style.display = 'none';
    $('board').style.display = '';
  }

  function storeList(hash, res) {
    if (!hash) return;
    try { sessionStorage.setItem(LIST_CACHE_KEY, JSON.stringify({ h: hash, res: res })); } catch (ignore) {}
  }

  function unlock() {
    var pc = $('passcode').value.trim();
    if (!pc) return;
    $('unlockBtn').disabled = true;
    showMsg('lockMsg', 'info', '<span class="spin"></span>Checking…');
    state.passcode = pc;

    shaHex(pc).then(function (hash) {
      // Instant paint if this tab already loaded the dashboard with this
      // passcode — then verify + refresh in the background.
      var cached = null;
      try { cached = JSON.parse(sessionStorage.getItem(LIST_CACHE_KEY) || 'null'); } catch (ignore) {}
      var painted = !!(hash && cached && cached.h === hash && cached.res);
      if (painted) {
        showBoard();
        applyListResult(cached.res);
        $('genAt').textContent += ' · refreshing…';
      }

      api({ action: 'list', passcode: pc }).then(function (res) {
        $('unlockBtn').disabled = false;
        if (!res.ok) {
          state.passcode = '';
          try { sessionStorage.removeItem(LIST_CACHE_KEY); } catch (ignore) {}
          if (painted) { $('board').style.display = 'none'; $('lock').style.display = ''; }
          return showMsg('lockMsg', 'error', res.error || 'Wrong passcode.');
        }
        storeList(hash, res);
        showBoard();
        applyListResult(res);
      }).catch(function (err) {
        $('unlockBtn').disabled = false;
        if (!painted) showMsg('lockMsg', 'error', 'Could not reach the server (' + err.message + ').');
        else $('genAt').textContent = $('genAt').textContent.replace(' · refreshing…', ' · offline copy');
      });
    });
  }

  function loadList() {
    if (!state.passcode) return;
    var btn = $('refreshBtn');
    btn.disabled = true; btn.textContent = 'Refreshing…';
    // Explicit refresh always bypasses the server cache (covers files dropped
    // straight into Drive, which don't clear it the way portal uploads do).
    api({ action: 'list', passcode: state.passcode, noCache: true })
      .then(function (res) {
        if (!res.ok) return;
        applyListResult(res);
        shaHex(state.passcode).then(function (h) { storeList(h, res); });
      })
      .catch(function () {})
      .then(function () { btn.disabled = false; btn.textContent = '↻ Refresh'; });
  }

  function applyListResult(res) {
    state.items = (res.items || []).map(function (it) {
      it.category = it.category || it.docType;   // old-backend items: category = flat name
      it.sub = it.sub || '';
      return it;
    });
    if (res.docTypes) { state.flat = normalizeFlat(res.docTypes); refreshTypeFilter(); }
    if (res.properties) state.properties = res.properties;
    $('genAt').textContent = 'Updated ' + new Date(res.generatedAt).toLocaleString() +
                             (res.cached ? ' · cached' : '');
    render();
  }

  // group items by "property||docType"
  function groupItems(items) {
    var g = {};
    items.forEach(function (it) {
      var k = it.property + '||' + it.docType;
      (g[k] = g[k] || []).push(it);
    });
    return g;
  }

  function effDate(it) { return it.reportDate || (it.uploadedAt || '').slice(0, 10); }

  function statusFor(docType, list) {
    if (!list || !list.length) return { key: 'missing', label: 'Missing' };
    var renewal = docType ? (docType.renewalMonths || 0) : 0;
    var latest = list.map(effDate).filter(Boolean).sort().pop() || '';
    if (!renewal) return { key: 'ok', label: 'On file', date: latest };
    var due = addMonths(new Date(latest), renewal);
    var days = Math.round((due - new Date()) / 86400000);
    if (days < 0) return { key: 'overdue', label: 'Overdue', date: latest };
    if (days <= DUE_SOON_DAYS) return { key: 'due', label: 'Due soon', date: latest };
    return { key: 'ok', label: 'Current', date: latest };
  }

  function render() {
    var groups = groupItems(state.items);     // matrix always reflects everything
    renderStats(groups);
    renderMatrix(groups);
    renderRecent(filterItems(state.items));   // search + filters shape this list
  }

  function renderRecent(items) {
    var list = items.slice()
      .sort(function (a, b) { return (b.uploadedAt || '').localeCompare(a.uploadedAt || ''); })
      .slice(0, 15);
    var box = $('recentList');
    if (!list.length) {
      box.innerHTML = '<p class="muted">No uploads match the current filters.</p>';
      return;
    }
    box.innerHTML = list.map(function (it) {
      return '<div class="rrow">' +
        '<span class="rdate">' + (it.uploadedAt || '').slice(0, 10) + '</span>' +
        '<span class="rmain">' +
          '<a href="' + escapeAttr(it.url) + '" target="_blank" rel="noopener">' + escapeHtml(it.fileName) + '</a>' +
          '<span class="rsub">' + escapeHtml(it.property) + ' · ' + escapeHtml(it.docType) +
            (it.uploadedBy ? ' · by ' + escapeHtml(it.uploadedBy) : '') + '</span>' +
        '</span></div>';
    }).join('');
  }

  function filterItems(items) {
    var q = $('search').value.toLowerCase();
    var fp = $('filterProperty').value, fd = $('filterDocType').value;
    return items.filter(function (it) {
      if (fp && it.property !== fp) return false;
      if (fd && it.docType !== fd) return false;
      if (q) {
        var hay = (it.fileName + ' ' + it.note + ' ' + it.uploadedBy + ' ' + it.property + ' ' + it.docType).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderStats(groups) {
    var counts = { ok: 0, due: 0, overdue: 0, missing: 0 };
    state.properties.forEach(function (p) {
      state.flat.forEach(function (d) {
        var st = statusFor(d, groups[p + '||' + d.name]);
        counts[st.key]++;
      });
    });
    var total = state.items.length;
    $('stats').innerHTML =
      stat(total, 'documents on file', '') +
      stat(counts.overdue, 'overdue', 'over') +
      stat(counts.due, 'due soon', 'due') +
      stat(counts.missing, 'missing', 'missing');
  }
  function stat(n, label, cls) {
    return '<div class="stat ' + cls + '"><div class="n">' + n + '</div><div class="l">' + label + '</div></div>';
  }

  function renderMatrix(groups) {
    var onlyProblems = $('onlyProblems').checked;
    var fp = $('filterProperty').value, fd = $('filterDocType').value;
    var props = state.properties.filter(function (p) { return !fp || p === fp; });
    var types = state.flat.filter(function (d) { return !fd || d.name === fd; });

    // Group consecutive columns by category for a two-row header:
    //   | Property |      Inspection      | Insurance | Manager Report |
    //   |          | Fire | Health | QA … |           |                |
    var cats = [];
    types.forEach(function (t) {
      var c = cats[cats.length - 1];
      if (!c || c.name !== t.category) { c = { name: t.category, types: [] }; cats.push(c); }
      c.types.push(t);
    });
    var hasSubRow = types.some(function (t) { return t.sub; });

    var html = '<thead><tr><th' + (hasSubRow ? ' rowspan="2"' : '') + '>Property</th>';
    cats.forEach(function (c) {
      if (c.types[0].sub) {
        html += '<th colspan="' + c.types.length + '" class="cathead">' + escapeHtml(c.name) + '</th>';
      } else {
        c.types.forEach(function (t) {
          html += '<th' + (hasSubRow ? ' rowspan="2"' : '') + '>' + escapeHtml(t.category) + '</th>';
        });
      }
    });
    html += '</tr>';
    if (hasSubRow) {
      html += '<tr>';
      cats.forEach(function (c) {
        if (!c.types[0].sub) return;
        c.types.forEach(function (t) { html += '<th class="subhead">' + escapeHtml(t.sub) + '</th>'; });
      });
      html += '</tr>';
    }
    html += '</thead><tbody>';

    props.forEach(function (p) {
      var cells = '', rowHasProblem = false;
      types.forEach(function (d) {
        var list = groups[p + '||' + d.name] || [];
        var st = statusFor(d, list);
        if (st.key === 'overdue' || st.key === 'missing' || st.key === 'due') rowHasProblem = true;
        var dateLine = st.date ? '<span class="d">' + st.date + (list.length > 1 ? ' · ' + list.length : '') + '</span>' : '';
        cells += '<td><span class="cell ' + st.key + '" data-p="' + escapeAttr(p) + '" data-d="' + escapeAttr(d.name) + '">' +
                 st.label + dateLine + '</span></td>';
      });
      if (onlyProblems && !rowHasProblem) return;
      html += '<tr><th>' + escapeHtml(p) + '</th>' + cells + '</tr>';
    });
    html += '</tbody>';
    var table = $('matrix');
    table.innerHTML = html;
    table.querySelectorAll('.cell').forEach(function (c) {
      c.addEventListener('click', function () { openModal(c.dataset.p, c.dataset.d); });
    });
  }

  /* ------------------------------- modal -------------------------------- */
  function openModal(property, docType) {
    var list = state.items.filter(function (it) { return it.property === property && it.docType === docType; });
    list.sort(function (a, b) { return effDate(b).localeCompare(effDate(a)); });
    $('modalTitle').textContent = docType + ' · ' + property;
    $('modalSub').textContent = list.length + ' document' + (list.length === 1 ? '' : 's');
    var body = $('modalBody');
    if (!list.length) {
      body.innerHTML = '<p class="muted">No documents uploaded yet for this property &amp; type.</p>';
    } else {
      body.innerHTML = list.map(function (it) {
        return '<div class="doc">' +
          '<div class="name"><a href="' + escapeAttr(it.url) + '" target="_blank" rel="noopener">' + escapeHtml(it.fileName) + '</a></div>' +
          '<div class="meta">' +
            (it.reportDate ? 'Document date: ' + it.reportDate + ' · ' : '') +
            'Uploaded ' + new Date(it.uploadedAt).toLocaleDateString() +
            (it.uploadedBy ? ' by ' + escapeHtml(it.uploadedBy) : '') +
            ' · ' + it.sizeKB + ' KB' +
          '</div>' +
          (it.note ? '<div class="meta">📝 ' + escapeHtml(it.note) + '</div>' : '') +
        '</div>';
      }).join('');
    }
    $('modalBg').classList.add('show');
  }
  function closeModal() { $('modalBg').classList.remove('show'); }

  /* ------------------------------- export ------------------------------- */
  function exportCsv() {
    var rows = [['Property', 'Category', 'Subcategory', 'Document Date', 'Uploaded At', 'Uploaded By', 'File Name', 'Size KB', 'Note', 'Link']];
    filterItems(state.items).forEach(function (it) {
      rows.push([it.property, it.category, it.sub, it.reportDate, it.uploadedAt, it.uploadedBy, it.fileName, it.sizeKB, it.note, it.url]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'property-documents.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ------------------------------- utils -------------------------------- */
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function addMonths(date, m) { var d = new Date(date.getTime()); d.setMonth(d.getMonth() + m); return d; }
  function mb(bytes) { return (bytes / (1024 * 1024)).toFixed(1); }
  function showMsg(id, type, html) {
    var el = $(id);
    el.className = 'msg show ' + type;
    el.innerHTML = html;
    if (!html) el.classList.remove('show');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  boot();
})();
