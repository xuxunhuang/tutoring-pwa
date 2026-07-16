/**
 * ============================================================================
 * ติดตามเรียนพิเศษ - Tutoring Session Tracker - Google Apps Script Web App
 * ============================================================================
 * Backend for the tutoring-pwa frontend (index.html). Reads/writes the
 * Google Sheet "ติดตามเรียนพิเศษ_v3" (5 tabs: ตั้งค่า, นักเรียน, บันทึกการสอน,
 * รายละเอียดรายนักเรียน, สรุปรายเดือน).
 *
 * DEPLOY INSTRUCTIONS ARE AT THE BOTTOM OF THIS FILE.
 * ============================================================================
 */

// ▼▼▼ EDIT THIS ONE LINE — paste your Google Sheet ID (the long string in its URL) ▼▼▼
const SHEET_ID = '1mowV5UwjXCQBBNWTYVLXZ4vVf_jxaKAO-RAczQmHuDM'; // "ติดตามเรียนพิเศษ" in Folder_PWD_ERP
// ▲▲▲ EDIT THIS ONE LINE ▲▲▲

const TZ = 'Asia/Bangkok';

const SHEET_NAMES = {
  SETTINGS: 'ตั้งค่า',
  STUDENTS: 'นักเรียน',
  SESSIONS: 'บันทึกการสอน',
  PAYMENTS: 'รายละเอียดรายนักเรียน',
  SUMMARY: 'สรุปรายเดือน'
};

// Row layout differs per tab (title row, and for some tabs a section-label
// row, before the actual column-header row). *_HEADER_ROW is where the
// column header text lives; *_DATA_ROW is the first row of real data.
const ROWS = {
  SETTINGS_HEADER_ROW: 2, SETTINGS_DATA_ROW: 3,   // title(1), headers(2), data(3+)
  STUDENTS_HEADER_ROW: 2, STUDENTS_DATA_ROW: 3,    // title(1), headers(2), data(3+)
  SESSIONS_HEADER_ROW: 3, SESSIONS_DATA_ROW: 4,    // title(1), section labels(2), headers(3), data(4+)
  PAYMENTS_HEADER_ROW: 2, PAYMENTS_DATA_ROW: 3,    // title(1), headers(2), data(3+)
  SUMMARY_HEADER_ROW: 2, SUMMARY_DATA_ROW: 3       // title(1), headers(2), data(3+)
};

// ตั้งค่า holds two independent tables side by side on the same rows.
// Room fee the teacher covers by default lives on the LOCATION now (it's a
// venue cost, not a subject cost) — editable per-session as an override when
// a session is actually booked. Groups no longer carry a room-fee field.
const LOC_COL = { NAME: 1, RENT: 2, TEACHER_FEE: 3, NOTE: 4, ALIASES: 5 };       // A-E
const GRP_COL = { NAME: 7, SUBJECT: 8, RATE: 9, NOTE: 10, ALIASES: 11 };        // G-K (F is a gap column)

// บันทึกการสอน column indices (1-based, matches spec A-V)
const SES_COL = {
  DATE_ENTERED: 1,        // A วันที่บันทึกข้อมูล
  GROUP: 2,               // B กลุ่ม
  LOCATION: 3,            // C สถานที่
  STATUS: 4,              // D สถานะ
  RENT_TOTAL: 5,          // E ค่าเช่าห้อง (บาท)
  RENT_TEACHER: 6,        // F ค่าเช่าห้อง ครูออก (บาท)
  RENT_PER_STUDENT: 7,    // G ค่าเช่าห้องเด็กออก (บาท) ต่อคน
  RATE_PER_HOUR: 8,       // H ค่าสอน/คน/ชม.
  PLAN: 9,                // I Plan
  ATTENDED: 10,           // J เข้าเรียน
  DATE_ATTENDED: 11,      // K วันที่เข้าเรียน
  TIME_START: 12,         // L เวลาเริ่ม
  TIME_END: 13,           // M เวลาสิ้นสุด
  HOURS: 14,              // N จำนวนชม.
  PLAN_COUNT: 15,         // O จำนวนแผน
  ATTEND_COUNT: 16,       // P จำนวนที่มา
  PLAN_REVENUE: 17,       // Q แผนรายได้ (บาท)
  REVENUE: 18,            // R รายได้รวม (บาท)
  REVENUE_AFTER_ROOM: 19, // S รายได้รวม (บาท) หลังหักค่าเช่าห้องครูออก
  SETTLED: 20,            // T ✅ ถ่ายโอนแล้ว
  MESSAGE: 21,            // U Message ตามเด็กเรียน
  CLIENT_KEY: 22          // V ClientKey (appended by this script if missing)
};

const STATUS = {
  PLAN: '📅 แผน',
  TAUGHT: '✅ สอนแล้ว',
  CANCELLED: '❌ ยกเลิก'
};

// รายละเอียดรายนักเรียน columns (1-based)
const PAY_COL = {
  STUDENT: 1,       // ชื่อนักเรียน
  GROUP: 2,         // กลุ่ม
  DATE_ATTENDED: 3, // วันที่เข้าเรียน
  LOCATION: 4,      // สถานที่
  STATUS: 5,        // สถานะคลาส
  ATTENDED: 6,      // เข้าเรียน
  HOURS: 7,         // จำนวนชม.
  AMOUNT_TEACH: 8,  // ยอด/ครั้ง (บาท)
  AMOUNT_ROOM: 9,   // ค่าเช่าห้อง/ครั้ง (บาท)
  AMOUNT_TOTAL: 10, // รวมยอด (บาท)
  PAID: 11,         // จ่ายแล้ว?
  RECEIVED: 12,     // รับเงินไป (บาท)
  OUTSTANDING: 13,  // ยอดค้าง (บาท)
  NOTE: 14,         // หมายเหตุ
  FOLLOWUP_MSG: 15, // ข้อความติดตามเงิน
  SESSION_REF: 16   // SessionRef (appended by this script if missing) - "<sessionClientKey>:<studentName>", idempotency key
};

