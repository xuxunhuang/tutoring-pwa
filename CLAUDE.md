# Tutoring Management PWA

## Facts (real schema, confirmed from the live Google Sheet "ติดตามเรียนพิเศษ_v3")
- Data lives in that Sheet, read/written via `Code.gs` (GAS Web App).
- Rate is per-GROUP, not per-student: กลุ่ม 1=คณิตศาสตร์ 200บ./ชม., กลุ่ม 2=ฟิสิกส์ 250, กลุ่ม 3=เคมี 300.
  Each student belongs to exactly one group. There is no per-student rate override.
- Rent per session: Genius K.Joy 500 | บ้านครูมด 700 | Starbuck 1000 THB.
- Room rent splits three ways: total rent → minus teacher's fixed portion (per group:
  กลุ่ม1=100, กลุ่ม2=150, กลุ่ม3=0) → remainder divided per head across actual attendees.
- A session row has a Plan (list of planned students) and เข้าเรียน/attended (list of who
  actually came) as SEPARATE fields — they can differ. Revenue is computed from attendance,
  not from the plan.
- There is a separate payment ledger (รายละเอียดรายนักเรียน) per student/session with a
  paid flag, amount received, and an auto-generated Thai payment-request message (bank
  info + itemized unpaid sessions) — this ships in v1, copy-to-clipboard only, no
  auto-send anywhere.
- Monthly summary breaks down by GROUP, not by location.
- Runtime is LLM-free: the command parser (`Parser` in index.html) is deterministic JS.
  Never propose an AI-call runtime feature — that was explicitly rejected for cost reasons.
- Free-tier only: GitHub Pages + Google Apps Script. No paid services, no DB, no build
  tools, no npm.
- The names/rates in the Sheet right now (Heng, Pim, Kee...) are placeholder/demo data,
  not real students — don't treat them as real when reasoning about the business.

## Command grammar (both modes are required, per explicit user decision)
- Mode 1 — new ad-hoc session: `[group] [location] [hours] [date] [students]`, e.g.
  "กลุ่ม1 มด 2ชม Heng,Pim,Kee". Missing group or location is never guessed — always ask.
  Missing students shows a roster picker (not an auto-select-all). Future date → status
  defaults to 📅 แผน; today/past → ✅ สอนแล้ว. See `Parser.parseCommand` in index.html.
- Mode 2 — check-in against an existing planned row: trigger words "มา"/"เช็ค"/"เช็คอิน",
  resolves to the nearest pending 📅 แผน row for that group+location if no date given.
- "ยกเลิก" cancels an existing matching row (never creates one).
- Full grammar + alias maps + ≥15 required test cases: see `runParserTests()` at the
  bottom of index.html (`?test=1` query param runs it on load).

## Architecture
- `index.html`: single-file PWA (Dispatch / History / Summary / Payments tabs)
- `Code.gs`: doGet(config|students|sessions|summary|payments), doPost(addSession|
  checkIn|cancelSession|updateSession|deleteSession|recordPayment). Shared-secret
  token (`TUTOR_APP_TOKEN` script property) required on every request.
- Idempotency: every write payload carries a client-generated `clientKey`; GAS checks
  a hidden `ClientKey` column before inserting to make retries/double-submits safe.
- Dates: ISO internally, Asia/Bangkok timezone throughout; display in Thai พ.ศ. where
  shown to the user; input accepts both ค.ศ. and พ.ศ. (year > 2400 → พ.ศ.).

## Style
- Design tokens: dark, `--bg:#000000 --primary:#34D399 --accent:#2563EB`, fonts
  Caveat (display) / Inter (body) / JetBrains Mono (numbers/labels), radius
  card 16px / control 8px / pill 9999px, spacing base 8px, card padding 24px.
- Output discipline: no greetings, no restating requirements, diffs over full files.

## Known gotcha
- Group canonical names in the Sheet include a space: "กลุ่ม 1" not "กลุ่ม1". The parser's
  `normAlias()` strips spaces for matching input, but the `name` field used for exact
  string comparisons against the Sheet (and sent to the backend) MUST keep the space, or
  `lookupGroup_` in Code.gs throws "Unknown group". Already fixed once — don't reintroduce
  a no-space default.

## Commands
- Test parser: open `index.html?test=1` locally (or via a static server — `file://` won't
  work for fetch calls) and read the console for `PASS`/`FAIL` lines.
