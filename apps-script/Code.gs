/**
 * ============================================================================
 *  PROPERTY DOCUMENTS PORTAL  —  Google Apps Script backend
 * ============================================================================
 *  This is the "server" for your portal. It runs for free on Google's
 *  infrastructure, owns the connection to your Google Drive, and does 3 jobs:
 *
 *    1. config  -> tells the website your property list + document types
 *    2. upload  -> saves an uploaded file into the right Drive folder
 *    3. list    -> (passcode protected) returns every file for the dashboard
 *
 *  Files are organized in Drive like this (subcategories are optional):
 *
 *    [Your Root Folder]
 *      └── Inspection
 *            └── Fire
 *                  ├── Best Western Kalamazoo
 *                  │     └── 2026-01-15__Annual Fire Report.pdf
 *                  └── Hampton Inn Sturgis
 *            └── QA
 *      └── Manager Report          ← no subcategory: property folders sit here
 *            └── Best Western Kalamazoo
 *
 *  SETUP: edit the CONFIG block below, then deploy as a Web App.
 *  Full step-by-step instructions are in README.md.
 * ============================================================================
 */

// =========================== CONFIG — EDIT ME ===============================
const CONFIG = {
  // 1) The Drive folder that will hold everything.
  //    Open the folder in Drive; the ID is the part of the URL after /folders/
  ROOT_FOLDER_ID: '1x2KB_cFmAoeKNTw7QrQowqsX9RFoTrZV',

  // 2) Passcode required to VIEW the dashboard (the "select few").
  //    NOTE: your REAL passcode lives in your deployed Apps Script. It is kept
  //    out of this (public) repo on purpose. Set it again if you ever re-paste
  //    this file into the Apps Script editor.
  ADMIN_PASSCODE: 'set-in-deployed-apps-script',

  // 3) Upload key. Leave '' so ANYONE can upload (as you asked).
  //    Recommended: set a shared staff word here to stop random internet spam.
  UPLOAD_KEY: '',

  // 4) Largest file allowed, in megabytes.
  MAX_FILE_MB: 40,

  // 5) Your properties. Add/remove freely — the website reads this list.
  PROPERTIES: [
    'Best Western Kalamazoo',
    'Hampton Inn Kalamazoo',
    'Hampton Inn Sturgis',
    'Comfort Inn La Porte',
    'Country Inn Traverse City',
    'Comfort Inn Kalamazoo',
    'Super 8 Manistee',
    'Fairfield Inn Evansville',
    'Holiday Inn Express Normal',
    'Motel 6 Peoria',
    'Comfort Inn South Haven',
    'HomeTowne Studios Lansing',
    'Holiday Inn Express Three Rivers',
    'Hampton Inn Port Huron',
  ],

  // 6) Document types. Two shapes are allowed, mix freely:
  //      { name: 'Utilities', renewalMonths: 1 }          ← simple type
  //      { name: 'Inspection', subs: [ {...}, {...} ] }   ← category with subcategories
  //    renewalMonths drives the compliance colors on the dashboard (e.g. a fire
  //    inspection is due again 12 months after its date). 0 = never expires.
  DOC_TYPES: [
    { name: 'Inspection', subs: [
        { name: 'Fire',       renewalMonths: 12 },
        { name: 'Health',     renewalMonths: 12 },
        { name: 'Elevator',   renewalMonths: 12 },
        { name: 'Backflow',   renewalMonths: 12 },
        { name: 'Pool / Spa', renewalMonths: 12 },
        { name: 'QA',         renewalMonths: 12 },
    ]},
    { name: 'Commission',          renewalMonths: 1  },
    { name: 'Monthly Star',        renewalMonths: 1  },
    { name: 'Monthly Statistic',   renewalMonths: 1  },
    { name: 'Insurance',           renewalMonths: 12 },
    { name: 'Licenses & Permits',  renewalMonths: 12 },
    { name: 'Contract',            renewalMonths: 0  },
    { name: 'Manager Report',      renewalMonths: 12 },
    { name: 'Utilities',           renewalMonths: 12 },
    { name: 'Renovation',          renewalMonths: 0  },
    { name: 'Franchise Agreement', renewalMonths: 0  },
    { name: 'Other',               renewalMonths: 0  },
  ],
};
// ========================= END CONFIG (logic below) =========================