// ============================================================================
// Entry points
// ============================================================================

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (!checkToken(params.token)) return jsonOutput({ ok: false, error: 'forbidden' });

    const action = params.action;
    let data;
    switch (action) {
      case 'config':
        data = getConfig();
        break;
      case 'students':
        data = getStudents();
        break;
      case 'sessions':
        data = getSessions(params.month || null);
        break;
      case 'summary':
        data = getSummary(params.month || null);
        break;
      case 'payments':
        data = getPayments(params.student || null);
        break;
      default:
        return jsonOutput({ ok: false, error: 'unknown action' });
    }
    return jsonOutput({ ok: true, data: data });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  // Every write (add/update/delete across sessions, payments, and the roster)
  // reads current state (e.g. "first empty row", "does this name already
  // exist") before writing. Apps Script Web Apps can run concurrent requests
  // for the same script without serializing them automatically, so two
  // overlapping writes can race on that read — confirmed empirically: two
  // concurrent deleteLocation calls left one deletion silently lost. A
  // single script-wide lock for the whole handler serializes all writes,
  // which is the standard fix and is free at this app's volume (one tutor,
  // occasional taps — never truly concurrent in practice, just not
  // guaranteed serial by the platform itself).
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    return jsonOutput({ ok: false, error: 'ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง' });
  }
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (!checkToken(body.token)) return jsonOutput({ ok: false, error: 'forbidden' });

    const action = body.action;
    const payload = body.payload || {};
    let result;
    switch (action) {
      case 'addSession':
        result = addSession(payload);
        break;
      case 'checkIn':
        result = checkIn(payload);
        break;
      case 'cancelSession':
        result = cancelSession(payload);
        break;
      case 'updateSession':
        result = updateSession(payload);
        break;
      case 'deleteSession':
        result = deleteSession(payload);
        break;
      case 'recordPayment':
        result = recordPayment(payload);
        break;
      case 'addLocation':
        result = addLocation(payload);
        break;
      case 'updateLocation':
        result = updateLocation(payload);
        break;
      case 'addGroup':
        result = addGroup(payload);
        break;
      case 'updateGroup':
        result = updateGroup(payload);
        break;
      case 'addStudent':
        result = addStudent(payload);
        break;
      case 'updateStudent':
        result = updateStudent(payload);
        break;
      case 'deleteLocation':
        result = deleteLocation(payload);
        break;
      case 'deleteGroup':
        result = deleteGroup(payload);
        break;
      case 'deleteStudent':
        result = deleteStudent(payload);
        break;
      default:
        return jsonOutput({ ok: false, error: 'unknown action' });
    }
    return jsonOutput({ ok: true, data: result });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function checkToken(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('TUTOR_APP_TOKEN');
  return expected && token && token === expected;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// Sheet helpers
// ============================================================================

function ss_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet tab not found: ' + name);
  return sh;
}

function getAllRows_(sheetName, headerRow, dataRow) {
  const sh = sheet_(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < dataRow) return { header: [], rows: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  return { header: values[headerRow - 1], rows: values.slice(dataRow - 1) };
}

function fmtDate_(d) {
  if (!d) return '';
  if (typeof d === 'string') return d; // already ISO
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function fmtTime_(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  return Utilities.formatDate(t, TZ, 'HH:mm');
}

function parseNames_(str) {
  if (!str) return [];
  return String(str).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// ============================================================================
// GET actions
// ============================================================================

function getConfig() {
  const sh = sheet_(SHEET_NAMES.SETTINGS);
  const lastRow = sh.getLastRow();
  if (lastRow < ROWS.SETTINGS_DATA_ROW) return { locations: [], groups: [], bank: {} };
  const numRows = lastRow - ROWS.SETTINGS_DATA_ROW + 1;

  // Locations: columns A-E (1-5). Room fee the teacher covers by default now
  // lives here (per-venue), not per-group — see LOC_COL comment below.
  const locVals = sh.getRange(ROWS.SETTINGS_DATA_ROW, LOC_COL.NAME, numRows, 5).getValues();
  const locations = locVals
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return {
        name: String(r[0]), rent: Number(r[1]) || 0, teacherRoomFee: Number(r[2]) || 0,
        note: String(r[3] || ''), aliases: parseNames_(r[4])
      };
    });

  // Groups: columns G-K (7-11), one gap column (F) after locations.
  const grpVals = sh.getRange(ROWS.SETTINGS_DATA_ROW, GRP_COL.NAME, numRows, 5).getValues();
  const groups = grpVals
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return {
        name: String(r[0]),
        subject: String(r[1]),
        rate: Number(r[2]) || 0,
        note: String(r[3] || ''),
        aliases: parseNames_(r[4])
      };
    });

  return { locations: locations, groups: groups };
}

function getStudents() {
  const data = getAllRows_(SHEET_NAMES.STUDENTS, ROWS.STUDENTS_HEADER_ROW, ROWS.STUDENTS_DATA_ROW);
  return data.rows.filter(function (r) { return r[0]; }).map(function (r) {
    return {
      code: String(r[0]),
      name: String(r[1] || ''),
      group: String(r[2] || ''),
      studentPhone: String(r[3] || ''),
      parentName: String(r[4] || ''),
      parentPhone: String(r[5] || ''),
      note: String(r[6] || '')
    };
  });
}

