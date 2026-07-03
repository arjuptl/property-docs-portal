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

  // 4) Largest file allowed, in megabytes. Heads-up: Google caps web-app
  //    requests around ~50MB, and base64 adds ~33% — so files bigger than
  //    ~35MB will fail at Google's edge no matter what this is set to.
  MAX_FILE_MB: 100,

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
  //    dueSoonDays (optional) = how many days before the due date the cell turns
  //    amber. Set it on a category to cover all its subs, or on a single sub.
  //    Types without it use the website default (DUE_SOON_DAYS in config.js).
  DOC_TYPES: [
    { name: 'Inspection', dueSoonDays: 45, subs: [
        { name: 'Fire',       renewalMonths: 12 },
        { name: 'Health',     renewalMonths: 12 },
        { name: 'Elevator',   renewalMonths: 12 },
        { name: 'Backflow',   renewalMonths: 12 },
        { name: 'Pool / Spa', renewalMonths: 12 },
        { name: 'QA',         renewalMonths: 12 },
    ]},
    { name: 'Commission', subs: [
        { name: 'Expedia',     renewalMonths: 1 },
        { name: 'Booking.com', renewalMonths: 1 },
    ]},
    { name: 'Monthly Star',          renewalMonths: 1  },
    { name: 'Monthly Statistic',     renewalMonths: 1  },
    { name: 'Credit Card Statement', renewalMonths: 1  },
    { name: 'Insurance',             renewalMonths: 12, dueSoonDays: 45 },
    { name: 'Licenses & Permits',    renewalMonths: 12, dueSoonDays: 45 },
    { name: 'Contract', subs: [
        { name: 'Cable/internet',      renewalMonths: 0 },
        { name: 'Pest Control',        renewalMonths: 0 },
        { name: 'Elevator',            renewalMonths: 0 },
        { name: 'Franchise Agreement', renewalMonths: 0 },
    ]},
    { name: 'Manager Report',        renewalMonths: 1  },
    { name: 'Utilities', subs: [
        { name: 'Cable',     renewalMonths: 1 },
        { name: 'Telephone', renewalMonths: 1 },
        { name: 'Electric',  renewalMonths: 1 },
        { name: 'Gas',       renewalMonths: 1 },
        { name: 'Water',     renewalMonths: 1 },
        { name: 'Dumpster',  renewalMonths: 1 },
    ]},
    { name: 'Invoices', subs: [
        { name: 'Breakfast',    renewalMonths: 1 },
        { name: 'Pest Control', renewalMonths: 1 },
        { name: 'Electric',     renewalMonths: 1 },
        { name: 'Gas',          renewalMonths: 1 },
        { name: 'Water',        renewalMonths: 1 },
        { name: 'Dumpster',     renewalMonths: 1 },
    ]},
    { name: 'Renovation',            renewalMonths: 0  },
    { name: 'Other',                 renewalMonths: 0  },
  ],

  // 7) Automatic email reminders — see the REMINDERS section at the bottom.
  //    Setup: run setupReminders() once, then sendReminders() once to test.
  REMINDERS: {
    // Your live site (used to put upload links inside the emails).
    SITE_URL: 'https://arjuptl.github.io/property-docs-portal/',

    // The "select few": get the full portfolio digest every week.
    SUMMARY_EMAILS: ['arjuptl@gmail.com'],

    // Each property's GM / front desk. They only get an email when THEIR
    // property has something overdue, due soon, or missing.
    PROPERTY_EMAILS: {
      // 'Best Western Kalamazoo': 'gm-bw@example.com, frontdesk-bw@example.com',
      // 'Hampton Inn Sturgis':    'gm-sturgis@example.com',
    },

    // Also chase never-uploaded items? Great while you onboard; set false
    // later if you only want renewal reminders.
    INCLUDE_MISSING: true,

    // Combos that genuinely don't apply — never nagged about. Example:
    NOT_APPLICABLE: {
      // 'Motel 6 Peoria': ['Inspection — Elevator', 'Inspection — Pool / Spa'],
    },

    // Amber window for types without their own dueSoonDays.
    // Keep in sync with DUE_SOON_DAYS in the website's config.js.
    DEFAULT_DUE_SOON_DAYS: 10,
  },
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
                   renewalMonths: s.renewalMonths || 0,
                   dueSoonDays: (s.dueSoonDays != null ? s.dueSoonDays : t.dueSoonDays) });
      });
    } else {
      out.push({ category: t.name, sub: '', label: t.name,
                 renewalMonths: t.renewalMonths || 0,
                 dueSoonDays: t.dueSoonDays });
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
      return { name: f.label, category: f.category, sub: f.sub, renewalMonths: f.renewalMonths, dueSoonDays: f.dueSoonDays };
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

  const propFolder = resolveUploadFolder(ft, b.property);

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

  let items;
  try {
    // Fastest path: the Drive advanced service batches whole folder levels into
    // a handful of API calls (enable once: Editor -> Services -> + -> Drive API).
    items = (typeof Drive !== 'undefined' && Drive.Files)
      ? itemsViaDriveApi(flats)
      : itemsViaDriveApp(flats);
  } catch (apiProblem) {
    items = itemsViaDriveApp(flats);   // never let the fast path take the site down
  }

  const out = {
    ok: true,
    generatedAt: new Date().toISOString(),
    properties: CONFIG.PROPERTIES,
    docTypes: flats.map(function (f) {
      return { name: f.label, category: f.category, sub: f.sub, renewalMonths: f.renewalMonths, dueSoonDays: f.dueSoonDays };
    }),
    items: items,
  };
  try { cache.put(cacheKey, JSON.stringify(out), 600); } catch (tooBig) { /* >100KB: serve live only */ }
  return out;
}


