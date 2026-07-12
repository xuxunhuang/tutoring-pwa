# ติดตามเรียนพิเศษ — Tutor Dispatch PWA

A mobile-first PWA for logging private tutoring sessions with one-line shorthand
commands (e.g. `กลุ่ม1 จอย 2ชม Heng,Pim`), backed by your existing Google Sheet
via a Google Apps Script Web App. Vanilla HTML/CSS/JS, no build step, no
frameworks, zero LLM/AI calls at runtime.

## Files

- `Code.gs` — Google Apps Script Web App (backend)
- `index.html` — single-file frontend (PWA shell, dispatch parser, all 4 screens)
- `manifest.webmanifest` — PWA install manifest
- `sw.js` — service worker (offline app shell + API cache)

## 1. Set up the Google Sheet

1. If your data is currently an `.xlsx` file, upload it to Google Drive, then
   right-click it → **Open with → Google Sheets** (this converts it in place;
   or use File → Save as Google Sheets from within Sheets).
2. Confirm the 5 tabs are named exactly: `ตั้งค่า`, `นักเรียน`, `บันทึกการสอน`,
   `รายละเอียดรายนักเรียน`, `สรุปรายเดือน` — the backend looks them up by
   these exact names.
3. Copy the Sheet's ID from its URL: `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.

## 2. Deploy the Apps Script backend

1. In the Sheet, go to **Extensions → Apps Script**.
2. Delete the boilerplate `Code.gs` content and paste in this repo's `Code.gs`.
3. At the top of the file, set `SHEET_ID` to the ID you copied above.
4. Go to **Project Settings** (gear icon) → **Script Properties** → **Add script property**.
   Key: `TUTOR_APP_TOKEN`. Value: a long random secret you generate yourself
   (this is the shared secret the app sends with every request — treat it
   like a password).
5. Click **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**.
   Who has access: **Anyone with the link**. Click **Deploy**, authorize the
   script when prompted.
6. Copy the **Web app URL** — you'll need it in step 3 below.
7. Whenever you edit `Code.gs` again, you must **Deploy → Manage deployments
   → Edit → New version** for the changes to go live on the same URL.

## 3. Configure the frontend

Open `index.html` and edit the `CONFIG` object near the top of the `<script>`:

```js
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/.../exec', // from step 2.6
  TOKEN: '...',            // same value as TUTOR_APP_TOKEN from step 2.4
  TEACHER_NAME: '...',
  BANK_NAME: '...',
  ACCOUNT_NUMBER: '...',
  locations: [ ... ],       // seed data — gets refreshed from the Sheet on load
  groups: [ ... ],
  students: [ ... ]
};
```

The `locations`/`groups`/`students` arrays are just an offline-friendly seed —
on every load, the app fetches live data from `action=config`/`action=students`
and merges it in (and caches the result to localStorage for offline use). The
one thing that does **not** come from the Sheet automatically is each
location's/group's `aliases: []` array (see below).

## 4. Host `index.html`

**Option A — GitHub Pages:**

1. Create a new GitHub repo, push this folder's contents (`index.html`,
   `manifest.webmanifest`, `sw.js` — `Code.gs` doesn't need to be hosted).
2. Repo **Settings → Pages** → Source: deploy from branch → pick `main` /
   root. Save.
3. Your app will be live at `https://<username>.github.io/<repo>/`.

**Option B — any static host** (Netlify, Vercel, Firebase Hosting, a plain
web server, etc.) — just serve the 3 static files from the same folder.

**Option C — local file** — you can open `index.html` directly in a mobile
browser for testing, though the service worker (offline support) only
activates when served over `http(s)://`, not `file://`.

For "Add to Home Screen" (PWA install) to work, the site must be served over
HTTPS (GitHub Pages, Netlify, etc. all do this for free).

## Adding / changing data

- **New student**: edit the `นักเรียน` tab directly — no code change needed.
  The app re-fetches the student list on every load.
- **New location or group/rate**: edit the `ตั้งค่า` tab, **and** add a
  matching entry (with an `aliases: []` list of the shorthand words you want
  to type, e.g. `"จอย"`) to `CONFIG.locations` / `CONFIG.groups` inside
  `index.html`. The rent/rate/teacher-room-fee numbers themselves sync
  automatically from the Sheet — only the alias words are hand-maintained,
  since they're a frontend-only shorthand convenience.

## Command grammar quick reference

```
[group] [location] [hours] [date] [students] [modifiers]
```

- **group**: `กลุ่ม1` / `กลุ่ม 1` / `g1`, or subject alias `คณิต` / `ฟิสิกส์` / `เคมี`
- **location**: alias, e.g. `จอย`, `มด`, `สตบ`
- **hours**: `2ชม`, `1.5ชม`, `ครึ่งชม` (=0.5)
- **date**: `วันนี้` (default), `เมื่อวาน`, `วันก่อน`, `พรุ่งนี้`, `จ ที่แล้ว` (last Monday,
  etc.), `26/5/2569` (พ.ศ. or ค.ศ. numeric DD/MM/YYYY)
- **students**: names (comma/space separated, partial match ok), `ทุกคน`/`all`,
  or leave blank to get a tap-to-pick checklist
- **check-in**: `มา` / `เช็ค` / `เช็คอิน` + student list + group + location
  (marks an existing planned row as attended)
- **cancel**: `ยกเลิก` + group + location + date (marks an existing row cancelled)

Nothing ever writes to the Sheet before you tap **✓ ยืนยันบันทึก** on the
confirm-preview card. Run the built-in parser test suite by opening the app
with `?test=1` in the URL and checking the browser console.

## Zero ongoing cost, zero AI

The command parser is 100% deterministic hand-written JavaScript (tokenize →
classify → resolve) — there are no LLM/AI API calls anywhere in this app, at
runtime or otherwise. Hosting on GitHub Pages + Google Apps Script + Google
Sheets is free on the standard free tiers.