function getSessions(month) {
  const sh = sheet_(SHEET_NAMES.SESSIONS);
  const lastRow = sh.getLastRow();
  if (lastRow < ROWS.SESSIONS_DATA_ROW) return [];
  const lastCol = Math.max(sh.getLastColumn(), SES_COL.CLIENT_KEY);
  const values = sh.getRange(ROWS.SESSIONS_DATA_ROW, 1, lastRow - ROWS.SESSIONS_DATA_ROW + 1, lastCol).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    if (!r[SES_COL.GROUP - 1]) continue;
    const dateEntered = fmtDate_(r[SES_COL.DATE_ENTERED - 1]);
    const dateAttended = fmtDate_(r[SES_COL.DATE_ATTENDED - 1]);
    if (month) {
      const refDate = dateAttended || dateEntered;
      if (refDate.slice(0, 7) !== month) continue;
    }
    out.push({
      rowIndex: i + ROWS.SESSIONS_DATA_ROW,
      dateEntered: dateEntered,
      group: r[SES_COL.GROUP - 1],
      location: r[SES_COL.LOCATION - 1],
      status: r[SES_COL.STATUS - 1],
      rentTotal: Number(r[SES_COL.RENT_TOTAL - 1]) || 0,
      rentTeacher: Number(r[SES_COL.RENT_TEACHER - 1]) || 0,
      rentPerStudent: Number(r[SES_COL.RENT_PER_STUDENT - 1]) || 0,
      ratePerHour: Number(r[SES_COL.RATE_PER_HOUR - 1]) || 0,
      plan: r[SES_COL.PLAN - 1],
      attended: r[SES_COL.ATTENDED - 1],
      dateAttended: dateAttended,
      timeStart: fmtTime_(r[SES_COL.TIME_START - 1]),
      timeEnd: fmtTime_(r[SES_COL.TIME_END - 1]),
      hours: Number(r[SES_COL.HOURS - 1]) || 0,
      planCount: Number(r[SES_COL.PLAN_COUNT - 1]) || 0,
      attendCount: Number(r[SES_COL.ATTEND_COUNT - 1]) || 0,
      planRevenue: Number(r[SES_COL.PLAN_REVENUE - 1]) || 0,
      revenue: Number(r[SES_COL.REVENUE - 1]) || 0,
      revenueAfterRoom: Number(r[SES_COL.REVENUE_AFTER_ROOM - 1]) || 0,
      settled: !!r[SES_COL.SETTLED - 1],
      message: r[SES_COL.MESSAGE - 1],
      clientKey: r[SES_COL.CLIENT_KEY - 1] || ''
    });
  }
  return out;
}

function getSummary(month) {
  const data = getAllRows_(SHEET_NAMES.SUMMARY, ROWS.SUMMARY_HEADER_ROW, ROWS.SUMMARY_DATA_ROW);
  return data.rows.filter(function (r) {
    if (!r[0]) return false;
    if (month && String(r[0]).indexOf(month) === -1 && r[0] !== month) {
      // summary month is stored as Thai label; caller can filter client-side too
    }
    return true;
  }).map(function (r) {
    return {
      month: r[0],
      group: r[1],
      planned: Number(r[2]) || 0,
      taught: Number(r[3]) || 0,
      cancelled: Number(r[4]) || 0,
      studentsTotal: Number(r[5]) || 0,
      revenue: Number(r[6]) || 0,
      teacherRoomCost: Number(r[7]) || 0
    };
  });
}

function getPayments(studentFilter) {
  const data = getAllRows_(SHEET_NAMES.PAYMENTS, ROWS.PAYMENTS_HEADER_ROW, ROWS.PAYMENTS_DATA_ROW);
  return data.rows
    .map(function (r, idx) { return { r: r, rowIndex: idx + ROWS.PAYMENTS_DATA_ROW }; })
    .filter(function (x) { return x.r[0]; })
    .filter(function (x) { return !studentFilter || String(x.r[0]) === studentFilter; })
    .map(function (x) {
      const r = x.r;
      return {
        rowIndex: x.rowIndex,
        student: r[PAY_COL.STUDENT - 1],
        group: r[PAY_COL.GROUP - 1],
        dateAttended: fmtDate_(r[PAY_COL.DATE_ATTENDED - 1]),
        location: r[PAY_COL.LOCATION - 1],
        status: r[PAY_COL.STATUS - 1],
        attended: r[PAY_COL.ATTENDED - 1],
        hours: Number(r[PAY_COL.HOURS - 1]) || 0,
        amountTeach: Number(r[PAY_COL.AMOUNT_TEACH - 1]) || 0,
        amountRoom: Number(r[PAY_COL.AMOUNT_ROOM - 1]) || 0,
        amountTotal: Number(r[PAY_COL.AMOUNT_TOTAL - 1]) || 0,
        paid: !!r[PAY_COL.PAID - 1],
        received: Number(r[PAY_COL.RECEIVED - 1]) || 0,
        outstanding: Number(r[PAY_COL.OUTSTANDING - 1]) || 0,
        note: r[PAY_COL.NOTE - 1],
        followupMsg: r[PAY_COL.FOLLOWUP_MSG - 1]
      };
    });
}

// ============================================================================
// Formula helpers (must match spec exactly)
// ============================================================================

function lookupLocation_(locationName) {
  const cfg = getConfig();
  const loc = cfg.locations.filter(function (l) { return l.name === locationName; })[0];
  if (!loc) throw new Error('Unknown location: ' + locationName);
  return loc;
}

function lookupGroup_(groupName) {
  const cfg = getConfig();
  const grp = cfg.groups.filter(function (g) { return g.name === groupName; })[0];
  if (!grp) throw new Error('Unknown group: ' + groupName);
  return grp;
}

// E, F, G, H, O, P, Q, R, S per spec
// fields.teacherRoomFeeOverride: optional per-session override of the
// location's default room-fee-covered-by-teacher amount (set at booking time).
function computeRow_(fields) {
  const loc = lookupLocation_(fields.location);
  const rentTotal = loc.rent;                                        // E
  const grp = lookupGroup_(fields.group);
  const rentTeacher = (fields.teacherRoomFeeOverride != null && fields.teacherRoomFeeOverride !== '')
    ? Number(fields.teacherRoomFeeOverride)
    : loc.teacherRoomFee;                                            // F
  const ratePerHour = grp.rate;                                      // H
  const planCount = fields.planList.length;                          // O
  const attendCount = fields.attendedList.length;                    // P
  const rentPerStudent = attendCount > 0                              // G
    ? Math.max(0, rentTotal - rentTeacher) / attendCount
    : 0;
  const hours = Number(fields.hours) || 0;                            // N
  const planRevenue = hours * ratePerHour * planCount;                // Q
  const revenue = hours * ratePerHour * attendCount;                  // R
  const revenueAfterRoom = revenue - rentTeacher;                     // S

  return {
    rentTotal: rentTotal,
    rentTeacher: rentTeacher,
    rentPerStudent: rentPerStudent,
    ratePerHour: ratePerHour,
    planCount: planCount,
    attendCount: attendCount,
    planRevenue: planRevenue,
    revenue: revenue,
    revenueAfterRoom: revenueAfterRoom
  };
}

// ============================================================================
// Payment ledger fan-out
// ============================================================================
// Session rows (บันทึกการสอน) hold attendance; the per-student payment ledger
// (รายละเอียดรายนักเรียน) is a separate bill per attending student. Nothing
// else creates rows there, so every path that can mark a session TAUGHT must
// call this to fan out one billable row per attendee. Idempotent via
// "<sessionClientKey>:<studentName>" stored in the hidden SessionRef column.

