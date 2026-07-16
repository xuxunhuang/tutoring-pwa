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

## Status — what's already done for you

- **The Sheet exists and is wired in.** `ติดตามเรียนพิเศษ` in `Folder_PWD_ERP`
  on Drive — https://docs.google.com/spreadsheets/d/1mowV5UwjXCQBBNWTYVLXZ4vVf_jxaKAO-RAczQmHuDM/edit
  — created from scratch (no demo data), with the 5 tabs and exact headers
  `Code.gs` expects: `ตั้งค่า`, `นักเรียน`, `บันทึกการสอน`, `รายละเอียดรายนักเรียน`,
  `สรุปรายเดือน`. `SHEET_ID` in `Code.gs` already points at it.
- **You still need to generate the shared-secret token** (step 2 below) —
  deliberately left as a placeholder in both `Code.gs` and `index.html`
  rather than committed for you, since this repo is **public**: any value
  committed here is visible in git history forever, and index.html being a
  public static page means the token is visible in view-source once deployed
  regardless. Treat it as a deterrent against casual/automated hits on the
  URL, not a real access-control boundary — don't reuse a secret you care
  about elsewhere.
- **The repo is live**: https://github.com/xuxunhuang/tutoring-pwa , and
  GitHub Pages is already enabled, serving at
  https://xuxunhuang.github.io/tutoring-pwa/ .
- **You still need to fill in your real locations/groups/rates** in the
  `ตั้งค่า` tab and your real students in `นักเรียน` — the Sheet is
  intentionally blank, it was never seeded with the earlier example workbook's
  placeholder data.

## 1. Fill in your real data

Open the Sheet (link above) and fill in:
- `ตั้งค่า` tab: your real locations (name, rent/session, and the room fee
  you cover by default at that venue) in columns A-E starting row 3, and
  your real groups (name, subject, rate/hr) in columns G-K starting row 3
  (column F is intentionally left blank as a gap between the two tables).
  The teacher's room-fee-covered amount lives on the *location* now, not
  the group — it's just a default, editable per session when you actually
  book one.
- `นักเรียน` tab: your real students (name, group, contact info).

## 2. Deploy the Apps Script backend

This part can't be automated — it requires you to authorize the script's
access to your own Sheet in your own browser session.

1. In the Sheet, go to **Extensions → Apps Script**.
2. Delete the boilerplate `Code.gs` content and paste in this repo's `Code.gs`
   (SHEET_ID is already set correctly — don't need to touch it).
3. Go to **Project Settings** (gear icon) → **Script Properties** → **Add script property**.
   Key: `TUTOR_APP_TOKEN`. Value: a long random string you generate yourself
   (e.g. `openssl rand -base64 32`, or any password generator) — this must
   match `CONFIG.TOKEN` in `index.html` (step 3 below), but pick your own
   value rather than reusing one from a chat log or example.
4. Click **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**.
   Who has access: **Anyone with the link**. Click **Deploy**, authorize the
   script when prompted.
5. Copy the **Web app URL** — paste it into `CONFIG.GAS_URL` in `index.html`,
   and paste the same token from step 3 into `CONFIG.TOKEN` (both are
   placeholders right now). Commit and push — GitHub Pages picks it up
   automatically. This is the one point where your real token becomes part
   of the public repo/page — that's expected and fine, just don't reuse that
   value anywhere sensitive.
6. Whenever you edit `Code.gs` again, you must **Deploy → Manage deployments
   → Edit → New version** for the changes to go live on the same URL.

## 3. The frontend `CONFIG` block

`index.html`'s `CONFIG` object near the top of the `<script>` — everything
except `GAS_URL` (step 2.5 above) is already filled in:

```js
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/.../exec', // ← fill in from step 2.5
  TOKEN: '...',                    // ← same value as Script Property TUTOR_APP_TOKEN
  TEACHER_NAME: '[ชื่อครู]',      // edit to your real name
  BANK_NAME: '[ชื่อธนาคาร]',      // edit to your real bank
  ACCOUNT_NUMBER: '[เลขบัญชี]',   // edit to your real account number
  locations: [],  // intentionally empty — populated live from the Sheet on load
  groups: [],
  students: []
};
```

`locations`/`groups`/`students` start empty on purpose (this is a from-scratch
deployment, not seeded with demo data) — on every load, the app fetches live
data from `action=config`/`action=students`, including each location's/group's
`aliases`, and caches it to localStorage for offline use. See "Adding /
changing data" below for how to add your real ones.

## 4. Hosting — already done

The app is already pushed to GitHub and served via GitHub Pages at
https://xuxunhuang.github.io/tutoring-pwa/ — no hosting setup needed. After
editing `CONFIG.GAS_URL` (step 2.5), just commit and push; Pages redeploys
automatically within a minute or two.

For "Add to Home Screen" (PWA install) on your phone, just open that URL —
GitHub Pages serves over HTTPS already, which is required for install +
offline support to work.

## Adding / changing data

Everything below — locations, groups, students — can be added, edited, and
deleted from the app's **Settings** tab (⚙️) directly, including each
location's/group's shorthand `aliases` (a comma-separated field right in the
Sheet now, not something hand-maintained in `index.html`). No code change is
ever required to add a new one.

Editing the Sheet directly still works too, if you'd rather do it there —
`Code.gs` reads it live either way, and the app re-fetches on every load.
Both paths are always in sync; there's no separate "source of truth" to keep
manually aligned.

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