/**
 * Run this ONCE from the Apps Script editor (pick "setupCheck" and click Run).
 * It verifies your folder ID, triggers the Drive permission prompt, and
 * pre-creates the document-type folders so Drive looks tidy from day one.
 */
function setupCheck() {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  Logger.log('✅ Root folder found: "%s"', root.getName());
  CONFIG.DOC_TYPES.forEach(function (dt) {
    const catFolder = getOrCreate(root, dt.name);
    (dt.subs || []).forEach(function (s) { getOrCreate(catFolder, s.name); });
  });
  Logger.log('✅ Verified %s document-type folders. You are ready to deploy.',
             CONFIG.DOC_TYPES.length);
}


/** Flattens DOC_TYPES: a category with subs becomes one entry per sub. */
function flatTypes() {
  const out = [];
  CONFIG.DOC_TYPES.forEach(function (t) {
    if (t.subs && t.subs.length) {
      t.subs.forEach(function (s) {
        out.push({ category: t.name, sub: s.name, label: t.name + ' — ' + s.name,
                   renewalMonths: s.renewalMonths || 0 });
      });
    } else {
      out.push({ category: t.name, sub: '', label: t.name,
                 renewalMonths: t.renewalMonths || 0 });
    }
  });
  return out;
}


/** Visiting the web-app URL in a browser shows this friendly note. */
function doGet() {
  return ContentService
    .createTextOutput('Property Documents Portal API is running. Open the website to use it.')
    .setMimeType(ContentService.MimeType.TEXT);
}