function ensurePaySessionRefColumn_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < PAY_COL.SESSION_REF) {
    sh.getRange(ROWS.PAYMENTS_HEADER_ROW, PAY_COL.SESSION_REF).setValue('SessionRef');
  }
}

function syncPaymentRows_(sessionRowIndex) {
  const sh = sheet_(SHEET_NAMES.SESSIONS);
  const session = rowToSessionObj_(sh, sessionRowIndex);
  if (session.status !== STATUS.TAUGHT) return;

  const attendedList = parseNames_(session.attended);
  if (attendedList.length === 0) return;
  if (!session.clientKey) return; // no stable ref to dedupe on; skip rather than risk duplicate bills

  const paySh = sheet_(SHEET_NAMES.PAYMENTS);
  ensurePaySessionRefColumn_(paySh);

  const lastRow = paySh.getLastRow();
  const existingRefs = lastRow >= ROWS.PAYMENTS_DATA_ROW
    ? paySh.getRange(ROWS.PAYMENTS_DATA_ROW, PAY_COL.SESSION_REF, lastRow - ROWS.PAYMENTS_DATA_ROW + 1, 1).getValues().map(function (r) { return r[0]; })
    : [];

  const amountTeach = session.hours * session.ratePerHour;
  const amountRoom = session.rentPerStudent;
  const amountTotal = amountTeach + amountRoom;

  attendedList.forEach(function (studentName) {
    const ref = session.clientKey + ':' + studentName;
    if (existingRefs.indexOf(ref) !== -1) return; // already billed for this session

    const row = new Array(PAY_COL.SESSION_REF).fill('');
    row[PAY_COL.STUDENT - 1] = studentName;
    row[PAY_COL.GROUP - 1] = session.group;
    row[PAY_COL.DATE_ATTENDED - 1] = session.dateAttended;
    row[PAY_COL.LOCATION - 1] = session.location;
    row[PAY_COL.STATUS - 1] = session.status;
    row[PAY_COL.ATTENDED - 1] = studentName;
    row[PAY_COL.HOURS - 1] = session.hours;
    row[PAY_COL.AMOUNT_TEACH - 1] = amountTeach;
    row[PAY_COL.AMOUNT_ROOM - 1] = amountRoom;
    row[PAY_COL.AMOUNT_TOTAL - 1] = amountTotal;
    row[PAY_COL.PAID - 1] = false;
    row[PAY_COL.RECEIVED - 1] = 0;
    row[PAY_COL.OUTSTANDING - 1] = amountTotal;
    row[PAY_COL.NOTE - 1] = '';
    row[PAY_COL.FOLLOWUP_MSG - 1] = '';
    row[PAY_COL.SESSION_REF - 1] = ref;
    paySh.appendRow(row);
    existingRefs.push(ref);
  });
}

// ============================================================================
// POST actions
// ============================================================================

function ensureClientKeyColumn_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < SES_COL.CLIENT_KEY) {
    sh.getRange(ROWS.SESSIONS_HEADER_ROW, SES_COL.CLIENT_KEY).setValue('ClientKey');
  }
}

function findRowByClientKey_(sh, clientKey) {
  if (!clientKey) return -1;
  const lastRow = sh.getLastRow();
  if (lastRow < ROWS.SESSIONS_DATA_ROW) return -1;
  const keys = sh.getRange(ROWS.SESSIONS_DATA_ROW, SES_COL.CLIENT_KEY, lastRow - ROWS.SESSIONS_DATA_ROW + 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (keys[i][0] && String(keys[i][0]) === String(clientKey)) return i + ROWS.SESSIONS_DATA_ROW;
  }
  return -1;
}

function rowToSessionObj_(sh, rowIndex) {
  const lastCol = Math.max(sh.getLastColumn(), SES_COL.CLIENT_KEY);
  const r = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  return {
    rowIndex: rowIndex,
    dateEntered: fmtDate_(r[SES_COL.DATE_ENTERED - 1]),
    group: r[SES_COL.GROUP - 1],
    location: r[SES_COL.LOCATION - 1],
    status: r[SES_COL.STATUS - 1],
    rentTotal: Number(r[SES_COL.RENT_TOTAL - 1]) || 0,
    rentTeacher: Number(r[SES_COL.RENT_TEACHER - 1]) || 0,
    rentPerStudent: Number(r[SES_COL.RENT_PER_STUDENT - 1]) || 0,
    ratePerHour: Number(r[SES_COL.RATE_PER_HOUR - 1]) || 0,
    plan: r[SES_COL.PLAN - 1],
    attended: r[SES_COL.ATTENDED - 1],
    dateAttended: fmtDate_(r[SES_COL.DATE_ATTENDED - 1]),
    timeStart: fmtTime_(r[SES_COL.TIME_START - 1]),
    timeEnd: fmtTime_(r[SES_COL.TIME_END - 1]),
    hours: Number(r[SES_COL.HOURS - 1]) || 0,
    planCount: Number(r[SES_COL.PLAN_COUNT - 1]) || 0,
    attendCount: Number(r[SES_COL.ATTEND_COUNT - 1]) || 0,
    planRevenue: Number(r[SES_COL.PLAN_REVENUE - 1]) || 0,
    revenue: Number(r[SES_COL.REVENUE - 1]) || 0,
    revenueAfterRoom: Number(r[SES_COL.REVENUE_AFTER_ROOM - 1]) || 0,
    settled: !!r[SES_COL.SETTLED - 1],
    message: r[SES_COL.MESSAGE - 1],
    clientKey: r[SES_COL.CLIENT_KEY - 1] || ''
  };
}

/**
 * payload: { clientKey, group, location, status, date, planList, attendedList,
 *            dateAttended, timeStart, timeEnd, hours, message }
 */