/** Collision-proof lookup key for a (category, sub) pair. */
function typeKey(category, sub) {
  return JSON.stringify([String(category).toLowerCase(), String(sub || '').toLowerCase()]);
}


/**
 * Collects dashboard items with ~4-6 batched Drive API calls TOTAL (category
 * folders, their children, property folders, then all files) instead of one
 * call per folder - stays fast no matter how many documents accumulate.
 */
function itemsViaDriveApi(flats) {
  const propByLower = {};
  CONFIG.PROPERTIES.forEach(function (p) { propByLower[p.toLowerCase()] = p; });
  const ftByKey = {};
  flats.forEach(function (f) { ftByKey[typeKey(f.category, f.sub)] = f; });
  const isCategory = {};
  CONFIG.DOC_TYPES.forEach(function (t) { isCategory[t.name.toLowerCase()] = true; });

  // Level 1: category folders under the root
  const catById = {};
  driveChildren([CONFIG.ROOT_FOLDER_ID], true).forEach(function (f) {
    if (isCategory[f.name.toLowerCase()]) catById[f.id] = f;
  });

  // Level 2: children of category folders - subcategory or property folders
  const propFolders = [];
  const subById = {};
  if (Object.keys(catById).length) {
    driveChildren(Object.keys(catById), true).forEach(function (f) {
      const parent = (f.parents || []).map(function (id) { return catById[id]; }).filter(Boolean)[0];
      if (!parent) return;
      const subFt = ftByKey[typeKey(parent.name, f.name)];
      if (subFt) { subById[f.id] = { ft: subFt }; return; }
      const simpleFt = ftByKey[typeKey(parent.name, '')];
      const canonical = propByLower[f.name.toLowerCase()];
      if (simpleFt && canonical) propFolders.push({ id: f.id, property: canonical, ft: simpleFt });
    });
  }

  // Level 3: property folders inside subcategory folders
  if (Object.keys(subById).length) {
    driveChildren(Object.keys(subById), true).forEach(function (f) {
      const parent = (f.parents || []).map(function (id) { return subById[id]; }).filter(Boolean)[0];
      const canonical = propByLower[f.name.toLowerCase()];
      if (parent && canonical) propFolders.push({ id: f.id, property: canonical, ft: parent.ft });
    });
  }

  // Level 4: every file inside every property folder, batched
  const items = [];
  const pfById = {};
  propFolders.forEach(function (p) { pfById[p.id] = p; });
  if (Object.keys(pfById).length) {
    driveChildren(Object.keys(pfById), false).forEach(function (f) {
      const pf = (f.parents || []).map(function (id) { return pfById[id]; }).filter(Boolean)[0];
      if (!pf) return;
      let meta = {};
      try { meta = JSON.parse(f.description || '{}'); } catch (ignore) {}
      items.push({
        property: pf.property,
        docType: pf.ft.label,
        category: pf.ft.category,
        sub: pf.ft.sub,
        fileName: f.name,
        url: f.url,
        sizeKB: Math.round((f.size || 0) / 1024),
        reportDate: meta.reportDate || '',
        uploadedBy: meta.uploadedBy || '',
        note: meta.note || '',
        uploadedAt: meta.uploadedAt || f.createdTime || '',
      });
    });
  }
  return items;
}