/** All website requests come in here as POST with a JSON body. */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (body.action) {
      case 'config': return json(handleConfig());
      case 'upload': return json(handleUpload(body));
      case 'list':   return json(handleList(body));
      default:       return json({ ok: false, error: 'Unknown action.' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}


/** Sends the property list + document types to the website. */
function handleConfig() {
  return {
    ok: true,
    properties: CONFIG.PROPERTIES,
    docTypes: CONFIG.DOC_TYPES,     // nested — the upload form builds its dropdowns from this
    flatTypes: flatTypes().map(function (f) {
      return { name: f.label, category: f.category, sub: f.sub, renewalMonths: f.renewalMonths };
    }),
    uploadRequiresKey: !!CONFIG.UPLOAD_KEY,
    maxFileMb: CONFIG.MAX_FILE_MB,
  };
}


/** Saves one uploaded file into  Root / DocType / Property. */
function handleUpload(b) {
  if (CONFIG.UPLOAD_KEY && b.uploadKey !== CONFIG.UPLOAD_KEY) {
    return { ok: false, error: 'Wrong upload key.' };
  }
  if (CONFIG.PROPERTIES.indexOf(b.property) === -1) {
    return { ok: false, error: 'Unknown property.' };
  }
  // Accept category+sub (current site) or a flat label (an older cached page).
  let ft = null;
  if (b.docCategory) {
    ft = flatTypes().filter(function (f) {
      return f.category === b.docCategory && f.sub === String(b.docSub || '');
    })[0];
  } else if (b.docType) {
    ft = flatTypes().filter(function (f) { return f.label === b.docType; })[0];
  }
  if (!ft) {
    return { ok: false, error: 'Unknown document type.' };
  }
  if (!b.dataBase64 || !b.fileName) {
    return { ok: false, error: 'No file received.' };
  }

  const bytes = Utilities.base64Decode(b.dataBase64);
  const sizeMb = bytes.length / (1024 * 1024);
  if (sizeMb > CONFIG.MAX_FILE_MB) {
    return { ok: false, error: 'File is too large (' + sizeMb.toFixed(1) +
                                'MB). Limit is ' + CONFIG.MAX_FILE_MB + 'MB.' };
  }

  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  let typeFolder = getOrCreate(root, ft.category);
  if (ft.sub) typeFolder = getOrCreate(typeFolder, ft.sub);
  const propFolder = getOrCreate(typeFolder, b.property);

  // Prefix the filename with the report date (or today) so files sort by date
  // inside Drive and are easy to scan by eye.
  const datePrefix = /^\d{4}-\d{2}-\d{2}$/.test(b.reportDate || '')
    ? b.reportDate
    : isoDate(new Date());
  const finalName = datePrefix + '__' + sanitize(b.fileName);

  const blob = Utilities.newBlob(bytes, b.mimeType || 'application/octet-stream', finalName);
  const file = propFolder.createFile(blob);

  // Stash the extra details on the file itself so the dashboard can show them.
  file.setDescription(JSON.stringify({
    reportDate: b.reportDate || '',
    uploadedBy: String(b.uploadedBy || '').slice(0, 120),
    note: String(b.note || '').slice(0, 500),
    uploadedAt: new Date().toISOString(),
  }));

  // A new file makes any cached dashboard listing stale — clear it.
  try {
    CacheService.getScriptCache()
      .remove('list-v2-' + flatTypes().length + '-' + CONFIG.PROPERTIES.length);
  } catch (ignore) {}

  return { ok: true, fileName: finalName, url: file.getUrl() };
}


/** Returns every file (passcode protected) for the admin dashboard. */
function handleList(b) {
  if (b.passcode !== CONFIG.ADMIN_PASSCODE) {
    return { ok: false, error: 'Wrong passcode.' };
  }

  const flats = flatTypes();
  // Cache key includes the config shape, so redeploying with new types or
  // properties doesn't serve a stale layout for the next 10 minutes.
  const cacheKey = 'list-v2-' + flats.length + '-' + CONFIG.PROPERTIES.length;
  const cache = CacheService.getScriptCache();
  if (!b.noCache) {
    const hit = cache.get(cacheKey);
    if (hit) {
      const cached = JSON.parse(hit);
      cached.cached = true;
      return cached;
    }
  }

  // Walk only the folders that actually exist (one listing per folder) instead
  // of probing every Category × Sub × Property combination by name — that was
  // hundreds of Drive lookups and the reason the dashboard crawled.
  const propByLower = {};
  CONFIG.PROPERTIES.forEach(function (p) { propByLower[p.toLowerCase()] = p; });
  const ftByKey = {};
  flats.forEach(function (f) {
    ftByKey[(f.category + '\u0000' + f.sub).toLowerCase()] = f;
  });

  const items = [];
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const cats = root.getFolders();
  while (cats.hasNext()) {
    const catFolder = cats.next();
    const catName = catFolder.getName();
    const simpleFt = ftByKey[(catName + '\u0000').toLowerCase()];
    const kids = catFolder.getFolders();
    while (kids.hasNext()) {
      const kid = kids.next();
      const kidName = kid.getName();
      const subFt = ftByKey[(catName + '\u0000' + kidName).toLowerCase()];
      if (subFt) {
        // kid is a subcategory folder — its children are property folders
        const propFolders = kid.getFolders();
        while (propFolders.hasNext()) {
          const pf = propFolders.next();
          const canonical = propByLower[pf.getName().toLowerCase()];
          if (canonical) collectFiles(pf, canonical, subFt, items);
        }
      } else if (simpleFt) {
        // kid is a property folder directly under a simple category
        const canonical = propByLower[kidName.toLowerCase()];
        if (canonical) collectFiles(kid, canonical, simpleFt, items);
      }
    }
  }

  const out = {
    ok: true,
    generatedAt: new Date().toISOString(),
    properties: CONFIG.PROPERTIES,
    docTypes: flats.map(function (f) {
      return { name: f.label, category: f.category, sub: f.sub, renewalMonths: f.renewalMonths };
    }),
    items: items,
  };
  try { cache.put(cacheKey, JSON.stringify(out), 600); } catch (tooBig) { /* >100KB: serve live only */ }
  return out;
}


/** Pushes one dashboard row per file in a property folder. */
function collectFiles(propFolder, property, ft, items) {
  const files = propFolder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    let meta = {};
    try { meta = JSON.parse(f.getDescription() || '{}'); } catch (ignore) {}
    items.push({
      property: property,
      docType: ft.label,      // composite, e.g. "Inspection — Fire"
      category: ft.category,
      sub: ft.sub,
      fileName: f.getName(),
      url: f.getUrl(),
      sizeKB: Math.round(f.getSize() / 1024),
      reportDate: meta.reportDate || '',
      uploadedBy: meta.uploadedBy || '',
      note: meta.note || '',
      uploadedAt: meta.uploadedAt || f.getDateCreated().toISOString(),
    });
  }
}


// ------------------------------- helpers -----------------------------------

function getOrCreate(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function sanitize(name) {
  return String(name)
    .replace(/[\/\\]/g, '_')   // no path separators in a filename
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'file';
}

function isoDate(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
