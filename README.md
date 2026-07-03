# Property Documents Portal

A free, no-server portal where **anyone** (your on-site staff) can upload documents
— fire inspections, manager reports, utilities, licenses, etc. — tagged to a
**property** and a **document type**. Files land automatically in organized
Google Drive folders. A **passcode-protected dashboard** (the "select few") shows
a compliance grid across all properties: *who has a current fire inspection, who's
overdue, who's missing one.*

```
  Staff phone/laptop                GitHub Pages              Google Apps Script         Google Drive
 ┌──────────────────┐   upload    ┌──────────────┐  POST   ┌──────────────────┐      ┌──────────────┐
 │  Upload form     │ ──────────▶ │  Your website │ ──────▶ │  Backend (free)   │ ───▶ │ Fire Inspect/│
 │  pick property + │             │  (static)     │         │  routes to folder │      │   Maple Inn/ │
 │  document type   │             └──────────────┘         │  checks passcode  │      │   Riverside/ │
 └──────────────────┘                    ▲                 └──────────────────┘      └──────────────┘
                                          │ dashboard (passcode)        │ reads files
                                   ┌──────────────┐                     │
                                   │  The few who  │◀────────────────────┘
                                   │  see all docs │   compliance grid + links
                                   └──────────────┘
```

**Cost:** $0. **Servers to maintain:** none. Everything runs on GitHub Pages +
Google's free Apps Script + your existing Google Drive.

---

## What it does (mapped to your requirements)

| You asked for | How it works |
|---|---|
| Employees upload docs tagged to their property + what it is | Upload form with **Property** and **Document type** dropdowns |
| Files go into folders like "fire inspection for all hotels" | Auto-filed as `Document Type → Property` in Drive |
| GitHub-hosted website | Static site on **GitHub Pages** |
| "Does property X have a fire inspection? where are the others'?" | **Compliance grid**: properties × document types, color-coded |
| Manage multiple properties' reports, reference quickly | Click any cell → list of files → open in Drive |
| Anyone can upload | Upload form is open (optional shared key to stop spam) |
| Only a select few can view all | Dashboard is **passcode-protected**; Drive folder stays private |
| See reports from our Google Drive | The files *are* in your Drive — the portal just organizes + surfaces them |

---

## Setup — about 20 minutes, one time

You'll do three things: **(A)** set up the Drive folder + backend, **(B)** put the
website on GitHub, **(C)** give the right people access.

### A. Google Drive + backend (Apps Script)

1. **Create the master folder** in Google Drive, e.g. `Property Documents`.
   Open it. The URL looks like
   `https://drive.google.com/drive/folders/`**`1AbCdEf...XyZ`** — copy that ID
   (the part after `/folders/`).

2. Go to **<https://script.google.com>** → **New project**.

3. Delete the sample code. Open [`apps-script/Code.gs`](apps-script/Code.gs) from
   this repo, copy **all** of it, and paste it in.

4. Edit the **CONFIG** block at the top:
   - `ROOT_FOLDER_ID` → paste the folder ID from step 1
   - `ADMIN_PASSCODE` → choose a strong passcode (this gates the dashboard)
   - `UPLOAD_KEY` → leave `''` for fully open uploads, **or** set a shared staff
     word (recommended — a public upload URL otherwise invites spam)
   - `PROPERTIES` → your real property names
   - `DOC_TYPES` → your document types and how often each renews (months)

5. Click **Save**. In the function dropdown choose **`setupCheck`** and click
   **Run**. Approve the Google permission prompt (it needs Drive access — this is
   your own script accessing your own Drive). The log should say
   `✅ Root folder found`.

6. **Deploy** → **New deployment** → gear icon → **Web app**:
   - **Execute as:** *Me*
   - **Who has access:** *Anyone*  ← required so staff can upload without a login
   - Click **Deploy**, approve again, and **copy the Web app URL** (ends in `/exec`).

> Re-deploying after code changes: **Deploy → Manage deployments → edit (pencil)
> → Version: New version → Deploy.** The `/exec` URL stays the same.

### B. The website (GitHub Pages)

1. Open [`docs/config.js`](docs/config.js) and paste your `/exec` URL into
   `API_URL`. Set `ORG_NAME` to your company name.

