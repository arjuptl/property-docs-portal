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
 *  Files are organized in Drive like this:
 *
 *    [Your Root Folder]
 *      └── Fire Inspection
 *            ├── Maple Inn
 *            │     └── 2026-01-15__Annual Fire Report.pdf
 *            └── Riverside Hotel
 *      └── Manager Report
 *            └── ...
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
    'Holiday Inn La Porte',
  ],

  // 6) Document types. renewalMonths drives the compliance colors on the
  //    dashboard (e.g. a fire inspection is due again 12 months after its date).
  //    Use 0 for documents that never expire.
  DOC_TYPES: [
    { name: 'Fire Inspection',     renewalMonths: 12 },
    { name: 'Health Inspection',   renewalMonths: 12 },
    { name: 'Elevator Inspection', renewalMonths: 12 },
    { name: 'Pool / Spa',          renewalMonths: 12 },
    { name: 'Insurance',           renewalMonths: 12 },
    { name: 'Licenses & Permits',  renewalMonths: 12 },
    { name: 'Manager Report',      renewalMonths: 1  },
    { name: 'Utilities',           renewalMonths: 1  },
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
  CONFIG.DOC_TYPES.forEach(function (dt) { getOrCreate(root, dt.name); });
  Logger.log('✅ Verified %s document-type folders. You are ready to deploy.',
             CONFIG.DOC_TYPES.length);
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
    docTypes: CONFIG.DOC_TYPES,
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
  if (!CONFIG.DOC_TYPES.some(function (d) { return d.name === b.docType; })) {
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
  const typeFolder = getOrCreate(root, b.docType);
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

  return { ok: true, fileName: finalName, url: file.getUrl() };
}


/** Returns every file (passcode protected) for the admin dashboard. */
function handleList(b) {
  if (b.passcode !== CONFIG.ADMIN_PASSCODE) {
    return { ok: false, error: 'Wrong passcode.' };
  }
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const items = [];

  CONFIG.DOC_TYPES.forEach(function (dt) {
    const typeFolder = findChild(root, dt.name);
    if (!typeFolder) return;
    CONFIG.PROPERTIES.forEach(function (prop) {
      const propFolder = findChild(typeFolder, prop);
      if (!propFolder) return;
      const files = propFolder.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        let meta = {};
        try { meta = JSON.parse(f.getDescription() || '{}'); } catch (ignore) {}
        items.push({
          property: prop,
          docType: dt.name,
          fileName: f.getName(),
          url: f.getUrl(),
          sizeKB: Math.round(f.getSize() / 1024),
          reportDate: meta.reportDate || '',
          uploadedBy: meta.uploadedBy || '',
          note: meta.note || '',
          uploadedAt: meta.uploadedAt || f.getDateCreated().toISOString(),
        });
      }
    });
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    properties: CONFIG.PROPERTIES,
    docTypes: CONFIG.DOC_TYPES,
    items: items,
  };
}


// ------------------------------- helpers -----------------------------------

function getOrCreate(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function findChild(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
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