function addSession(payload) {
  const sh = sheet_(SHEET_NAMES.SESSIONS);
  ensureClientKeyColumn_(sh);

  const existingRow = findRowByClientKey_(sh, payload.clientKey);
  if (existingRow > 0) {
    return rowToSessionObj_(sh, existingRow); // idempotent no-op
  }

  const planList = payload.planList || [];
  const attendedList = payload.attendedList || [];
  const computed = computeRow_({
    location: payload.location,
    group: payload.group,
    hours: payload.hours,
    planList: planList,
    attendedList: attendedList,
    teacherRoomFeeOverride: payload.teacherRoomFee
  });

  const rowIndex = sh.getLastRow() + 1;
  const rowVals = new Array(SES_COL.CLIENT_KEY).fill('');
  rowVals[SES_COL.DATE_ENTERED - 1] = payload.date || fmtDate_(new Date());
  rowVals[SES_COL.GROUP - 1] = payload.group;
  rowVals[SES_COL.LOCATION - 1] = payload.location;
  rowVals[SES_COL.STATUS - 1] = payload.status;
  rowVals[SES_COL.RENT_TOTAL - 1] = computed.rentTotal;
  rowVals[SES_COL.RENT_TEACHER - 1] = computed.rentTeacher;
  rowVals[SES_COL.RENT_PER_STUDENT - 1] = computed.rentPerStudent;
  rowVals[SES_COL.RATE_PER_HOUR - 1] = computed.ratePerHour;
  rowVals[SES_COL.PLAN - 1] = planList.join(', ');
  rowVals[SES_COL.ATTENDED - 1] = attendedList.join(', ');
  rowVals[SES_COL.DATE_ATTENDED - 1] = payload.dateAttended || (payload.status === STATUS.TAUGHT ? (payload.date || fmtDate_(new Date())) : '');
  rowVals[SES_COL.TIME_START - 1] = payload.timeStart || '';
  rowVals[SES_COL.TIME_END - 1] = payload.timeEnd || '';
  rowVals[SES_COL.HOURS - 1] = payload.hours;
  rowVals[SES_COL.PLAN_COUNT - 1] = computed.planCount;
  rowVals[SES_COL.ATTEND_COUNT - 1] = computed.attendCount;
  rowVals[SES_COL.PLAN_REVENUE - 1] = computed.planRevenue;
  rowVals[SES_COL.REVENUE - 1] = computed.revenue;
  rowVals[SES_COL.REVENUE_AFTER_ROOM - 1] = computed.revenueAfterRoom;
  rowVals[SES_COL.SETTLED - 1] = false;
  rowVals[SES_COL.MESSAGE - 1] = payload.message || '';
  rowVals[SES_COL.CLIENT_KEY - 1] = payload.clientKey || '';

  sh.getRange(rowIndex, 1, 1, rowVals.length).setValues([rowVals]);
  syncPaymentRows_(rowIndex);
  return rowToSessionObj_(sh, rowIndex);
}

/**
 * payload: { clientKey, group, location, date (optional), attendedList, rowIndex (optional, target existing plan row) }
 * If rowIndex not given, resolves nearest pending 📅 แผน row for group+location (caller should already have
 * resolved this client-side via getSessions, but we defensively resolve here too if rowIndex missing).
 */
function checkIn(payload) {
  const sh = sheet_(SHEET_NAMES.SESSIONS);
  ensureClientKeyColumn_(sh);

  const existingRow = findRowByClientKey_(sh, payload.clientKey);
  if (existingRow > 0) {
    return rowToSessionObj_(sh, existingRow); // idempotent no-op
  }

  let targetRow = payload.rowIndex;
  if (!targetRow) {
    targetRow = findNearestPendingPlanRow_(sh, payload.group, payload.location, payload.date);
  }
  if (!targetRow) throw new Error('No pending plan found for ' + payload.group + ' / ' + payload.location);

  const attendedList = payload.attendedList || [];
  const existing = rowToSessionObj_(sh, targetRow);
  const planList = parseNames_(existing.plan);
  const hours = existing.hours;

  const computed = computeRow_({
    location: existing.location,
    group: existing.group,
    hours: hours,
    planList: planList,
    attendedList: attendedList,
    teacherRoomFeeOverride: existing.rentTeacher // honor whatever was decided when this session was booked
  });

  const dateAttended = payload.dateAttended || fmtDate_(new Date());

  sh.getRange(targetRow, SES_COL.STATUS).setValue(STATUS.TAUGHT);
  sh.getRange(targetRow, SES_COL.ATTENDED).setValue(attendedList.join(', '));
  sh.getRange(targetRow, SES_COL.DATE_ATTENDED).setValue(dateAttended);
  sh.getRange(targetRow, SES_COL.RENT_PER_STUDENT).setValue(computed.rentPerStudent);
  sh.getRange(targetRow, SES_COL.ATTEND_COUNT).setValue(computed.attendCount);
  sh.getRange(targetRow, SES_COL.REVENUE).setValue(computed.revenue);
  sh.getRange(targetRow, SES_COL.REVENUE_AFTER_ROOM).setValue(computed.revenueAfterRoom);
  sh.getRange(targetRow, SES_COL.CLIENT_KEY).setValue(payload.clientKey || existing.clientKey || '');

  syncPaymentRows_(targetRow);
  return rowToSessionObj_(sh, targetRow);
}

function findNearestPendingPlanRow_(sh, group, location, date) {
  const lastRow = sh.getLastRow();
  if (lastRow < ROWS.SESSIONS_DATA_ROW) return null;
  const values = sh.getRange(ROWS.SESSIONS_DATA_ROW, 1, lastRow - ROWS.SESSIONS_DATA_ROW + 1, SES_COL.CLIENT_KEY).getValues();
  let candidates = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    if (r[SES_COL.GROUP - 1] === group && r[SES_COL.LOCATION - 1] === location && r[SES_COL.STATUS - 1] === STATUS.PLAN) {
      candidates.push({ rowIndex: i + ROWS.SESSIONS_DATA_ROW, date: fmtDate_(r[SES_COL.DATE_ENTERED - 1]) });
    }
  }
  if (candidates.length === 0) return null;
  if (date) {
    const match = candidates.filter(function (c) { return c.date === date; });
    if (match.length >= 1) return match[0].rowIndex;
  }
  // nearest by date proximity to today
  const today = new Date();
  candidates.sort(function (a, b) {
    return Math.abs(new Date(a.date) - today) - Math.abs(new Date(b.date) - today);
  });
  return candidates[0].rowIndex;
}