2. Create a GitHub repo and upload this project (or push it — see below).

3. In the repo: **Settings → Pages** → **Source: Deploy from a branch** →
   Branch **main**, folder **`/docs`** → **Save**.

4. Wait ~1 minute. Your portal is live at
   `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

```bash
# pushing from this folder, if you prefer the command line:
cd property-docs-portal
git init && git add . && git commit -m "Property documents portal"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

### C. Who can see the files

The dashboard's passcode controls who can see the **list** of documents. The
**actual files** are protected by Google Drive itself. So, for the "select few":

1. Keep the master Drive folder **private** (don't share with "Anyone with link").
2. **Share** it (Viewer is enough) with the Google accounts of the people allowed
   to read everything.
3. Give those same people the `ADMIN_PASSCODE`.

Now: staff upload freely; only people who (a) know the passcode **and** (b) have
Drive access can both see the grid and open the documents.

---

## Daily use

- **Staff:** open the site → **Upload** tab → pick property + type → (optionally a
  document date + their name) → choose file(s) → **Upload**. Done.
- **Managers:** **Dashboard** tab → enter passcode → see the grid.
  - 🟩 Current 🟨 Due soon 🟥 Overdue ⬜ Missing
  - Click any cell to see the files and open them in Drive.
  - Filter by property/type, search, tick **Only needs attention**, or **Export CSV**.

Already have old reports? Just drop them into the matching
`Document Type / Property` folders in Drive — they'll show up on the dashboard
(using the file's date if you didn't upload them through the form).

### Sharing it with the team

Open **`share.html`** on your live site (or click **🔗 Share links** on the
dashboard). It generates, for every property:

- a **pre-locked upload link** — e.g. `…/?property=Hampton%20Inn%20Sturgis&lock=1`
  — the property is pre-selected and can't be changed, so staff can't file
  documents under the wrong hotel, and
- a **printable QR card** for the front desk / back office — staff point their
  phone camera at it and they're on the upload form.

Other handy URL patterns (the site understands these anywhere):

| Link | What it does |
|---|---|
| `…/#dashboard` | Opens straight to the manager dashboard (passcode still required) |
| `…/?property=X&lock=1` | Upload form locked to property X |
| `…/?property=X&lock=1&type=Fire%20Inspection` | …and with a document type pre-selected |

---

## Customizing

- **Add a property or document type:** edit `PROPERTIES` / `DOC_TYPES` in
  `Code.gs`, then re-deploy a new version (B's note above). The website updates
  automatically — you don't touch the website for this.
- **Subcategories:** a document type can hold subcategories — the upload form
  then shows a second dropdown, Drive nests folders one level deeper
  (`Inspection / Fire / <property>`), and the dashboard groups the columns:

  ```javascript
  { name: 'Inspection', subs: [
      { name: 'Fire', renewalMonths: 12 },
      { name: 'QA',   renewalMonths: 12 },
  ]},
  { name: 'Utilities', renewalMonths: 1 },   // simple types still work
  ```

  On the dashboard and in share links these appear as `Inspection — Fire`.
- **Change renewal periods:** edit `renewalMonths` (`0` = never expires).
- **Per-type warning windows:** add `dueSoonDays` to any type (or to a category,
  covering all its subs) to control how many days before the due date its cells
  turn amber — e.g. `{ name: 'Inspection', dueSoonDays: 45, subs: […] }` warns
  45 days out for inspections you must book, while monthlies keep the site-wide
  default (`DUE_SOON_DAYS` in `config.js`).
- **Change "due soon" window:** `DUE_SOON_DAYS` in `config.js`.

---

## Automatic email reminders

The backend can email people before things lapse — no extra services, it sends
from your Gmail via Apps Script:

- **Per-property emails** (to each GM / front desk) listing only their overdue,
  due-soon, and missing documents, with their locked upload link as a button.
- **A weekly digest** to the owners with everything across all properties and a
  dashboard link.

Setup, in the Apps Script editor:

1. Fill in the `REMINDERS` block in the CONFIG (at minimum `SUMMARY_EMAILS`;
   add `PROPERTY_EMAILS` as you collect GMs' addresses).
2. Function dropdown → **setupReminders** → Run (installs the Monday ~8am
   schedule; approve the permission prompt).
3. Function dropdown → **sendReminders** → Run (sends real emails right now, so
   you can see what everyone will get).

Notes: properties with nothing to fix get no email. `NOT_APPLICABLE` silences
combos that don't exist (no pool → no Pool/Spa nagging). `INCLUDE_MISSING:
false` switches to renewal-chasing only. For daily instead of weekly, change
`onWeekDay(...)` to `.everyDays(1)` in `setupReminders`. Free Gmail allows ~100
recipients/day — far more than this needs.

---

## Performance

The portal is built to feel instant:

- The website remembers your property/type lists and the dashboard's last data
  on-device, paints immediately, and refreshes silently in the background.
- Uploads run three at a time, and the backend caches folder locations.
- The dashboard listing is served from a 10-minute server cache (portal uploads
  clear it automatically; the **↻ Refresh** button always reads Drive live).
- **Recommended:** in the Apps Script editor, click **Services (+) → Drive API
  → Add**. The backend then reads whole folder levels in a handful of batched
  calls (fresh loads in ~2-4s no matter how many files you accumulate). Without
  it, a slower folder-by-folder fallback is used automatically.

---

## Security notes (worth understanding)

- Uploads are open by design (you wanted "anyone can upload"). Setting
  `UPLOAD_KEY` is the simple defense against random internet spam — strongly
  recommended for a public URL.
- The passcode is checked **on the backend**, never stored in the website, so it
  isn't exposed in the page source. A leaked passcode would expose the document
  *list* (names/dates/notes) but **not** the file contents — those still require
  Google Drive access.
- Want per-person identity + an audit trail instead of one shared passcode? See
  **"Upgrade: Google Sign-In"** below.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Banner: "isn't connected yet" | `API_URL` in `config.js` is still the placeholder. |
| "Could not reach the server" | Re-deploy with **Who has access: Anyone**. Confirm the URL ends in `/exec` (not `/dev`). |
| Dropdowns stuck on "Loading…" | Same as above — the `config` call failed. Open the `/exec` URL directly; it should say "API is running". |
| "Wrong passcode" | Must match `ADMIN_PASSCODE` exactly. Re-deploy a new version after changing it. |
| File link won't open for a manager | Share the Drive folder with that person's Google account (step C). |
| "File too large" | Limit is `MAX_FILE_MB` (default 40). Raise it in `Code.gs`, or have staff compress/split. |
| Changed `Code.gs` but nothing changed | You must **Deploy → Manage deployments → New version**. |

---

## Upgrade: Google Sign-In (optional, stronger)

To replace the shared passcode with real per-person Google login + an email
allowlist (better security and you can see *who* viewed):

1. In Google Cloud Console create an **OAuth 2.0 Client ID (Web)** and add your
   GitHub Pages URL to authorized origins.
2. Add Google Identity Services to `index.html`, sign the user in, and send the
   returned **ID token** to the backend instead of a passcode.
3. In `handleList`, verify the token and check the email against an allowlist:

   ```javascript
   function emailFromToken(idToken) {
     var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
     var info = JSON.parse(UrlFetchApp.fetch(url).getContentText());
     return (info.aud === 'YOUR_OAUTH_CLIENT_ID' && info.email_verified === 'true') ? info.email : null;
   }
   var ALLOWED_VIEWERS = ['you@example.com', 'gm@example.com'];
   // in handleList: var email = emailFromToken(b.idToken);
   //                if (ALLOWED_VIEWERS.indexOf(email) === -1) return {ok:false, error:'Not authorized'};
   ```

This is intentionally left as an opt-in so the base version works with zero Google
Cloud setup.

---

## Files

```
property-docs-portal/
├── README.md                 ← you are here
├── docs/                     ← the website (GitHub Pages serves this folder)
│   ├── index.html
│   ├── share.html            ← per-property share links + printable QR cards
│   ├── config.js             ← the ONLY website file you edit (API_URL)
│   ├── app.js
│   └── styles.css
└── apps-script/              ← the backend (paste into script.google.com)
    ├── Code.gs               ← edit the CONFIG block, then deploy
    └── appsscript.json
```