let DRIVE_IS_V3 = null;   // detected on first call; both service versions work

/** Lists children of many parent folders in one query (chunks of 20 parents). */
function driveChildren(parentIds, foldersOnly) {
  const out = [];
  for (let i = 0; i < parentIds.length; i += 20) {
    const chunk = parentIds.slice(i, i + 20);
    const q = '(' + chunk.map(function (id) { return "'" + id + "' in parents"; }).join(' or ') + ')' +
              ' and trashed=false and mimeType' + (foldersOnly ? '=' : '!=') +
              "'application/vnd.google-apps.folder'";
    let pageToken = null;
    do {
      let res = null;
      if (DRIVE_IS_V3 !== false) {
        try {
          res = Drive.Files.list({ q: q, pageSize: 1000, pageToken: pageToken,
            fields: 'nextPageToken, files(id,name,size,description,createdTime,webViewLink,parents)' });
          DRIVE_IS_V3 = true;
        } catch (v2Signature) {
          if (DRIVE_IS_V3 === true) throw v2Signature;
          DRIVE_IS_V3 = false;
        }
      }
      if (DRIVE_IS_V3 === false) {
        res = Drive.Files.list({ q: q, maxResults: 1000, pageToken: pageToken,
          fields: 'nextPageToken, items(id,title,fileSize,description,createdDate,alternateLink,parents/id)' });
      }
      (res.files || res.items || []).forEach(function (f) {
        out.push({
          id: f.id,
          name: f.name || f.title || '',
          size: Number(f.size || f.fileSize || 0),
          description: f.description || '',
          createdTime: f.createdTime || f.createdDate || '',
          url: f.webViewLink || f.alternateLink || ('https://drive.google.com/file/d/' + f.id + '/view'),
          parents: (f.parents || []).map(function (p) { return p.id || p; }),
        });
      });
      pageToken = res.nextPageToken;
    } while (pageToken);
  }
  return out;
}


/** Fallback collector using plain DriveApp (Drive API service not enabled):
 *  walks only folders that exist - one listing per folder. */