/** payload: { group, location, date } - finds matching row, sets status cancelled */
function cancelSession(payload) {
  const sh = sheet_(SHEET_NAMES.SESSIONS);
  // Prefer an explicit rowIndex (the picker in the app targets an exact row
  // the user tapped) — fall back to group+location+date matching only for
  // older callers that don't have a rowIndex handy.
  if (payload.rowIndex) {
    sh.getRange(payload.rowIndex, SES_COL.STATUS).setValue(STATUS.CANCELLED);
    return rowToSessionObj_(sh, payload.rowIndex);
  }
  const lastRow = sh.getLastRow();
  if (lastRow < ROWS.SESSIONS_DATA_ROW) throw new Error('no matching session found');
  const values = sh.getRange(ROWS.SESSIONS_DATA_ROW, 1, lastRow - ROWS.SESSIONS_DATA_ROW + 1, SES_COL.CLIENT_KEY).getValues();
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    const rowDate = fmtDate_(r[SES_COL.DATE_ENTERED - 1]);
    if (r[SES_COL.GROUP - 1] === payload.group && r[SES_COL.LOCATION - 1] === payload.location && rowDate === payload.date) {
      const rowIndex = i + ROWS.SESSIONS_DATA_ROW;
      sh.getRange(rowIndex, SES_COL.STATUS).setValue(STATUS.CANCELLED);
      return rowToSessionObj_(sh, rowIndex);
    }
  }
  throw new Error('no matching session found');
}

/** payload: { rowIndex, ...fields to update } - recomputes formulas */
function updateSession(payload) {
  const sh = sheet_(SHEET_NAMES.SESSIONS);
  const rowIndex = payload.rowIndex;
  if (!rowIndex) throw new Error('rowIndex required');
  const existing = rowToSessionObj_(sh, rowIndex);

  const group = payload.group || existing.group;
  const location = payload.location || existing.location;
  const hours = payload.hours != null ? payload.hours : existing.hours;
  const planList = payload.planList || parseNames_(existing.plan);
  const attendedList = payload.attendedList || parseNames_(existing.attended);
  const status = payload.status || existing.status;
  const teacherRoomFeeOverride = payload.teacherRoomFee != null ? payload.teacherRoomFee : existing.rentTeacher;

  const computed = computeRow_({ location: location, group: group, hours: hours, planList: planList, attendedList: attendedList, teacherRoomFeeOverride: teacherRoomFeeOverride });

  sh.getRange(rowIndex, SES_COL.GROUP).setValue(group);
  sh.getRange(rowIndex, SES_COL.LOCATION).setValue(location);
  sh.getRange(rowIndex, SES_COL.STATUS).setValue(status);
  sh.getRange(rowIndex, SES_COL.RENT_TOTAL).setValue(computed.rentTotal);
  sh.getRange(rowIndex, SES_COL.RENT_TEACHER).setValue(computed.rentTeacher);
  sh.getRange(rowIndex, SES_COL.RENT_PER_STUDENT).setValue(computed.rentPerStudent);
  sh.getRange(rowIndex, SES_COL.RATE_PER_HOUR).setValue(computed.ratePerHour);
  sh.getRange(rowIndex, SES_COL.PLAN).setValue(planList.join(', '));
  sh.getRange(rowIndex, SES_COL.ATTENDED).setValue(attendedList.join(', '));
  if (payload.dateAttended) sh.getRange(rowIndex, SES_COL.DATE_ATTENDED).setValue(payload.dateAttended);
  if (payload.timeStart) sh.getRange(rowIndex, SES_COL.TIME_START).setValue(payload.timeStart);
  if (payload.timeEnd) sh.getRange(rowIndex, SES_COL.TIME_END).setValue(payload.timeEnd);
  sh.getRange(rowIndex, SES_COL.HOURS).setValue(hours);
  sh.getRange(rowIndex, SES_COL.PLAN_COUNT).setValue(computed.planCount);
  sh.getRange(rowIndex, SES_COL.ATTEND_COUNT).setValue(computed.attendCount);
  sh.getRange(rowIndex, SES_COL.PLAN_REVENUE).setValue(computed.planRevenue);
  sh.getRange(rowIndex, SES_COL.REVENUE).setValue(computed.revenue);
  sh.getRange(rowIndex, SES_COL.REVENUE_AFTER_ROOM).setValue(computed.revenueAfterRoom);
  if (payload.message != null) sh.getRange(rowIndex, SES_COL.MESSAGE).setValue(payload.message);

  syncPaymentRows_(rowIndex);
  return rowToSessionObj_(sh, rowIndex);
}

/** payload: { rowIndex } - used for "Undo last" in History screen */
function deleteSession(payload) {
  const sh = sheet_(SHEET_NAMES.SESSIONS);
  const rowIndex = payload.rowIndex;
  if (!rowIndex) throw new Error('rowIndex required');
  sh.deleteRow(rowIndex);
  return { deleted: true, rowIndex: rowIndex };
}

/** payload: { rowIndex (in รายละเอียดรายนักเรียน), paid, received, note } */
function recordPayment(payload) {
  const sh = sheet_(SHEET_NAMES.PAYMENTS);
  const rowIndex = payload.rowIndex;
  if (!rowIndex) throw new Error('rowIndex required');

  const amountTotal = Number(sh.getRange(rowIndex, PAY_COL.AMOUNT_TOTAL).getValue()) || 0;
  const received = Number(payload.received) || 0;
  const outstanding = amountTotal - received;

  sh.getRange(rowIndex, PAY_COL.PAID).setValue(!!payload.paid);
  sh.getRange(rowIndex, PAY_COL.RECEIVED).setValue(received);
  sh.getRange(rowIndex, PAY_COL.OUTSTANDING).setValue(outstanding);
  if (payload.note != null) sh.getRange(rowIndex, PAY_COL.NOTE).setValue(payload.note);

  return {
    rowIndex: rowIndex,
    paid: !!payload.paid,
    received: received,
    outstanding: outstanding
  };
}

// ============================================================================
// Roster management (locations / groups / students) — lets the Settings
// screen add/edit these in-app instead of requiring direct Sheet access.
// ตั้งค่า holds TWO independent side-by-side tables (locations in A-E,
// groups in G-K, F is a gap column) that can have different row counts, so
// appends must find the first empty row within the relevant column, not
// just use the sheet's overall last row.
// ============================================================================

