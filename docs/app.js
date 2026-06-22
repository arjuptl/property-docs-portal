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
    docTypes: [],          // [{name, renewalMonths}]
    uploadRequiresKey: false,
    maxFileMb: 40,
    files: [],             // chosen upload files
    items: [],             // dashboard files
    passcode: '',
  };

  var $ = function (id) { return document.getElementById(id); };
  var configured = API && API.indexOf('PASTE_') === -1;

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
  function initNav() {
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
        $('view-' + t.dataset.view).classList.add('active');
      });
    });
  }

  /* ----------------------------- bootstrap ------------------------------ */
  function boot() {
    initNav();
    if (!configured) { $('configBanner').classList.add('show'); return; }
    $('orgName').textContent = CFG.ORG_NAME || 'Property Documents Portal';
    document.title = (CFG.ORG_NAME ? CFG.ORG_NAME + ' — ' : '') + 'Documents Portal';

    api({ action: 'config' })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Could not load config');
        state.properties = res.properties || [];
        state.docTypes = res.docTypes || [];
        state.uploadRequiresKey = !!res.uploadRequiresKey;
        state.maxFileMb = res.maxFileMb || 40;
        populateDropdowns();
      })
      .catch(function (err) {
        showMsg('uploadMsg', 'error', 'Could not reach the server. Check API_URL and that the Apps Script is deployed for "Anyone". (' + err.message + ')');
      });

    initUpload();
    initDashboard();
  }

  function populateDropdowns() {
    var prop = $('property'), dt = $('docType');
    var fp = $('filterProperty'), fd = $('filterDocType');
    prop.innerHTML = '<option value="">Select a property…</option>';
    dt.innerHTML = '<option value="">Select a document type…</option>';
    state.properties.forEach(function (p) {
      prop.appendChild(opt(p, p));
      fp.appendChild(opt(p, p));
    });
    state.docTypes.forEach(function (d) {
      dt.appendChild(opt(d.name, d.name));
      fd.appendChild(opt(d.name, d.name));
    });
    if (state.uploadRequiresKey) $('uploadKeyField').style.display = '';
    $('dropHint').textContent = 'PDF, images, Word, Excel… up to ' + state.maxFileMb + 'MB each';
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
    $('uploadBtn').addEventListener('click', doUpload);
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
    var docType = $('docType').value;
    if (!property) return showMsg('uploadMsg', 'error', 'Please choose a property.');
    if (!docType) return showMsg('uploadMsg', 'error', 'Please choose a document type.');
    if (!state.files.length) return showMsg('uploadMsg', 'error', 'Please choose at least one file.');
    if (state.uploadRequiresKey && !$('uploadKey').value.trim()) {
      return showMsg('uploadMsg', 'error', 'An upload key is required.');
    }

    var common = {
      action: 'upload',
      property: property,
      docType: docType,
      reportDate: $('reportDate').value || '',
      uploadedBy: $('uploadedBy').value.trim(),
      note: $('note').value.trim(),
      uploadKey: $('uploadKey') ? $('uploadKey').value.trim() : '',
    };

    var btn = $('uploadBtn');
    btn.disabled = true;
    var total = state.files.length, done = 0, failed = [];

    showMsg('uploadMsg', 'info', '<span class="spin"></span>Uploading 0 / ' + total + '…');

    // Upload files one at a time (keeps payloads small and progress clear).
    var queue = state.files.slice();
    function next() {
      if (!queue.length) return finish();
      var f = queue.shift();
      fileToBase64(f).then(function (b64) {
        var payload = Object.assign({}, common, {
          fileName: f.name, mimeType: f.type, dataBase64: b64,
        });
        return api(payload);
      }).then(function (res) {
        if (res.ok) { done++; } else { failed.push(f.name + ': ' + res.error); }
        showMsg('uploadMsg', 'info', '<span class="spin"></span>Uploading ' + (done + failed.length) + ' / ' + total + '…');
        next();
      }).catch(function (err) {
        failed.push(f.name + ': ' + err.message);
        next();
      });
    }

    function finish() {
      btn.disabled = false;
      if (!failed.length) {
        showMsg('uploadMsg', 'success', '✅ Uploaded ' + done + ' file' + (done === 1 ? '' : 's') + ' to ' + escapeHtml(docType) + ' → ' + escapeHtml(property) + '.');
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

  function unlock() {
    var pc = $('passcode').value.trim();
    if (!pc) return;
    $('unlockBtn').disabled = true;
    showMsg('lockMsg', 'info', '<span class="spin"></span>Checking…');
    state.passcode = pc;
    api({ action: 'list', passcode: pc }).then(function (res) {
      $('unlockBtn').disabled = false;
      if (!res.ok) { state.passcode = ''; return showMsg('lockMsg', 'error', res.error || 'Wrong passcode.'); }
      $('lockMsg').classList.remove('show');
      $('lock').style.display = 'none';
      $('board').style.display = '';
      applyListResult(res);
    }).catch(function (err) {
      $('unlockBtn').disabled = false;
      showMsg('lockMsg', 'error', 'Could not reach the server (' + err.message + ').');
    });
  }

  function loadList() {
    if (!state.passcode) return;
    showMsg('lockMsg', 'info', '');
    api({ action: 'list', passcode: state.passcode }).then(function (res) {
      if (res.ok) applyListResult(res);
    });
  }

  function applyListResult(res) {
    state.items = res.items || [];
    if (res.docTypes) state.docTypes = res.docTypes;
    if (res.properties) state.properties = res.properties;
    $('genAt').textContent = 'Updated ' + new Date(res.generatedAt).toLocaleString();
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
    var filtered = filterItems(state.items);
    var groups = groupItems(state.items);     // matrix always reflects everything
    renderStats(groups);
    renderMatrix(groups);
    void filtered; // (search/table filtering happens inside the modal + CSV)
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
      state.docTypes.forEach(function (d) {
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
    var types = state.docTypes.filter(function (d) { return !fd || d.name === fd; });

    var html = '<thead><tr><th>Property</th>';
    types.forEach(function (d) { html += '<th>' + escapeHtml(d.name) + '</th>'; });
    html += '</tr></thead><tbody>';

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
    $('modalTitle').textContent = docType + ' — ' + property;
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
    var rows = [['Property', 'Document Type', 'Document Date', 'Uploaded At', 'Uploaded By', 'File Name', 'Size KB', 'Note', 'Link']];
    filterItems(state.items).forEach(function (it) {
      rows.push([it.property, it.docType, it.reportDate, it.uploadedAt, it.uploadedBy, it.fileName, it.sizeKB, it.note, it.url]);
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