function itemsViaDriveApp(flats) {
  const propByLower = {};
  CONFIG.PROPERTIES.forEach(function (p) { propByLower[p.toLowerCase()] = p; });
  const ftByKey = {};
  flats.forEach(function (f) { ftByKey[typeKey(f.category, f.sub)] = f; });

  const items = [];
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const cats = root.getFolders();
  while (cats.hasNext()) {
    const catFolder = cats.next();
    const catName = catFolder.getName();
    const simpleFt = ftByKey[typeKey(catName, '')];
    const kids = catFolder.getFolders();
    while (kids.hasNext()) {
      const kid = kids.next();
      const kidName = kid.getName();
      const subFt = ftByKey[typeKey(catName, kidName)];
      if (subFt) {
        const propFolders = kid.getFolders();
        while (propFolders.hasNext()) {
          const pf = propFolders.next();
          const canonical = propByLower[pf.getName().toLowerCase()];
          if (canonical) collectFiles(pf, canonical, subFt, items);
        }
      } else if (simpleFt) {
        const canonical = propByLower[kidName.toLowerCase()];
        if (canonical) collectFiles(kid, canonical, simpleFt, items);
      }
    }
  }
  return items;
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

/** Resolves (creating if needed) Root/Category[/Sub]/Property with the folder
 *  id cached for 6 hours — repeat uploads skip three folder lookups. */
function resolveUploadFolder(ft, property) {
  const cache = CacheService.getScriptCache();
  const key = 'fid|' + ft.category + '|' + ft.sub + '|' + property;
  const hit = cache.get(key);
  if (hit) {
    try { return DriveApp.getFolderById(hit); } catch (gone) { /* re-resolve below */ }
  }
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  let typeFolder = getOrCreate(root, ft.category);
  if (ft.sub) typeFolder = getOrCreate(typeFolder, ft.sub);
  const propFolder = getOrCreate(typeFolder, property);
  try { cache.put(key, propFolder.getId(), 21600); } catch (ignore) {}
  return propFolder;
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


// ======================= AUTOMATIC EMAIL REMINDERS ==========================
//  One-time setup, from the Apps Script editor:
//    1. Pick setupReminders in the function dropdown → Run   (installs the
//       Monday-morning schedule; approve the permissions prompt)
//    2. Pick sendReminders → Run   (sends a real test email right now)
//  After that it runs by itself every Monday ~8am. To go daily, change
//  setupReminders below to: .everyDays(1).atHour(8)
// ============================================================================

/** Installs (or re-installs) the weekly schedule. Run once. */
function setupReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendReminders')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8)
    .create();
  Logger.log('✅ Reminders scheduled: every Monday ~8am. Now run sendReminders once to test.');
}


/** Reads Drive, works out what needs attention, and sends the emails. */
function sendReminders() {
  const R = CONFIG.REMINDERS || {};
  const flats = flatTypes();
  let items;
  try {
    items = (typeof Drive !== 'undefined' && Drive.Files)
      ? itemsViaDriveApi(flats) : itemsViaDriveApp(flats);
  } catch (e) {
    items = itemsViaDriveApp(flats);
  }
  const perProperty = reminderReport(flats, items, new Date());

  const site = R.SITE_URL || '';
  let totalOver = 0, totalDue = 0, totalMissing = 0;
  const problemProps = [];

  CONFIG.PROPERTIES.forEach(function (prop) {
    const b = perProperty[prop];
    totalOver += b.overdue.length;
    totalDue += b.dueSoon.length;
    totalMissing += b.missing.length;
    const hasWork = b.overdue.length || b.dueSoon.length ||
                    (R.INCLUDE_MISSING && b.missing.length);
    if (hasWork) problemProps.push({ prop: prop, b: b });

    const to = (R.PROPERTY_EMAILS || {})[prop];
    if (!to || !hasWork) return;
    MailApp.sendEmail({
      to: to,
      subject: '[' + prop + '] Documents need attention: ' + cellCounts(b, R),
      htmlBody: propertyEmailHtml(prop, b, site, R),
    });
  });

  if ((R.SUMMARY_EMAILS || []).length && problemProps.length) {
    MailApp.sendEmail({
      to: R.SUMMARY_EMAILS.join(','),
      subject: 'Weekly documents digest: ' + totalOver + ' overdue · ' + totalDue + ' due soon' +
               (R.INCLUDE_MISSING ? ' · ' + totalMissing + ' missing' : ''),
      htmlBody: summaryEmailHtml(problemProps, site, R),
    });
  }
  Logger.log('Reminders done. overdue=%s dueSoon=%s missing=%s properties_emailed=%s',
             totalOver, totalDue, totalMissing,
             Object.keys(R.PROPERTY_EMAILS || {}).length);
}


/** Pure status math (same rules as the dashboard) — property → buckets. */
function reminderReport(flats, items, now) {
  const R = CONFIG.REMINDERS || {};
  const na = R.NOT_APPLICABLE || {};
  const defaultWarn = (R.DEFAULT_DUE_SOON_DAYS != null) ? R.DEFAULT_DUE_SOON_DAYS : 10;

  // newest document date per property × type
  const newest = {};
  items.forEach(function (it) {
    const k = it.property + '|' + it.docType;
    const d = it.reportDate || String(it.uploadedAt || '').slice(0, 10);
    if (d && (!newest[k] || d > newest[k])) newest[k] = d;
  });

  const perProperty = {};
  CONFIG.PROPERTIES.forEach(function (prop) {
    const b = { overdue: [], dueSoon: [], missing: [] };
    flats.forEach(function (ft) {
      if ((na[prop] || []).indexOf(ft.label) > -1) return;
      if (!ft.renewalMonths) return;               // Renovation/Contract/Other: nothing to chase
      const latest = newest[prop + '|' + ft.label];
      if (!latest) { b.missing.push(ft.label); return; }
      const due = new Date(latest + 'T12:00:00');
      due.setMonth(due.getMonth() + ft.renewalMonths);
      const days = Math.round((due - now) / 86400000);
      const warn = (ft.dueSoonDays != null) ? ft.dueSoonDays : defaultWarn;
      const row = { type: ft.label, last: latest, due: due.toISOString().slice(0, 10), days: days };
      if (days < 0) b.overdue.push(row);
      else if (days <= warn) b.dueSoon.push(row);
    });
    perProperty[prop] = b;
  });
  return perProperty;
}


// ------------------------- email formatting helpers -------------------------

function cellCounts(b, R) {
  const parts = [];
  if (b.overdue.length) parts.push(b.overdue.length + ' overdue');
  if (b.dueSoon.length) parts.push(b.dueSoon.length + ' due soon');
  if (R.INCLUDE_MISSING && b.missing.length) parts.push(b.missing.length + ' missing');
  return parts.join(', ');
}

function htmlEsc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function rowsTable(rows, color) {
  return '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin:6px 0 14px;">' +
    '<tr style="background:#f1f5f9;"><th align="left">Document</th><th align="left">Last on file</th><th align="left">Due</th><th align="left"></th></tr>' +
    rows.map(function (r) {
      const when = r.days < 0 ? Math.abs(r.days) + ' days overdue' : 'in ' + r.days + ' days';
      return '<tr style="border-top:1px solid #e2e8f0;">' +
        '<td><b style="color:' + color + ';">' + htmlEsc(r.type) + '</b></td>' +
        '<td>' + htmlEsc(r.last) + '</td><td>' + htmlEsc(r.due) + '</td>' +
        '<td style="color:#66727f;">' + when + '</td></tr>';
    }).join('') + '</table>';
}

function propertyEmailHtml(prop, b, site, R) {
  const uploadLink = site ? site + '?property=' + encodeURIComponent(prop) + '&lock=1' : '';
  let h = '<div style="font-family:Arial,sans-serif;color:#1f2933;max-width:640px;">' +
          '<h2 style="margin:0 0 4px;">' + htmlEsc(prop) + '</h2>' +
          '<p style="margin:0 0 16px;color:#66727f;">Weekly document check — here is what needs attention.</p>';
  if (b.overdue.length) h += '<h3 style="color:#dc2626;margin:14px 0 2px;">🔴 Overdue</h3>' + rowsTable(b.overdue, '#dc2626');
  if (b.dueSoon.length) h += '<h3 style="color:#d97706;margin:14px 0 2px;">🟠 Due soon</h3>' + rowsTable(b.dueSoon, '#d97706');
  if (R.INCLUDE_MISSING && b.missing.length) {
    h += '<h3 style="color:#64748b;margin:14px 0 2px;">⚪ Never uploaded</h3>' +
         '<p style="margin:4px 0 14px;">' + b.missing.map(htmlEsc).join(' · ') + '</p>';
  }
  if (uploadLink) {
    h += '<p style="margin:18px 0;"><a href="' + htmlEsc(uploadLink) + '" ' +
         'style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">' +
         '📤 Upload documents for ' + htmlEsc(prop) + '</a></p>';
  }
  h += '<p style="color:#94a3b8;font-size:12px;">Automated weekly reminder from the Property Documents Portal.</p></div>';
  return h;
}

function summaryEmailHtml(problemProps, site, R) {
  let h = '<div style="font-family:Arial,sans-serif;color:#1f2933;max-width:680px;">' +
          '<h2 style="margin:0 0 12px;">Weekly documents digest</h2>';
  problemProps.forEach(function (e) {
    h += '<h3 style="margin:16px 0 2px;">' + htmlEsc(e.prop) +
         ' <span style="font-weight:normal;color:#66727f;font-size:13px;">— ' + cellCounts(e.b, R) + '</span></h3>';
    if (e.b.overdue.length) h += rowsTable(e.b.overdue, '#dc2626');
    if (e.b.dueSoon.length) h += rowsTable(e.b.dueSoon, '#d97706');
    if (R.INCLUDE_MISSING && e.b.missing.length) {
      h += '<p style="margin:2px 0 10px;color:#64748b;">⚪ Missing: ' + e.b.missing.map(htmlEsc).join(' · ') + '</p>';
    }
  });
  if (site) {
    h += '<p style="margin:18px 0;"><a href="' + htmlEsc(site) + '#dashboard" ' +
         'style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">' +
         'Open the dashboard</a></p>';
  }
  h += '<p style="color:#94a3b8;font-size:12px;">Automated weekly digest from the Property Documents Portal.</p></div>';
  return h;
}