function ensureSettingsAliasHeaders_(sh) {
  if (!sh.getRange(ROWS.SETTINGS_HEADER_ROW, LOC_COL.TEACHER_FEE).getValue()) {
    sh.getRange(ROWS.SETTINGS_HEADER_ROW, LOC_COL.TEACHER_FEE).setValue('ครูออกค่าห้อง/ครั้ง (ค่าเริ่มต้น)');
  }
  if (!sh.getRange(ROWS.SETTINGS_HEADER_ROW, LOC_COL.ALIASES).getValue()) {
    sh.getRange(ROWS.SETTINGS_HEADER_ROW, LOC_COL.ALIASES).setValue('Aliases (คั่นด้วยจุลภาค)');
  }
  if (!sh.getRange(ROWS.SETTINGS_HEADER_ROW, GRP_COL.ALIASES).getValue()) {
    sh.getRange(ROWS.SETTINGS_HEADER_ROW, GRP_COL.ALIASES).setValue('Aliases (คั่นด้วยจุลภาค)');
  }
}

function firstEmptyRowInColumn_(sh, col, startRow) {
  const maxRows = sh.getMaxRows();
  if (maxRows < startRow) return startRow;
  const values = sh.getRange(startRow, col, maxRows - startRow + 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0]) return startRow + i;
  }
  return startRow + values.length;
}

function findSettingsRowByName_(sh, col, name) {
  const lastRow = sh.getLastRow();
  if (lastRow < ROWS.SETTINGS_DATA_ROW) return -1;
  const values = sh.getRange(ROWS.SETTINGS_DATA_ROW, col, lastRow - ROWS.SETTINGS_DATA_ROW + 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(name)) return ROWS.SETTINGS_DATA_ROW + i;
  }
  return -1;
}

/** payload: { name, rent, note, aliases: [] } */
function addLocation(payload) {
  if (!payload.name) throw new Error('name required');
  const sh = sheet_(SHEET_NAMES.SETTINGS);
  ensureSettingsAliasHeaders_(sh);
  if (findSettingsRowByName_(sh, LOC_COL.NAME, payload.name) > 0) throw new Error('มีสถานที่ชื่อนี้อยู่แล้ว');
  const rowIndex = firstEmptyRowInColumn_(sh, LOC_COL.NAME, ROWS.SETTINGS_DATA_ROW);
  sh.getRange(rowIndex, LOC_COL.NAME, 1, 5).setValues([[
    payload.name, Number(payload.rent) || 0, Number(payload.teacherRoomFee) || 0, payload.note || '', (payload.aliases || []).join(', ')
  ]]);
  return { name: payload.name };
}

/** payload: { originalName, name, rent, teacherRoomFee, note, aliases: [] } */
function updateLocation(payload) {
  const sh = sheet_(SHEET_NAMES.SETTINGS);
  ensureSettingsAliasHeaders_(sh);
  const rowIndex = findSettingsRowByName_(sh, LOC_COL.NAME, payload.originalName);
  if (rowIndex < 0) throw new Error('ไม่พบสถานที่: ' + payload.originalName);
  if (payload.name !== payload.originalName) {
    const collision = findSettingsRowByName_(sh, LOC_COL.NAME, payload.name);
    if (collision > 0 && collision !== rowIndex) throw new Error('มีสถานที่ชื่อนี้อยู่แล้ว');
  }
  sh.getRange(rowIndex, LOC_COL.NAME, 1, 5).setValues([[
    payload.name, Number(payload.rent) || 0, Number(payload.teacherRoomFee) || 0, payload.note || '', (payload.aliases || []).join(', ')
  ]]);
  return { name: payload.name };
}

/** payload: { name, subject, rate, note, aliases: [] } */
function addGroup(payload) {
  if (!payload.name) throw new Error('name required');
  const sh = sheet_(SHEET_NAMES.SETTINGS);
  ensureSettingsAliasHeaders_(sh);
  if (findSettingsRowByName_(sh, GRP_COL.NAME, payload.name) > 0) throw new Error('มีกลุ่มชื่อนี้อยู่แล้ว');
  const rowIndex = firstEmptyRowInColumn_(sh, GRP_COL.NAME, ROWS.SETTINGS_DATA_ROW);
  sh.getRange(rowIndex, GRP_COL.NAME, 1, 5).setValues([[
    payload.name, payload.subject || '', Number(payload.rate) || 0,
    payload.note || '', (payload.aliases || []).join(', ')
  ]]);
  return { name: payload.name };
}

/** payload: { originalName, name, subject, rate, note, aliases: [] } */
function updateGroup(payload) {
  const sh = sheet_(SHEET_NAMES.SETTINGS);
  ensureSettingsAliasHeaders_(sh);
  const rowIndex = findSettingsRowByName_(sh, GRP_COL.NAME, payload.originalName);
  if (rowIndex < 0) throw new Error('ไม่พบกลุ่ม: ' + payload.originalName);
  if (payload.name !== payload.originalName) {
    const collision = findSettingsRowByName_(sh, GRP_COL.NAME, payload.name);
    if (collision > 0 && collision !== rowIndex) throw new Error('มีกลุ่มชื่อนี้อยู่แล้ว');
  }
  sh.getRange(rowIndex, GRP_COL.NAME, 1, 5).setValues([[
    payload.name, payload.subject || '', Number(payload.rate) || 0,
    payload.note || '', (payload.aliases || []).join(', ')
  ]]);
  return { name: payload.name };
}

function nextStudentCode_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < ROWS.STUDENTS_DATA_ROW) return 1;
  const codes = sh.getRange(ROWS.STUDENTS_DATA_ROW, 1, lastRow - ROWS.STUDENTS_DATA_ROW + 1, 1).getValues();
  let max = 0;
  codes.forEach(function (r) {
    const n = Number(r[0]);
    if (!isNaN(n) && n > max) max = n;
  });
  return max + 1;
}

/** payload: { name, group, studentPhone, parentName, parentPhone, note } */
function addStudent(payload) {
  if (!payload.name) throw new Error('name required');
  const sh = sheet_(SHEET_NAMES.STUDENTS);
  if (findStudentRowByName_(sh, payload.name) > 0) {
    throw new Error('มีนักเรียนชื่อนี้อยู่แล้ว — ถ้าเป็นคนละคนจริง ลองใส่ชื่อให้ต่างกันชัดเจน เช่น เติมนามสกุลหรือชื่อเล่นกลุ่ม');
  }
  const rowIndex = sh.getLastRow() < ROWS.STUDENTS_DATA_ROW ? ROWS.STUDENTS_DATA_ROW : sh.getLastRow() + 1;
  const code = nextStudentCode_(sh);
  sh.getRange(rowIndex, 1, 1, 7).setValues([[
    code, payload.name, payload.group || '', payload.studentPhone || '',
    payload.parentName || '', payload.parentPhone || '', payload.note || ''
  ]]);
  return { code: code, name: payload.name };
}

function findStudentRowByName_(sh, name) {
  const lastRow = sh.getLastRow();
  if (lastRow < ROWS.STUDENTS_DATA_ROW) return -1;
  const names = sh.getRange(ROWS.STUDENTS_DATA_ROW, 2, lastRow - ROWS.STUDENTS_DATA_ROW + 1, 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (String(names[i][0]) === String(name)) return ROWS.STUDENTS_DATA_ROW + i;
  }
  return -1;
}

/** payload: { originalName, name, group, studentPhone, parentName, parentPhone, note } */
function updateStudent(payload) {
  const sh = sheet_(SHEET_NAMES.STUDENTS);
  const rowIndex = findStudentRowByName_(sh, payload.originalName);
  if (rowIndex < 0) throw new Error('ไม่พบนักเรียน: ' + payload.originalName);
  if (payload.name !== payload.originalName) {
    const collision = findStudentRowByName_(sh, payload.name);
    if (collision > 0 && collision !== rowIndex) throw new Error('มีนักเรียนชื่อนี้อยู่แล้ว');
  }
  sh.getRange(rowIndex, 2, 1, 6).setValues([[
    payload.name, payload.group || '', payload.studentPhone || '',
    payload.parentName || '', payload.parentPhone || '', payload.note || ''
  ]]);
  return { name: payload.name };
}

// Deletes one row's worth of data within a single column range only, shifting
// everything below it up. Plain sh.deleteRow() would be WRONG for ตั้งค่า:
// locations (A-E) and groups (G-K) are two independent tables sharing the
// same physical rows, so deleting a whole row would silently corrupt
// whichever table wasn't being edited.
function deleteRowInColumnRange_(sh, startCol, numCols, targetRow) {
  const lastRow = sh.getLastRow();
  if (targetRow < ROWS.SETTINGS_DATA_ROW || targetRow > lastRow) return;
  if (targetRow < lastRow) {
    const below = sh.getRange(targetRow + 1, startCol, lastRow - targetRow, numCols).getValues();
    sh.getRange(targetRow, startCol, lastRow - targetRow, numCols).setValues(below);
  }
  sh.getRange(lastRow, startCol, 1, numCols).clearContent();
}

/** payload: { name } — existing sessions/payments keep the name as plain
 * historical text (see buildFollowupMessage's rate note in index.html), so
 * this is safe even if old records reference the deleted name. */
function deleteLocation(payload) {
  const sh = sheet_(SHEET_NAMES.SETTINGS);
  const rowIndex = findSettingsRowByName_(sh, LOC_COL.NAME, payload.name);
  if (rowIndex < 0) throw new Error('ไม่พบสถานที่: ' + payload.name);
  deleteRowInColumnRange_(sh, LOC_COL.NAME, 5, rowIndex);
  return { deleted: true, name: payload.name };
}

/** payload: { name } */
function deleteGroup(payload) {
  const sh = sheet_(SHEET_NAMES.SETTINGS);
  const rowIndex = findSettingsRowByName_(sh, GRP_COL.NAME, payload.name);
  if (rowIndex < 0) throw new Error('ไม่พบกลุ่ม: ' + payload.name);
  deleteRowInColumnRange_(sh, GRP_COL.NAME, 5, rowIndex);
  return { deleted: true, name: payload.name };
}

/** payload: { name } */
function deleteStudent(payload) {
  const sh = sheet_(SHEET_NAMES.STUDENTS);
  const rowIndex = findStudentRowByName_(sh, payload.name);
  if (rowIndex < 0) throw new Error('ไม่พบนักเรียน: ' + payload.name);
  sh.deleteRow(rowIndex); // นักเรียน is a single table — plain deleteRow is safe here
  return { deleted: true, name: payload.name };
}

/**
 * ============================================================================
 * DEPLOY INSTRUCTIONS
 * ============================================================================
 * 1. SHEET_ID above is already set to the real working Sheet "ติดตามเรียนพิเศษ"
 *    (in Folder_PWD_ERP on Drive) — a from-scratch Sheet with the 5 tabs
 *    ตั้งค่า, นักเรียน, บันทึกการสอน, รายละเอียดรายนักเรียน, สรุปรายเดือน,
 *    headers only, no demo data. Fill in your real locations/groups in
 *    ตั้งค่า and your real students in นักเรียน before using the app for real.
 * 2. Open that Sheet, go to Extensions > Apps Script.
 * 3. Delete any boilerplate code and paste this entire Code.gs file in.
 * 4. In the Apps Script editor, go to Project Settings (gear icon) > Script
 *    Properties > Add script property. Key: TUTOR_APP_TOKEN, Value: a long
 *    random secret you generate yourself (this is the shared secret the app
 *    sends with every request — must match CONFIG.TOKEN in index.html).
 *    NOTE: since index.html is a public static page, this token is visible
 *    to anyone who views the deployed page's source — it deters casual/
 *    automated hits on the URL, it is not a real access-control boundary.
 *    Do not reuse a secret you care about elsewhere.
 * 5. Click Deploy > New deployment. Select type "Web app". Set "Execute as":
 *    Me. Set "Who has access": Anyone with the link. Click Deploy.
 *    (This step asks YOU to authorize the script's access to your own Sheet —
 *    that consent has to happen in your own browser session, it can't be
 *    done on your behalf.)
 * 6. Copy the Web app URL shown — paste it into index.html's CONFIG.GAS_URL.
 * 8. Every time you edit this Code.gs file, you must create a NEW deployment
 *    version (Deploy > Manage deployments > Edit > New version) for changes
 *    to take effect on the existing URL.
 * ============================================================================
 */
