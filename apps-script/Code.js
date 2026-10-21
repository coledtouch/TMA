// GENERATED FILE — do not edit. Built from src/ by `npm run build:gas`.
"use strict";
var TMA = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj2, key, value) => key in obj2 ? __defProp(obj2, key, { enumerable: true, configurable: true, writable: true, value }) : obj2[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj2, key, value) => __defNormalProp(obj2, typeof key !== "symbol" ? key + "" : key, value);

  // src/gas/entry.ts
  var entry_exports = {};
  __export(entry_exports, {
    VERSION: () => VERSION,
    dailyTick: () => dailyTick,
    doGet: () => doGet,
    doPost: () => doPost,
    installTriggers: () => installTriggers,
    landingPage: () => landingPage,
    linkPushWorker: () => linkPushWorker,
    onOpen: () => onOpen,
    parseApiRequest: () => parseApiRequest,
    sendTestPushToMe: () => sendTestPushToMe,
    setupTma: () => setupTma,
    setupTmaWithSampleData: () => setupTmaWithSampleData,
    showTmaStatus: () => showTmaStatus,
    summarizeTick: () => summarizeTick,
    syncTick: () => syncTick
  });

  // src/server/errors.ts
  var ApiError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code");
      this.name = "ApiError";
      this.code = code;
    }
  };
  function fail(code, message) {
    throw new ApiError(code, message);
  }
  function badRequest(message) {
    return fail("BAD_REQUEST", message);
  }
  function notFound(message) {
    return fail("NOT_FOUND", message);
  }
  function forbidden(message) {
    return fail("FORBIDDEN", message);
  }
  function conflict(message) {
    return fail("CONFLICT", message);
  }

  // src/shared/schema.ts
  var TABLES = {
    Families: {
      headers: [
        "FamilyID",
        "Parent Name",
        "Email",
        "Phone",
        "Parent 2 Name",
        "Parent 2 Email",
        "Parent 2 Phone",
        "Status",
        "Member",
        "Created"
      ],
      aliases: {
        "Parent Name": ["Parent", "Guardian", "Guardian Name", "Parent 1 Name", "Name"],
        Email: ["Parent Email", "Parent 1 Email", "Guardian Email", "Email Address"],
        Phone: ["Cell", "Cell Phone", "Parent Phone", "Parent 1 Phone", "Mobile"],
        "Parent 2 Name": ["Guardian 2", "Guardian 2 Name", "Second Parent"],
        "Parent 2 Email": ["Guardian 2 Email", "Second Email"],
        "Parent 2 Phone": ["Guardian 2 Phone", "Parent 2 Cell"],
        Member: ["TMA Member", "Membership"]
      },
      note: "One row per household. Status: Active (verified), Pending (signed up in the app, needs review), Inactive."
    },
    Students: {
      headers: [
        "StudentID",
        "FamilyID",
        "First Name",
        "Last Name",
        "Grade",
        "School",
        "Ensembles",
        "Instrument",
        "Status"
      ],
      aliases: {
        "First Name": ["First", "Student First Name"],
        "Last Name": ["Last", "Student Last Name"],
        Ensembles: ["Groups", "Ensemble", "Programs"]
      },
      note: 'One row per student. Ensembles is a comma-separated list (e.g. "Band, Jazz Band").'
    },
    Ledger: {
      headers: ["Date", "StudentID", "Type", "Description", "Amount", "ActivityID", "Reference", "Entered By"],
      aliases: { Amount: ["Amount ($)", "Credit", "Value"], ActivityID: ["Activity", "Trip", "TripID"] },
      note: "Activity-fund history. + adds to a student's funds (fundraiser credit), - spends them. Fill ActivityID when funds are applied to a trip/activity."
    },
    Activities: {
      headers: [
        "ActivityID",
        "Name",
        "Kind",
        "Description",
        "Schools",
        "Ensembles",
        "Cost",
        "Deposit",
        "Deposit Due",
        "Due Date",
        "Status",
        "Allow Funds",
        "Allow Online Payment",
        "Info URL"
      ],
      aliases: { Kind: ["Type"], Cost: ["Cost Per Student", "Price"], "Due Date": ["Final Due", "Balance Due"] },
      note: "Trips, camps, lessons. Kind: Trip | Camp | Lessons | Other. Status: Open | Closed. Allow columns: TRUE/FALSE or Y/N."
    },
    Enrollments: {
      headers: ["StudentID", "ActivityID", "Cost", "Status"],
      aliases: { Cost: ["Cost Override", "Price"] },
      note: "Who is going (per the music department). Cost blank = activity default. Status: Going | Waitlist | Withdrawn."
    },
    Payments: {
      headers: [
        "Date",
        "StudentID",
        "ActivityID",
        "Amount",
        "Fee Covered",
        "Gross",
        "Method",
        "Reference",
        "Payer Email",
        "Status"
      ],
      note: "Money paid toward an activity (PayPal rows are added by the app; add checks/cash by hand). Amount = credited to the trip."
    },
    Redemptions: {
      headers: [
        "RequestID",
        "Requested",
        "Email",
        "FamilyID",
        "StudentID",
        "ActivityID",
        "Amount",
        "Note",
        "Status",
        "Decided",
        "Decided By",
        "Admin Note",
        "Notified"
      ],
      note: "Requests to apply activity funds to a trip. Change Status to Approved/Denied here or in the app; the app posts the Ledger row."
    },
    Announcements: {
      headers: ["ID", "Date", "Title", "Body", "Schools", "Ensembles", "Link", "Sent"],
      note: "News for families. Leave Sent blank and the app sends it on its next run (Schools/Ensembles blank = everyone)."
    },
    Events: {
      headers: ["ID", "Date", "Time", "Title", "Location", "Details", "Schools", "Ensembles"],
      note: "Concerts, meetings, deadlines. Families get a reminder the day before."
    },
    Preferences: {
      headers: ["Email", "FamilyID", "Prefs", "Updated"],
      system: true,
      note: "Notification choices per parent email (JSON). Managed by the app."
    },
    Devices: {
      headers: ["Email", "FamilyID", "Token", "User Agent", "Created", "Last Seen"],
      system: true,
      note: "Push-notification device tokens. Managed by the app."
    },
    Settings: {
      headers: ["Key", "Value", "Notes"],
      note: "App settings (non-secret). Secrets go in Apps Script > Project Settings > Script Properties."
    },
    Log: {
      headers: ["At", "Kind", "Detail"],
      system: true,
      note: "What the app did (notifications sent, approvals, errors)."
    },
    _Snapshot: {
      headers: ["StudentID", "Balance", "Updated"],
      system: true,
      note: "Last seen balances, used to detect changes and notify families."
    },
    _Sent: {
      headers: ["Key", "At"],
      system: true,
      note: "Idempotency keys for reminders already sent."
    }
  };
  var TABLE_ORDER = [
    "Families",
    "Students",
    "Ledger",
    "Activities",
    "Enrollments",
    "Payments",
    "Redemptions",
    "Announcements",
    "Events",
    "Settings",
    "Preferences",
    "Devices",
    "Log",
    "_Snapshot",
    "_Sent"
  ];
  var SETTING_DEFAULTS = {
    ORG_NAME: "Timberlane Music Association",
    SUPPORT_EMAIL: "timberlanemusictma@gmail.com",
    APP_URL: "",
    ADMIN_EMAILS: "",
    SCHOOLS: "High School, Middle School, Elementary",
    ENSEMBLES: "Band, Marching Band, Jazz Band, Orchestra, Chorus, Guitar",
    FEE_PERCENT: "1.99",
    FEE_FIXED: "0.49",
    FEE_COVER_DEFAULT: "TRUE",
    ONLINE_PAYMENTS: "FALSE",
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "",
    MIN_PAYMENT: "5.00",
    OTHER_PAYMENT_INSTRUCTIONS: `Checks payable to "Timberlane Music Association", P.O. Box 420, Plaistow, NH 03865. Please write the student's name and the trip in the memo line.`,
    DONATE_URL: "https://sites.google.com/view/timberlanemusicassociation/donate",
    PRIVACY_NOTE: "TMA only stores what it needs to run the program: parent names, emails, an optional cell number, and each student's name, grade, school and groups. No addresses, SSNs or card numbers. Card payments are handled by PayPal; TMA never sees card numbers.",
    REMINDER_DAYS: "14, 7, 1",
    EMAIL_ENABLED: "TRUE",
    /** "cloudflare": send as noreply@mytma.org through the push Worker (Gmail if that fails); "gmail": always MailApp. */
    EMAIL_VIA: "cloudflare",
    SMS_ENABLED: "FALSE",
    PUSH_RELAY_URL: "https://tma-push.coleciprari.workers.dev",
    TOKEN_VERSION: "1",
    SESSION_DAYS: "120",
    NEW_SIGNUPS_PER_HOUR: "30"
  };
  function normalizeHeader(h) {
    return String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // src/server/sha256.ts
  function utf8Encode(text2) {
    const out = [];
    for (let i = 0; i < text2.length; i++) {
      let c = text2.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const next = i + 1 < text2.length ? text2.charCodeAt(i + 1) : 0;
        if (next >= 56320 && next <= 57343) {
          c = 65536 + (c - 55296 << 10) + (next - 56320);
          i++;
        } else {
          c = 65533;
        }
      } else if (c >= 56320 && c <= 57343) {
        c = 65533;
      }
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
      else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
    }
    return out;
  }
  function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const b0 = bytes[i];
      let cp;
      let extra;
      if (b0 < 128) {
        cp = b0;
        extra = 0;
      } else if (b0 >= 194 && b0 <= 223) {
        cp = b0 & 31;
        extra = 1;
      } else if (b0 >= 224 && b0 <= 239) {
        cp = b0 & 15;
        extra = 2;
      } else if (b0 >= 240 && b0 <= 244) {
        cp = b0 & 7;
        extra = 3;
      } else {
        return null;
      }
      if (i + extra >= bytes.length) return null;
      for (let k = 1; k <= extra; k++) {
        const b = bytes[i + k];
        if ((b & 192) !== 128) return null;
        cp = cp << 6 | b & 63;
      }
      if (extra === 2 && cp < 2048 || extra === 3 && (cp < 65536 || cp > 1114111)) return null;
      if (cp >= 55296 && cp <= 57343) return null;
      out += String.fromCodePoint(cp);
      i += extra + 1;
    }
    return out;
  }

  // src/server/util.ts
  var MAX_AMOUNT_CENTS = 1e7;
  var DAY_MS = 864e5;
  var SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
  function isBlank(value) {
    return value === null || value === void 0 || typeof value === "string" && value.trim() === "";
  }
  function str(value) {
    if (value === null || value === void 0) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
    return String(value).trim();
  }
  var TRUE_WORDS = /* @__PURE__ */ new Set(["true", "yes", "y", "x", "1", "on", "✓", "✔"]);
  var FALSE_WORDS = /* @__PURE__ */ new Set(["false", "no", "n", "0", "off"]);
  function parseBool(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value !== 0 : fallback;
    const s = str(value).toLowerCase();
    if (TRUE_WORDS.has(s)) return true;
    if (FALSE_WORDS.has(s)) return false;
    return fallback;
  }
  function splitList(value, separators = /[,;/\n\r]+/) {
    return str(value).split(separators).map((s) => s.trim()).filter((s) => s !== "");
  }
  function canonical(value, known) {
    const key = normalizeHeader(value);
    if (!key) return value;
    for (const k of known) if (normalizeHeader(k) === key) return k;
    return value;
  }
  function isKnown(value, known) {
    const key = normalizeHeader(value);
    return key !== "" && known.some((k) => normalizeHeader(k) === key);
  }
  function parseList(value, known) {
    return uniqueBy(
      splitList(value).map((s) => canonical(s, known)),
      (s) => normalizeHeader(s) || s
    );
  }
  function joinList(list2) {
    return list2.join(", ");
  }
  function uniqueBy(items, key) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const item of items) {
      const k = key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }
  function unique(items) {
    return uniqueBy(items, (s) => s);
  }
  function intersects(a, b) {
    const keys = new Set(a.map((s) => normalizeHeader(s)));
    return b.some((s) => keys.has(normalizeHeader(s)));
  }
  function idKey(value) {
    return str(value).toUpperCase();
  }
  var GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  function normalizeGrade(value) {
    const s = str(value);
    if (!s) return "";
    if (/^(k|kg|kindergarten)$/i.test(s)) return "K";
    const m = /^(?:grade\s*)?0*(\d{1,2})(?:\.0+)?(?:st|nd|rd|th)?(?:\s*grade)?$/i.exec(s);
    return m ? String(parseInt(m[1], 10)) : s;
  }
  var INVISIBLE_RANGES = [
    [0, 8],
    [11, 12],
    [14, 31],
    [127, 127],
    [8203, 8207],
    // zero-width and directional marks
    [8234, 8238],
    // bidi embedding/override
    [8232, 8233],
    // line/paragraph separators
    [8294, 8297],
    // bidi isolates
    [65279, 65279]
    // BOM
  ];
  var hex4 = (n) => n.toString(16).padStart(4, "0");
  var INVISIBLE = new RegExp(
    `[${INVISIBLE_RANGES.map(([a, b]) => `\\u${hex4(a)}-\\u${hex4(b)}`).join("")}]`,
    "g"
  );
  function cleanText(value, multiline = false) {
    const s = value.replace(/\r\n?/g, "\n").replace(INVISIBLE, "");
    if (!multiline) return s.replace(/\s+/g, " ").trim();
    return s.split("\n").map((line) => line.replace(/[ \t\f\v]+/g, " ").trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function truncate(text2, max) {
    if (text2.length <= max) return text2;
    return `${text2.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }
  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }
  function lettersOnly(value) {
    return value.toLowerCase().replace(/[^a-z]/g, "");
  }
  function safeUrl(value, max = 500) {
    const s = str(value);
    if (!s || s.length > max) return void 0;
    return /^https?:\/\/[^\s<>"'`]+$/i.test(s) ? s : void 0;
  }
  var EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  var MAX_EMAIL_LENGTH = 200;
  function normEmail(value) {
    return str(value).toLowerCase();
  }
  function isEmail(value) {
    return value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value) && !value.includes("..") && !value.startsWith(".") && !value.includes(".@");
  }
  function errorMessage(err) {
    if (err instanceof Error) return err.message;
    return typeof err === "string" ? err : "Unknown error";
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function hasOwn(obj2, key) {
    return Object.prototype.hasOwnProperty.call(obj2, key);
  }
  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  var B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function base64UrlEncode(text2) {
    const bytes = utf8Encode(text2);
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const n = bytes[i] << 16 | b1 << 8 | b2;
      out += B64URL[n >> 18 & 63] + B64URL[n >> 12 & 63];
      if (i + 1 < bytes.length) out += B64URL[n >> 6 & 63];
      if (i + 2 < bytes.length) out += B64URL[n & 63];
    }
    return out;
  }
  function base64UrlDecode(encoded) {
    if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1) return null;
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < encoded.length; i++) {
      buffer = (buffer << 6 | B64URL.indexOf(encoded[i])) & 16777215;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push(buffer >> bits & 255);
      }
    }
    if (bits > 0 && (buffer & (1 << bits) - 1) !== 0) return null;
    return utf8Decode(bytes);
  }
  function hex8(uuid) {
    return uuid.replace(/[^0-9a-f]/gi, "").slice(0, 8).toLowerCase();
  }
  function nextSequentialId(prefix, existing) {
    let max = 0;
    const re = new RegExp(`^${prefix}0*(\\d{1,9})$`, "i");
    for (const id2 of existing) {
      const m = re.exec(id2.trim());
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}${String(max + 1).padStart(4, "0")}`;
  }
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function nthSunday(year, month0, n) {
    const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
    return 1 + (7 - firstDow) % 7 + 7 * (n - 1);
  }
  function nyOffsetMinutes(at) {
    const year = at.getUTCFullYear();
    const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 7);
    const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 6);
    const t = at.getTime();
    return t >= start && t < end ? -240 : -300;
  }
  function nyParts(at) {
    const shifted = new Date(at.getTime() + nyOffsetMinutes(at) * 6e4);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes()
    };
  }
  function isoDate(year, month, day) {
    return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
  }
  function nyDate(at) {
    const p = nyParts(at);
    return isoDate(p.year, p.month, p.day);
  }
  function nyLocalToDate(year, month, day, hour = 0, minute = 0, second = 0) {
    const wall = Date.UTC(year, month - 1, day, hour, minute, second);
    let t = wall + 300 * 6e4;
    t = wall - nyOffsetMinutes(new Date(t)) * 6e4;
    t = wall - nyOffsetMinutes(new Date(t)) * 6e4;
    return new Date(t);
  }
  function dateParts(date) {
    const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
    return [y, m, d];
  }
  function utcMidnight(date) {
    const [y, m, d] = dateParts(date);
    return Date.UTC(y, m - 1, d);
  }
  function addDays(date, days) {
    const t = new Date(utcMidnight(date) + days * DAY_MS);
    return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function daysBetween(from, to) {
    return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDate(date) {
    var _a;
    const [, m, d] = dateParts(date);
    return `${(_a = MONTHS[m - 1]) != null ? _a : ""} ${d}`;
  }
  function validDate(year, month, day) {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) return null;
    return isoDate(year, month, day);
  }
  function serialToDate(serial) {
    if (!Number.isFinite(serial) || serial <= 0 || serial >= 2958466) return null;
    const t = new Date(SHEETS_EPOCH_MS + Math.floor(serial) * DAY_MS);
    return validDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  var ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  var ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
  var US_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i;
  function zonedIsoToMs(isoText, zone) {
    const fixed = /^[+-]\d{4}$/.test(zone) ? isoText.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : isoText;
    return Date.parse(fixed.replace(" ", "T"));
  }
  function parseDate(value) {
    if (value === null || value === void 0) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : validDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (typeof value === "number") return serialToDate(value);
    const s = str(value);
    if (!s) return null;
    let m = ISO_DATE.exec(s);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = ISO_DATETIME.exec(s);
    if (m) {
      if (!m[7]) return validDate(+m[1], +m[2], +m[3]);
      const t2 = zonedIsoToMs(s, m[7]);
      return Number.isNaN(t2) ? null : nyDate(new Date(t2));
    }
    m = US_DATE.exec(s);
    if (m) {
      const year = m[3].length === 2 ? 2e3 + parseInt(m[3], 10) : parseInt(m[3], 10);
      return validDate(year, +m[1], +m[2]);
    }
    if (/^\d+(\.\d+)?$/.test(s)) return serialToDate(parseFloat(s));
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    return validDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function parseTimestamp(value) {
    var _a;
    if (value === null || value === void 0) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0 || value >= 2958466) return null;
      const date = serialToDate(value);
      if (!date) return null;
      const [y, mo, d] = dateParts(date);
      const seconds = Math.round((value - Math.floor(value)) * 86400);
      return nyLocalToDate(y, mo, d, 0, 0, seconds).toISOString();
    }
    const s = str(value);
    if (!s) return null;
    let m = ISO_DATE.exec(s);
    if (m) {
      const date = validDate(+m[1], +m[2], +m[3]);
      return date ? nyLocalToDate(+m[1], +m[2], +m[3]).toISOString() : null;
    }
    m = ISO_DATETIME.exec(s);
    if (m) {
      if (!validDate(+m[1], +m[2], +m[3])) return null;
      if (m[7]) {
        const t2 = zonedIsoToMs(s, m[7]);
        return Number.isNaN(t2) ? null : new Date(t2).toISOString();
      }
      return nyLocalToDate(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0).toISOString();
    }
    m = US_DATE.exec(s);
    if (m) {
      const year = m[3].length === 2 ? 2e3 + parseInt(m[3], 10) : parseInt(m[3], 10);
      if (!validDate(year, +m[1], +m[2])) return null;
      let hour = m[4] ? parseInt(m[4], 10) : 0;
      const minute = m[5] ? parseInt(m[5], 10) : 0;
      const meridiem = ((_a = m[7]) != null ? _a : "").toLowerCase().replace(/\./g, "");
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
      if (hour > 23 || minute > 59) return null;
      return nyLocalToDate(year, +m[1], +m[2], hour, minute, m[6] ? +m[6] : 0).toISOString();
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  function parseTimeText(value) {
    let hours;
    let minutes;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return "";
      hours = value.getHours();
      minutes = value.getMinutes();
    } else if (typeof value === "number" && value >= 0 && value < 1) {
      const total = Math.round(value * 1440);
      hours = Math.floor(total / 60) % 24;
      minutes = total % 60;
    } else {
      const s = str(value);
      if (!/^1899-12-(30|31)T/.test(s)) return s;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return "";
      hours = d.getHours();
      minutes = d.getMinutes();
    }
    const suffix = hours >= 12 ? "PM" : "AM";
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${h12}:${pad2(minutes)} ${suffix}`;
  }

  // src/server/access.ts
  function isAdmin(ctx, email2) {
    return ctx.m.settings().adminEmails.includes(email2);
  }
  function requireFamily(ctx, email2, opts = {}) {
    const family = ctx.m.familyForEmail(email2);
    if (!family) return forbidden("Set up your household in the app first.");
    if (family.status === "Inactive") return forbidden("This household is inactive. Please contact TMA.");
    if (opts.active && family.status !== "Active") {
      return forbidden("TMA is still verifying your household. You'll get a notification when it's ready.");
    }
    return family;
  }
  function requireOwnStudent(ctx, family, studentId) {
    const student2 = ctx.m.studentById(studentId);
    if (!student2 || student2.familyId === null || idKey(student2.familyId) !== idKey(family.id) || student2.status === "Inactive") {
      return notFound("Student not found.");
    }
    if (student2.status !== "Active") return forbidden("TMA is still verifying this student.");
    return student2;
  }
  function requireActivity(ctx, activityId) {
    var _a;
    return (_a = ctx.m.activityById(activityId)) != null ? _a : notFound("Activity not found.");
  }
  function guardianName(family, email2) {
    const g = family == null ? void 0 : family.guardians.find((x) => x.email === email2);
    return (g == null ? void 0 : g.name) || email2.split("@")[0];
  }
  function guardianNames(family) {
    const names = family.guardians.map((g) => g.name || g.email.split("@")[0]).filter((n) => n !== "");
    return names.join(" & ") || family.id;
  }

  // src/shared/money.ts
  function dollarsToCents(value) {
    if (value === null || value === void 0 || value === "") return 0;
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.round(value * 100) : 0;
    }
    let s = String(value).trim();
    let negative = false;
    if (/^\(.*\)$/.test(s)) {
      negative = true;
      s = s.slice(1, -1);
    }
    s = s.replace(/[$,\s]/g, "");
    if (s.startsWith("-")) {
      negative = !negative;
      s = s.slice(1);
    }
    if (!/^\d*(\.\d+)?$/.test(s) || s === "" || s === ".") return 0;
    const cents2 = Math.round(parseFloat(s) * 100);
    return negative ? -cents2 : cents2;
  }
  function centsToDollars(cents2) {
    return Math.round(cents2) / 100;
  }
  function formatCents(cents2, opts = {}) {
    const abs = Math.abs(Math.round(cents2));
    const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const body = `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
    if (cents2 < 0) return `-${body}`;
    if (opts.sign && cents2 > 0) return `+${body}`;
    return body;
  }
  function processorFeeCents(grossCents, feePercent, feeFixedCents) {
    if (grossCents <= 0) return 0;
    return Math.ceil(grossCents * feePercent / 100 - 1e-9) + feeFixedCents;
  }
  function grossUpCents(amountCents, feePercent, feeFixedCents) {
    if (amountCents <= 0) return { grossCents: 0, feeCents: 0 };
    if (feePercent <= 0 && feeFixedCents <= 0) return { grossCents: amountCents, feeCents: 0 };
    const rate = feePercent / 100;
    let gross = Math.ceil((amountCents + feeFixedCents) / (1 - rate));
    while (gross - processorFeeCents(gross, feePercent, feeFixedCents) < amountCents) gross += 1;
    while (gross - 1 - processorFeeCents(gross - 1, feePercent, feeFixedCents) >= amountCents) gross -= 1;
    return { grossCents: gross, feeCents: gross - amountCents };
  }

  // src/server/ledger.ts
  function pairKey(studentId, activityId) {
    return `${idKey(studentId)}|${idKey(activityId)}`;
  }
  function add(map, key, cents2) {
    var _a;
    map.set(key, ((_a = map.get(key)) != null ? _a : 0) + cents2);
  }
  var Books = class {
    constructor(input) {
      __publicField(this, "balances", /* @__PURE__ */ new Map());
      __publicField(this, "pendingByStudent", /* @__PURE__ */ new Map());
      __publicField(this, "pendingByPair", /* @__PURE__ */ new Map());
      __publicField(this, "fundsByPair", /* @__PURE__ */ new Map());
      __publicField(this, "directByPair", /* @__PURE__ */ new Map());
      __publicField(this, "clearingByPair", /* @__PURE__ */ new Map());
      /** Last enrollment row wins for a (student, activity) pair; order of first appearance is kept. */
      __publicField(this, "enrollmentsByStudent", /* @__PURE__ */ new Map());
      __publicField(this, "activities", /* @__PURE__ */ new Map());
      for (const a of input.activities) if (!this.activities.has(idKey(a.id))) this.activities.set(idKey(a.id), a);
      for (const row of input.ledger) {
        if (!row.studentId || !row.amountCents) continue;
        add(this.balances, idKey(row.studentId), row.amountCents);
        if (row.activityId) add(this.fundsByPair, pairKey(row.studentId, row.activityId), -row.amountCents);
      }
      for (const p of input.payments) {
        if (!p.studentId || !p.activityId) continue;
        if (p.status === "Completed") add(this.directByPair, pairKey(p.studentId, p.activityId), p.amountCents);
        else if (p.status === "Pending") add(this.clearingByPair, pairKey(p.studentId, p.activityId), p.amountCents);
      }
      for (const r of input.redemptions) {
        if (r.status !== "Pending" || !r.studentId) continue;
        add(this.pendingByStudent, idKey(r.studentId), r.amountCents);
        if (r.activityId) add(this.pendingByPair, pairKey(r.studentId, r.activityId), r.amountCents);
      }
      for (const e of input.enrollments) {
        const key = idKey(e.studentId);
        let byActivity = this.enrollmentsByStudent.get(key);
        if (!byActivity) {
          byActivity = /* @__PURE__ */ new Map();
          this.enrollmentsByStudent.set(key, byActivity);
        }
        byActivity.set(idKey(e.activityId), e);
      }
    }
    /** Student keys (idKey) that have ledger rows. */
    ledgerStudentKeys() {
      return Array.from(this.balances.keys());
    }
    balance(studentId) {
      var _a;
      return (_a = this.balances.get(idKey(studentId))) != null ? _a : 0;
    }
    pending(studentId) {
      var _a;
      return (_a = this.pendingByStudent.get(idKey(studentId))) != null ? _a : 0;
    }
    available(studentId) {
      return Math.max(0, this.balance(studentId) - this.pending(studentId));
    }
    pendingFor(studentId, activityId) {
      var _a;
      return (_a = this.pendingByPair.get(pairKey(studentId, activityId))) != null ? _a : 0;
    }
    enrollment(studentId, activityId) {
      var _a, _b;
      return (_b = (_a = this.enrollmentsByStudent.get(idKey(studentId))) == null ? void 0 : _a.get(idKey(activityId))) != null ? _b : null;
    }
    /** The account for one enrollment (any status), or null when not enrolled / unknown activity. */
    account(studentId, activityId) {
      const enrollment = this.enrollment(studentId, activityId);
      return enrollment ? this.toAccount(enrollment) : null;
    }
    /** Accounts shown to the family: Going/Waitlist, plus Withdrawn when something was paid. Open first. */
    accounts(studentId) {
      const byActivity = this.enrollmentsByStudent.get(idKey(studentId));
      if (!byActivity) return [];
      const out = [];
      byActivity.forEach((enrollment) => {
        const account = this.toAccount(enrollment);
        if (!account) return;
        if (account.enrollmentStatus === "Withdrawn" && account.paidCents <= 0) return;
        out.push(account);
      });
      const open = out.filter((a) => a.activityOpen);
      const closed = out.filter((a) => !a.activityOpen);
      return open.concat(closed);
    }
    toAccount(enrollment) {
      var _a, _b, _c, _d;
      const activity = this.activities.get(idKey(enrollment.activityId));
      if (!activity) return null;
      const pair = pairKey(enrollment.studentId, activity.id);
      const paidFromFunds = (_a = this.fundsByPair.get(pair)) != null ? _a : 0;
      const paidDirect = (_b = this.directByPair.get(pair)) != null ? _b : 0;
      const paid = paidFromFunds + paidDirect;
      const clearing = Math.max(0, (_c = this.clearingByPair.get(pair)) != null ? _c : 0);
      const account = {
        studentId: enrollment.studentId,
        activityId: activity.id,
        activityName: activity.name,
        kind: activity.kind,
        enrollmentStatus: enrollment.status,
        costCents: enrollment.costCents,
        paidFromFundsCents: paidFromFunds,
        paidDirectCents: paidDirect,
        paidCents: paid,
        pendingRedemptionCents: (_d = this.pendingByPair.get(pair)) != null ? _d : 0,
        pendingPaymentCents: clearing,
        remainingCents: Math.max(0, enrollment.costCents - paid - clearing),
        allowFunds: activity.allowFunds,
        allowOnlinePayment: activity.allowOnlinePayment,
        activityOpen: activity.status === "Open"
      };
      if (activity.dueDate) account.dueDate = activity.dueDate;
      if (activity.depositCents) account.depositCents = activity.depositCents;
      if (activity.depositDueDate) account.depositDueDate = activity.depositDueDate;
      return account;
    }
  };
  function computeBooks(input) {
    return new Books(input);
  }

  // src/server/push-subscription.ts
  var PUSH_SERVICE_HOSTS = [
    "fcm.googleapis.com",
    // Chrome, Edge (Chromium) and Android
    "updates.push.services.mozilla.com",
    // Firefox
    "web.push.apple.com"
    // Safari and iPhone/iPad Home Screen apps
  ];
  var PUSH_SERVICE_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];
  var MAX_ENDPOINT_CHARS = 2048;
  var MAX_P256DH_CHARS = 88;
  var MAX_AUTH_CHARS = 24;
  var P256_POINT_BYTES = 65;
  var AUTH_SECRET_BYTES = 16;
  var MAX_SUBSCRIPTION_JSON_CHARS = 4096;
  var ENDPOINT_RE = /^https:\/\/([A-Za-z0-9.-]+)([/?#][\x21-\x5b\x5d-\x7e]*)?$/;
  var HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
  var B64URL2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function b64Value(code) {
    if (code >= 65 && code <= 90) return code - 65;
    if (code >= 97 && code <= 122) return code - 71;
    if (code >= 48 && code <= 57) return code + 4;
    if (code === 45 || code === 43) return 62;
    if (code === 47 || code === 95) return 63;
    return -1;
  }
  function decodeBase64UrlBytes(input) {
    let end = input.length;
    while (end > 0 && input.length - end < 2 && input.charCodeAt(end - 1) === 61) end--;
    if (end % 4 === 1) return null;
    const out = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < end; i++) {
      const v = b64Value(input.charCodeAt(i));
      if (v < 0) return null;
      buffer = (buffer << 6 | v) & 16777215;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push(buffer >> bits & 255);
      }
    }
    return out;
  }
  function encodeBase64UrlBytes(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i] & 255;
      const b1 = i + 1 < bytes.length ? bytes[i + 1] & 255 : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] & 255 : 0;
      const n = b0 << 16 | b1 << 8 | b2;
      out += B64URL2[n >> 18 & 63] + B64URL2[n >> 12 & 63];
      if (i + 1 < bytes.length) out += B64URL2[n >> 6 & 63];
      if (i + 2 < bytes.length) out += B64URL2[n & 63];
    }
    return out;
  }
  function canonicalP256Key(value) {
    if (typeof value !== "string") return null;
    const text2 = value.trim();
    if (text2.length === 0 || text2.length > MAX_P256DH_CHARS) return null;
    const bytes = decodeBase64UrlBytes(text2);
    if (!bytes || bytes.length !== P256_POINT_BYTES || bytes[0] !== 4) return null;
    return encodeBase64UrlBytes(bytes);
  }
  function canonicalAuthSecret(value) {
    if (typeof value !== "string") return null;
    const text2 = value.trim();
    if (text2.length === 0 || text2.length > MAX_AUTH_CHARS) return null;
    const bytes = decodeBase64UrlBytes(text2);
    if (!bytes || bytes.length !== AUTH_SECRET_BYTES) return null;
    return encodeBase64UrlBytes(bytes);
  }
  function isPushServiceHost(host) {
    const h = host.toLowerCase();
    if (!HOST_RE.test(h)) return false;
    return PUSH_SERVICE_HOSTS.includes(h) || PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
  }
  function checkEndpoint(value) {
    var _a;
    if (typeof value !== "string") return { ok: false, problem: "endpoint" };
    const text2 = value.trim();
    if (text2.length > MAX_ENDPOINT_CHARS) return { ok: false, problem: "endpoint" };
    const m = ENDPOINT_RE.exec(text2);
    if (!m) return { ok: false, problem: "endpoint" };
    const host = m[1].toLowerCase();
    if (!isPushServiceHost(host)) return { ok: false, problem: "push_service" };
    return { ok: true, endpoint: `https://${host}${(_a = m[2]) != null ? _a : ""}` };
  }
  function canonicalEndpoint(value) {
    const result = checkEndpoint(value);
    return result.ok ? result.endpoint : null;
  }
  function parseJsonObject(value) {
    if (isRecord(value)) return value;
    if (typeof value !== "string") return null;
    const text2 = value.trim();
    if (!text2.startsWith("{") || text2.length > MAX_SUBSCRIPTION_JSON_CHARS) return null;
    try {
      const parsed = JSON.parse(text2);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  function parseSubscription(value) {
    const data = parseJsonObject(value);
    if (!data) return { ok: false, problem: "format" };
    const endpoint = checkEndpoint(data.endpoint);
    if (!endpoint.ok) return { ok: false, problem: endpoint.problem };
    const keys = data.keys;
    if (!isRecord(keys)) return { ok: false, problem: "keys" };
    const p256dh = canonicalP256Key(keys.p256dh);
    const auth = canonicalAuthSecret(keys.auth);
    if (!p256dh || !auth) return { ok: false, problem: "keys" };
    return { ok: true, subscription: { endpoint: endpoint.endpoint, keys: { p256dh, auth } } };
  }
  function toSubscription(value) {
    const result = parseSubscription(value);
    return result.ok ? result.subscription : null;
  }
  function subscriptionToken(subscription) {
    return JSON.stringify({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }
    });
  }
  function subscriptionEndpoint(value) {
    const data = parseJsonObject(value);
    return data ? canonicalEndpoint(data.endpoint) : null;
  }

  // src/server/settings.ts
  var SETTING_NOTES = {
    ORG_NAME: "Shown in the app, in emails and on PayPal checkout.",
    SUPPORT_EMAIL: "Where families can reach TMA with questions.",
    APP_URL: "Web address of the TMA app (used for the button in emails): https://mytma.org/",
    ADMIN_EMAILS: "Comma-separated emails of board members who can approve requests and send announcements in the app.",
    SCHOOLS: "Comma-separated school levels families can pick.",
    ENSEMBLES: "Comma-separated groups families can pick.",
    FEE_PERCENT: 'PayPal percentage fee used for the optional "cover the fee" add-on (1.99 = confirmed 501(c)(3) charity rate).',
    FEE_FIXED: "PayPal fixed fee per payment, in dollars.",
    FEE_COVER_DEFAULT: 'TRUE = the "cover the processing fee" box starts checked.',
    ONLINE_PAYMENTS: "TRUE lets families pay online (also needs PAYPAL_CLIENT_ID here and PAYPAL_SECRET in Script Properties).",
    PAYPAL_ENV: "sandbox while testing, live for real payments.",
    PAYPAL_CLIENT_ID: "PayPal REST app client ID (public, not secret).",
    MIN_PAYMENT: "Smallest online payment, in dollars.",
    OTHER_PAYMENT_INSTRUCTIONS: 'Shown to families under "Other ways to pay".',
    DONATE_URL: "Link for general donations to TMA.",
    PRIVACY_NOTE: "Shown in the app under More > Privacy.",
    REMINDER_DAYS: "Send payment reminders this many days before a due date (comma-separated).",
    EMAIL_ENABLED: "TRUE sends email notifications to families who chose email.",
    EMAIL_VIA: "cloudflare = send as noreply@mytma.org through the TMA Worker (falls back to Gmail if that fails); gmail = always send from the Google account that runs the script",
    SMS_ENABLED: "TRUE sends text messages to families who chose texts (needs Twilio; about 1 cent per text).",
    PUSH_RELAY_URL: "Web address of the TMA push Worker on Cloudflare. Leave the default unless TMA moves it.",
    TOKEN_VERSION: "Change this number to sign everyone out of the app.",
    SESSION_DAYS: "How many days a sign-in lasts.",
    NEW_SIGNUPS_PER_HOUR: "Sign-in codes per hour, across everyone, to emails TMA has not verified yet (new families). Raise it for a launch day."
  };
  function settingKey(value) {
    return str(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }
  function parsePaypalEnv(value) {
    return /^(live|production|prod)$/i.test(String(value != null ? value : "").trim()) ? "live" : "sandbox";
  }
  function clampNumber(value, min, max, fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }
  function readSettingValues(rows) {
    const values = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const key = settingKey(row.data.Key);
      if (key) values.set(key, str(row.data.Value));
    }
    return values;
  }
  function buildSettings(rows, services) {
    var _a, _b;
    const values = readSettingValues(rows);
    const get = (key) => {
      const v = values.get(key);
      return v === void 0 || v === "" ? SETTING_DEFAULTS[key] : v;
    };
    const bool2 = (key) => parseBool(get(key), parseBool(SETTING_DEFAULTS[key], false));
    const list2 = (key) => {
      const items = uniqueBy(splitList(get(key), /[,;\n\r]+/), (s) => s.toLowerCase());
      return items.length > 0 ? items : splitList(SETTING_DEFAULTS[key], /,/);
    };
    const safely3 = (fn) => {
      try {
        return fn();
      } catch (err) {
        services.logger.error("Port enabled() check failed", err);
        return false;
      }
    };
    const pushPublicKey = () => {
      var _a2;
      if (!safely3(() => services.push.enabled())) return "";
      try {
        return (_a2 = canonicalP256Key(services.push.publicKey())) != null ? _a2 : "";
      } catch (err) {
        services.logger.error("Push public key lookup failed", err);
        return "";
      }
    };
    const paypalClientId = get("PAYPAL_CLIENT_ID").trim();
    const onlinePaymentsSetting = bool2("ONLINE_PAYMENTS");
    const smsSetting = bool2("SMS_ENABLED");
    const supportEmail = normEmail(get("SUPPORT_EMAIL"));
    const minPayment = dollarsToCents(get("MIN_PAYMENT"));
    const pub = {
      orgName: get("ORG_NAME"),
      supportEmail: isEmail(supportEmail) ? supportEmail : SETTING_DEFAULTS.SUPPORT_EMAIL,
      appUrl: (_a = safeUrl(get("APP_URL"))) != null ? _a : "",
      schools: list2("SCHOOLS"),
      ensembles: list2("ENSEMBLES"),
      feePercent: clampNumber(parseFloat(get("FEE_PERCENT")), 0, 20, parseFloat(SETTING_DEFAULTS.FEE_PERCENT)),
      feeFixedCents: clampNumber(dollarsToCents(get("FEE_FIXED")), 0, 1e3, 49),
      feeCoverDefault: bool2("FEE_COVER_DEFAULT"),
      onlinePaymentsEnabled: onlinePaymentsSetting && paypalClientId !== "" && safely3(() => services.payments.enabled()),
      paypalClientId,
      paypalEnv: parsePaypalEnv(get("PAYPAL_ENV")),
      minPaymentCents: minPayment > 0 ? Math.min(minPayment, 1e5) : 500,
      otherPaymentInstructions: get("OTHER_PAYMENT_INSTRUCTIONS"),
      donateUrl: (_b = safeUrl(get("DONATE_URL"))) != null ? _b : "",
      privacyNote: get("PRIVACY_NOTE"),
      smsEnabled: smsSetting && safely3(() => services.sms.enabled()),
      pushPublicKey: pushPublicKey()
    };
    const reminderDays = unique(
      splitList(get("REMINDER_DAYS"), /[,;\s]+/).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365).map(String)
    ).map(Number).sort((a, b) => b - a);
    const sessionDays = Math.round(Number(get("SESSION_DAYS")));
    const newSignups = Math.round(Number(get("NEW_SIGNUPS_PER_HOUR")));
    return {
      pub,
      adminEmails: unique(splitList(get("ADMIN_EMAILS"), /[,;\s]+/).map(normEmail).filter(isEmail)),
      reminderDays,
      emailEnabled: bool2("EMAIL_ENABLED"),
      smsSetting,
      onlinePaymentsSetting,
      tokenVersion: get("TOKEN_VERSION").trim().replace(/\.0+$/, "") || "1",
      sessionDays: Number.isFinite(sessionDays) && sessionDays >= 1 && sessionDays <= 400 ? sessionDays : 120,
      newSignupsPerHour: Number.isFinite(newSignups) && newSignups >= 1 && newSignups <= 500 ? newSignups : Number(SETTING_DEFAULTS.NEW_SIGNUPS_PER_HOUR)
    };
  }

  // src/server/data.ts
  function recordStatus(value, fallback) {
    const s = lettersOnly(str(value));
    if (!s) return fallback;
    if (s === "active" || s === "verified" || s === "approved") return "Active";
    if (s === "pending" || s === "new" || s === "review") return "Pending";
    if (["inactive", "archived", "merged", "rejected", "graduated", "left", "closed", "removed"].includes(s)) {
      return "Inactive";
    }
    return fallback;
  }
  function enrollmentStatus(value) {
    const s = lettersOnly(str(value));
    if (!s) return "Going";
    if (s.startsWith("wait")) return "Waitlist";
    if (["withdrawn", "withdrew", "withdraw", "cancelled", "canceled", "notgoing", "dropped", "no"].includes(s)) {
      return "Withdrawn";
    }
    return "Going";
  }
  function activityKind(value) {
    const s = lettersOnly(str(value));
    if (s.includes("trip") || s === "travel") return "Trip";
    if (s.includes("lesson")) return "Lessons";
    if (s.includes("camp")) return "Camp";
    return "Other";
  }
  function paymentMethod(value) {
    const s = lettersOnly(str(value));
    if (s.includes("paypal")) return "PayPal";
    if (s.includes("venmo")) return "Venmo";
    if (s.startsWith("check") || s.startsWith("cheque") || s.startsWith("chk")) return "Check";
    if (s.startsWith("cash")) return "Cash";
    if (/card|credit|debit|visa|mastercard|amex|discover/.test(s)) return "Card";
    return "Other";
  }
  function paymentStatus(value) {
    const s = lettersOnly(str(value));
    if (!s) return "Completed";
    if (s.startsWith("pend")) return "Pending";
    if (s.startsWith("refund")) return "Refunded";
    if (/^(fail|declin|void|cancel|bounce|reject)/.test(s)) return "Failed";
    return "Completed";
  }
  function redemptionStatus(value) {
    const s = lettersOnly(str(value));
    if (!s) return "Pending";
    if (s.startsWith("approv") || s === "yes" || s === "ok" || s === "posted") return "Approved";
    if (s.startsWith("den") || s.startsWith("declin") || s.startsWith("reject") || s === "no") return "Denied";
    if (s.startsWith("cancel") || s.startsWith("withdr")) return "Cancelled";
    return "Pending";
  }
  function guardian(name, email2, phone) {
    const g = { name: str(name), email: normEmail(email2) };
    const p = str(phone);
    if (p) g.phone = p;
    return g;
  }
  function mapFamily(row) {
    const d = row.data;
    const id2 = str(d.FamilyID);
    if (!id2) return null;
    const slots = [
      guardian(d["Parent Name"], d.Email, d.Phone),
      guardian(d["Parent 2 Name"], d["Parent 2 Email"], d["Parent 2 Phone"])
    ];
    const family = {
      row: row.rowNumber,
      id: id2,
      guardians: slots.filter((g) => g.name !== "" || g.email !== "").map((g) => ({ ...g })),
      slots,
      status: recordStatus(d.Status, "Active"),
      member: parseBool(d.Member, false)
    };
    const created = parseTimestamp(d.Created);
    if (created) family.createdAt = created;
    return family;
  }
  function mapStudent(row, settings, resolve) {
    const d = row.data;
    const id2 = str(d.StudentID);
    if (!id2) return null;
    const familyId = str(d.FamilyID);
    const student2 = {
      row: row.rowNumber,
      id: id2,
      familyId: familyId ? resolve.family(familyId) : null,
      firstName: str(d["First Name"]),
      lastName: str(d["Last Name"]),
      grade: normalizeGrade(d.Grade),
      school: canonical(str(d.School), settings.pub.schools),
      ensembles: parseList(d.Ensembles, settings.pub.ensembles),
      status: recordStatus(d.Status, "Active")
    };
    const instrument = str(d.Instrument);
    if (instrument) student2.instrument = instrument;
    return student2;
  }
  function mapActivity(row, settings) {
    const d = row.data;
    const id2 = str(d.ActivityID);
    if (!id2) return null;
    const activity = {
      row: row.rowNumber,
      id: id2,
      name: str(d.Name) || id2,
      description: str(d.Description),
      kind: activityKind(d.Kind),
      ensembles: parseList(d.Ensembles, settings.pub.ensembles),
      schools: parseList(d.Schools, settings.pub.schools),
      costCents: Math.max(0, dollarsToCents(d.Cost)),
      status: /^(closed?|no|false|inactive|archived|done|completed?|cancell?ed)$/i.test(str(d.Status)) ? "Closed" : "Open",
      allowFunds: parseBool(d["Allow Funds"], true),
      allowOnlinePayment: parseBool(d["Allow Online Payment"], true)
    };
    const due = parseDate(d["Due Date"]);
    if (due) activity.dueDate = due;
    const deposit = dollarsToCents(d.Deposit);
    if (deposit > 0) activity.depositCents = deposit;
    const depositDue = parseDate(d["Deposit Due"]);
    if (depositDue) activity.depositDueDate = depositDue;
    const info = safeUrl(d["Info URL"]);
    if (info) activity.infoUrl = info;
    return activity;
  }
  function mapEnrollment(row, resolve, activityCost) {
    const d = row.data;
    const studentId = str(d.StudentID);
    const activityId = str(d.ActivityID);
    if (!studentId || !activityId) return null;
    const canonicalActivity = resolve.activity(activityId);
    const override = str(d.Cost);
    return {
      row: row.rowNumber,
      studentId: resolve.student(studentId),
      activityId: canonicalActivity,
      costCents: override ? Math.max(0, dollarsToCents(d.Cost)) : activityCost(canonicalActivity),
      status: enrollmentStatus(d.Status)
    };
  }
  function mapLedger(row, resolve) {
    var _a;
    const d = row.data;
    const studentId = str(d.StudentID);
    const amountCents = dollarsToCents(d.Amount);
    if (!studentId || amountCents === 0) return null;
    const reference = str(d.Reference);
    const entry = {
      row: row.rowNumber,
      id: reference || `L${row.rowNumber}`,
      date: (_a = parseDate(d.Date)) != null ? _a : "",
      studentId: resolve.student(studentId),
      type: str(d.Type) || (amountCents > 0 ? "Credit" : "Adjustment"),
      description: str(d.Description),
      amountCents
    };
    const activityId = str(d.ActivityID);
    if (activityId) entry.activityId = resolve.activity(activityId);
    if (reference) entry.reference = reference;
    return entry;
  }
  function mapPayment(row, resolve) {
    var _a;
    const d = row.data;
    const studentId = str(d.StudentID);
    const amountCents = dollarsToCents(d.Amount);
    if (!studentId || amountCents === 0) return null;
    const reference = str(d.Reference);
    const feeCents = Math.max(0, dollarsToCents(d["Fee Covered"]));
    const grossTyped = dollarsToCents(d.Gross);
    const activityId = str(d.ActivityID);
    const payment = {
      row: row.rowNumber,
      reference,
      id: reference || `P${row.rowNumber}`,
      date: (_a = parseDate(d.Date)) != null ? _a : "",
      studentId: resolve.student(studentId),
      activityId: activityId ? resolve.activity(activityId) : "",
      amountCents,
      feeCents,
      grossCents: grossTyped !== 0 ? grossTyped : amountCents + feeCents,
      method: paymentMethod(d.Method),
      status: paymentStatus(d.Status)
    };
    const payer = normEmail(d["Payer Email"]);
    if (payer) payment.payerEmail = payer;
    return payment;
  }
  function mapRedemption(row, resolve) {
    var _a, _b;
    const d = row.data;
    const id2 = str(d.RequestID);
    if (!id2) return null;
    const familyId = str(d.FamilyID);
    const r = {
      row: row.rowNumber,
      id: id2,
      requestedAt: (_a = parseTimestamp(d.Requested)) != null ? _a : "",
      email: normEmail(d.Email),
      familyId: familyId ? resolve.family(familyId) : "",
      studentId: resolve.student(str(d.StudentID)),
      activityId: resolve.activity(str(d.ActivityID)),
      amountCents: Math.max(0, dollarsToCents(d.Amount)),
      status: redemptionStatus(d.Status)
    };
    const note = str(d.Note);
    if (note) r.note = note;
    const decidedAt = parseTimestamp(d.Decided);
    if (decidedAt) r.decidedAt = decidedAt;
    const decidedBy = str(d["Decided By"]);
    if (decidedBy) r.decidedBy = decidedBy;
    const adminNote = str(d["Admin Note"]);
    if (adminNote) r.adminNote = adminNote;
    if (str(d.Notified)) r.notifiedAt = (_b = parseTimestamp(d.Notified)) != null ? _b : str(d.Notified);
    return r;
  }
  function mapAnnouncement(row, settings) {
    var _a, _b;
    const d = row.data;
    const title = str(d.Title);
    const body = str(d.Body);
    if (!title && !body) return null;
    const storedId = str(d.ID);
    const sentAt = parseTimestamp(d.Sent);
    const a = {
      row: row.rowNumber,
      storedId,
      id: storedId || `A${row.rowNumber}`,
      date: (_b = parseDate(d.Date)) != null ? _b : sentAt ? (_a = parseDate(sentAt)) != null ? _a : "" : "",
      title: title || "TMA update",
      body,
      audience: {
        schools: parseList(d.Schools, settings.pub.schools),
        ensembles: parseList(d.Ensembles, settings.pub.ensembles)
      },
      sent: str(d.Sent) !== ""
    };
    const link = safeUrl(d.Link);
    if (link) a.link = link;
    if (sentAt) a.sentAt = sentAt;
    return a;
  }
  function mapEvent(row, settings) {
    const d = row.data;
    const title = str(d.Title);
    const date = parseDate(d.Date);
    if (!title || !date) return null;
    const storedId = str(d.ID);
    const slug = lettersOnly(title).slice(0, 24);
    const e = {
      row: row.rowNumber,
      id: storedId || `E-${date}-${slug}`,
      date,
      title,
      audience: {
        schools: parseList(d.Schools, settings.pub.schools),
        ensembles: parseList(d.Ensembles, settings.pub.ensembles)
      }
    };
    const time = parseTimeText(d.Time);
    if (time) e.time = time;
    const location = str(d.Location);
    if (location) e.location = location;
    const details = str(d.Details);
    if (details) e.details = details;
    return e;
  }
  function toFamily(f) {
    const out = {
      id: f.id,
      guardians: f.guardians.map((g) => ({ ...g })),
      status: f.status,
      member: f.member
    };
    if (f.createdAt) out.createdAt = f.createdAt;
    return out;
  }
  function toStudent(s) {
    const out = {
      id: s.id,
      familyId: s.familyId,
      firstName: s.firstName,
      lastName: s.lastName,
      grade: s.grade,
      school: s.school,
      ensembles: s.ensembles.slice(),
      status: s.status
    };
    if (s.instrument) out.instrument = s.instrument;
    return out;
  }
  function toActivity(a) {
    const out = {
      id: a.id,
      name: a.name,
      description: a.description,
      kind: a.kind,
      ensembles: a.ensembles.slice(),
      schools: a.schools.slice(),
      costCents: a.costCents,
      status: a.status,
      allowFunds: a.allowFunds,
      allowOnlinePayment: a.allowOnlinePayment
    };
    if (a.dueDate) out.dueDate = a.dueDate;
    if (a.depositCents) out.depositCents = a.depositCents;
    if (a.depositDueDate) out.depositDueDate = a.depositDueDate;
    if (a.infoUrl) out.infoUrl = a.infoUrl;
    return out;
  }
  function toLedgerEntry(l) {
    const out = {
      id: l.id,
      date: l.date,
      studentId: l.studentId,
      type: l.type,
      description: l.description,
      amountCents: l.amountCents
    };
    if (l.activityId) out.activityId = l.activityId;
    if (l.reference) out.reference = l.reference;
    return out;
  }
  function toPayment(p) {
    const out = {
      id: p.id,
      date: p.date,
      studentId: p.studentId,
      activityId: p.activityId,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      grossCents: p.grossCents,
      method: p.method,
      status: p.status
    };
    if (p.payerEmail) out.payerEmail = p.payerEmail;
    return out;
  }
  function toRedemption(r) {
    const out = {
      id: r.id,
      requestedAt: r.requestedAt,
      email: r.email,
      familyId: r.familyId,
      studentId: r.studentId,
      activityId: r.activityId,
      amountCents: r.amountCents,
      status: r.status
    };
    if (r.note) out.note = r.note;
    if (r.decidedAt) out.decidedAt = r.decidedAt;
    if (r.decidedBy) out.decidedBy = r.decidedBy;
    if (r.adminNote) out.adminNote = r.adminNote;
    return out;
  }
  function toAnnouncement(a) {
    const out = {
      id: a.id,
      date: a.date,
      title: a.title,
      body: a.body,
      audience: { schools: a.audience.schools.slice(), ensembles: a.audience.ensembles.slice() }
    };
    if (a.link) out.link = a.link;
    if (a.sentAt) out.sentAt = a.sentAt;
    return out;
  }
  function toEvent(e) {
    const out = {
      id: e.id,
      date: e.date,
      title: e.title,
      audience: { schools: e.audience.schools.slice(), ensembles: e.audience.ensembles.slice() }
    };
    if (e.time) out.time = e.time;
    if (e.location) out.location = e.location;
    if (e.details) out.details = e.details;
    return out;
  }
  function studentName(s) {
    return `${s.firstName} ${s.lastName}`.trim();
  }
  var PEOPLE = ["Families", "Students", "Settings"];
  var CATALOG = ["Activities", "Settings"];
  var REFS = [...PEOPLE, "Activities"];
  var STATUS_RANK = { Active: 0, Pending: 1, Inactive: 2 };
  var Model = class {
    constructor(services, db) {
      this.services = services;
      this.db = db;
      __publicField(this, "memos", /* @__PURE__ */ new Map());
    }
    /** Memoize `build` until one of `deps` is written. */
    memo(name, deps, build) {
      const key = deps.map((t) => this.db.version(t)).join("|");
      const hit = this.memos.get(name);
      if (hit && hit.key === key) return hit.value;
      const value = build();
      this.memos.set(name, { key, value });
      return value;
    }
    parse(table, map) {
      const out = [];
      for (const row of this.db.rows(table)) {
        const rec = map(row);
        if (rec) out.push(rec);
      }
      return out;
    }
    settings() {
      return this.memo("settings", ["Settings"], () => buildSettings(this.db.rows("Settings"), this.services));
    }
    // Families ---------------------------------------------------------------
    families() {
      return this.memo("families", ["Families"], () => this.parse("Families", mapFamily));
    }
    familyIndex() {
      return this.memo("familyIndex", ["Families"], () => {
        const index = /* @__PURE__ */ new Map();
        for (const f of this.families()) if (!index.has(idKey(f.id))) index.set(idKey(f.id), f);
        return index;
      });
    }
    familyById(id2) {
      var _a;
      return id2 ? (_a = this.familyIndex().get(idKey(id2))) != null ? _a : null : null;
    }
    /** Families listing `email` as a guardian, best status first (Active, Pending, Inactive), then sheet order. */
    familiesWithEmail(email2) {
      var _a;
      const byEmail = this.memo("familiesByEmail", ["Families"], () => {
        var _a2;
        const index = /* @__PURE__ */ new Map();
        for (const f of this.families()) {
          for (const g of f.guardians) {
            if (!g.email) continue;
            const list2 = (_a2 = index.get(g.email)) != null ? _a2 : [];
            if (!list2.includes(f)) list2.push(f);
            index.set(g.email, list2);
          }
        }
        index.forEach((list2) => list2.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.row - b.row));
        return index;
      });
      return ((_a = byEmail.get(normEmail(email2))) != null ? _a : []).slice();
    }
    /**
     * The caller's household (Inactive only when it is the sole match). An Inactive household counts
     * only for its first guardian: anyone can type an email into the second-guardian slot, so a
     * rejected household must not lock that email's owner out of signing up with their own.
     */
    familyForEmail(email2) {
      var _a;
      const key = normEmail(email2);
      return (_a = this.familiesWithEmail(key).find((f) => f.status !== "Inactive" || f.slots[0].email === key)) != null ? _a : null;
    }
    // Students ---------------------------------------------------------------
    students() {
      return this.memo("students", PEOPLE, () => {
        const settings = this.settings();
        const resolve = { family: (id2) => {
          var _a, _b;
          return (_b = (_a = this.familyById(id2)) == null ? void 0 : _a.id) != null ? _b : id2;
        } };
        const out = [];
        for (const row of this.db.rows("Students")) {
          const s = mapStudent(row, settings, resolve);
          if (s) out.push(s);
          else if (str(row.data["First Name"]) || str(row.data["Last Name"])) {
            this.services.logger.info(`Students row ${row.rowNumber} has no StudentID; ignored`);
          }
        }
        return out;
      });
    }
    studentIndex() {
      return this.memo("studentIndex", PEOPLE, () => {
        const index = /* @__PURE__ */ new Map();
        for (const s of this.students()) if (!index.has(idKey(s.id))) index.set(idKey(s.id), s);
        return index;
      });
    }
    studentById(id2) {
      var _a;
      return id2 ? (_a = this.studentIndex().get(idKey(id2))) != null ? _a : null : null;
    }
    /** Students linked to a family (Inactive ones only when asked). */
    studentsOfFamily(familyId, includeInactive = false) {
      var _a;
      const byFamily = this.memo("studentsByFamily", PEOPLE, () => {
        var _a2;
        const index = /* @__PURE__ */ new Map();
        for (const s of this.students()) {
          if (s.familyId === null) continue;
          const list2 = (_a2 = index.get(idKey(s.familyId))) != null ? _a2 : [];
          list2.push(s);
          index.set(idKey(s.familyId), list2);
        }
        return index;
      });
      const all = (_a = byFamily.get(idKey(familyId))) != null ? _a : [];
      return includeInactive ? all.slice() : all.filter((s) => s.status !== "Inactive");
    }
    /** Verified = family Active and student Active (money is only shown/notified then). */
    isVerified(student2) {
      var _a;
      if (student2.status !== "Active") return false;
      return ((_a = this.familyById(student2.familyId)) == null ? void 0 : _a.status) === "Active";
    }
    // Activities ---------------------------------------------------------------
    activities() {
      return this.memo("activities", CATALOG, () => {
        const settings = this.settings();
        return this.parse("Activities", (row) => mapActivity(row, settings));
      });
    }
    activityById(id2) {
      var _a;
      if (!id2) return null;
      const index = this.memo("activityIndex", CATALOG, () => {
        const map = /* @__PURE__ */ new Map();
        for (const a of this.activities()) if (!map.has(idKey(a.id))) map.set(idKey(a.id), a);
        return map;
      });
      return (_a = index.get(idKey(id2))) != null ? _a : null;
    }
    resolver() {
      return {
        student: (id2) => {
          var _a, _b;
          return (_b = (_a = this.studentById(id2)) == null ? void 0 : _a.id) != null ? _b : id2;
        },
        activity: (id2) => {
          var _a, _b;
          return (_b = (_a = this.activityById(id2)) == null ? void 0 : _a.id) != null ? _b : id2;
        },
        family: (id2) => {
          var _a, _b;
          return (_b = (_a = this.familyById(id2)) == null ? void 0 : _a.id) != null ? _b : id2;
        }
      };
    }
    // Money tabs -----------------------------------------------------------------
    enrollments() {
      return this.memo("enrollments", [...REFS, "Enrollments"], () => {
        const resolve = this.resolver();
        const cost = (activityId) => {
          var _a, _b;
          return (_b = (_a = this.activityById(activityId)) == null ? void 0 : _a.costCents) != null ? _b : 0;
        };
        return this.parse("Enrollments", (row) => mapEnrollment(row, resolve, cost));
      });
    }
    ledger() {
      return this.memo("ledger", [...REFS, "Ledger"], () => {
        const resolve = this.resolver();
        return this.parse("Ledger", (row) => mapLedger(row, resolve));
      });
    }
    payments() {
      return this.memo("payments", [...REFS, "Payments"], () => {
        const resolve = this.resolver();
        return this.parse("Payments", (row) => mapPayment(row, resolve));
      });
    }
    redemptions() {
      return this.memo("redemptions", [...REFS, "Redemptions"], () => {
        const resolve = this.resolver();
        return this.parse("Redemptions", (row) => mapRedemption(row, resolve));
      });
    }
    redemptionById(id2) {
      var _a;
      const key = idKey(id2);
      return (_a = this.redemptions().find((r) => idKey(r.id) === key)) != null ? _a : null;
    }
    books() {
      return this.memo(
        "books",
        [...REFS, "Enrollments", "Ledger", "Payments", "Redemptions"],
        () => computeBooks({
          ledger: this.ledger(),
          payments: this.payments(),
          redemptions: this.redemptions(),
          enrollments: this.enrollments(),
          activities: this.activities()
        })
      );
    }
    // News -----------------------------------------------------------------------
    announcements() {
      return this.memo("announcements", ["Announcements", "Settings"], () => {
        const settings = this.settings();
        return this.parse("Announcements", (row) => mapAnnouncement(row, settings));
      });
    }
    events() {
      return this.memo("events", ["Events", "Settings"], () => {
        const settings = this.settings();
        return this.parse("Events", (row) => mapEvent(row, settings));
      });
    }
    // App-managed tabs -----------------------------------------------------------
    /** Stored notification prefs by email (last row wins). */
    preferences() {
      return this.memo("preferences", ["Preferences"], () => {
        const map = /* @__PURE__ */ new Map();
        for (const row of this.db.rows("Preferences")) {
          const email2 = normEmail(row.data.Email);
          if (!isEmail(email2)) continue;
          map.set(email2, { row: row.rowNumber, email: email2, familyId: str(row.data.FamilyID), json: str(row.data.Prefs) });
        }
        return map;
      });
    }
    devices() {
      return this.memo(
        "devices",
        ["Devices"],
        () => this.parse("Devices", (row) => {
          const token = str(row.data.Token);
          if (!token) return null;
          const device = {
            row: row.rowNumber,
            email: normEmail(row.data.Email),
            familyId: str(row.data.FamilyID),
            token,
            userAgent: str(row.data["User Agent"])
          };
          const created = parseTimestamp(row.data.Created);
          if (created) device.createdAt = created;
          const seen = parseTimestamp(row.data["Last Seen"]);
          if (seen) device.lastSeen = seen;
          return device;
        })
      );
    }
    devicesFor(email2) {
      const key = normEmail(email2);
      return key ? this.devices().filter((d) => d.email === key) : [];
    }
    logEntries() {
      return this.memo(
        "log",
        ["Log"],
        () => this.parse("Log", (row) => {
          var _a;
          const kind = str(row.data.Kind);
          const detail = str(row.data.Detail);
          if (!kind && !detail) return null;
          return { row: row.rowNumber, at: (_a = parseTimestamp(row.data.At)) != null ? _a : "", kind, detail };
        })
      );
    }
    /** Last balances the sync saw, by idKey(StudentID). */
    snapshot() {
      return this.memo("snapshot", ["_Snapshot"], () => {
        const map = /* @__PURE__ */ new Map();
        for (const row of this.db.rows("_Snapshot")) {
          const studentId = str(row.data.StudentID);
          if (!studentId) continue;
          map.set(idKey(studentId), { row: row.rowNumber, studentId, balanceCents: dollarsToCents(row.data.Balance) });
        }
        return map;
      });
    }
    sentKeys() {
      return this.memo("sent", ["_Sent"], () => {
        const keys = /* @__PURE__ */ new Set();
        for (const row of this.db.rows("_Sent")) {
          const key = str(row.data.Key);
          if (key) keys.add(key);
        }
        return keys;
      });
    }
  };

  // src/server/messages.ts
  var MINUS = "−";
  function creditNotice(firstName, deltaCents, balanceCents, studentId) {
    return {
      topic: "balance",
      title: `+${formatCents(deltaCents)} for ${firstName}`,
      body: `${formatCents(deltaCents)} was added to ${firstName}'s TMA activity funds. New balance: ${formatCents(balanceCents)}.`,
      url: "#/funds",
      tag: `bal-${studentId}`
    };
  }
  function debitNotice(firstName, deltaCents, balanceCents, studentId) {
    return {
      topic: "balance",
      title: `${firstName}'s activity funds changed`,
      body: `${MINUS}${formatCents(Math.abs(deltaCents))} adjustment. New balance: ${formatCents(balanceCents)}.`,
      url: "#/funds",
      tag: `bal-${studentId}`
    };
  }
  function redemptionApprovedNotice(firstName, amountCents, activityName, remainingCents, requestId) {
    return {
      topic: "payments",
      title: `Funds applied to ${activityName}`,
      body: `${formatCents(amountCents)} of ${firstName}'s activity funds was applied to ${activityName}. Remaining: ${formatCents(remainingCents)}.`,
      url: "#/trips",
      tag: `red-${requestId}`
    };
  }
  function redemptionDeniedNotice(amountCents, activityName, adminNote, requestId) {
    const note = adminNote ? ` Note: ${adminNote}` : "";
    return {
      topic: "payments",
      title: "Funds request not approved",
      body: `Your request to apply ${formatCents(amountCents)} to ${activityName} was not approved.${note}`,
      url: "#/trips",
      tag: `red-${requestId}`
    };
  }
  function paymentReceivedNotice(firstName, amountCents, activityName, remainingCents, paymentId) {
    return {
      topic: "payments",
      title: "Payment received – thank you!",
      body: `${formatCents(amountCents)} toward ${activityName} for ${firstName}. Remaining: ${formatCents(remainingCents)}.`,
      url: "#/trips",
      tag: `pay-${paymentId}`
    };
  }
  function paymentReminderNotice(opts) {
    const when = opts.days === 0 ? "today" : `in ${plural(opts.days, "day")}`;
    const how = opts.allowFunds && opts.allowOnline ? "Use activity funds or pay online in the app." : opts.allowFunds ? "You can use activity funds in the app." : opts.allowOnline ? "You can pay online in the app." : "See the app for ways to pay.";
    return {
      topic: "reminders",
      title: `${opts.activityName} payment due ${when}`,
      body: `${opts.firstName} has ${formatCents(opts.remainingCents)} left to pay by ${shortDate(opts.dueDate)}. ${how}`,
      url: "#/trips",
      tag: opts.tag
    };
  }
  function eventTomorrowNotice(event) {
    var _a;
    let body;
    if (event.time && event.location) body = `${event.time} at ${event.location}.`;
    else if (event.time) body = `${event.time}.`;
    else if (event.location) body = `At ${event.location}.`;
    else body = truncate((_a = event.details) != null ? _a : "", 180);
    return {
      topic: "announcements",
      title: `Tomorrow: ${event.title}`,
      body,
      url: "#/news",
      tag: `evt-${event.id}`,
      audience: event.audience
    };
  }
  function announcementNotice(a) {
    const notice = {
      topic: "announcements",
      title: a.title,
      body: a.body,
      pushBody: truncate(a.body.replace(/\s+/g, " "), 180),
      url: "#/news",
      tag: `ann-${a.id}`,
      audience: a.audience
    };
    if (a.link) notice.link = a.link;
    return notice;
  }
  function householdVerifiedNotice(familyId) {
    return {
      topic: "admin",
      title: "You're all set!",
      body: "TMA verified your household. You can now see activity funds and trips.",
      url: "#/",
      tag: `hh-${familyId}`
    };
  }
  function newSignupNotice(guardianNames2, studentCount, familyId) {
    return {
      topic: "admin",
      title: "New family signed up",
      body: `${guardianNames2} (${plural(studentCount, "student")}). Review in the app.`,
      url: "#/admin",
      tag: `signup-${familyId}`
    };
  }
  function newStudentsNotice(guardianNames2, studentNames, familyId) {
    return {
      topic: "admin",
      title: studentNames.length === 1 ? "New student to review" : "New students to review",
      body: `${guardianNames2} added ${studentNames.join(", ")}. Review in the app.`,
      url: "#/admin",
      tag: `signup-${familyId}`
    };
  }
  function fundsRequestNotice(parentName, amountCents, firstName, activityName, requestId) {
    return {
      topic: "admin",
      title: `Funds request: ${formatCents(amountCents)}`,
      body: `${parentName} asked to apply ${formatCents(amountCents)} from ${firstName}'s funds to ${activityName}.`,
      url: "#/admin",
      tag: `req-${requestId}`
    };
  }
  function paymentReviewNotice(firstName, activityName, reference) {
    return {
      topic: "admin",
      title: "Payment needs review",
      body: `A PayPal payment for ${firstName} (${activityName}) did not match the expected amount, so the app did not record it. Check PayPal capture ${reference} and add it to the Payments tab.`,
      url: "#/admin",
      tag: `payreview-${reference}`
    };
  }
  function paymentUnconfirmedNotice(firstName, activityName, grossCents, orderId) {
    return {
      topic: "admin",
      title: "Payment needs review",
      body: `PayPal did not confirm whether a ${formatCents(grossCents)} payment for ${firstName} (${activityName}) went through, so the app has not recorded it yet. The app asks PayPal again, and if it then records the payment you'll get a "Payment recorded" message. Otherwise look up PayPal order ${orderId}: if it was captured and the Payments tab has no row with its transaction ID, add one so the family isn't asked to pay again.`,
      url: "#/admin",
      tag: `payreview-${orderId}`
    };
  }
  function paymentRecordedAfterReviewNotice(firstName, activityName, grossCents, orderId, reference, pending) {
    return {
      topic: "admin",
      title: "Payment recorded",
      body: `The ${formatCents(grossCents)} PayPal payment for ${firstName} (${activityName}) that needed review (order ${orderId}) went through after all: the app recorded it in the Payments tab as ${reference}${pending ? " (Pending while PayPal finishes processing it)" : ""}. Don't add it by hand.`,
      url: "#/admin",
      tag: `payreview-${orderId}`
    };
  }
  function testNotice() {
    return {
      topic: "test",
      title: "Test notification ✅",
      body: "Notifications are working on this device.",
      url: "#/",
      tag: "test"
    };
  }

  // src/server/db.ts
  function isBlankRow(data) {
    for (const key of Object.keys(data)) if (!isBlank(data[key])) return false;
    return true;
  }
  var Db = class {
    constructor(store) {
      this.store = store;
      __publicField(this, "cache", /* @__PURE__ */ new Map());
      __publicField(this, "versions", /* @__PURE__ */ new Map());
      __publicField(this, "epoch", 0);
    }
    rows(table) {
      let rows = this.cache.get(table);
      if (!rows) {
        rows = this.store.read(table).slice();
        this.cache.set(table, rows);
      }
      return rows;
    }
    /** Changes whenever the table (or the whole view) may have changed. */
    version(table) {
      var _a;
      return `${this.epoch}.${(_a = this.versions.get(table)) != null ? _a : 0}`;
    }
    append(table, rows) {
      if (rows.length === 0) return;
      this.store.append(table, rows);
      this.cache.delete(table);
      this.bump(table);
    }
    update(table, rowNumber, patch) {
      this.store.update(table, rowNumber, patch);
      const rows = this.cache.get(table);
      if (rows) {
        const index = rows.findIndex((r) => r.rowNumber === rowNumber);
        if (index < 0) {
          this.cache.delete(table);
        } else {
          const data = { ...rows[index].data, ...patch };
          if (isBlankRow(data)) rows.splice(index, 1);
          else rows[index] = { rowNumber, data };
        }
      }
      this.bump(table);
    }
    /** Blank out a row (the sheet equivalent of deleting it without shifting row numbers). */
    clear(table, rowNumber, columns) {
      const patch = {};
      for (const c of columns) patch[c] = "";
      this.update(table, rowNumber, patch);
    }
    overwrite(table, rows) {
      this.store.overwrite(table, rows);
      this.cache.delete(table);
      this.bump(table);
    }
    /**
     * Read the tab again from the sheet, dropping what this request (and the store) memoized: the
     * treasurer can insert, delete or sort rows at any time, and the script lock doesn't stop that.
     */
    refresh(table) {
      var _a, _b;
      (_b = (_a = this.store).invalidate) == null ? void 0 : _b.call(_a, table);
      this.cache.delete(table);
      this.bump(table);
    }
    /** Canonical headers the tab has; null = the tab is missing; undefined = the store can't tell. */
    columns(table) {
      return this.store.columns ? this.store.columns(table) : void 0;
    }
    ensureTable(table) {
      const result = this.store.ensureTable(table);
      this.cache.delete(table);
      this.bump(table);
      return result;
    }
    /** Forget everything read so far (call after taking the write lock). */
    reset() {
      this.cache.clear();
      this.epoch++;
    }
    bump(table) {
      var _a;
      this.versions.set(table, ((_a = this.versions.get(table)) != null ? _a : 0) + 1);
    }
  };

  // src/server/context.ts
  var MAX_LOG_DETAIL = 500;
  function createCtx(services) {
    const db = new Db(services.store);
    const now = services.clock.now();
    const pending = [];
    return {
      s: services,
      db,
      m: new Model(services, db),
      now,
      today: nyDate(now),
      deliveries: null,
      log(kind, detail) {
        pending.push({ At: now, Kind: kind, Detail: truncate(detail, MAX_LOG_DETAIL) });
      },
      flushLog() {
        if (pending.length === 0) return;
        const rows = pending.splice(0, pending.length);
        try {
          db.append("Log", rows);
        } catch (err) {
          services.logger.error("Could not write Log rows", err);
        }
      }
    };
  }
  function inWriteLock(ctx, fn) {
    return ctx.s.withLock(() => {
      ctx.db.reset();
      try {
        return fn();
      } finally {
        ctx.flushLog();
      }
    });
  }
  function rateLimit(ctx, key, limit, windowSeconds, message) {
    const nowMs = ctx.now.getTime();
    let count = 0;
    let resetAt = nowMs + windowSeconds * 1e3;
    const raw = ctx.s.cache.get(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.n === "number" && typeof parsed.r === "number" && parsed.r > nowMs) {
          count = parsed.n;
          resetAt = parsed.r;
        }
      } catch {
      }
    }
    if (count >= limit) throw new ApiError("RATE_LIMITED", message);
    const ttl = Math.max(1, Math.ceil((resetAt - nowMs) / 1e3));
    ctx.s.cache.put(key, JSON.stringify({ n: count + 1, r: resetAt }), ttl);
  }

  // src/server/email.ts
  var NOTIFICATION_FOOTER = "You're receiving this because you signed up for TMA updates. Change what you get in the app under More → Notifications.";
  var MAROON = "#5a0f13";
  var INK = "#141010";
  var CREAM = "#faf7f5";
  var SERIF = "Georgia,'Times New Roman',serif";
  var SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  function escapeHtml(text2) {
    return text2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function appLink(appUrl, path = "") {
    const base = safeUrl(appUrl);
    if (!base) return "";
    if (!path) return base;
    return path.startsWith("#") && base.includes("#") ? base.slice(0, base.indexOf("#")) + path : base + path;
  }
  function paragraphs(body) {
    return body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== "").map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
  }
  function renderEmail(input) {
    var _a;
    const buttonUrl = appLink(input.appUrl, input.path);
    const link = safeUrl(input.link);
    const footer = (_a = input.footer) != null ? _a : NOTIFICATION_FOOTER;
    const html = [
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
      `<body style="margin:0;padding:0;background:${CREAM};">`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">`,
      '<tr><td align="center">',
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:${SANS};color:${INK};">`,
      `<tr><td style="background:${MAROON};color:#ffffff;padding:16px 24px;font-family:${SERIF};font-size:20px;font-weight:bold;">${escapeHtml(input.orgName)}</td></tr>`,
      '<tr><td style="padding:24px;font-size:16px;line-height:1.5;">',
      `<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:22px;line-height:1.3;color:${INK};">${escapeHtml(input.title)}</h1>`,
      paragraphs(input.body),
      input.code ? `<p style="margin:8px 0 18px;font-family:'SFMono-Regular',Consolas,monospace;font-size:32px;letter-spacing:6px;font-weight:bold;color:${MAROON};">${escapeHtml(input.code)}</p>` : "",
      link ? `<p style="margin:0 0 14px;"><a href="${escapeHtml(link)}" style="color:${MAROON};">More information</a></p>` : "",
      buttonUrl ? `<p style="margin:20px 0 4px;"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:${MAROON};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;">Open the TMA app</a></p>` : "",
      "</td></tr>",
      `<tr><td style="padding:16px 24px;border-top:1px solid #eee4e0;font-size:13px;line-height:1.4;color:#6b5f5c;">${escapeHtml(footer)}</td></tr>`,
      "</table></td></tr></table></body></html>"
    ].join("");
    const textParts = [input.title, "", input.body.trim()];
    if (input.code) textParts.push("", input.code);
    if (link) textParts.push("", `More information: ${link}`);
    if (buttonUrl) textParts.push("", `Open the TMA app: ${buttonUrl}`);
    textParts.push("", "--", input.orgName, footer);
    return { html, text: textParts.join("\n") };
  }

  // src/server/prefs.ts
  var CHANNELS = ["push", "email", "sms"];
  var TOPICS = ["balance", "payments", "reminders", "announcements"];
  var DEFAULT_CHANNELS = { push: true, email: true, sms: false };
  function knownOnly(values, known) {
    return uniqueBy(
      values.filter((v) => isKnown(v, known)).map((v) => canonical(v, known)),
      (v) => v
    );
  }
  function defaultPrefs(students, settings) {
    const schools = [];
    const ensembles = [];
    for (const s of students) {
      if (s.status === "Inactive") continue;
      if (s.school) schools.push(s.school);
      ensembles.push(...s.ensembles);
    }
    return {
      channels: { ...DEFAULT_CHANNELS },
      topics: { balance: true, payments: true, reminders: true, announcements: true },
      schools: knownOnly(schools, settings.pub.schools),
      ensembles: knownOnly(ensembles, settings.pub.ensembles)
    };
  }
  function stringList(value) {
    if (!Array.isArray(value)) return null;
    return value.filter((v) => typeof v === "string").slice(0, 50);
  }
  var SMS_PHONE_RE = /^1?[2-9]\d{2}[2-9]\d{6}$/;
  function sanitizePrefs(input, settings, fallback) {
    const src = isRecord(input) ? input : {};
    const channelsIn = isRecord(src.channels) ? src.channels : {};
    const topicsIn = isRecord(src.topics) ? src.topics : {};
    const bool2 = (value, dflt) => typeof value === "boolean" ? value : dflt;
    const channels = {};
    for (const c of CHANNELS) channels[c] = bool2(channelsIn[c], fallback.channels[c]);
    const topics = {};
    for (const t of TOPICS) topics[t] = bool2(topicsIn[t], fallback.topics[t]);
    const schoolsIn = stringList(src.schools);
    const ensemblesIn = stringList(src.ensembles);
    const prefs = {
      channels,
      topics,
      schools: schoolsIn ? knownOnly(schoolsIn, settings.pub.schools) : fallback.schools.slice(),
      ensembles: ensemblesIn ? knownOnly(ensemblesIn, settings.pub.ensembles) : fallback.ensembles.slice()
    };
    const phoneIn = src.smsPhone === void 0 ? fallback.smsPhone : src.smsPhone;
    const digits = typeof phoneIn === "string" || typeof phoneIn === "number" ? String(phoneIn).replace(/\D/g, "") : "";
    if (SMS_PHONE_RE.test(digits)) prefs.smsPhone = digits;
    if (!settings.smsSetting || !prefs.smsPhone) prefs.channels.sms = false;
    return prefs;
  }
  function audienceMatches(audience, prefs) {
    const { schools, ensembles } = audience;
    if (schools.length === 0 && ensembles.length === 0) return true;
    if (prefs.schools.length === 0 && prefs.ensembles.length === 0) return true;
    if (schools.length > 0 && ensembles.length > 0) {
      return intersects(schools, prefs.schools) && intersects(ensembles, prefs.ensembles);
    }
    return schools.length > 0 ? intersects(schools, prefs.schools) : intersects(ensembles, prefs.ensembles);
  }
  function defaultPrefsFor(ctx, email2) {
    const family = ctx.m.familyForEmail(email2);
    const students = family && family.status !== "Inactive" ? ctx.m.studentsOfFamily(family.id) : [];
    return defaultPrefs(students, ctx.m.settings());
  }
  function prefsFor(ctx, email2) {
    const fallback = defaultPrefsFor(ctx, email2);
    const stored = ctx.m.preferences().get(email2);
    if (!stored || !stored.json) return fallback;
    let parsed;
    try {
      parsed = JSON.parse(stored.json);
    } catch {
      return fallback;
    }
    return isRecord(parsed) ? sanitizePrefs(parsed, ctx.m.settings(), fallback) : fallback;
  }

  // src/server/notify.ts
  function zeroCounts() {
    return { push: 0, email: 0, sms: 0 };
  }
  function addCounts(target, more) {
    target.push += more.push;
    target.email += more.email;
    target.sms += more.sms;
    return target;
  }
  function isTopic(topic) {
    return TOPICS.includes(topic);
  }
  function oneLine(text2, max) {
    return truncate(text2.replace(/\s+/g, " ").trim(), max);
  }
  function safely(ctx, what, fn, fallback) {
    try {
      return fn();
    } catch (err) {
      ctx.s.logger.error(`${what} failed`, errorMessage(err));
      return fallback;
    }
  }
  var DEVICE_COLUMNS = TABLES.Devices.headers;
  var SIGN_IN_EMAIL_RESERVE = 20;
  function mayText(ctx, email2) {
    var _a;
    return ctx.m.settings().adminEmails.includes(email2) || ((_a = ctx.m.familyForEmail(email2)) == null ? void 0 : _a.status) === "Active";
  }
  function planDelivery(ctx, recipients, notice, opts) {
    const emails = unique(recipients.map(normEmail).filter(isEmail));
    if (emails.length === 0) return null;
    const settings = ctx.m.settings();
    const allowed = { push: true, email: true, sms: true, ...opts.channels };
    const pushOn = allowed.push && safely(ctx, "push.enabled", () => ctx.s.push.enabled(), false);
    const emailOn = allowed.email && settings.emailEnabled;
    const smsOn = allowed.sms && settings.smsSetting && safely(ctx, "sms.enabled", () => ctx.s.sms.enabled(), false);
    const tokens = [];
    const mailTo = [];
    const smsTo = [];
    for (const email2 of emails) {
      const prefs = prefsFor(ctx, email2);
      if (!opts.ignorePrefs) {
        if (isTopic(notice.topic) && !prefs.topics[notice.topic]) continue;
        if (notice.audience && !audienceMatches(notice.audience, prefs)) continue;
      }
      if (pushOn && (opts.ignorePrefs || prefs.channels.push)) {
        for (const d of ctx.m.devicesFor(email2)) tokens.push(d.token);
      }
      if (emailOn && (opts.ignorePrefs || prefs.channels.email)) mailTo.push(email2);
      if (smsOn && prefs.smsPhone && (opts.ignorePrefs || prefs.channels.sms) && mayText(ctx, email2)) smsTo.push(prefs.smsPhone);
    }
    return { notice, tokens: unique(tokens), mailTo, smsTo: unique(smsTo), counts: zeroCounts() };
  }
  function deliver(ctx, recipients, notice, opts = {}) {
    const job = planDelivery(ctx, recipients, notice, opts);
    if (!job) return zeroCounts();
    if (ctx.deliveries) {
      ctx.deliveries.push(job);
      return job.counts;
    }
    removeDevices(ctx, sendJob(ctx, job));
    return job.counts;
  }
  function flushDeliveries(ctx) {
    var _a;
    const jobs = (_a = ctx.deliveries) != null ? _a : [];
    ctx.deliveries = null;
    const total = zeroCounts();
    if (jobs.length === 0) return total;
    const invalid = /* @__PURE__ */ new Set();
    for (const job of jobs) {
      try {
        for (const token of sendJob(ctx, job)) invalid.add(token);
      } catch (err) {
        ctx.s.logger.error(`Could not send "${job.notice.title}"`, errorMessage(err));
      }
      addCounts(total, job.counts);
    }
    try {
      inWriteLock(ctx, () => removeDevices(ctx, invalid));
    } catch (err) {
      ctx.s.logger.error("Could not record notification results", errorMessage(err));
    }
    return total;
  }
  function sendJob(ctx, job) {
    var _a;
    const { notice, counts } = job;
    const settings = ctx.m.settings();
    const invalid = job.tokens.length > 0 ? sendPush(ctx, job.tokens, notice, counts) : [];
    let quotaSkipped = 0;
    if (job.mailTo.length > 0) {
      let quota = safely(ctx, "mailer.remainingQuota", () => ctx.s.mailer.remainingQuota(), 0) - SIGN_IN_EMAIL_RESERVE;
      const { html, text: text2 } = renderEmail({
        orgName: settings.pub.orgName,
        title: notice.title,
        body: notice.body,
        appUrl: settings.pub.appUrl,
        path: notice.url,
        link: notice.link
      });
      const subject = oneLine(notice.title, 150);
      let next = 0;
      while (next < job.mailTo.length && quota > 0) {
        const batch = job.mailTo.slice(next, next + quota);
        next += batch.length;
        const { sent, kept } = sendEmails(ctx, batch, { subject, html, text: text2 });
        counts.email += sent;
        quota -= sent;
        quotaSkipped += kept;
        if (kept === batch.length) break;
      }
      quotaSkipped += job.mailTo.length - next;
    }
    if (job.smsTo.length > 0) {
      const message = oneLine(`TMA: ${notice.title} – ${(_a = notice.pushBody) != null ? _a : notice.body}`, 320);
      for (const phone of job.smsTo) {
        const sent = safely(
          ctx,
          "sms.send",
          () => {
            ctx.s.sms.send(phone, message);
            return true;
          },
          false
        );
        if (sent) counts.sms++;
      }
    }
    const skipped = quotaSkipped > 0 ? ` (${quotaSkipped} email skipped: daily quota used up; the last ${SIGN_IN_EMAIL_RESERVE} are kept for sign-in codes)` : "";
    ctx.log("notify", `${notice.topic}: ${notice.title} → push ${counts.push}, email ${counts.email}, sms ${counts.sms}${skipped}`);
    return invalid;
  }
  function sendEmails(ctx, recipients, content) {
    const mailer = ctx.s.mailer;
    let sent = 0;
    let kept = 0;
    if (!mailer.sendMany) {
      for (const to of recipients) {
        const ok = safely(
          ctx,
          `email to ${to}`,
          () => {
            mailer.send({ to, ...content });
            return true;
          },
          false
        );
        if (ok) sent++;
      }
      return { sent, kept };
    }
    const messages = recipients.map((to) => ({ to, ...content }));
    const results = safely(ctx, "mailer.sendMany", () => mailer.sendMany(messages), null);
    if (!results) return { sent, kept };
    recipients.forEach((to, i) => {
      const result = results[i];
      if (result == null ? void 0 : result.ok) sent++;
      else {
        if (result == null ? void 0 : result.quota) kept++;
        ctx.s.logger.error(`email to ${to} failed`, result ? result.error : "no result");
      }
    });
    return { sent, kept };
  }
  function sendPush(ctx, tokens, notice, counts) {
    var _a;
    const message = {
      title: oneLine(notice.title, 120),
      body: oneLine((_a = notice.pushBody) != null ? _a : notice.body, 240),
      url: notice.url,
      topic: notice.topic
    };
    if (notice.tag) message.tag = notice.tag;
    const results = safely(ctx, "push.send", () => ctx.s.push.send(tokens, message), []);
    const invalid = [];
    results.forEach((result, i) => {
      if (result === "ok") counts.push++;
      else if (result === "invalid" && i < tokens.length) invalid.push(tokens[i]);
    });
    return invalid;
  }
  function removeDevices(ctx, invalid) {
    const dead = new Set(invalid);
    if (dead.size === 0) return;
    for (const device of ctx.m.devices()) {
      if (!dead.has(device.token)) continue;
      safely(ctx, "remove invalid device", () => ctx.db.clear("Devices", device.row, DEVICE_COLUMNS), void 0);
    }
    ctx.log("push", `Removed ${dead.size} expired device token(s)`);
  }
  function familyRecipients(family) {
    return family ? unique(family.guardians.map((g) => g.email).filter(isEmail)) : [];
  }
  function adminRecipients(ctx) {
    return ctx.m.settings().adminEmails.slice();
  }
  function allRecipients(ctx) {
    const out = [];
    for (const f of ctx.m.families()) if (f.status !== "Inactive") out.push(...familyRecipients(f));
    ctx.m.preferences().forEach((_, email2) => out.push(email2));
    for (const d of ctx.m.devices()) if (d.email) out.push(d.email);
    return unique(out.filter(isEmail));
  }
  function notifyFamily(ctx, family, notice) {
    if (!family || family.status === "Inactive") return zeroCounts();
    return deliver(ctx, familyRecipients(family), notice);
  }
  function notifyAdmins(ctx, notice) {
    const admins = adminRecipients(ctx);
    if (admins.length === 0) {
      ctx.log("notify", `admin: ${notice.title} → no ADMIN_EMAILS set`);
      return zeroCounts();
    }
    return deliver(ctx, admins, notice);
  }

  // src/server/validate.ts
  var LIMITS = {
    name: 80,
    studentName: 40,
    note: 500,
    title: 120,
    body: 2e3,
    id: 64,
    url: 500,
    instrument: 40,
    userAgent: 300,
    token: 4096
  };
  function obj(value, label) {
    if (!isRecord(value)) badRequest(`${label} is missing or invalid.`);
    return value;
  }
  function list(value, label, max, min = 0) {
    if (value === void 0 || value === null) {
      if (min > 0) badRequest(`${label} is required.`);
      return [];
    }
    if (!Array.isArray(value)) return badRequest(`${label} must be a list.`);
    if (value.length < min) badRequest(`Add at least ${min} ${label.toLowerCase()}.`);
    if (value.length > max) badRequest(`${label}: at most ${max} allowed.`);
    return value;
  }
  function text(value, label, max, opts = {}) {
    var _a;
    const min = (_a = opts.min) != null ? _a : 1;
    if (value !== void 0 && value !== null && typeof value !== "string") badRequest(`${label} must be text.`);
    const s = typeof value === "string" ? cleanText(value, opts.multiline) : "";
    if (s.length < min) badRequest(min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
    if (s.length > max) badRequest(`${label} must be at most ${max} characters.`);
    return s;
  }
  function optText(value, label, max, multiline = false) {
    if (value === void 0 || value === null) return "";
    return text(value, label, max, { min: 0, multiline });
  }
  function email(value, label = "Email") {
    if (typeof value !== "string") return badRequest(`${label} is required.`);
    const e = normEmail(value);
    if (!isEmail(e)) badRequest(`${label} doesn't look like an email address.`);
    return e;
  }
  function id(value, label) {
    if (typeof value !== "string" && typeof value !== "number") return badRequest(`${label} is required.`);
    const s = cleanText(String(value));
    if (!s) badRequest(`${label} is required.`);
    if (s.length > LIMITS.id) badRequest(`${label} is too long.`);
    return s;
  }
  function cents(value, label, min) {
    if (typeof value !== "number" || !Number.isFinite(value)) return badRequest(`${label} must be a number of cents.`);
    if (!Number.isInteger(value)) badRequest(`${label} must be whole cents.`);
    if (value > MAX_AMOUNT_CENTS) badRequest(`${label} is too large.`);
    if (value < min) badRequest(`${label} is too small.`);
    return value;
  }
  function bool(value, label, fallback) {
    if (typeof value === "boolean") return value;
    if ((value === void 0 || value === null) && fallback !== void 0) return fallback;
    return badRequest(`${label} must be true or false.`);
  }
  function optUrl(value, label) {
    if (value === void 0 || value === null || typeof value === "string" && value.trim() === "") return void 0;
    const url = safeUrl(value, LIMITS.url);
    if (!url) badRequest(`${label} must be a web address starting with https://`);
    return url;
  }
  function oneOf(value, label, allowed) {
    if (typeof value === "string" && allowed.includes(value)) return value;
    return badRequest(`${label} must be one of: ${allowed.join(", ")}.`);
  }

  // src/server/admin.ts
  var MAX_CANDIDATES = 3;
  var MAX_PENDING_HOUSEHOLDS = 100;
  var MAX_PENDING_REDEMPTIONS = 200;
  var RECENT_LOG = 50;
  var DUPLICATE_WINDOW_MS = 15 * 60 * 1e3;
  function matchCandidates(ctx, family, pending) {
    const last = lettersOnly(pending.lastName);
    if (!last) return [];
    const first = lettersOnly(pending.firstName);
    const grade = normalizeGrade(pending.grade);
    const books = ctx.m.books();
    const out = [];
    for (const s of ctx.m.students()) {
      if (s.status !== "Active" || idKey(s.id) === idKey(pending.id)) continue;
      if (s.familyId !== null && idKey(s.familyId) === idKey(family.id)) continue;
      if (lettersOnly(s.lastName) !== last) continue;
      let score = 0.6;
      const otherFirst = lettersOnly(s.firstName);
      if (first && otherFirst === first) score += 0.3;
      else if (first && otherFirst && (otherFirst.startsWith(first) || first.startsWith(otherFirst))) score += 0.2;
      if (grade && normalizeGrade(s.grade) === grade) score += 0.1;
      out.push({
        studentId: s.id,
        name: studentName(s),
        grade: s.grade,
        school: s.school,
        familyId: s.familyId,
        balanceCents: books.balance(s.id),
        score: Math.round(score * 100) / 100
      });
    }
    return out.filter((c) => c.score >= 0.6).sort((a, b) => b.score - a.score || b.balanceCents - a.balanceCents).slice(0, MAX_CANDIDATES);
  }
  function studentRecordTabs(ctx) {
    const index = /* @__PURE__ */ new Map();
    const add2 = (studentId, tab) => {
      var _a;
      if (!studentId) return;
      const list2 = (_a = index.get(idKey(studentId))) != null ? _a : [];
      if (!list2.includes(tab)) list2.push(tab);
      index.set(idKey(studentId), list2);
    };
    for (const l of ctx.m.ledger()) add2(l.studentId, "Ledger");
    for (const e of ctx.m.enrollments()) add2(e.studentId, "Enrollments");
    for (const p of ctx.m.payments()) add2(p.studentId, "Payments");
    for (const r of ctx.m.redemptions()) add2(r.studentId, "Redemptions");
    return index;
  }
  function reviewWarnings(ctx, family, pending, records = studentRecordTabs(ctx)) {
    var _a;
    const m = ctx.m;
    const warnings = [];
    for (const s of pending) {
      const tabs = (_a = records.get(idKey(s.id))) != null ? _a : [];
      if (tabs.length > 0) {
        warnings.push(
          `${s.id} (${studentName(s)}) already has rows in ${tabs.join(", ")} from an earlier student with this ID. Fix the IDs in the sheet before approving.`
        );
      }
    }
    if (family.status === "Pending") {
      for (const s of m.studentsOfFamily(family.id)) {
        if (s.status === "Pending") continue;
        warnings.push(
          `${s.id} (${studentName(s)}, ${s.status}) is already linked to ${family.id} in the Students tab. Approving shows this household that student's funds and history.`
        );
      }
      const pendingKeys = new Set(pending.map((s) => idKey(s.id)));
      const requests = m.redemptions().filter((r) => idKey(r.familyId) === idKey(family.id) && !pendingKeys.has(idKey(r.studentId)));
      if (requests.length > 0) {
        warnings.push(`${family.id} already has ${requests.length} row(s) in Redemptions from before it signed up. Check the FamilyID before approving.`);
      }
    }
    return warnings;
  }
  function adminOverview(ctx) {
    var _a, _b, _c;
    const m = ctx.m;
    const books = m.books();
    const families = m.families();
    const students = m.students().filter((s) => s.status !== "Inactive");
    let totalFunds = 0;
    for (const s of m.students()) totalFunds += books.balance(s.id);
    const known = new Set(m.students().map((s) => idKey(s.id)));
    for (const key of books.ledgerStudentKeys()) if (!known.has(key)) totalFunds += books.balance(key);
    let emailQuota = 0;
    let emailRelay = null;
    try {
      emailQuota = ctx.s.mailer.remainingQuota();
      emailRelay = (_c = (_b = (_a = ctx.s.mailer).relayStatus) == null ? void 0 : _b.call(_a)) != null ? _c : null;
    } catch (err) {
      ctx.s.logger.error("remainingQuota failed", err);
    }
    const pendingRedemptions = m.redemptions().filter((r) => r.status === "Pending").sort((a, b) => a.requestedAt === b.requestedAt ? a.row - b.row : a.requestedAt < b.requestedAt ? -1 : 1).slice(0, MAX_PENDING_REDEMPTIONS).map((r) => {
      var _a2, _b2, _c2;
      const student2 = m.studentById(r.studentId);
      const activity = m.activityById(r.activityId);
      return {
        ...toRedemption(r),
        studentName: student2 ? studentName(student2) : r.studentId,
        activityName: (_a2 = activity == null ? void 0 : activity.name) != null ? _a2 : r.activityId,
        availableCents: Math.max(0, books.balance(r.studentId) - (books.pending(r.studentId) - r.amountCents)),
        remainingCents: (_c2 = (_b2 = books.account(r.studentId, r.activityId)) == null ? void 0 : _b2.remainingCents) != null ? _c2 : 0
      };
    });
    const pendingHouseholds = [];
    const records = studentRecordTabs(ctx);
    for (const f of families) {
      if (f.status === "Inactive") continue;
      const pendingStudents = m.studentsOfFamily(f.id).filter((s) => s.status === "Pending");
      if (f.status !== "Pending" && pendingStudents.length === 0) continue;
      const entry = {
        family: toFamily(f),
        students: pendingStudents.map((s) => ({ student: toStudent(s), candidates: matchCandidates(ctx, f, s) }))
      };
      const warnings = reviewWarnings(ctx, f, pendingStudents, records);
      if (warnings.length > 0) entry.warnings = warnings;
      pendingHouseholds.push(entry);
      if (pendingHouseholds.length >= MAX_PENDING_HOUSEHOLDS) break;
    }
    const log = m.logEntries();
    const recentLog = log.slice(Math.max(0, log.length - RECENT_LOG)).reverse().map((l) => ({ at: l.at, kind: l.kind, detail: l.detail }));
    return {
      stats: {
        families: families.filter((f) => f.status !== "Inactive").length,
        activeFamilies: families.filter((f) => f.status === "Active").length,
        pendingFamilies: families.filter((f) => f.status === "Pending").length,
        students: students.length,
        totalFundsCents: totalFunds,
        pushDevices: m.devices().length,
        emailQuotaRemaining: emailQuota,
        // The Worker's allowance says nothing useful; what matters is how much Gmail can still cover.
        ...emailRelay ? { emailFrom: emailRelay.from, emailBackupRemaining: emailRelay.backupRemaining } : {}
      },
      pendingRedemptions,
      pendingHouseholds,
      recentLog
    };
  }
  function fillBlanks(existing, pending) {
    const patch = {};
    if (!existing.grade && pending.grade) patch.Grade = pending.grade;
    if (!existing.school && pending.school) patch.School = pending.school;
    if (existing.ensembles.length === 0 && pending.ensembles.length > 0) patch.Ensembles = joinList(pending.ensembles);
    if (!existing.instrument && pending.instrument) patch.Instrument = pending.instrument;
    return patch;
  }
  function reviewHousehold(ctx, adminEmail, params) {
    var _a, _b;
    const familyId = id(params.familyId, "Household");
    const decision = oneOf(params.decision, "Decision", ["approve", "reject"]);
    const family = ctx.m.familyById(familyId);
    if (!family) notFound("Household not found.");
    const pending = ctx.m.studentsOfFamily(family.id).filter((s) => s.status === "Pending");
    if (decision === "reject") {
      if (family.status === "Pending") ctx.db.update("Families", family.row, { Status: "Inactive" });
      for (const s of pending) ctx.db.update("Students", s.row, { Status: "Inactive" });
      ctx.log(
        "review",
        family.status === "Pending" ? `${family.id} rejected by ${adminEmail}` : `${family.id}: ${pending.length} pending student(s) rejected by ${adminEmail}; household stays ${family.status}`
      );
      return { family: toFamily((_a = ctx.m.familyById(family.id)) != null ? _a : family) };
    }
    const links = [];
    const seenPending = /* @__PURE__ */ new Set();
    const seenExisting = /* @__PURE__ */ new Set();
    for (const [i, raw] of list(params.links, "Links", 8).entries()) {
      const link = obj(raw, `Link ${i + 1}`);
      const pendingId = id(link.pendingStudentId, "Pending student");
      const existingId = id(link.existingStudentId, "Existing student");
      const p = pending.find((s) => idKey(s.id) === idKey(pendingId));
      if (!p) badRequest(`${pendingId} is not a pending student of ${family.id}.`);
      const existing = ctx.m.studentById(existingId);
      if (!existing || existing.status !== "Active") badRequest(`${existingId} is not an active student record.`);
      if (existing.familyId !== null && idKey(existing.familyId) === idKey(family.id)) {
        badRequest(`${existing.id} is already in this household.`);
      }
      const owner = ctx.m.familyById(existing.familyId);
      if (owner && owner.status !== "Inactive" && idKey(owner.id) !== idKey(family.id)) {
        conflict(`${existing.id} already belongs to household ${owner.id}. Fix it in the sheet if the student moved.`);
      }
      if (seenPending.has(idKey(p.id)) || seenExisting.has(idKey(existing.id))) badRequest("Each student can be linked once.");
      seenPending.add(idKey(p.id));
      seenExisting.add(idKey(existing.id));
      links.push({ pending: p, existing });
    }
    const changed = family.status !== "Active" || pending.length > 0;
    if (family.status !== "Active") ctx.db.update("Families", family.row, { Status: "Active" });
    for (const { pending: p, existing } of links) {
      ctx.db.update("Students", existing.row, { FamilyID: family.id, Status: "Active", ...fillBlanks(existing, p) });
      ctx.db.update("Students", p.row, { Status: "Inactive" });
      ctx.log("review", `${p.id} (${studentName(p)}) merged into ${existing.id} for ${family.id}`);
    }
    for (const s of pending) {
      if (!seenPending.has(idKey(s.id))) ctx.db.update("Students", s.row, { Status: "Active" });
    }
    ctx.log("review", `${family.id} approved by ${adminEmail}`);
    const updated = (_b = ctx.m.familyById(family.id)) != null ? _b : family;
    if (changed) notifyFamily(ctx, updated, householdVerifiedNotice(family.id));
    return { family: toFamily(updated) };
  }
  function audienceList(value, label, known) {
    const out = [];
    for (const item of list(value, label, Math.max(known.length, 1))) {
      if (typeof item !== "string" || !isKnown(item, known)) badRequest(`${label}: "${String(item)}" is not in Settings.`);
      const name = canonical(item, known);
      if (!out.includes(name)) out.push(name);
    }
    return out;
  }
  function newAnnouncementId(ctx) {
    const taken = new Set(ctx.m.announcements().map((a) => idKey(a.id)));
    for (let i = 0; i < 5; i++) {
      const id2 = `A-${hex8(ctx.s.crypto.uuid())}`;
      if (!taken.has(idKey(id2))) return id2;
    }
    throw new Error("Could not generate a unique announcement ID");
  }
  function announce(ctx, adminEmail, params) {
    var _a, _b;
    const settings = ctx.m.settings().pub;
    const title = text(params.title, "Title", LIMITS.title);
    const body = text(params.body, "Message", LIMITS.body, { multiline: true });
    const audienceIn = obj((_a = params.audience) != null ? _a : {}, "Audience");
    const audience = {
      schools: audienceList(audienceIn.schools, "Schools", settings.schools),
      ensembles: audienceList(audienceIn.ensembles, "Groups", settings.ensembles)
    };
    const channelsIn = obj(params.channels, "Channels");
    const channels = {};
    for (const c of CHANNELS) channels[c] = bool(channelsIn[c], `Channel ${c}`, false);
    if (!CHANNELS.some((c) => channels[c])) badRequest("Choose at least one way to send it.");
    const link = optUrl(params.link, "Link");
    const nowMs = ctx.now.getTime();
    const recent = ctx.m.announcements().find((a) => {
      const sentMs = a.sentAt ? Date.parse(a.sentAt) : NaN;
      return a.title === title && a.body.trim() === body.trim() && nowMs - sentMs >= 0 && nowMs - sentMs < DUPLICATE_WINDOW_MS;
    });
    if (recent) {
      const minutes = Math.max(1, Math.round((nowMs - Date.parse((_b = recent.sentAt) != null ? _b : "")) / 6e4));
      conflict(`This announcement was already sent ${minutes} minute${minutes === 1 ? "" : "s"} ago. Check News before sending it again.`);
    }
    const id2 = newAnnouncementId(ctx);
    ctx.db.append("Announcements", [
      {
        ID: id2,
        Date: ctx.today,
        Title: title,
        Body: body,
        Schools: joinList(audience.schools),
        Ensembles: joinList(audience.ensembles),
        Link: link != null ? link : "",
        Sent: ctx.now
      }
    ]);
    ctx.log("announce", `${id2} "${title}" by ${adminEmail}`);
    const delivered = deliver(ctx, allRecipients(ctx), announcementNotice({ id: id2, title, body, audience, link }), { channels });
    const saved = ctx.m.announcements().find((a) => a.id === id2);
    if (!saved) throw new Error(`Announcement ${id2} was not saved`);
    return { announcement: toAnnouncement(saved), delivered };
  }

  // src/server/services.ts
  var MailReserveError = class extends Error {
    constructor(remaining, reserve) {
      super(`Not sent: ${remaining} emails left today, and the last ${reserve} are kept`);
      /** Emails the sender had left today. */
      __publicField(this, "remaining");
      this.name = "MailReserveError";
      this.remaining = remaining;
    }
  };

  // src/server/auth.ts
  var CODE_TTL_SECONDS = 600;
  var MAX_CODE_ATTEMPTS = 5;
  var CODES_PER_HOUR = 5;
  var MAX_TOKEN_LENGTH = 2048;
  var NEW_EMAIL_CODES_PER_HOUR = Number(SETTING_DEFAULTS.NEW_SIGNUPS_PER_HOUR);
  var KNOWN_EMAIL_CODE_RESERVE = 40;
  function requireSecret(ctx) {
    const secret = ctx.s.secrets.get("TOKEN_SECRET");
    if (!secret || secret.length < 32) {
      return fail("NOT_CONFIGURED", "The TMA app isn't set up yet. Please ask TMA to run Setup.");
    }
    return secret;
  }
  function otpHash(ctx, secret, email2, code) {
    return ctx.s.crypto.hmacSha256Hex(secret, `otp|${email2}|${code}`);
  }
  function readOtp(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) return null;
      const { h, a, x } = parsed;
      return typeof h === "string" && typeof a === "number" && typeof x === "number" ? { h, a, x } : null;
    } catch {
      return null;
    }
  }
  function isKnownEmail(ctx, email2) {
    return ctx.m.settings().adminEmails.includes(email2) || ctx.m.familiesWithEmail(email2).some((f) => f.status === "Active");
  }
  function newEmailLimitHit(ctx, detail) {
    ctx.s.logger.error(detail);
    const flag = "otp-new-email-limit-logged";
    if (ctx.s.cache.get(flag)) return;
    ctx.s.cache.put(flag, "1", 3600);
    try {
      inWriteLock(ctx, () => ctx.log("auth", detail));
    } catch (err) {
      ctx.s.logger.error("Could not write the Log row", errorMessage(err));
    }
  }
  var NEW_EMAILS_PAUSED = "Lots of people are signing up right now, so new sign-ups are paused for a while. Please try again later or contact TMA.";
  function requestCode(ctx, params) {
    const email2 = email(params.email);
    const secret = requireSecret(ctx);
    const perHour = ctx.s.mode === "demo" ? 100 : CODES_PER_HOUR;
    rateLimit(ctx, `otp-rl:${email2}`, perHour, 3600, "Too many codes requested for this email. Please wait an hour and try again.");
    if (ctx.s.mode === "demo") {
      const devCode = newCode(ctx);
      storeCode(ctx, secret, email2, devCode);
      return { sent: true, devCode };
    }
    let quota = 0;
    try {
      quota = ctx.s.mailer.remainingQuota();
    } catch (err) {
      ctx.s.logger.error("remainingQuota failed", errorMessage(err));
    }
    if (quota <= 0) {
      fail("RATE_LIMITED", "TMA has reached today's email limit. Please try again tomorrow or contact TMA.");
    }
    const known = isKnownEmail(ctx, email2);
    if (!known) {
      if (quota <= KNOWN_EMAIL_CODE_RESERVE) {
        newEmailLimitHit(ctx, `Sign-in codes to new emails paused: only ${quota} emails left today (the last ${KNOWN_EMAIL_CODE_RESERVE} are kept for families TMA has verified)`);
        fail("RATE_LIMITED", NEW_EMAILS_PAUSED);
      }
      const perHourNew = ctx.m.settings().newSignupsPerHour;
      try {
        rateLimit(ctx, "otp-rl:new-emails", perHourNew, 3600, NEW_EMAILS_PAUSED);
      } catch (err) {
        newEmailLimitHit(ctx, `Sign-in codes to new emails paused: more than ${perHourNew} in an hour (Settings NEW_SIGNUPS_PER_HOUR)`);
        throw err;
      }
    }
    const code = newCode(ctx);
    const settings = ctx.m.settings();
    const { html, text: text2 } = renderEmail({
      orgName: settings.pub.orgName,
      title: "Your sign-in code",
      body: "Enter this code in the TMA app to sign in. It expires in 10 minutes.",
      code,
      appUrl: "",
      footer: "Someone asked to sign in to the TMA app with this email address. If it wasn't you, you can ignore this email."
    });
    try {
      ctx.s.mailer.send({ to: email2, subject: `Your TMA sign-in code: ${code}`, html, text: text2 }, known ? void 0 : { reserve: KNOWN_EMAIL_CODE_RESERVE });
    } catch (err) {
      if (err instanceof MailReserveError) {
        newEmailLimitHit(ctx, `Sign-in codes to new emails paused: only ${err.remaining} backup emails left today (the last ${KNOWN_EMAIL_CODE_RESERVE} are kept for families TMA has verified)`);
        fail("RATE_LIMITED", NEW_EMAILS_PAUSED);
      }
      ctx.s.logger.error("Could not send sign-in code", errorMessage(err));
      fail("INTERNAL", "We couldn't send the email right now. Please try again in a few minutes.");
    }
    storeCode(ctx, secret, email2, code);
    return { sent: true };
  }
  function newCode(ctx) {
    const code = ctx.s.crypto.randomDigits(6);
    if (!/^\d{6}$/.test(code)) throw new Error("randomDigits returned an invalid code");
    return code;
  }
  function storeCode(ctx, secret, email2, code) {
    const entry = { h: otpHash(ctx, secret, email2, code), a: 0, x: ctx.now.getTime() + CODE_TTL_SECONDS * 1e3 };
    ctx.s.cache.put(`otp:${email2}`, JSON.stringify(entry), CODE_TTL_SECONDS);
  }
  function verifyCode(ctx, params) {
    const email2 = email(params.email);
    const rawCode = typeof params.code === "number" ? String(params.code).padStart(6, "0") : params.code;
    const code = typeof rawCode === "string" ? rawCode.replace(/[\s-]/g, "") : "";
    if (!/^\d{6}$/.test(code)) badRequest("Enter the 6-digit code from the email.");
    const secret = requireSecret(ctx);
    const key = `otp:${email2}`;
    const entry = readOtp(ctx.s.cache.get(key));
    if (!entry || entry.x <= ctx.now.getTime()) {
      ctx.s.cache.remove(key);
      fail("UNAUTHORIZED", "That code has expired. Please request a new one.");
    }
    const otp = entry;
    if (otp.a >= MAX_CODE_ATTEMPTS) {
      ctx.s.cache.remove(key);
      fail("UNAUTHORIZED", "Too many tries. Please request a new code.");
    }
    if (!safeEqual(otp.h, otpHash(ctx, secret, email2, code))) {
      otp.a += 1;
      const ttl = Math.ceil((otp.x - ctx.now.getTime()) / 1e3);
      if (otp.a >= MAX_CODE_ATTEMPTS || ttl <= 0) ctx.s.cache.remove(key);
      else ctx.s.cache.put(key, JSON.stringify(otp), ttl);
      fail(
        "UNAUTHORIZED",
        otp.a >= MAX_CODE_ATTEMPTS ? "Too many tries. Please request a new code." : "That code isn't right. Please check the email and try again."
      );
    }
    ctx.s.cache.remove(key);
    return issueToken(ctx, email2, secret);
  }
  function issueToken(ctx, email2, secret = requireSecret(ctx)) {
    const settings = ctx.m.settings();
    const expiry = Math.floor(ctx.now.getTime() / 1e3) + settings.sessionDays * 86400;
    const payload = base64UrlEncode(JSON.stringify({ e: email2, v: settings.tokenVersion, x: expiry }));
    return {
      token: `${payload}.${ctx.s.crypto.hmacSha256Hex(secret, payload)}`,
      expiresAt: new Date(expiry * 1e3).toISOString()
    };
  }
  function authenticate(ctx, token) {
    if (typeof token !== "string" || token === "") fail("UNAUTHORIZED", "Please sign in.");
    const t = token;
    const secret = requireSecret(ctx);
    const invalid = () => {
      throw new ApiError("UNAUTHORIZED", "Please sign in again.");
    };
    if (t.length > MAX_TOKEN_LENGTH) invalid();
    const dot = t.indexOf(".");
    if (dot <= 0 || dot !== t.lastIndexOf(".")) invalid();
    const payload = t.slice(0, dot);
    const signature = t.slice(dot + 1);
    if (!/^[0-9a-f]{64}$/.test(signature)) invalid();
    if (!safeEqual(signature, ctx.s.crypto.hmacSha256Hex(secret, payload))) invalid();
    const json2 = base64UrlDecode(payload);
    if (json2 === null) return invalid();
    let claims;
    try {
      claims = JSON.parse(json2);
    } catch {
      return invalid();
    }
    if (!isRecord(claims)) return invalid();
    const { e, v: version, x } = claims;
    if (typeof e !== "string" || !isEmail(e) || typeof x !== "number" || !Number.isFinite(x)) return invalid();
    if (x * 1e3 <= ctx.now.getTime()) fail("UNAUTHORIZED", "Your session has expired. Please sign in again.");
    if (String(version) !== ctx.m.settings().tokenVersion) invalid();
    return e;
  }

  // src/server/bootstrap.ts
  var MAX_LEDGER = 200;
  var MAX_PAYMENTS = 200;
  var MAX_REDEMPTIONS = 200;
  var MAX_NEWS = 50;
  function newestFirst(items, date) {
    return items.slice().sort((a, b) => {
      const da = date(a);
      const db = date(b);
      if (da !== db) return da < db ? 1 : -1;
      return b.row - a.row;
    });
  }
  function buildBootstrap(ctx, email2) {
    const m = ctx.m;
    const settings = m.settings();
    const admin = isAdmin(ctx, email2);
    const family = m.familyForEmail(email2);
    const books = m.books();
    const students = [];
    const verified = /* @__PURE__ */ new Set();
    if (family) {
      for (const s of m.studentsOfFamily(family.id)) {
        const ok = family.status === "Active" && s.status === "Active";
        if (ok) verified.add(idKey(s.id));
        students.push({
          student: toStudent(s),
          verified: ok,
          balanceCents: ok ? books.balance(s.id) : 0,
          pendingCents: ok ? books.pending(s.id) : 0,
          availableCents: ok ? books.available(s.id) : 0,
          activities: ok ? books.accounts(s.id) : []
        });
      }
    }
    const mine = (studentId) => verified.has(idKey(studentId));
    const prefs = prefsFor(ctx, email2);
    const guardian2 = family == null ? void 0 : family.guardians.find((g) => g.email === email2);
    const announcements = newestFirst(
      m.announcements().filter((a) => a.sent && (admin || audienceMatches(a.audience, prefs))),
      (a) => a.date || a.sentAt || ""
    ).slice(0, MAX_NEWS).map(toAnnouncement);
    const events = m.events().filter((e) => e.date >= ctx.today && audienceMatches(e.audience, prefs)).sort((a, b) => a.date === b.date ? a.row - b.row : a.date < b.date ? -1 : 1).slice(0, MAX_NEWS).map(toEvent);
    return {
      me: {
        email: email2,
        name: (guardian2 == null ? void 0 : guardian2.name) || email2.split("@")[0],
        familyId: family ? family.id : null,
        familyStatus: family ? family.status : "None",
        isAdmin: admin
      },
      family: family ? toFamily(family) : null,
      students,
      ledger: newestFirst(
        m.ledger().filter((l) => mine(l.studentId)),
        (l) => l.date
      ).slice(0, MAX_LEDGER).map(toLedgerEntry),
      payments: newestFirst(
        m.payments().filter((p) => mine(p.studentId)),
        (p) => p.date
      ).slice(0, MAX_PAYMENTS).map(toPayment),
      redemptions: newestFirst(
        // Requests typed into the sheet may lack a FamilyID; never show another household's request.
        m.redemptions().filter((r) => mine(r.studentId) && (!r.familyId || idKey(r.familyId) === idKey(family == null ? void 0 : family.id))),
        (r) => r.requestedAt
      ).slice(0, MAX_REDEMPTIONS).map(toRedemption),
      announcements,
      events,
      activities: m.activities().filter((a) => a.status === "Open").map(toActivity),
      prefs,
      pushTokens: m.devicesFor(email2).length,
      settings: { ...settings.pub, schools: settings.pub.schools.slice(), ensembles: settings.pub.ensembles.slice() },
      serverTime: ctx.now.toISOString()
    };
  }

  // src/server/household.ts
  var MAX_GUARDIANS = 2;
  var MAX_INPUT_STUDENTS = 8;
  var MAX_HOUSEHOLD_STUDENTS = 10;
  var PHONE_RE = /^[0-9 ()+\-.]{7,20}$/;
  function parseGuardian(value, index) {
    const label = index === 0 ? "Guardian" : "Second guardian";
    const g = obj(value, label);
    const out = {
      name: text(g.name, `${label} name`, LIMITS.name),
      email: email(g.email, `${label} email`),
      phoneGiven: g.phone !== void 0 && g.phone !== null
    };
    const phone = optText(g.phone, `${label} phone`, 20);
    if (phone) {
      if (!PHONE_RE.test(phone) || phone.replace(/\D/g, "").length < 7) {
        badRequest(`${label} phone should be a phone number like 603-555-0123.`);
      }
      out.phone = phone;
    }
    return out;
  }
  function parseStudent(value, index, settings) {
    const label = `Student ${index + 1}`;
    const s = obj(value, label);
    const grade = normalizeGrade(typeof s.grade === "string" || typeof s.grade === "number" ? cleanText(String(s.grade)) : "");
    if (!GRADES.includes(grade)) badRequest(`${label}: choose a grade (K or 1–12).`);
    const school = typeof s.school === "string" ? cleanText(s.school) : "";
    if (!isKnown(school, settings.pub.schools)) badRequest(`${label}: choose a school from the list.`);
    const ensembles = list(s.ensembles, `${label} groups`, settings.pub.ensembles.length || 10).map((e) => {
      if (typeof e !== "string" || !isKnown(e, settings.pub.ensembles)) badRequest(`${label}: choose groups from the list.`);
      return canonical(cleanText(e), settings.pub.ensembles);
    });
    const out = {
      firstName: text(s.firstName, `${label} first name`, LIMITS.studentName),
      lastName: text(s.lastName, `${label} last name`, LIMITS.studentName),
      grade,
      school: canonical(school, settings.pub.schools),
      ensembles: uniqueBy(ensembles, (e) => e),
      instrumentGiven: s.instrument !== void 0 && s.instrument !== null
    };
    const instrument = optText(s.instrument, `${label} instrument`, LIMITS.instrument);
    if (instrument) out.instrument = instrument;
    if (s.id !== void 0 && s.id !== null && s.id !== "") out.id = id(s.id, `${label} ID`);
    return out;
  }
  function parseInput(params, settings) {
    const guardians = list(params.guardians, "Guardians", MAX_GUARDIANS, 1).map(parseGuardian);
    if (guardians.length === 2 && guardians[0].email === guardians[1].email) {
      badRequest("The two guardians need different email addresses.");
    }
    const students = list(params.students, "Students", MAX_INPUT_STUDENTS).map((s, i) => parseStudent(s, i, settings));
    const ids = students.filter((s) => s.id).map((s) => idKey(s.id));
    if (new Set(ids).size !== ids.length) badRequest("The same student appears twice.");
    return { guardians, students };
  }
  function studentRow(id2, familyId, s) {
    var _a;
    return {
      StudentID: id2,
      FamilyID: familyId,
      "First Name": s.firstName,
      "Last Name": s.lastName,
      Grade: s.grade,
      School: s.school,
      Ensembles: joinList(s.ensembles),
      Instrument: (_a = s.instrument) != null ? _a : "",
      Status: "Pending"
    };
  }
  function emailTaken(ctx, email2, exceptFamilyId) {
    return ctx.m.familiesWithEmail(email2).some((f) => f.status !== "Inactive" && (exceptFamilyId === void 0 || idKey(f.id) !== idKey(exceptFamilyId)));
  }
  var TAKEN_MESSAGE = "That email is already on a TMA household. Sign in with it or contact TMA.";
  function saveHousehold(ctx, email2, params) {
    rateLimit(ctx, `hh-rl:${email2}`, 30, 3600, "Too many changes in a short time. Please try again later.");
    if (bool(params.leave, "Leave", false)) {
      leaveHousehold(ctx, email2);
      return buildBootstrap(ctx, email2);
    }
    const settings = ctx.m.settings();
    const input = parseInput(params, settings);
    if (!input.guardians.some((g) => g.email === email2)) {
      badRequest("Your own email must be one of the guardians.");
    }
    const family = ctx.m.familyForEmail(email2);
    if (!family) createHousehold(ctx, email2, input);
    else if (family.status === "Inactive") forbidden("This household is inactive. Please contact TMA.");
    else updateHousehold(ctx, email2, family, input);
    return buildBootstrap(ctx, email2);
  }
  function leaveHousehold(ctx, email2) {
    const family = ctx.m.familyForEmail(email2);
    if (!family) return;
    const [first, second] = family.slots;
    if (second.email !== email2 || first.email === email2) {
      badRequest("The first guardian can't leave a household in the app. Please contact TMA.");
    }
    ctx.db.update("Families", family.row, { "Parent 2 Name": "", "Parent 2 Email": "", "Parent 2 Phone": "" });
    ctx.log("household", `${family.id}: second guardian ${email2} left the household`);
  }
  function createHousehold(ctx, email2, input) {
    var _a, _b, _c, _d;
    for (const g of input.guardians) if (emailTaken(ctx, g.email)) conflict(TAKEN_MESSAGE);
    const familyId = nextSequentialId("F", referencedFamilyIds(ctx));
    const [g1, g2] = input.guardians.slice().sort((a, b) => Number(b.email === email2) - Number(a.email === email2));
    ctx.db.append("Families", [
      {
        FamilyID: familyId,
        "Parent Name": g1.name,
        Email: g1.email,
        Phone: (_a = g1.phone) != null ? _a : "",
        "Parent 2 Name": (_b = g2 == null ? void 0 : g2.name) != null ? _b : "",
        "Parent 2 Email": (_c = g2 == null ? void 0 : g2.email) != null ? _c : "",
        "Parent 2 Phone": (_d = g2 == null ? void 0 : g2.phone) != null ? _d : "",
        Status: "Pending",
        Member: false,
        Created: ctx.now
      }
    ]);
    const ids = newStudentIds(ctx, input.students.length);
    ctx.db.append(
      "Students",
      input.students.map((s, i) => studentRow(ids[i], familyId, s))
    );
    const names = [g1, g2].filter((g) => g !== void 0).map((g) => g.name).join(" & ");
    ctx.log("signup", `${familyId}: ${names} signed up with ${input.students.length} student(s)`);
    notifyAdmins(ctx, newSignupNotice(names, input.students.length, familyId));
  }
  function referencedFamilyIds(ctx) {
    const ids = ctx.m.families().map((f) => f.id);
    for (const s of ctx.m.students()) if (s.familyId) ids.push(s.familyId);
    for (const r of ctx.m.redemptions()) if (r.familyId) ids.push(r.familyId);
    return ids;
  }
  function referencedStudentIds(ctx) {
    const m = ctx.m;
    const ids = m.students().map((s) => s.id);
    for (const l of m.ledger()) ids.push(l.studentId);
    for (const e of m.enrollments()) ids.push(e.studentId);
    for (const p of m.payments()) ids.push(p.studentId);
    for (const r of m.redemptions()) if (r.studentId) ids.push(r.studentId);
    m.snapshot().forEach((snap) => ids.push(snap.studentId));
    return ids;
  }
  function newStudentIds(ctx, count) {
    const existing = referencedStudentIds(ctx);
    const ids = [];
    for (let i = 0; i < count; i++) {
      const id2 = nextSequentialId("S", existing.concat(ids));
      ids.push(id2);
    }
    return ids;
  }
  function assignGuardians(email2, family, guardians) {
    var _a, _b;
    const [e1, e2] = [family.slots[0].email, family.slots[1].email];
    const byEmail = new Map(guardians.map((g) => [g.email, g]));
    if (e1 && !byEmail.has(e1)) {
      badRequest("The first guardian on this household can't be removed in the app. Please contact TMA.");
    }
    let slot1 = e1 ? (_a = byEmail.get(e1)) != null ? _a : null : null;
    let slot2 = e2 && byEmail.has(e2) ? (_b = byEmail.get(e2)) != null ? _b : null : null;
    const callerIsFirst = e1 !== "" && email2 === e1;
    for (const g of guardians) {
      if (g === slot1 || g === slot2) continue;
      if (!slot1) slot1 = g;
      else if (!slot2 && (callerIsFirst || !e2)) slot2 = g;
      else badRequest("Only the first guardian can change the second guardian. Please contact TMA.");
    }
    return [slot1, slot2];
  }
  function updateHousehold(ctx, email2, family, input) {
    var _a, _b;
    const [slot1, slot2] = assignGuardians(email2, family, input.guardians);
    const storedEmails = new Set([family.slots[0].email, family.slots[1].email].filter((e) => e !== ""));
    for (const g of [slot1, slot2]) {
      if (g && !storedEmails.has(g.email) && emailTaken(ctx, g.email, family.id)) conflict(TAKEN_MESSAGE);
    }
    const current = ctx.m.studentsOfFamily(family.id);
    const updates = [];
    const added = [];
    for (const s of input.students) {
      if (!s.id) {
        added.push(s);
        continue;
      }
      const rec = current.find((c) => idKey(c.id) === idKey(s.id));
      if (!rec) notFound("That student isn't part of your household.");
      updates.push({ rec, input: s });
    }
    if (current.length + added.length > MAX_HOUSEHOLD_STUDENTS) {
      badRequest(`A household can have at most ${MAX_HOUSEHOLD_STUDENTS} students. Please contact TMA.`);
    }
    const slotPatch = (g, stored, names) => {
      var _a2, _b2;
      if (!g) return stored.email || stored.name ? { [names[0]]: "", [names[1]]: "", [names[2]]: "" } : {};
      const keepPhone = !g.phoneGiven && g.email === stored.email;
      return { [names[0]]: g.name, [names[1]]: g.email, [names[2]]: keepPhone ? (_a2 = stored.phone) != null ? _a2 : "" : (_b2 = g.phone) != null ? _b2 : "" };
    };
    const patch = {
      ...slot1 ? slotPatch(slot1, family.slots[0], ["Parent Name", "Email", "Phone"]) : {},
      ...slotPatch(slot2, family.slots[1], ["Parent 2 Name", "Parent 2 Email", "Parent 2 Phone"])
    };
    if (Object.keys(patch).length > 0) ctx.db.update("Families", family.row, patch);
    if (slot2 && slot2.email !== family.slots[1].email) {
      ctx.log("household", `${family.id}: second guardian set to ${slot2.email} by ${email2}`);
    } else if (!slot2 && family.slots[1].email) {
      ctx.log("household", `${family.id}: second guardian ${family.slots[1].email} removed by ${email2}`);
    }
    const knownGroups = ctx.m.settings().pub.ensembles;
    for (const { rec, input: s } of updates) {
      const sheetOnly = rec.ensembles.filter((e) => !isKnown(e, knownGroups));
      const studentPatch = {
        Grade: s.grade,
        School: s.school,
        Ensembles: joinList(uniqueBy([...s.ensembles, ...sheetOnly], (e) => e.toLowerCase()))
      };
      if (s.instrumentGiven) studentPatch.Instrument = (_a = s.instrument) != null ? _a : "";
      const sameName = rec.firstName.toLowerCase() === s.firstName.toLowerCase() && rec.lastName.toLowerCase() === s.lastName.toLowerCase();
      if (rec.status === "Pending") {
        studentPatch["First Name"] = s.firstName;
        studentPatch["Last Name"] = s.lastName;
      } else if (!sameName) {
        ctx.log("name-change", `${rec.id}: ${studentName(rec)} → ${s.firstName} ${s.lastName} requested by ${email2} (not applied)`);
      }
      ctx.db.update("Students", rec.row, studentPatch);
    }
    if (added.length > 0) {
      const ids = newStudentIds(ctx, added.length);
      ctx.db.append(
        "Students",
        added.map((s, i) => studentRow(ids[i], family.id, s))
      );
      const names = added.map((s) => `${s.firstName} ${s.lastName}`);
      ctx.log("signup", `${family.id}: added ${names.join(", ")}`);
      const refreshed = (_b = ctx.m.familyById(family.id)) != null ? _b : family;
      if (family.status === "Active") notifyAdmins(ctx, newStudentsNotice(guardianNames(refreshed), names, family.id));
    }
  }

  // src/server/me.ts
  var MAX_DEVICES_PER_EMAIL = 10;
  var DEVICE_COLUMNS2 = TABLES.Devices.headers;
  function savePrefs(ctx, email2, params) {
    if (!isRecord(params.prefs)) badRequest("Preferences are missing.");
    const input = params.prefs;
    for (const [key, label] of [
      ["schools", "Schools"],
      ["ensembles", "Groups"]
    ]) {
      if (input[key] !== void 0 && !Array.isArray(input[key])) badRequest(`${label} must be a list.`);
    }
    const prefs = sanitizePrefs(input, ctx.m.settings(), prefsFor(ctx, email2));
    const family = ctx.m.familyForEmail(email2);
    const row = {
      Email: email2,
      FamilyID: family ? family.id : "",
      Prefs: JSON.stringify(prefs),
      Updated: ctx.now
    };
    const existing = ctx.m.preferences().get(email2);
    if (existing) ctx.db.update("Preferences", existing.row, row);
    else ctx.db.append("Preferences", [row]);
    return { prefs: prefsFor(ctx, email2) };
  }
  var DEMO_TOKEN_RE = /^demo-[A-Za-z0-9_.:-]{8,200}$/;
  function tokenText(value) {
    if (typeof value !== "string" || value.trim() === "") return badRequest("Device token is missing.");
    if (value.length > LIMITS.token) badRequest("Device token is invalid.");
    return value.trim();
  }
  function demoKey(ctx, text2) {
    return ctx.s.mode === "demo" && DEMO_TOKEN_RE.test(text2) ? { token: text2, endpoint: null } : null;
  }
  function registrationKey(ctx, value) {
    const text2 = tokenText(value);
    const demo = demoKey(ctx, text2);
    if (demo) return demo;
    const parsed = parseSubscription(text2);
    if (!parsed.ok) {
      if (parsed.problem === "push_service") {
        badRequest("This browser's push service isn't supported. Try Chrome, Safari, Firefox or Edge.");
      }
      badRequest("Device token is invalid.");
    }
    const { subscription } = parsed;
    return { token: subscriptionToken(subscription), endpoint: subscription.endpoint };
  }
  function unregistrationKey(ctx, value) {
    const text2 = tokenText(value);
    const demo = demoKey(ctx, text2);
    if (demo) return demo;
    const endpoint = subscriptionEndpoint(text2);
    if (!endpoint) badRequest("Device token is invalid.");
    return { token: text2, endpoint };
  }
  function sameDevice(key) {
    if (key.endpoint === null) return (d) => d.token === key.token;
    const endpoint = key.endpoint;
    return (d) => subscriptionEndpoint(d.token) === endpoint;
  }
  function lastSeenMs(d) {
    var _a, _b;
    const t = Date.parse((_b = (_a = d.lastSeen) != null ? _a : d.createdAt) != null ? _b : "");
    return Number.isNaN(t) ? 0 : t;
  }
  function registerDevice(ctx, email2, params) {
    const key = registrationKey(ctx, params.token);
    const userAgent = typeof params.userAgent === "string" ? cleanText(params.userAgent).slice(0, LIMITS.userAgent) : "";
    rateLimit(ctx, `push-rl:${email2}`, 30, 3600, "Too many device registrations. Please try again later.");
    const family = ctx.m.familyForEmail(email2);
    const familyId = family && family.status !== "Inactive" ? family.id : "";
    const isThisDevice = sameDevice(key);
    const matches = ctx.m.devices().filter(isThisDevice);
    if (matches.length > 0) {
      const [first, ...duplicates] = matches;
      ctx.db.update("Devices", first.row, {
        Email: email2,
        FamilyID: familyId,
        Token: key.token,
        "User Agent": userAgent,
        "Last Seen": ctx.now
      });
      for (const d of duplicates) ctx.db.clear("Devices", d.row, DEVICE_COLUMNS2);
    } else {
      ctx.db.append("Devices", [
        { Email: email2, FamilyID: familyId, Token: key.token, "User Agent": userAgent, Created: ctx.now, "Last Seen": ctx.now }
      ]);
    }
    const mine = ctx.m.devicesFor(email2);
    if (mine.length > MAX_DEVICES_PER_EMAIL) {
      const oldest = mine.filter((d) => !isThisDevice(d)).sort((a, b) => lastSeenMs(a) - lastSeenMs(b) || a.row - b.row).slice(0, mine.length - MAX_DEVICES_PER_EMAIL);
      for (const d of oldest) ctx.db.clear("Devices", d.row, DEVICE_COLUMNS2);
    }
    return { devices: ctx.m.devicesFor(email2).length };
  }
  function unregisterDevice(ctx, email2, params) {
    const isThisDevice = sameDevice(unregistrationKey(ctx, params.token));
    for (const d of ctx.m.devicesFor(email2)) {
      if (isThisDevice(d)) ctx.db.clear("Devices", d.row, DEVICE_COLUMNS2);
    }
    return { devices: ctx.m.devicesFor(email2).length };
  }
  function testPush(ctx, email2) {
    rateLimit(ctx, `push-test-rl:${email2}`, 10, 3600, "Too many test notifications. Please try again later.");
    return deliver(ctx, [email2], testNotice(), { channels: { push: true, email: false, sms: false }, ignorePrefs: true });
  }

  // src/server/payments.ts
  var ORDER_TTL_SECONDS = 21600;
  var ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function orderKey(orderId) {
    return `order:${orderId}`;
  }
  function readOrder(raw) {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (!isRecord(o)) return null;
      const strings = ["email", "familyId", "studentId", "activityId"];
      const numbers = ["amountCents", "feeCents", "grossCents"];
      if (!strings.every((k) => typeof o[k] === "string") || !numbers.every((k) => Number.isInteger(o[k]))) return null;
      return o;
    } catch {
      return null;
    }
  }
  function paymentsUnavailable() {
    return fail("NOT_CONFIGURED", 'Online payments are not available right now. See "Other ways to pay".');
  }
  function createOrder(ctx, email2, params) {
    const studentId = id(params.studentId, "Student");
    const activityId = id(params.activityId, "Activity");
    const amount = cents(params.amountCents, "Amount", 1);
    const coverFee = bool(params.coverFee, "Cover the fee", false);
    const settings = ctx.m.settings().pub;
    if (!settings.onlinePaymentsEnabled) paymentsUnavailable();
    rateLimit(ctx, `pay-rl:${email2}`, 30, 3600, "Too many payment attempts in a short time. Please try again later.");
    const family = requireFamily(ctx, email2, { active: true });
    const student2 = requireOwnStudent(ctx, family, studentId);
    const activity = requireActivity(ctx, activityId);
    if (activity.status !== "Open") conflict(`${activity.name} is closed.`);
    if (!activity.allowOnlinePayment) badRequest(`${activity.name} can't be paid online. See "Other ways to pay".`);
    const account = ctx.m.books().account(student2.id, activity.id);
    if (!account || account.enrollmentStatus !== "Going") {
      badRequest(`${student2.firstName} isn't signed up as going on ${activity.name}.`);
    }
    const remaining = account.remainingCents;
    if (remaining <= 0) {
      conflict(
        account.pendingPaymentCents ? `A payment toward ${activity.name} is still being processed, so nothing is left to pay right now.` : `${activity.name} is already paid in full.`
      );
    }
    const minimum = Math.min(settings.minPaymentCents, remaining);
    if (amount < minimum) badRequest(`The smallest online payment is ${formatCents(minimum)}.`);
    if (amount > remaining) badRequest(`That's more than what's left to pay (${formatCents(remaining)}).`);
    const { grossCents, feeCents } = coverFee ? grossUpCents(amount, settings.feePercent, settings.feeFixedCents) : { grossCents: amount, feeCents: 0 };
    let orderId;
    try {
      orderId = ctx.s.payments.createOrder({
        amountCents: amount,
        feeCents,
        grossCents,
        itemName: truncate(`${activity.name} – ${student2.firstName} ${student2.lastName.charAt(0)}.`.replace(/ \.$/, ""), 127),
        description: truncate(`${settings.orgName}: payment toward ${activity.name}`, 127),
        referenceId: `${student2.id}:${activity.id}`,
        customId: `PO-${hex8(ctx.s.crypto.uuid())}`,
        brandName: truncate(settings.orgName, 127)
      }).orderId;
    } catch (err) {
      ctx.s.logger.error("PayPal createOrder failed", errorMessage(err));
      return fail("PAYMENT_FAILED", "We couldn't start the PayPal payment. Please try again in a minute.");
    }
    if (typeof orderId !== "string" || !ORDER_ID_RE.test(orderId)) {
      ctx.s.logger.error("PayPal returned an unexpected order id", orderId);
      fail("PAYMENT_FAILED", "We couldn't start the PayPal payment. Please try again in a minute.");
    }
    const order = {
      email: email2,
      familyId: family.id,
      studentId: student2.id,
      activityId: activity.id,
      amountCents: amount,
      feeCents,
      grossCents
    };
    ctx.s.cache.put(orderKey(orderId), JSON.stringify(order), ORDER_TTL_SECONDS);
    return { orderId, amountCents: amount, feeCents, grossCents };
  }
  function findPayment(ctx, references) {
    var _a;
    const keys = new Set(references.filter((r) => !!r).map(idKey));
    if (keys.size === 0) return null;
    return (_a = ctx.m.payments().find((p) => p.reference !== "" && keys.has(idKey(p.reference)))) != null ? _a : null;
  }
  function captureOrder(ctx, email2, params) {
    var _a, _b, _c, _d, _e, _f, _g;
    const orderId = id(params.orderId, "Order");
    if (!ORDER_ID_RE.test(orderId)) badRequest("Order is invalid.");
    const order = readOrder(ctx.s.cache.get(orderKey(orderId)));
    if (!order) notFound("This payment session expired. Please start the payment again.");
    if (order.email !== email2) forbidden("This payment was started by a different account.");
    const existing = findPayment(ctx, [order.captureId, orderId]);
    if (existing) return { payment: toPayment(existing) };
    const student2 = ctx.m.studentById(order.studentId);
    const activity = ctx.m.activityById(order.activityId);
    const firstName = (_a = student2 == null ? void 0 : student2.firstName) != null ? _a : order.studentId;
    const activityName = (_b = activity == null ? void 0 : activity.name) != null ? _b : order.activityId;
    if (!order.captureId && !order.unconfirmed) {
      const left = (_d = (_c = ctx.m.books().account(order.studentId, order.activityId)) == null ? void 0 : _c.remainingCents) != null ? _d : 0;
      if (order.amountCents > left) {
        ctx.log("payment", `${orderId}: not captured; ${formatCents(order.amountCents)} is more than the ${formatCents(left)} left for ${order.studentId} / ${order.activityId}`);
        fail(
          "PAYMENT_FAILED",
          left > 0 ? `Part of this was paid in the meantime and only ${formatCents(left)} is left, so this payment was stopped and you were not charged. Please start again with the new amount.` : `${activityName} was paid in the meantime, so this payment was stopped and you were not charged.`
        );
      }
    }
    let result;
    try {
      result = ctx.s.payments.captureOrder(orderId, `cap-${orderId}`);
    } catch (err) {
      ctx.s.logger.error("PayPal captureOrder failed", errorMessage(err));
      result = { status: "UNKNOWN", message: errorMessage(err) };
    }
    if (order.unconfirmed && (result.status === "FAILED" || result.status === "DECLINED")) {
      result = { status: "UNKNOWN", message: `retry: ${result.status}${result.message ? ` (${result.message})` : ""}` };
    }
    if (result.status === "UNKNOWN") {
      ctx.s.cache.put(orderKey(orderId), JSON.stringify({ ...order, unconfirmed: true }), ORDER_TTL_SECONDS);
      const detail = `${orderId}: PayPal did not confirm the capture of ${formatCents(order.grossCents)} (${(_e = result.message) != null ? _e : "no answer"}); check PayPal (${email2}, ${order.studentId}, ${order.activityId})`;
      ctx.log("payment-error", detail);
      ctx.s.logger.error("Capture outcome unknown", detail);
      if (!order.unconfirmed) notifyAdmins(ctx, paymentUnconfirmedNotice(firstName, activityName, order.grossCents, orderId));
      fail(
        "INTERNAL",
        "We couldn't confirm the payment with PayPal. If PayPal emailed you a receipt, it went through and TMA will record it. Please don't pay again until it shows in the app."
      );
    }
    const captureId = typeof result.captureId === "string" && result.captureId.trim() !== "" ? result.captureId.trim() : void 0;
    if (captureId) {
      ctx.s.cache.put(orderKey(orderId), JSON.stringify({ ...order, captureId }), ORDER_TTL_SECONDS);
      const already = findPayment(ctx, [captureId]);
      if (already) return { payment: toPayment(already) };
    }
    if (result.status === "COMPLETED") {
      if (result.grossCents !== order.grossCents) {
        const detail = `${orderId}/${captureId != null ? captureId : "?"}: PayPal captured ${result.grossCents === void 0 ? "an unknown amount" : formatCents(result.grossCents)}, expected ${formatCents(order.grossCents)} (${email2}, ${order.studentId}, ${order.activityId})`;
        ctx.log("payment-error", detail);
        ctx.s.logger.error("Capture amount mismatch", detail);
        notifyAdmins(ctx, paymentReviewNotice(firstName, activityName, captureId != null ? captureId : orderId));
        fail("PAYMENT_FAILED", "PayPal reported a different amount than expected. TMA will check it and contact you.");
      }
    } else if (result.status !== "PENDING") {
      ctx.log("payment", `${orderId}: capture ${result.status}${result.message ? ` (${result.message})` : ""}`);
      fail("PAYMENT_FAILED", "The payment didn't go through, and you were not charged. Please try another payment method.");
    }
    const status = result.status === "COMPLETED" ? "Completed" : "Pending";
    const reference = captureId != null ? captureId : orderId;
    ctx.db.append("Payments", [
      {
        Date: ctx.today,
        StudentID: order.studentId,
        ActivityID: order.activityId,
        Amount: centsToDollars(order.amountCents),
        "Fee Covered": centsToDollars(order.feeCents),
        Gross: centsToDollars(order.grossCents),
        Method: "PayPal",
        Reference: reference,
        "Payer Email": email2,
        Status: status
      }
    ]);
    ctx.log("payment", `${reference}: ${formatCents(order.grossCents)} via PayPal from ${email2} for ${order.studentId} / ${order.activityId} (${status})`);
    const recorded = findPayment(ctx, [reference]);
    if (!recorded) throw new Error(`Payment ${reference} was not saved`);
    if (order.unconfirmed) notifyAdmins(ctx, paymentRecordedAfterReviewNotice(firstName, activityName, order.grossCents, orderId, reference, status === "Pending"));
    if (status === "Completed") {
      const remaining = (_g = (_f = ctx.m.books().account(order.studentId, order.activityId)) == null ? void 0 : _f.remainingCents) != null ? _g : 0;
      notifyFamily(
        ctx,
        ctx.m.familyById(order.familyId),
        paymentReceivedNotice(firstName, order.amountCents, activityName, remaining, reference)
      );
    }
    return { payment: toPayment(recorded) };
  }

  // src/server/redemptions.ts
  var MIN_REDEMPTION_CENTS = 100;
  var MAX_PENDING_PER_FAMILY = 20;
  function newRequestId(ctx) {
    const taken = new Set(ctx.m.redemptions().map((r) => idKey(r.id)));
    for (let i = 0; i < 5; i++) {
      const id2 = `R-${hex8(ctx.s.crypto.uuid())}`;
      if (!taken.has(idKey(id2))) return id2;
    }
    throw new Error("Could not generate a unique request ID");
  }
  function requestRedemption(ctx, email2, params) {
    const studentId = id(params.studentId, "Student");
    const activityId = id(params.activityId, "Activity");
    const amount = cents(params.amountCents, "Amount", MIN_REDEMPTION_CENTS);
    const note = optText(params.note, "Note", LIMITS.note, true);
    rateLimit(ctx, `red-rl:${email2}`, 20, 3600, "Too many requests in a short time. Please try again later.");
    const family = requireFamily(ctx, email2, { active: true });
    const student2 = requireOwnStudent(ctx, family, studentId);
    const activity = requireActivity(ctx, activityId);
    if (activity.status !== "Open") conflict(`${activity.name} is closed.`);
    if (!activity.allowFunds) badRequest(`Activity funds can't be used for ${activity.name}.`);
    const books = ctx.m.books();
    const account = books.account(student2.id, activity.id);
    if (!account || account.enrollmentStatus !== "Going") {
      badRequest(`${student2.firstName} isn't signed up as going on ${activity.name}.`);
    }
    const available = books.available(student2.id);
    if (amount > available) {
      badRequest(`That's more than ${student2.firstName}'s available activity funds (${formatCents(available)}).`);
    }
    const room = Math.max(0, account.remainingCents - books.pendingFor(student2.id, activity.id));
    if (amount > room) {
      badRequest(
        room === 0 ? `Nothing is left to cover on ${activity.name} after pending requests.` : `That's more than what's left to pay on ${activity.name} (${formatCents(room)} after pending requests).`
      );
    }
    const pendingCount = ctx.m.redemptions().filter((r) => r.status === "Pending" && idKey(r.familyId) === idKey(family.id)).length;
    if (pendingCount >= MAX_PENDING_PER_FAMILY) conflict("You have many pending requests. Please wait for TMA to review them.");
    const id2 = newRequestId(ctx);
    ctx.db.append("Redemptions", [
      {
        RequestID: id2,
        Requested: ctx.now,
        Email: email2,
        FamilyID: family.id,
        StudentID: student2.id,
        ActivityID: activity.id,
        Amount: centsToDollars(amount),
        Note: note,
        Status: "Pending"
      }
    ]);
    ctx.log("redemption", `${id2}: ${email2} requested ${formatCents(amount)} from ${student2.id} for ${activity.id}`);
    notifyAdmins(ctx, fundsRequestNotice(guardianName(family, email2), amount, student2.firstName, activity.name, id2));
    const created = ctx.m.redemptionById(id2);
    if (!created) throw new Error(`Redemption ${id2} was not saved`);
    return { redemption: toRedemption(created) };
  }
  function cancelRedemption(ctx, email2, params) {
    var _a;
    const id2 = id(params.id, "Request");
    const family = requireFamily(ctx, email2);
    const rec = ctx.m.redemptionById(id2);
    if (!rec || idKey(rec.familyId) !== idKey(family.id)) return notFound("Request not found.");
    if (rec.status !== "Pending") conflict(`This request was already ${rec.status.toLowerCase()}.`);
    ctx.db.update("Redemptions", rec.row, {
      Status: "Cancelled",
      Decided: ctx.now,
      "Decided By": email2,
      Notified: ctx.now
    });
    ctx.log("redemption", `${rec.id}: cancelled by ${email2}`);
    return { redemption: toRedemption((_a = ctx.m.redemptionById(rec.id)) != null ? _a : rec) };
  }
  function ledgerHasReference(ctx, requestId) {
    const key = idKey(requestId);
    return ctx.m.ledger().some((l) => l.reference !== void 0 && idKey(l.reference) === key);
  }
  function postRedemptionLedger(ctx, rec, enteredBy) {
    var _a, _b;
    if (ledgerHasReference(ctx, rec.id)) return false;
    const activity = ctx.m.activityById(rec.activityId);
    ctx.db.append("Ledger", [
      {
        Date: ctx.today,
        StudentID: rec.studentId,
        Type: "Redemption",
        Description: `Applied to ${(_a = activity == null ? void 0 : activity.name) != null ? _a : rec.activityId}`,
        Amount: -centsToDollars(rec.amountCents),
        ActivityID: (_b = activity == null ? void 0 : activity.id) != null ? _b : rec.activityId,
        Reference: rec.id,
        "Entered By": enteredBy
      }
    ]);
    adjustSnapshot(ctx, rec.studentId, -rec.amountCents);
    return true;
  }
  function adjustSnapshot(ctx, studentId, deltaCents) {
    const snapshot = ctx.m.snapshot();
    if (snapshot.size === 0) return;
    const current = snapshot.get(idKey(studentId));
    if (current) {
      ctx.db.update("_Snapshot", current.row, {
        Balance: centsToDollars(current.balanceCents + deltaCents),
        Updated: ctx.now
      });
    } else {
      ctx.db.append("_Snapshot", [{ StudentID: studentId, Balance: centsToDollars(deltaCents), Updated: ctx.now }]);
    }
  }
  function notifyDecision(ctx, rec) {
    var _a, _b, _c;
    const family = ctx.m.familyById(rec.familyId);
    const student2 = ctx.m.studentById(rec.studentId);
    const activity = ctx.m.activityById(rec.activityId);
    if (!family || family.status !== "Active" || !student2) return { push: 0, email: 0, sms: 0 };
    const activityName = (_a = activity == null ? void 0 : activity.name) != null ? _a : rec.activityId;
    if (rec.status === "Approved") {
      const remaining = (_c = (_b = ctx.m.books().account(student2.id, rec.activityId)) == null ? void 0 : _b.remainingCents) != null ? _c : 0;
      return notifyFamily(ctx, family, redemptionApprovedNotice(student2.firstName, rec.amountCents, activityName, remaining, rec.id));
    }
    return notifyFamily(ctx, family, redemptionDeniedNotice(rec.amountCents, activityName, rec.adminNote, rec.id));
  }
  function decideRedemption(ctx, adminEmail, params) {
    var _a, _b, _c, _d;
    const id2 = id(params.id, "Request");
    const decision = oneOf(params.decision, "Decision", ["Approved", "Denied"]);
    const adminNote = optText(params.adminNote, "Note", LIMITS.note, true);
    const rec = ctx.m.redemptionById(id2);
    if (!rec) return notFound("Request not found.");
    if (rec.status !== "Pending") conflict(`This request was already ${rec.status.toLowerCase()}.`);
    if (decision === "Approved" && ledgerHasReference(ctx, rec.id)) {
      ctx.log("redemption", `${rec.id}: Ledger row already in the sheet; not posting another`);
    } else if (decision === "Approved") {
      const books = ctx.m.books();
      const student2 = ctx.m.studentById(rec.studentId);
      const name = (_a = student2 == null ? void 0 : student2.firstName) != null ? _a : rec.studentId;
      const available = Math.max(0, books.balance(rec.studentId) - (books.pending(rec.studentId) - rec.amountCents));
      if (rec.amountCents > available) {
        conflict(`${name} only has ${formatCents(available)} available, less than the ${formatCents(rec.amountCents)} requested. Deny it or ask the family to request less.`);
      }
      const remaining = (_c = (_b = books.account(rec.studentId, rec.activityId)) == null ? void 0 : _b.remainingCents) != null ? _c : 0;
      if (rec.amountCents > remaining) {
        conflict(`Only ${formatCents(remaining)} is left to pay on this activity, less than the ${formatCents(rec.amountCents)} requested.`);
      }
      postRedemptionLedger(ctx, rec, adminEmail);
    }
    const patch = {
      Status: decision,
      Decided: ctx.now,
      "Decided By": adminEmail,
      "Admin Note": adminNote,
      Notified: ctx.now
    };
    ctx.db.update("Redemptions", rec.row, patch);
    ctx.log("redemption", `${rec.id}: ${decision.toLowerCase()} by ${adminEmail}`);
    const updated = (_d = ctx.m.redemptionById(rec.id)) != null ? _d : rec;
    notifyDecision(ctx, updated);
    return { redemption: toRedemption(updated) };
  }

  // src/server/sample-data.ts
  var TREASURER = "treasurer@example.com";
  var TMA_SITE = "https://sites.google.com/view/timberlanemusicassociation/home";
  function sampleData(today, opts = {}) {
    const base = nyDate(today);
    const day = (offset) => addDays(base, offset);
    const at = (offset, hour = 12, minute = 0) => {
      const [y, m, d] = day(offset).split("-").map((n) => parseInt(n, 10));
      return nyLocalToDate(y, m, d, hour, minute).toISOString();
    };
    const credit = (offset, studentId, type, description, amount) => ({
      Date: day(offset),
      StudentID: studentId,
      Type: type,
      Description: description,
      Amount: amount,
      ActivityID: "",
      Reference: "",
      "Entered By": TREASURER
    });
    const ledger = [
      credit(-330, "S0001", "Fundraiser", "Poinsettia sale (last year)", 120),
      credit(-330, "S0003", "Fundraiser", "Poinsettia sale (last year)", 90),
      credit(-330, "S0005", "Fundraiser", "Poinsettia sale (last year)", 140),
      credit(-240, "S0001", "Fundraiser", "Cookie Dough fundraiser", 185),
      credit(-240, "S0002", "Fundraiser", "Cookie Dough fundraiser", 55),
      credit(-240, "S0003", "Fundraiser", "Cookie Dough fundraiser", 210),
      credit(-240, "S0005", "Fundraiser", "Cookie Dough fundraiser", 230),
      {
        ...credit(-180, "S0001", "Redemption", "Applied to New York City 2025", -200),
        ActivityID: "NYC25"
      },
      credit(-150, "S0001", "Fundraiser", "Pizza Night", 60),
      credit(-150, "S0002", "Fundraiser", "Pizza Night", 30),
      credit(-150, "S0003", "Fundraiser", "Pizza Night", 60),
      credit(-90, "S0001", "Fundraiser", "Car Wash", 95),
      credit(-90, "S0003", "Fundraiser", "Car Wash", 95),
      credit(-90, "S0005", "Fundraiser", "Car Wash", 95),
      credit(-75, "S0003", "Donation", "Donation from a family friend (designated)", 250),
      {
        ...credit(-60, "S0003", "Redemption", "Applied to Florida 2027 deposit", -350),
        ActivityID: "FL27"
      },
      credit(-45, "S0001", "Donation", "Donation from grandparents (designated)", 250),
      credit(-45, "S0005", "Donation", "Donation (designated)", 55),
      credit(-12, "S0001", "Fundraiser", "Poinsettia sale", 130),
      credit(-12, "S0003", "Fundraiser", "Poinsettia sale", 55),
      credit(-12, "S0004", "Fundraiser", "Poinsettia sale", 35)
    ];
    const balances = { S0001: 640, S0002: 85, S0003: 410, S0004: 35, S0005: 520, S0006: 0 };
    const data = {
      Families: [
        {
          FamilyID: "F0001",
          "Parent Name": "Jordan Thompson",
          Email: "parent@example.com",
          Phone: "603-555-0142",
          "Parent 2 Name": "Casey Thompson",
          "Parent 2 Email": "casey.thompson@example.com",
          "Parent 2 Phone": "",
          Status: "Active",
          Member: true,
          Created: at(-400, 19, 5)
        },
        {
          FamilyID: "F0002",
          "Parent Name": "Priya Nguyen",
          Email: "nguyen.family@example.com",
          Phone: "603-555-0187",
          "Parent 2 Name": "",
          "Parent 2 Email": "",
          "Parent 2 Phone": "",
          Status: "Active",
          Member: true,
          Created: at(-380, 20, 30)
        },
        {
          FamilyID: "F0003",
          "Parent Name": "Marcus Ortiz",
          Email: "ortiz@example.com",
          Phone: "",
          "Parent 2 Name": "",
          "Parent 2 Email": "",
          "Parent 2 Phone": "",
          Status: "Pending",
          Member: false,
          Created: at(-2, 21, 14)
        }
      ],
      Students: [
        student("S0001", "F0001", "Avery", "Thompson", 11, "High School", "Band, Marching Band, Jazz Band", "Trumpet", "Active"),
        student("S0002", "F0001", "Liam", "Thompson", 7, "Middle School", "Chorus", "", "Active"),
        student("S0003", "F0002", "Maya", "Nguyen", 10, "High School", "Orchestra", "Violin", "Active"),
        student("S0004", "F0002", "Ethan", "Nguyen", 5, "Elementary", "Orchestra", "Cello", "Active"),
        student("S0005", "", "Sofia", "Ortiz", 12, "High School", "Chorus", "", "Active"),
        student("S0006", "F0003", "Sofia", "Ortiz", 12, "High School", "Chorus", "", "Pending")
      ],
      Activities: [
        {
          ActivityID: "FL27",
          Name: "Florida 2027 – Disney & Universal",
          Kind: "Trip",
          Description: "Performance trip for High School Band, Jazz Band, Orchestra and Chorus: perform at Disney Springs and take a Universal music workshop.",
          Schools: "High School",
          Ensembles: "Band, Marching Band, Jazz Band, Orchestra, Chorus",
          Cost: 1850,
          Deposit: 350,
          "Deposit Due": day(25),
          "Due Date": day(100),
          Status: "Open",
          "Allow Funds": true,
          "Allow Online Payment": true,
          "Info URL": TMA_SITE
        },
        {
          ActivityID: "CAMP27",
          Name: "Marching Band Camp 2027",
          Kind: "Camp",
          Description: "One week of summer band camp before the marching season. Includes meals and the camp T-shirt.",
          Schools: "High School",
          Ensembles: "Band, Marching Band",
          Cost: 275,
          Deposit: "",
          "Deposit Due": "",
          "Due Date": day(200),
          Status: "Open",
          "Allow Funds": true,
          "Allow Online Payment": true,
          "Info URL": ""
        },
        {
          ActivityID: "LESSONS",
          Name: "TRSD Private Lessons 2026–27",
          Kind: "Lessons",
          Description: "Weekly private lessons with district-approved teachers. Cost is set per student.",
          Schools: "",
          Ensembles: "",
          Cost: "",
          Deposit: "",
          "Deposit Due": "",
          "Due Date": day(14),
          Status: "Open",
          "Allow Funds": true,
          "Allow Online Payment": false,
          "Info URL": ""
        },
        {
          ActivityID: "NYC25",
          Name: "New York City 2025",
          Kind: "Trip",
          Description: "Broadway workshop and performance.",
          Schools: "High School",
          Ensembles: "",
          Cost: 650,
          Deposit: "",
          "Deposit Due": "",
          "Due Date": day(-200),
          Status: "Closed",
          "Allow Funds": false,
          "Allow Online Payment": false,
          "Info URL": ""
        }
      ],
      Enrollments: [
        { StudentID: "S0001", ActivityID: "FL27", Cost: "", Status: "Going" },
        { StudentID: "S0001", ActivityID: "CAMP27", Cost: "", Status: "Going" },
        { StudentID: "S0003", ActivityID: "FL27", Cost: "", Status: "Going" },
        { StudentID: "S0003", ActivityID: "LESSONS", Cost: 360, Status: "Going" },
        { StudentID: "S0005", ActivityID: "FL27", Cost: "", Status: "Going" }
      ],
      Ledger: ledger,
      Payments: [
        {
          Date: day(-20),
          StudentID: "S0001",
          ActivityID: "FL27",
          Amount: 350,
          "Fee Covered": 0,
          Gross: 350,
          Method: "Check",
          Reference: "Check #1043 (deposit)",
          "Payer Email": "parent@example.com",
          Status: "Completed"
        }
      ],
      Redemptions: [
        {
          RequestID: "R-7f3a9c21",
          Requested: at(-1, 19, 42),
          Email: "parent@example.com",
          FamilyID: "F0001",
          StudentID: "S0001",
          ActivityID: "FL27",
          Amount: 200,
          Note: "Please use Avery's Car Wash and Poinsettia credits.",
          Status: "Pending",
          Decided: "",
          "Decided By": "",
          "Admin Note": "",
          Notified: ""
        }
      ],
      Announcements: [
        {
          ID: "A-1e7d4b90",
          Date: day(-12),
          Title: "Poinsettia credits posted",
          Body: "Thank you for a great Poinsettia sale! Each student's share has been added to their activity funds. Check your balance in the app.",
          Schools: "",
          Ensembles: "",
          Link: "",
          Sent: at(-12, 20, 0)
        },
        {
          ID: "A-5c2f8a14",
          Date: day(-7),
          Title: "Winter Concert volunteers needed",
          Body: "We need about 10 parents to help with ushering, the bake table and stage crew at the High School Winter Concert.\n\nReply to this email or sign up at the next TMA meeting. Thank you!",
          Schools: "High School",
          Ensembles: "Chorus",
          Link: "",
          Sent: at(-7, 18, 30)
        },
        {
          ID: "A-3b9e1d07",
          Date: day(-3),
          Title: "Florida 2027 deposit reminder",
          Body: `The $350 deposit for Florida 2027 is due ${shortDate(day(25))}. You can apply activity funds or pay online in the TMA app, or mail a check.`,
          Schools: "High School",
          Ensembles: "",
          Link: TMA_SITE,
          Sent: at(-3, 9, 0)
        },
        {
          ID: "A-9a6c3e52",
          Date: day(5),
          Title: "Florida 2027 family information night",
          Body: "Families of students going to Florida 2027: join us in the TRHS Library for the itinerary, packing list and Q&A.",
          Schools: "High School",
          Ensembles: "",
          Link: "",
          Sent: ""
        }
      ],
      Events: [
        {
          ID: "EV-JAZZ",
          Date: day(1),
          Time: "7:00 PM",
          Title: "Jazz Night",
          Location: "TRHS Cafeteria",
          Details: "Jazz Band performs with guest musicians. Desserts by TMA volunteers.",
          Schools: "",
          Ensembles: "Jazz Band"
        },
        {
          ID: "EV-MEETING",
          Date: day(12),
          Time: "7:00 PM",
          Title: "TMA monthly meeting",
          Location: "TRHS Library",
          Details: "All music families are welcome. Bring your questions about trips and fundraisers.",
          Schools: "",
          Ensembles: ""
        },
        {
          ID: "EV-MSWC",
          Date: day(48),
          Time: "6:30 PM",
          Title: "Middle School Winter Concert",
          Location: "Timberlane Regional Middle School Gym",
          Details: "",
          Schools: "Middle School",
          Ensembles: ""
        },
        {
          ID: "EV-HSWC",
          Date: day(50),
          Time: "7:00 PM",
          Title: "High School Winter Concert",
          Location: "TRHS Auditorium",
          Details: "Band, Orchestra and Chorus. Doors open at 6:30 PM.",
          Schools: "High School",
          Ensembles: ""
        }
      ],
      // Matches the ledger, so the first sync sends nothing and new credits notify right away.
      _Snapshot: Object.keys(balances).map((id2) => ({ StudentID: id2, Balance: balances[id2], Updated: at(-1, 8, 0) }))
    };
    if (opts.demoSettings) {
      const overrides = {
        ADMIN_EMAILS: TREASURER,
        ONLINE_PAYMENTS: "TRUE",
        PAYPAL_CLIENT_ID: "demo",
        APP_URL: ""
      };
      data.Settings = Object.keys(SETTING_DEFAULTS).map((key) => {
        var _a;
        return {
          Key: key,
          Value: (_a = overrides[key]) != null ? _a : SETTING_DEFAULTS[key],
          Notes: SETTING_NOTES[key]
        };
      });
      data.Devices = [
        {
          Email: "parent@example.com",
          FamilyID: "F0001",
          Token: "demo-device-parent",
          "User Agent": "Demo phone",
          Created: at(-30, 19, 0),
          "Last Seen": at(-1, 7, 30)
        }
      ];
    }
    return data;
  }
  function student(id2, familyId, first, last, grade, school, ensembles, instrument, status) {
    return {
      StudentID: id2,
      FamilyID: familyId,
      "First Name": first,
      "Last Name": last,
      Grade: grade,
      School: school,
      Ensembles: ensembles,
      Instrument: instrument,
      Status: status
    };
  }

  // src/server/setup.ts
  var SEED_GUARD = ["Families", "Students", "Ledger"];
  function generateSecret(c, name) {
    const secret = c.hmacSha256Hex(c.uuid(), `${c.uuid()}${c.uuid()}${c.randomDigits(32)}`);
    if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error(`Could not generate ${name}`);
    return secret;
  }
  function runSetup(ctx, options = {}) {
    const report = { createdTables: [], addedColumns: [], seeded: false, secretsInitialized: [] };
    for (const table of TABLE_ORDER) {
      const result = ctx.db.ensureTable(table);
      if (result.created) report.createdTables.push(table);
      for (const column of result.addedColumns) report.addedColumns.push({ table, column });
    }
    const present = new Set(ctx.db.rows("Settings").map((r) => settingKey(r.data.Key)));
    const missing = Object.keys(SETTING_DEFAULTS).filter((key) => !present.has(key)).map((key) => ({ Key: key, Value: SETTING_DEFAULTS[key], Notes: SETTING_NOTES[key] }));
    ctx.db.append("Settings", missing);
    if (!ctx.s.secrets.get("TOKEN_SECRET")) {
      ctx.s.secrets.set("TOKEN_SECRET", generateSecret(ctx.s.crypto, "TOKEN_SECRET"));
      report.secretsInitialized.push("TOKEN_SECRET");
    }
    if (options.seedSampleData && SEED_GUARD.every((t) => ctx.db.rows(t).length === 0)) {
      const data = sampleData(ctx.now);
      for (const table of TABLE_ORDER) {
        const rows = data[table];
        if (rows && rows.length > 0 && ctx.db.rows(table).length === 0) ctx.db.append(table, rows);
      }
      report.seeded = true;
    }
    ctx.log(
      "setup",
      [
        report.createdTables.length ? `created ${report.createdTables.join(", ")}` : "tabs ok",
        report.addedColumns.length ? `added ${report.addedColumns.length} column(s)` : "",
        missing.length ? `added ${missing.length} setting(s)` : "",
        report.secretsInitialized.length ? "created TOKEN_SECRET" : "",
        report.seeded ? "seeded sample data" : ""
      ].filter((s) => s !== "").join("; ")
    );
    return report;
  }

  // src/server/sync.ts
  var SETTLE_MS = 5 * 60 * 1e3;
  var ANNOUNCE_FROM_HOUR = 8;
  var SETTLE_TTL_SECONDS = 21600;
  function emptyReport(now) {
    return {
      ranAt: now.toISOString(),
      balanceChanges: 0,
      redemptionsPosted: 0,
      announcementsSent: 0,
      remindersSent: 0,
      notifications: zeroCounts(),
      errors: []
    };
  }
  function recordError(ctx, report, step2, err) {
    const message = `${step2}: ${errorMessage(err)}`;
    report.errors.push(message);
    ctx.s.logger.error(`syncTick step failed: ${step2}`, err);
    ctx.log("error", message);
  }
  function step(ctx, report, name, fn) {
    try {
      fn();
    } catch (err) {
      recordError(ctx, report, name, err);
    }
  }
  function runSync(ctx) {
    const report = emptyReport(ctx.now);
    step(ctx, report, "redemptions", () => postSheetDecisions(ctx, report));
    step(ctx, report, "balances", () => detectBalanceChanges(ctx, report));
    step(ctx, report, "announcements", () => sendQueuedAnnouncements(ctx, report));
    return report;
  }
  function runDaily(ctx) {
    const report = emptyReport(ctx.now);
    step(ctx, report, "payment reminders", () => sendPaymentReminders(ctx, report));
    step(ctx, report, "event reminders", () => sendEventReminders(ctx, report));
    return report;
  }
  function requireColumns(ctx, table, columns, tabRequired = false) {
    const present = ctx.db.columns(table);
    if (present === void 0) return;
    if (present === null) {
      if (tabRequired) throw new Error(`The ${table} tab is missing (was it renamed?), so this step was skipped. Rename it back to ${table}.`);
      return;
    }
    const missing = columns.filter((c) => !present.includes(c));
    if (missing.length > 0) {
      const names = missing.map((c) => `"${c}"`).join(", ");
      throw new Error(
        `The ${table} tab has no ${names} column, so this step was skipped rather than reading every row as blank. If a header was renamed (or the header row sorted), change it back.`
      );
    }
  }
  function settled(ctx, kind, content) {
    const key = `settle:${kind}:${ctx.s.crypto.hmacSha256Hex("tma-settle", JSON.stringify(content))}`;
    const firstSeen = Number(ctx.s.cache.get(key));
    if (Number.isFinite(firstSeen) && firstSeen > 0) return ctx.now.getTime() - firstSeen >= SETTLE_MS;
    ctx.s.cache.put(key, String(ctx.now.getTime()), SETTLE_TTL_SECONDS);
    return false;
  }
  function countWaiting(report) {
    var _a;
    report.waiting = ((_a = report.waiting) != null ? _a : 0) + 1;
  }
  function reread(ctx, table, list2, before, same) {
    var _a, _b;
    ctx.db.refresh(table);
    const matches = list2().filter(same);
    return (_b = (_a = matches.find((r) => r.row === before.row)) != null ? _a : matches[0]) != null ? _b : null;
  }
  function decisionContent(r) {
    var _a, _b;
    return [idKey(r.id), r.status, (_a = r.adminNote) != null ? _a : "", r.amountCents, idKey(r.studentId), idKey(r.activityId), (_b = r.decidedBy) != null ? _b : ""];
  }
  function announcementContent(a) {
    var _a;
    return [a.storedId, a.date, a.title, a.body, a.audience.schools, a.audience.ensembles, (_a = a.link) != null ? _a : ""];
  }
  function postSheetDecisions(ctx, report) {
    requireColumns(ctx, "Redemptions", ["RequestID", "StudentID", "ActivityID", "Amount", "Status", "Notified"]);
    const decided = ctx.m.redemptions().filter((r) => (r.status === "Approved" || r.status === "Denied") && !r.notifiedAt);
    if (decided.some((r) => r.status === "Approved")) requireColumns(ctx, "Ledger", ["StudentID", "Amount", "Reference"], true);
    for (const candidate of decided) {
      try {
        if (!settled(ctx, "decision", decisionContent(candidate))) {
          countWaiting(report);
          continue;
        }
        const content = JSON.stringify(decisionContent(candidate));
        const rec = reread(ctx, "Redemptions", () => ctx.m.redemptions(), candidate, (r) => !r.notifiedAt && JSON.stringify(decisionContent(r)) === content);
        if (!rec) continue;
        if (rec.status === "Approved" && !ledgerHasReference(ctx, rec.id)) {
          if (rec.amountCents <= 0 || !rec.studentId) throw new Error(`${rec.id} has no student or amount`);
          if (postRedemptionLedger(ctx, rec, rec.decidedBy || "TMA sheet")) report.redemptionsPosted++;
        }
        const patch = { Notified: ctx.now };
        if (!rec.decidedAt) patch.Decided = ctx.now;
        ctx.db.update("Redemptions", rec.row, patch);
        ctx.log("redemption", `${rec.id}: ${rec.status.toLowerCase()} in the sheet${rec.status === "Approved" ? ", ledger posted" : ""}`);
        addCounts(report.notifications, notifyDecision(ctx, rec));
      } catch (err) {
        recordError(ctx, report, `redemption ${candidate.id}`, err);
      }
    }
  }
  function detectBalanceChanges(ctx, report) {
    requireColumns(ctx, "Ledger", ["StudentID", "Amount"], true);
    const books = ctx.m.books();
    const current = /* @__PURE__ */ new Map();
    for (const s of ctx.m.students()) current.set(idKey(s.id), { studentId: s.id, cents: books.balance(s.id) });
    for (const key of books.ledgerStudentKeys()) {
      if (!current.has(key)) current.set(key, { studentId: key, cents: books.balance(key) });
    }
    const snapshot = ctx.m.snapshot();
    const rows = () => Array.from(current.values()).map((c) => ({
      StudentID: c.studentId,
      Balance: centsToDollars(c.cents),
      Updated: ctx.now
    }));
    if (snapshot.size === 0) {
      if (current.size > 0) {
        ctx.db.overwrite("_Snapshot", rows());
        ctx.log("sync", `First run: saved ${current.size} balances (no notifications)`);
      }
      return;
    }
    if (books.ledgerStudentKeys().length === 0 && Array.from(snapshot.values()).some((s) => s.balanceCents !== 0)) {
      throw new Error(
        "The Ledger tab has no rows with a StudentID and an Amount, but earlier runs saw balances, so no family was told about a change. If the Ledger really was emptied, clear the _Snapshot tab."
      );
    }
    let changed = false;
    const alerts = [];
    current.forEach((cur, key) => {
      const before = snapshot.get(key);
      const delta = cur.cents - (before ? before.balanceCents : 0);
      if (delta === 0) return;
      changed = true;
      report.balanceChanges++;
      alerts.push({ studentId: cur.studentId, delta, balance: cur.cents });
    });
    snapshot.forEach((_, key) => {
      if (!current.has(key)) changed = true;
    });
    if (changed) ctx.db.overwrite("_Snapshot", rows());
    for (const alert2 of alerts) {
      const student2 = ctx.m.studentById(alert2.studentId);
      if (!student2 || !ctx.m.isVerified(student2)) continue;
      try {
        const notice = alert2.delta > 0 ? creditNotice(student2.firstName, alert2.delta, alert2.balance, student2.id) : debitNotice(student2.firstName, alert2.delta, alert2.balance, student2.id);
        addCounts(report.notifications, notifyFamily(ctx, ctx.m.familyById(student2.familyId), notice));
      } catch (err) {
        recordError(ctx, report, `balance ${student2.id}`, err);
      }
    }
  }
  function sendQueuedAnnouncements(ctx, report) {
    requireColumns(ctx, "Announcements", ["Date", "Title", "Body", "Schools", "Ensembles", "Sent"]);
    const morning = nyParts(ctx.now).hour >= ANNOUNCE_FROM_HOUR;
    const isDue = (a) => !a.date || a.date < ctx.today || a.date === ctx.today && morning;
    let recipients = null;
    for (const candidate of ctx.m.announcements().filter((a) => !a.sent)) {
      try {
        const stable = settled(ctx, "announcement", announcementContent(candidate));
        if (!isDue(candidate)) continue;
        if (!stable) {
          countWaiting(report);
          continue;
        }
        const content = JSON.stringify(announcementContent(candidate));
        const a = reread(ctx, "Announcements", () => ctx.m.announcements(), candidate, (x) => !x.sent && JSON.stringify(announcementContent(x)) === content);
        if (!a) continue;
        ctx.db.update("Announcements", a.row, { Sent: ctx.now });
        recipients != null ? recipients : recipients = allRecipients(ctx);
        addCounts(report.notifications, deliver(ctx, recipients, announcementNotice(a)));
        report.announcementsSent++;
      } catch (err) {
        recordError(ctx, report, `announcement ${candidate.id}`, err);
      }
    }
  }
  function sendPaymentReminders(ctx, report) {
    const days = ctx.m.settings().reminderDays;
    if (days.length === 0) return;
    requireColumns(ctx, "Ledger", ["StudentID", "Amount", "ActivityID"], true);
    requireColumns(ctx, "Payments", ["StudentID", "ActivityID", "Amount", "Status"]);
    requireColumns(ctx, "Enrollments", ["StudentID", "ActivityID", "Status"]);
    const books = ctx.m.books();
    const sent = new Set(ctx.m.sentKeys());
    const newKeys = [];
    try {
      for (const student2 of ctx.m.students()) {
        if (!ctx.m.isVerified(student2)) continue;
        const family = ctx.m.familyById(student2.familyId);
        for (const account of books.accounts(student2.id)) {
          if (account.enrollmentStatus !== "Going" || !account.activityOpen) continue;
          if (account.remainingCents <= 0 || !account.dueDate) continue;
          const n = daysBetween(ctx.today, account.dueDate);
          if (!days.includes(n)) continue;
          const key = `rem:${student2.id}:${account.activityId}:${n}`;
          if (sent.has(key)) continue;
          sent.add(key);
          newKeys.push({ Key: key, At: ctx.now });
          const notice = paymentReminderNotice({
            firstName: student2.firstName,
            activityName: account.activityName,
            days: n,
            remainingCents: account.remainingCents,
            dueDate: account.dueDate,
            allowFunds: account.allowFunds,
            allowOnline: account.allowOnlinePayment && ctx.m.settings().pub.onlinePaymentsEnabled,
            tag: `rem-${student2.id}-${account.activityId}`
          });
          addCounts(report.notifications, notifyFamily(ctx, family, notice));
          report.remindersSent++;
        }
      }
    } finally {
      ctx.db.append("_Sent", newKeys);
    }
  }
  function sendEventReminders(ctx, report) {
    requireColumns(ctx, "Events", ["Date", "Title", "Schools", "Ensembles"]);
    const tomorrow = addDays(ctx.today, 1);
    const events = ctx.m.events().filter((e) => e.date === tomorrow);
    if (events.length === 0) return;
    const sent = new Set(ctx.m.sentKeys());
    const newKeys = [];
    const recipients = allRecipients(ctx);
    try {
      for (const event of events) {
        const key = `evt:${event.id}`;
        if (sent.has(key)) continue;
        sent.add(key);
        newKeys.push({ Key: key, At: ctx.now });
        addCounts(report.notifications, deliver(ctx, recipients, eventTomorrowNotice(event)));
        report.remindersSent++;
      }
    } finally {
      ctx.db.append("_Sent", newKeys);
    }
  }

  // src/server/app.ts
  var PUBLIC_ROUTES = {
    "auth.requestCode": requestCode,
    "auth.verifyCode": verifyCode
  };
  var ROUTES = {
    "me.bootstrap": { run: (ctx, email2) => buildBootstrap(ctx, email2) },
    "household.save": { write: true, run: saveHousehold },
    "prefs.save": { write: true, run: savePrefs },
    "push.register": { write: true, run: registerDevice },
    "push.unregister": { write: true, run: unregisterDevice },
    "push.test": { write: true, run: (ctx, email2) => testPush(ctx, email2) },
    "redemption.request": { write: true, run: requestRedemption },
    "redemption.cancel": { write: true, run: cancelRedemption },
    "payment.createOrder": { run: createOrder },
    "payment.captureOrder": { write: true, run: captureOrder },
    "admin.overview": { admin: true, run: (ctx) => adminOverview(ctx) },
    "admin.decideRedemption": { admin: true, write: true, run: decideRedemption },
    "admin.reviewHousehold": { admin: true, write: true, run: reviewHousehold },
    "admin.announce": { admin: true, write: true, run: announce },
    "admin.runSync": { admin: true, write: true, tick: true, run: (ctx) => runSync(ctx) }
  };
  var GENERIC_ERROR = "Something went wrong. Please try again.";
  function dispatch(services, request) {
    if (!isRecord(request) || typeof request.action !== "string") badRequest("Invalid request.");
    const req = request;
    const action = req.action;
    const params = req.params === void 0 || req.params === null ? {} : req.params;
    if (!isRecord(params)) badRequest("Invalid request parameters.");
    const p = params;
    if (hasOwn(PUBLIC_ROUTES, action)) {
      return PUBLIC_ROUTES[action](createCtx(services), p);
    }
    if (!hasOwn(ROUTES, action)) badRequest("Unknown action.");
    const route = ROUTES[action];
    const ctx = createCtx(services);
    const email2 = authenticate(ctx, req.token);
    if (route.admin && !isAdmin(ctx, email2)) forbidden("Only TMA board members can do that.");
    if (!route.write) return route.run(ctx, email2, p);
    ctx.deliveries = [];
    let result;
    try {
      result = inWriteLock(ctx, () => route.run(ctx, email2, p));
    } finally {
      const sent = flushDeliveries(ctx);
      if (route.tick && result) addCounts(result.notifications, sent);
    }
    return result;
  }
  function createApp(services) {
    return {
      handle(request) {
        try {
          return { ok: true, data: dispatch(services, request) };
        } catch (err) {
          if (err instanceof ApiError) return { ok: false, error: { code: err.code, message: err.message } };
          const action = isRecord(request) && typeof request.action === "string" ? request.action.slice(0, 64) : "?";
          try {
            services.logger.error(`Unhandled error in ${action}: ${errorMessage(err)}`, err);
          } catch {
          }
          return { ok: false, error: { code: "INTERNAL", message: GENERIC_ERROR } };
        }
      },
      syncTick() {
        return tick(services, runSync);
      },
      dailyTick() {
        return tick(services, runDaily);
      },
      setup(options) {
        const ctx = createCtx(services);
        return inWriteLock(ctx, () => runSetup(ctx, options != null ? options : {}));
      }
    };
  }
  function tick(services, run) {
    let ctx = null;
    try {
      ctx = createCtx(services);
      const c = ctx;
      c.deliveries = [];
      let report;
      try {
        report = inWriteLock(c, () => run(c));
      } finally {
        const sent = flushDeliveries(c);
        if (report) addCounts(report.notifications, sent);
      }
      return report;
    } catch (err) {
      services.logger.error("Scheduled run failed", errorMessage(err));
      const report = emptyReport(ctx ? ctx.now : /* @__PURE__ */ new Date());
      report.errors.push(errorMessage(err));
      return report;
    }
  }

  // src/gas/util.ts
  function bytesToHex(bytes) {
    let hex = "";
    for (const b of bytes) hex += ((b & 255) + 256).toString(16).slice(1);
    return hex;
  }
  function parseJson(text2) {
    try {
      return JSON.parse(text2);
    } catch {
      return void 0;
    }
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function pick(value, ...path) {
    let current = value;
    for (const key of path) {
      if (typeof key === "number") {
        if (!Array.isArray(current)) return void 0;
        current = current[key];
      } else {
        if (!isRecord2(current)) return void 0;
        current = current[key];
      }
    }
    return current;
  }
  function pickString(value, ...path) {
    const found = pick(value, ...path);
    return typeof found === "string" ? found : void 0;
  }
  function clip(text2, max) {
    return text2.length > max ? text2.slice(0, max) : text2;
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function formEncode(fields) {
    return Object.keys(fields).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`).join("&");
  }
  function describeError(error) {
    if (error instanceof Error) return { message: error.message, stack: error.stack };
    return error;
  }
  function escapeHtml2(text2) {
    return text2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // src/gas/push-relay.ts
  var MESSAGES_PER_REQUEST = 5;
  var REQUESTS_PER_FETCH_ALL = 20;
  var MAX_PAYLOAD_BYTES = 3e3;
  var PUSH_TTL_SECONDS = 86400;
  var MIN_SECRET_CHARS = 32;
  var MAX_SECRET_CHARS = 256;
  var PUBLIC_KEY_RETRY_SECONDS = 300;
  var PUBLIC_KEY_FAILED_CACHE_KEY = "push-relay:public-key-failed";
  var TOPIC_MAX_CHARS = 32;
  var ALREADY_REGISTERED_MESSAGE = "The push Worker is already linked to a different Apps Script secret. See workers/push/README.md (rotate keys).";
  function normalizeRelayUrl(value) {
    const url = String(value != null ? value : "").trim().replace(/\/+$/, "");
    return /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]*)?$/.test(url) ? url : null;
  }
  function utf8Length(text2) {
    let bytes = 0;
    for (let i = 0; i < text2.length; i += 1) {
      const c = text2.charCodeAt(i);
      if (c < 128) bytes += 1;
      else if (c < 2048) bytes += 2;
      else if (c >= 55296 && c <= 56319 && i + 1 < text2.length && (text2.charCodeAt(i + 1) & 64512) === 56320) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    }
    return bytes;
  }
  function cut(text2, n) {
    const head = text2.slice(0, n);
    const last = head.charCodeAt(head.length - 1);
    return last >= 55296 && last <= 56319 ? head.slice(0, -1) : head;
  }
  function buildPayload(message) {
    var _a, _b, _c;
    const fields = {
      title: clip(String((_a = message.title) != null ? _a : ""), 120),
      url: message.url ? clip(String(message.url), 200) : void 0,
      tag: message.tag ? clip(String(message.tag), 64) : void 0,
      topic: clip(String((_b = message.topic) != null ? _b : ""), 32)
    };
    const render = (body2) => JSON.stringify({ title: fields.title, body: body2, url: fields.url, tag: fields.tag, topic: fields.topic });
    const body = String((_c = message.body) != null ? _c : "");
    const full = render(body);
    if (utf8Length(full) <= MAX_PAYLOAD_BYTES) return full;
    let lo = 0;
    let hi = body.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (utf8Length(render(`${cut(body, mid)}…`)) <= MAX_PAYLOAD_BYTES) lo = mid;
      else hi = mid - 1;
    }
    return render(lo > 0 ? `${cut(body, lo)}…` : "");
  }
  function pushTopic(tag) {
    if (!tag) return void 0;
    const topic = String(tag).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, TOPIC_MAX_CHARS);
    return topic === "" ? void 0 : topic;
  }
  function pushUrgency(topic) {
    return topic === "reminders" || topic === "announcements" ? "normal" : "high";
  }
  function readSendResponse(code, text2, size) {
    const body = parseJson(text2);
    if (code === 401) return { kind: "unauthorized" };
    if (code === 503 && pick(body, "error") === "no_keys") return { kind: "no_keys" };
    if (code !== 200) return { kind: "failed", httpCode: code };
    const entries = pick(body, "results");
    if (!Array.isArray(entries) || entries.length !== size) return { kind: "failed", httpCode: code };
    const reasons = entries.map((e) => {
      const reason = pick(e, "reason");
      return typeof reason === "string" ? clip(reason.replace(/[^a-z0-9_]/gi, ""), 40) : "";
    });
    if (size > 0 && reasons.every((r) => r === "no_keys")) return { kind: "no_keys" };
    const results = entries.map((e) => {
      const status = isRecord2(e) ? e.status : void 0;
      return status === "ok" ? "ok" : status === "invalid" ? "invalid" : "error";
    });
    return { kind: "results", results, reasons };
  }
  function errorText(error, secret) {
    const text2 = clip(error instanceof Error ? error.message : String(error), 200);
    return secret ? text2.split(secret).join("[secret]") : text2;
  }
  function createPushRelaySender(deps) {
    const { secrets, cache, logger } = deps;
    let secretMemo = null;
    let publicKeyMemo = null;
    let reRegistered = false;
    let keysRequested = false;
    const baseUrl = () => normalizeRelayUrl(deps.relayUrl());
    function relaySecret() {
      if (secretMemo === null) {
        const value = secrets.get("PUSH_RELAY_SECRET");
        if (value && value.length >= MIN_SECRET_CHARS && value.length <= MAX_SECRET_CHARS && !/[\u0000-\u001f\u007f]/.test(value)) {
          secretMemo = value;
        }
      }
      return secretMemo;
    }
    function requireBase() {
      const base = baseUrl();
      if (!base) throw new Error("Settings PUSH_RELAY_URL is not an https:// address.");
      return base;
    }
    function fetchOrExplain(url, params) {
      try {
        return UrlFetchApp.fetch(url, { ...params, muteHttpExceptions: true });
      } catch (error) {
        throw new Error(`Could not reach the push Worker (${errorText(error, secretMemo)}).`);
      }
    }
    function register() {
      const base = requireBase();
      const secret = relaySecret();
      if (!secret) throw new Error("PUSH_RELAY_SECRET is missing or too short: run TMA App → Set up / repair tabs.");
      const res = fetchOrExplain(`${base}/register`, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ secret })
      });
      const code = res.getResponseCode();
      const body = parseJson(res.getContentText());
      if (code === 200 && pick(body, "registered") === true) return { first: pick(body, "first") === true };
      if (code === 409) throw new Error(ALREADY_REGISTERED_MESSAGE);
      throw new Error(`The push Worker answered HTTP ${code} when linking this sheet.`);
    }
    function refreshPublicKey() {
      const base = requireBase();
      const res = fetchOrExplain(`${base}/vapid-public-key`, { method: "get", headers: { Accept: "application/json" } });
      const code = res.getResponseCode();
      if (code !== 200) throw new Error(`The push Worker answered HTTP ${code} for its public key.`);
      const key = canonicalP256Key(pick(parseJson(res.getContentText()), "publicKey"));
      if (!key) throw new Error("The push Worker sent a public key that is not a P-256 key.");
      secrets.set("PUSH_PUBLIC_KEY", key);
      publicKeyMemo = key;
      cache.remove(PUBLIC_KEY_FAILED_CACHE_KEY);
      return key;
    }
    function publicKey() {
      if (publicKeyMemo) return publicKeyMemo;
      const stored = canonicalP256Key(secrets.get("PUSH_PUBLIC_KEY"));
      if (stored) {
        publicKeyMemo = stored;
        return stored;
      }
      if (!baseUrl() || cache.get(PUBLIC_KEY_FAILED_CACHE_KEY)) return "";
      try {
        return refreshPublicKey();
      } catch (error) {
        cache.put(PUBLIC_KEY_FAILED_CACHE_KEY, "1", PUBLIC_KEY_RETRY_SECONDS);
        logger.error("Could not get the push public key", { message: errorText(error, secretMemo) });
        return "";
      }
    }
    function health() {
      const down = { reachable: false, registered: false, hasKeys: false, email: false, emailKey: false };
      const base = baseUrl();
      if (!base) return { ...down, error: "PUSH_RELAY_URL is not an https:// address" };
      try {
        const res = UrlFetchApp.fetch(`${base}/health`, { method: "get", muteHttpExceptions: true });
        const code = res.getResponseCode();
        const body = parseJson(res.getContentText());
        if (code !== 200 || pick(body, "ok") !== true) return { ...down, httpCode: code };
        return {
          reachable: true,
          registered: pick(body, "registered") === true,
          hasKeys: pick(body, "hasKeys") === true,
          email: pick(body, "email") === true,
          emailKey: pick(body, "emailKey") === true
        };
      } catch (error) {
        return { ...down, error: errorText(error, secretMemo) };
      }
    }
    function relinkOnce(secret) {
      if (reRegistered) return false;
      reRegistered = true;
      try {
        register();
        return true;
      } catch (error) {
        logger.error("Push Worker rejected this sheet and linking again failed", { message: errorText(error, secret) });
        return false;
      }
    }
    function authorizedRequest(base, path, secret, body) {
      return {
        url: `${base}${path}`,
        method: "post",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${secret}` },
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      };
    }
    function requireSecret2() {
      const secret = relaySecret();
      if (!secret) throw new Error("PUSH_RELAY_SECRET is missing or too short: run TMA App → Set up / repair tabs.");
      return secret;
    }
    function authorizedPost(path, body) {
      const base = requireBase();
      const secret = requireSecret2();
      const once = () => {
        const { url, ...params } = authorizedRequest(base, path, secret, body);
        const res = fetchOrExplain(url, params);
        return { code: res.getResponseCode(), text: res.getContentText() };
      };
      const answer = once();
      if (answer.code !== 401 || !relinkOnce(secret)) return answer;
      return once();
    }
    function authorizedPostAll(path, bodies) {
      const base = requireBase();
      const secret = requireSecret2();
      const all = (items) => {
        if (items.length === 0) return [];
        let responses;
        try {
          responses = UrlFetchApp.fetchAll(items.map((body) => authorizedRequest(base, path, secret, body)));
        } catch (error) {
          throw new Error(`Could not reach the push Worker (${errorText(error, secret)}).`);
        }
        return items.map((_, i) => {
          const res = responses[i];
          return res ? { code: res.getResponseCode(), text: res.getContentText() } : { code: 0, text: "" };
        });
      };
      const answers = all(bodies);
      const rejected = answers.flatMap((a, i) => a.code === 401 ? [i] : []);
      if (rejected.length === 0 || !relinkOnce(secret)) return answers;
      try {
        const again = all(rejected.map((i) => bodies[i]));
        rejected.forEach((i, k) => {
          answers[i] = again[k];
        });
      } catch (error) {
        logger.error("Push Worker unreachable on retry", { message: errorText(error, secret) });
      }
      return answers;
    }
    function emailKey() {
      const secret = relaySecret();
      if (!secret) return null;
      return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret, Utilities.Charset.UTF_8));
    }
    function post(base, secret, chunks) {
      const outcomes = [];
      for (let start = 0; start < chunks.length; start += REQUESTS_PER_FETCH_ALL) {
        const group = chunks.slice(start, start + REQUESTS_PER_FETCH_ALL);
        try {
          const responses = UrlFetchApp.fetchAll(
            group.map((chunk) => ({
              url: `${base}/send`,
              method: "post",
              contentType: "application/json",
              headers: { Authorization: `Bearer ${secret}` },
              payload: JSON.stringify({ messages: chunk.map((p) => p.message) }),
              muteHttpExceptions: true
            }))
          );
          group.forEach((chunk, i) => {
            const res = responses[i];
            outcomes.push(res ? readSendResponse(res.getResponseCode(), res.getContentText(), chunk.length) : { kind: "failed", httpCode: 0 });
          });
        } catch (error) {
          logger.error("Push Worker unreachable", { message: errorText(error, secret) });
          for (let i = 0; i < group.length; i += 1) outcomes.push({ kind: "failed", httpCode: 0 });
        }
      }
      return outcomes;
    }
    function send(tokens, message) {
      const results = tokens.map(() => "error");
      if (tokens.length === 0) return results;
      const base = baseUrl();
      const secret = relaySecret();
      if (!base || !secret) return results;
      const payload = buildPayload(message);
      const topic = pushTopic(message.tag);
      const urgency = pushUrgency(message.topic);
      const queue = [];
      tokens.forEach((token, index) => {
        const subscription = typeof token === "string" ? toSubscription(token) : null;
        if (!subscription) {
          results[index] = "invalid";
          return;
        }
        const msg = { subscription, payload, ttl: PUSH_TTL_SECONDS, urgency };
        if (topic) msg.topic = topic;
        queue.push({ index, message: msg });
      });
      if (queue.length === 0) return results;
      const chunks = [];
      for (let i = 0; i < queue.length; i += MESSAGES_PER_REQUEST) chunks.push(queue.slice(i, i + MESSAGES_PER_REQUEST));
      const httpCodes = [];
      const reasons = [];
      const apply = (batch, outcomes) => {
        const retry = { unauthorized: [], noKeys: [] };
        batch.forEach((chunk, i) => {
          const outcome = outcomes[i];
          if (outcome.kind === "results") {
            chunk.forEach((p, k) => {
              results[p.index] = outcome.results[k];
              if (outcome.results[k] === "error" && outcome.reasons[k]) reasons.push(outcome.reasons[k]);
            });
          } else if (outcome.kind === "unauthorized") {
            retry.unauthorized.push(chunk);
          } else if (outcome.kind === "no_keys") {
            retry.noKeys.push(chunk);
          } else {
            httpCodes.push(outcome.httpCode);
          }
        });
        return retry;
      };
      const first = apply(chunks, post(base, secret, chunks));
      const noKeys = first.noKeys;
      if (first.unauthorized.length > 0) {
        if (!relinkOnce(secret)) {
          httpCodes.push(401);
        } else {
          const again = apply(first.unauthorized, post(base, secret, first.unauthorized));
          if (again.unauthorized.length > 0) httpCodes.push(401);
          noKeys.push(...again.noKeys);
        }
      }
      if (noKeys.length > 0) {
        if (keysRequested) {
          reasons.push("no_keys");
        } else {
          keysRequested = true;
          try {
            refreshPublicKey();
            const again = apply(noKeys, post(base, secret, noKeys));
            if (again.noKeys.length > 0) reasons.push("no_keys");
            if (again.unauthorized.length > 0) httpCodes.push(401);
          } catch (error) {
            reasons.push("no_keys");
            logger.error("Push Worker has no keys and creating them failed", { message: errorText(error, secret) });
          }
        }
      }
      const failed = results.filter((r) => r === "error").length;
      if (failed > 0) {
        logger.error("Push delivery errors", {
          failed,
          total: tokens.length,
          httpCodes: unique2(httpCodes.map(String)).slice(0, 5),
          reasons: unique2(reasons).slice(0, 5)
        });
      }
      return results;
    }
    return {
      enabled: () => baseUrl() !== null && relaySecret() !== null,
      publicKey,
      send,
      baseUrl,
      register,
      refreshPublicKey,
      health,
      authorizedPost,
      authorizedPostAll,
      emailKey
    };
  }
  function unique2(items) {
    return items.filter((item, i) => items.indexOf(item) === i);
  }

  // src/gas/mail.ts
  var WORKER_EMAIL_FROM = "noreply@mytma.org";
  var WORKER_DAILY_ALLOWANCE = 1e3;
  var WORKER_PAUSE_SECONDS = 600;
  var WORKER_DOWN_PAUSE_SECONDS = 120;
  var WORKER_PAUSE_CACHE_KEY = "email-worker:paused";
  var MAX_WORKER_FAILURES_IN_A_ROW = 3;
  var MAX_SUBJECT_CHARS = 300;
  var MESSAGES_PER_EMAIL_REQUEST = 10;
  var MAX_EMAIL_REQUEST_BYTES = 200 * 1024;
  var EMAIL_REQUESTS_PER_FETCH_ALL = 5;
  var SEND_MANY_TIME_BUDGET_MS = 4 * 6e4;
  var PAUSE_REASONS = /* @__PURE__ */ new Set([
    "sender_not_verified",
    // mytma.org isn't onboarded/verified in Cloudflare Email Sending yet
    "account_suspended",
    // Cloudflare paused Email Sending for the account
    "email_not_configured",
    // the Worker has no EMAIL binding
    "email_key_missing",
    // the Worker has no EMAIL_KEY secret
    "email_key_mismatch",
    // EMAIL_KEY holds another sheet's (or an old) key
    "no_email_endpoint",
    // the Worker is older than POST /email (404)
    "unauthorized"
    // the Worker is linked to another sheet, and linking again failed
  ]);
  var STOP_REASONS = /* @__PURE__ */ new Set(["rate_limited"]);
  var MESSAGE_REASONS = /* @__PURE__ */ new Set([
    // The Worker's own checks:
    "bad_message",
    "bad_to",
    "bad_reply_to",
    "bad_subject",
    "bad_content",
    "no_content",
    "content_too_large",
    // Cloudflare's answer about the recipient or the content:
    "recipient_not_allowed",
    "recipient_suppressed",
    "delivery_failed",
    "invalid_message",
    // HTTP 400/413 for a request: its content, not the Worker.
    "bad_request",
    "too_large"
  ]);
  function emailVia(value) {
    return String(value != null ? value : "").trim().toLowerCase() === "gmail" ? "gmail" : "cloudflare";
  }
  var PLAIN_ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  function oneLine2(text2) {
    return String(text2 != null ? text2 : "").replace(/[\r\n\u0085\u2028\u2029]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  }
  function cleanCode(value) {
    return typeof value === "string" ? clip(value.replace(/[^A-Za-z0-9_]/g, ""), 64) : "";
  }
  function errorText2(error) {
    return clip(error instanceof Error ? error.message : String(error), 300);
  }
  function replyToAddress(value) {
    const email2 = String(value != null ? value : "").trim().toLowerCase();
    return email2.length <= 254 && PLAIN_ADDRESS.test(email2) ? email2 : SETTING_DEFAULTS.SUPPORT_EMAIL;
  }
  function readEmailBatchAnswer(code, text2, count) {
    const body = parseJson(text2);
    const error = pick(body, "error");
    const failed = (reason) => ({ kind: "failed", outcome: { ok: false, reason, httpCode: code } });
    if (code === 401) return failed("unauthorized");
    if (code === 404) return failed("no_email_endpoint");
    if (code === 503 && (error === "email_not_configured" || error === "email_key_missing")) return failed(error);
    if (code === 403 && error === "email_key_mismatch") return failed(error);
    if (code === 400) return failed("bad_request");
    if (code === 413) return failed("too_large");
    if (code !== 200) return failed("http_error");
    const results = pick(body, "results");
    if (!Array.isArray(results) || results.length !== count || !results.every(isRecord2)) return failed("bad_answer");
    return {
      kind: "results",
      outcomes: results.map((result) => {
        if (result.status === "ok") return { ok: true, messageId: typeof result.messageId === "string" ? clip(result.messageId, 200) : "" };
        const reason = cleanCode(result.reason) || "send_failed";
        const cfCode = cleanCode(result.code);
        return cfCode ? { ok: false, reason, code: cfCode } : { ok: false, reason };
      })
    };
  }
  function readEmailAnswer(code, text2) {
    const answer = readEmailBatchAnswer(code, text2, 1);
    return answer.kind === "failed" ? answer.outcome : answer.outcomes[0];
  }
  function pauseSeconds(reason) {
    return PAUSE_REASONS.has(reason) ? WORKER_PAUSE_SECONDS : WORKER_DOWN_PAUSE_SECONDS;
  }
  function describeWorkerReason(reason) {
    switch (reason) {
      case "sender_not_verified":
        return "mytma.org isn't verified for Cloudflare Email Sending yet (finish onboarding it; see docs/SETUP.md, Email from noreply@mytma.org)";
      case "account_suspended":
        return "Cloudflare paused Email Sending for the account (check Compute → Email Service → Email Sending in Cloudflare)";
      case "recipient_not_allowed":
        return "Cloudflare only sends to verified addresses until mytma.org is onboarded on the Workers Paid plan (finish steps A and B)";
      case "recipient_suppressed":
        return "Cloudflare won't email this address any more (it bounced or complained before)";
      case "delivery_failed":
        return "the recipient's mail server refused it";
      case "invalid_message":
      case "bad_request":
      case "too_large":
        return "Cloudflare didn't accept this email's content";
      case "rate_limited":
        return "Cloudflare's sending limit was reached";
      case "email_not_configured":
        return "the push Worker has no Email Sending binding (deploy it again from workers/push)";
      case "email_key_missing":
        return "the push Worker doesn't have its EMAIL_KEY secret yet (copy the email key from TMA App → Status into Cloudflare; see docs/SETUP.md)";
      case "email_key_mismatch":
        return "the push Worker's EMAIL_KEY secret isn't this sheet's email key (copy it again from TMA App → Status; see docs/SETUP.md)";
      case "no_email_endpoint":
        return "the push Worker is an older version without email (deploy it again from workers/push)";
      case "unauthorized":
        return "the push Worker didn't accept this sheet's secret (another spreadsheet may be linked to it; see docs/SETUP.md step 5E)";
      case "network":
        return "the push Worker couldn't be reached";
      case "no_worker":
        return "Settings PUSH_RELAY_URL isn't an https:// address";
      case "not_linked":
        return "this sheet isn't linked to the push Worker yet (TMA App → Set up / repair tabs)";
      default:
        return `the push Worker couldn't send it (${cleanCode(reason) || "unknown"})`;
    }
  }
  function createGasMailer(deps) {
    const { relay, cache, logger } = deps;
    let pausedMemo;
    let stoppedReason = null;
    let failuresInARow = 0;
    let last = null;
    let promisedWorkerAllowance = false;
    let gmailSendsSincePromise = 0;
    function pausedReason() {
      if (pausedMemo === void 0) {
        try {
          pausedMemo = cache.get(WORKER_PAUSE_CACHE_KEY);
        } catch {
          pausedMemo = null;
        }
      }
      return pausedMemo;
    }
    function pause(reason) {
      pausedMemo = reason;
      try {
        cache.put(WORKER_PAUSE_CACHE_KEY, reason, pauseSeconds(reason));
      } catch (error) {
        logger.error("Could not pause Worker email", error);
      }
    }
    function route() {
      if (emailVia(deps.via()) === "gmail") return { via: "gmail", reason: "setting" };
      const base = relay.baseUrl();
      if (!base) return { via: "gmail", reason: "no_worker" };
      if (!relay.enabled()) return { via: "gmail", reason: "not_linked" };
      if (stoppedReason !== null) return { via: "gmail", reason: "this_run", detail: stoppedReason };
      const paused = pausedReason();
      if (paused) return { via: "gmail", reason: "paused", detail: paused };
      return { via: "cloudflare", from: WORKER_EMAIL_FROM, workerUrl: base };
    }
    function prepare(msg) {
      var _a, _b, _c;
      const to = String((_a = msg.to) != null ? _a : "").trim();
      if (!to || !to.includes("@")) return null;
      return {
        to,
        subject: clip(oneLine2(msg.subject), MAX_SUBJECT_CHARS),
        html: String((_b = msg.html) != null ? _b : ""),
        text: String((_c = msg.text) != null ? _c : ""),
        replyTo: replyToAddress(deps.replyTo())
      };
    }
    function sendThroughWorker(email2) {
      try {
        const answer = relay.authorizedPost("/email", { messages: [email2] });
        return readEmailAnswer(answer.code, answer.text);
      } catch {
        return { ok: false, reason: "network" };
      }
    }
    function workerFailed(outcome, messages = 1) {
      const details = { reason: outcome.reason };
      if (outcome.httpCode !== void 0) details.httpCode = outcome.httpCode;
      if (outcome.code) details.code = outcome.code;
      if (messages !== 1) details.messages = messages;
      logger.error(`Worker email failed; sending ${messages === 1 ? "this one" : "these"} with Gmail instead`, details);
      if (PAUSE_REASONS.has(outcome.reason)) {
        pause(outcome.reason);
      } else if (STOP_REASONS.has(outcome.reason)) {
        stoppedReason = outcome.reason;
      } else if (!MESSAGE_REASONS.has(outcome.reason)) {
        failuresInARow += 1;
        if (failuresInARow >= MAX_WORKER_FAILURES_IN_A_ROW) {
          stoppedReason = outcome.reason;
          pause(outcome.reason);
        }
      }
    }
    function mailApp(email2) {
      MailApp.sendEmail({
        to: email2.to,
        subject: email2.subject,
        htmlBody: email2.html,
        body: email2.text,
        name: oneLine2(deps.senderName()),
        replyTo: email2.replyTo
      });
    }
    function sendWithGmail(email2, reserve) {
      if (reserve !== void 0) {
        const left = MailApp.getRemainingDailyQuota();
        if (left <= reserve) throw new MailReserveError(left, reserve);
      }
      if (promisedWorkerAllowance) {
        if (gmailSendsSincePromise > 0 && MailApp.getRemainingDailyQuota() <= SIGN_IN_EMAIL_RESERVE) {
          throw new Error(`Gmail fallback skipped: the last ${SIGN_IN_EMAIL_RESERVE} emails of today's Gmail quota are kept for sign-in codes`);
        }
        gmailSendsSincePromise += 1;
      }
      mailApp(email2);
    }
    function send(msg, opts = {}) {
      var _a;
      last = null;
      const email2 = prepare(msg);
      if (!email2) throw new Error("Invalid email recipient");
      const current = route();
      if (current.via === "gmail") {
        sendWithGmail(email2, opts.reserve);
        last = current.reason === "setting" ? { via: "gmail" } : { via: "gmail", workerReason: (_a = current.detail) != null ? _a : current.reason };
        return;
      }
      const outcome = sendThroughWorker(email2);
      if (outcome.ok) {
        failuresInARow = 0;
        last = { via: "cloudflare" };
        return;
      }
      workerFailed(outcome);
      sendWithGmail(email2, opts.reserve);
      last = outcome.code ? { via: "gmail", workerReason: outcome.reason, workerCode: outcome.code } : { via: "gmail", workerReason: outcome.reason };
    }
    function chunk(items) {
      const EMPTY_BODY_BYTES = 15;
      const chunks = [];
      let current = [];
      let bytes = EMPTY_BODY_BYTES;
      for (const item of items) {
        const size = utf8Length(JSON.stringify(item.email)) + 1;
        if (current.length > 0 && (current.length >= MESSAGES_PER_EMAIL_REQUEST || bytes + size > MAX_EMAIL_REQUEST_BYTES)) {
          chunks.push(current);
          current = [];
          bytes = EMPTY_BODY_BYTES;
        }
        current.push(item);
        bytes += size;
      }
      if (current.length > 0) chunks.push(current);
      return chunks;
    }
    function sendMany(msgs) {
      const started = Date.now();
      const results = msgs.map(() => ({ ok: false, error: "not sent" }));
      const pending = [];
      msgs.forEach((msg, index) => {
        const email2 = prepare(msg);
        if (email2) pending.push({ index, email: email2 });
        else results[index] = { ok: false, error: "Invalid email recipient" };
      });
      let atReserve = false;
      const viaGmail = (item) => {
        try {
          if (!atReserve && MailApp.getRemainingDailyQuota() <= SIGN_IN_EMAIL_RESERVE) atReserve = true;
          if (atReserve) {
            results[item.index] = {
              ok: false,
              error: `Gmail fallback skipped: the last ${SIGN_IN_EMAIL_RESERVE} emails of today's Gmail quota are kept for sign-in codes`,
              quota: true
            };
            return;
          }
          mailApp(item.email);
          results[item.index] = { ok: true };
        } catch (error) {
          results[item.index] = { ok: false, error: errorText2(error) };
        }
      };
      const outOfTime = () => Date.now() - started > SEND_MANY_TIME_BUDGET_MS;
      let next = 0;
      while (next < pending.length) {
        if (outOfTime()) {
          const left = pending.length - next;
          logger.error("Stopped sending emails before the Apps Script time limit", { notSent: left });
          for (; next < pending.length; next += 1) {
            results[pending[next].index] = { ok: false, error: "Not sent: this run was close to the Apps Script time limit" };
          }
          break;
        }
        if (route().via === "gmail") {
          viaGmail(pending[next]);
          next += 1;
          continue;
        }
        const group = chunk(pending.slice(next, next + MESSAGES_PER_EMAIL_REQUEST * EMAIL_REQUESTS_PER_FETCH_ALL)).slice(0, EMAIL_REQUESTS_PER_FETCH_ALL);
        next += group.reduce((n, c) => n + c.length, 0);
        let answers;
        try {
          answers = relay.authorizedPostAll(
            "/email",
            group.map((c) => ({ messages: c.map((item) => item.email) }))
          );
        } catch {
          answers = null;
        }
        group.forEach((items, i) => {
          const answer = answers == null ? void 0 : answers[i];
          const parsed = answer ? readEmailBatchAnswer(answer.code, answer.text, items.length) : { kind: "failed", outcome: { ok: false, reason: "network" } };
          if (parsed.kind === "failed") {
            workerFailed(parsed.outcome, items.length);
            items.forEach(viaGmail);
            return;
          }
          parsed.outcomes.forEach((outcome, k) => {
            if (outcome.ok) {
              failuresInARow = 0;
              results[items[k].index] = { ok: true };
            } else {
              workerFailed(outcome);
              viaGmail(items[k]);
            }
          });
        });
      }
      return results;
    }
    return {
      remainingQuota() {
        if (route().via === "cloudflare") {
          promisedWorkerAllowance = true;
          return WORKER_DAILY_ALLOWANCE;
        }
        return MailApp.getRemainingDailyQuota();
      },
      send,
      sendMany,
      relayStatus: () => route().via === "cloudflare" ? { from: WORKER_EMAIL_FROM, backupRemaining: MailApp.getRemainingDailyQuota() } : null,
      route,
      lastDelivery: () => last,
      gmailQuota: () => MailApp.getRemainingDailyQuota()
    };
  }

  // src/gas/paypal.ts
  var PAYPAL_API = {
    live: "https://api-m.paypal.com",
    sandbox: "https://api-m.sandbox.paypal.com"
  };
  var FEE_ITEM_NAME = "Optional processing-fee contribution";
  var MAX_TOKEN_TTL_SECONDS = 21600;
  var ORDER_ID = /^[A-Za-z0-9-]{1,64}$/;
  var MAX_ORDER_CENTS = 1e7;
  function paypalEnv(value) {
    return parsePaypalEnv(value);
  }
  function formatAmount(cents2) {
    return `${Math.floor(cents2 / 100)}.${String(cents2 % 100).padStart(2, "0")}`;
  }
  function parseAmount(value) {
    if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return void 0;
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }
  function buildOrderBody(input) {
    const usd = (cents2) => ({ currency_code: "USD", value: formatAmount(cents2) });
    const items = [
      { name: clip(input.itemName, 127), quantity: "1", unit_amount: usd(input.amountCents) }
    ];
    if (input.feeCents > 0) items.push({ name: FEE_ITEM_NAME, quantity: "1", unit_amount: usd(input.feeCents) });
    return {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: clip(input.referenceId, 256),
          custom_id: clip(input.customId, 127),
          description: clip(input.description, 127),
          items,
          amount: { ...usd(input.grossCents), breakdown: { item_total: usd(input.grossCents) } }
        }
      ],
      application_context: {
        brand_name: clip(input.brandName, 127),
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW"
      }
    };
  }
  function parseCapture(body) {
    var _a;
    const capture = pick(body, "purchase_units", 0, "payments", "captures", 0);
    if (!isRecord2(capture)) return { status: "FAILED", message: "PayPal returned no capture for this order." };
    const result = { status: mapCaptureStatus(capture.status) };
    if (typeof capture.id === "string") result.captureId = capture.id;
    if (pickString(capture, "amount", "currency_code") === "USD") {
      const gross = parseAmount(pick(capture, "amount", "value"));
      if (gross !== void 0) result.grossCents = gross;
    }
    const payerEmail = (_a = pickString(body, "payer", "email_address")) != null ? _a : pickString(body, "payment_source", "paypal", "email_address");
    if (payerEmail) result.payerEmail = payerEmail.trim().toLowerCase();
    const reason = pickString(capture, "status_details", "reason");
    if (reason) result.message = reason;
    return result;
  }
  function mapCaptureStatus(status) {
    switch (status) {
      case "COMPLETED":
        return "COMPLETED";
      case "PENDING":
        return "PENDING";
      case "DECLINED":
        return "DECLINED";
      default:
        return "FAILED";
    }
  }
  function firstIssue(body) {
    var _a, _b;
    return (_b = (_a = pickString(body, "details", 0, "issue")) != null ? _a : pickString(body, "name")) != null ? _b : pickString(body, "error");
  }
  function hasCapture(body) {
    return isRecord2(pick(body, "purchase_units", 0, "payments", "captures", 0));
  }
  function definiteFailure(code) {
    return code >= 400 && code < 500 && code !== 408 && code !== 409 && code !== 425 && code !== 429;
  }
  function errorText3(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function validateOrder(input) {
    const { amountCents, feeCents, grossCents } = input;
    const ints = [amountCents, feeCents, grossCents].every((n) => Number.isInteger(n));
    if (!ints || amountCents < 1 || feeCents < 0 || grossCents !== amountCents + feeCents || grossCents > MAX_ORDER_CENTS) {
      throw new Error("Invalid PayPal order amounts");
    }
    if (!input.referenceId || !input.customId) throw new Error("PayPal order is missing its reference");
  }
  function createPayPalGateway(deps) {
    const { cache, logger } = deps;
    function resolve() {
      var _a, _b, _c;
      const config = deps.config();
      const clientId = ((_a = config.clientId) != null ? _a : "").trim();
      const secret = ((_b = config.secret) != null ? _b : "").trim();
      if (!clientId || !secret) return null;
      const env = paypalEnv((_c = config.env) != null ? _c : "");
      return { clientId, secret, env, base: PAYPAL_API[env] };
    }
    function tokenKey(r) {
      return `paypal-token:${r.env}:${r.clientId}`;
    }
    function accessToken(r) {
      const cached = cache.get(tokenKey(r));
      if (cached) return cached;
      const res = UrlFetchApp.fetch(`${r.base}/v1/oauth2/token`, {
        method: "post",
        headers: {
          Authorization: `Basic ${Utilities.base64Encode(`${r.clientId}:${r.secret}`, Utilities.Charset.UTF_8)}`,
          Accept: "application/json"
        },
        contentType: "application/x-www-form-urlencoded",
        payload: "grant_type=client_credentials",
        muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      const body = parseJson(res.getContentText());
      const token = pickString(body, "access_token");
      if (code !== 200 || !token) {
        logger.error("PayPal authentication failed", { status: code, env: r.env, error: pickString(body, "error") });
        throw new Error("PayPal authentication failed. Check PAYPAL_CLIENT_ID, PAYPAL_ENV and the PAYPAL_SECRET script property.");
      }
      const expiresIn = Number(pick(body, "expires_in")) || 32400;
      cache.put(tokenKey(r), token, clamp(Math.floor(expiresIn - 600), 60, MAX_TOKEN_TTL_SECONDS));
      return token;
    }
    function call(r, method, path, payload, headers = {}) {
      const send = () => {
        const options = {
          method,
          headers: { Authorization: `Bearer ${accessToken(r)}`, Accept: "application/json", ...headers },
          muteHttpExceptions: true
        };
        if (payload !== void 0) {
          options.contentType = "application/json";
          options.payload = JSON.stringify(payload);
        }
        const res = UrlFetchApp.fetch(`${r.base}${path}`, options);
        return { code: res.getResponseCode(), body: parseJson(res.getContentText()) };
      };
      let result = send();
      if (result.code === 401) {
        cache.remove(tokenKey(r));
        result = send();
      }
      return result;
    }
    return {
      enabled: () => resolve() !== null,
      createOrder(input) {
        var _a;
        validateOrder(input);
        const r = resolve();
        if (!r) throw new Error("PayPal is not configured");
        const { code, body } = call(r, "post", "/v2/checkout/orders", buildOrderBody(input));
        const orderId = pickString(body, "id");
        if ((code === 200 || code === 201) && orderId) return { orderId };
        logger.error("PayPal create order failed", { status: code, issue: firstIssue(body), debugId: pickString(body, "debug_id") });
        throw new Error(`PayPal could not create the order (${(_a = firstIssue(body)) != null ? _a : `HTTP ${code}`}).`);
      },
      /**
       * Capture once; when the outcome is ambiguous (the capture may have happened), ask again with the
       * same PayPal-Request-Id, which PayPal answers with the original result instead of charging twice.
       * Still no definite answer -> UNKNOWN, never FAILED: "not charged" must only be said when true.
       */
      captureOrder(orderId, requestId) {
        var _a;
        if (typeof orderId !== "string" || !ORDER_ID.test(orderId)) {
          return { status: "FAILED", message: "Invalid PayPal order id." };
        }
        const r = resolve();
        if (!r) return { status: "FAILED", message: "PayPal is not configured." };
        try {
          accessToken(r);
        } catch (error) {
          logger.error("PayPal capture not attempted", { message: errorText3(error) });
          return { status: "FAILED", message: "Could not reach PayPal. Please try again." };
        }
        const path = `/v2/checkout/orders/${orderId}`;
        const readOrder2 = () => {
          try {
            const order = call(r, "get", path);
            if (order.code === 200 && hasCapture(order.body)) return parseCapture(order.body);
            logger.error("PayPal order lookup failed", { status: order.code, issue: firstIssue(order.body) });
          } catch (error) {
            logger.error("PayPal order lookup error", { message: errorText3(error) });
          }
          return null;
        };
        const capture = () => {
          let res;
          try {
            res = call(r, "post", `${path}/capture`, {}, { "PayPal-Request-Id": clip(requestId, 108), Prefer: "return=representation" });
          } catch (error) {
            logger.error("PayPal capture error", { message: errorText3(error) });
            return null;
          }
          const { code, body } = res;
          if ((code === 200 || code === 201) && hasCapture(body)) return parseCapture(body);
          const issue = firstIssue(body);
          if (code === 422 && issue === "ORDER_ALREADY_CAPTURED") return readOrder2();
          logger.error("PayPal capture failed", { status: code, issue, debugId: pickString(body, "debug_id") });
          if (!definiteFailure(code)) return null;
          if (issue === "INSTRUMENT_DECLINED") {
            return { status: "DECLINED", message: "The payment method was declined. Please try another card or account." };
          }
          return { status: "FAILED", message: `PayPal could not complete the payment (${issue != null ? issue : `HTTP ${code}`}).` };
        };
        const result = (_a = capture()) != null ? _a : capture();
        return result != null ? result : { status: "UNKNOWN", message: "PayPal did not confirm whether the payment went through." };
      }
    };
  }

  // src/gas/self-test.ts
  var TEST_MESSAGE = {
    title: "Test notification ✅",
    body: "Notifications are working on this device.",
    url: "#/",
    tag: "tma-test",
    topic: "test"
  };
  var BLANK_DEVICE = { Email: "", FamilyID: "", Token: "", "User Agent": "", Created: "", "Last Seen": "" };
  function normEmail2(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }
  function tokenOf(value) {
    return value === null || value === void 0 ? "" : String(value).trim();
  }
  function sendSelfTest(services, rawEmail) {
    var _a;
    const email2 = normEmail2(rawEmail);
    const report = { email: email2, devices: 0, push: 0, removed: 0, emailSent: false, notes: [] };
    if (!email2) {
      report.notes.push("Could not tell which Google account you are signed in with.");
      return report;
    }
    const tokens = [
      ...new Set(
        services.store.read("Devices").filter((row) => normEmail2(row.data.Email) === email2).map((row) => tokenOf(row.data.Token)).filter(Boolean)
      )
    ];
    report.devices = tokens.length;
    if (tokens.length === 0) {
      report.notes.push(`No phones are registered for ${email2}. Sign in to the app with this email and turn on notifications (More → Notifications).`);
    } else if (!services.push.enabled()) {
      report.notes.push("Push is not set up: run TMA App → Set up / repair tabs to link this sheet to the push Worker (see docs/SETUP.md).");
    } else {
      const results = services.push.send(tokens, TEST_MESSAGE);
      report.push = results.filter((r) => r === "ok").length;
      const dead = new Set(tokens.filter((_, i) => results[i] === "invalid"));
      if (dead.size > 0) {
        services.withLock(() => {
          for (const row of services.store.read("Devices")) {
            if (dead.has(tokenOf(row.data.Token))) {
              services.store.update("Devices", row.rowNumber, BLANK_DEVICE);
              report.removed += 1;
            }
          }
        });
      }
      const failed = results.filter((r) => r === "error").length;
      if (failed > 0) report.notes.push(`${failed} device(s) could not be reached right now; see Executions for details.`);
    }
    if (!services.flag("EMAIL_ENABLED")) {
      report.notes.push("Email is turned off (Settings EMAIL_ENABLED).");
    } else if (services.mailer.remainingQuota() <= 0) {
      report.notes.push("No emails left in today's Google quota.");
    } else {
      const orgName = services.setting("ORG_NAME");
      try {
        services.mailer.send({
          to: email2,
          subject: `${orgName}: test notification`,
          html: testEmailHtml(orgName),
          text: `${TEST_MESSAGE.title}

Email from the TMA app is working.
`
        });
        report.emailSent = true;
        const delivery = services.mailer.lastDelivery();
        report.emailVia = (_a = delivery == null ? void 0 : delivery.via) != null ? _a : "gmail";
        if (delivery == null ? void 0 : delivery.workerReason) report.emailWorkerReason = delivery.workerReason;
        if (delivery == null ? void 0 : delivery.workerCode) report.emailWorkerCode = delivery.workerCode;
      } catch (error) {
        report.notes.push(`The test email could not be sent: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    services.store.append("Log", [
      {
        At: services.clock.now(),
        Kind: "notify",
        Detail: `test: ${TEST_MESSAGE.title} → push ${report.push}, email ${report.emailSent ? 1 : 0}, sms 0`
      }
    ]);
    return report;
  }
  function testEmailHtml(orgName) {
    return [
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e6dcdc">',
      `<div style="background:#5a0f13;color:#ffffff;padding:14px 18px;font-family:Georgia,serif;font-size:18px">${escapeHtml2(orgName)}</div>`,
      '<div style="padding:18px;color:#141010;font-size:15px;line-height:1.5">',
      `<p style="margin:0 0 12px"><strong>${escapeHtml2(TEST_MESSAGE.title)}</strong></p>`,
      '<p style="margin:0">Email from the TMA app is working.</p>',
      "</div></div>"
    ].join("");
  }

  // src/gas/settings.ts
  function readSetting(store, key) {
    let value;
    for (const row of store.read("Settings")) {
      if (settingKey2(row.data.Key) === key) value = cellText(row.data.Value);
    }
    return value === void 0 || value === "" ? SETTING_DEFAULTS[key] : value;
  }
  function settingKey2(value) {
    return cellText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }
  function readFlag(store, key) {
    return parseFlag(readSetting(store, key), parseFlag(SETTING_DEFAULTS[key], false));
  }
  var TRUE_WORDS2 = ["true", "yes", "y", "x", "1", "on", "✓", "✔"];
  var FALSE_WORDS2 = ["false", "no", "n", "0", "off"];
  function parseFlag(value, fallback) {
    const word = value.trim().toLowerCase();
    if (TRUE_WORDS2.includes(word)) return true;
    if (FALSE_WORDS2.includes(word)) return false;
    return fallback;
  }
  function cellText(value) {
    if (value === null || value === void 0) return "";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
    return String(value).trim();
  }

  // src/gas/sheet-store.ts
  var MAX_CELL_CHARS = 5e4;
  var FORMULA_START = /^[=+\-@']/;
  var NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
  var WALL_CLOCK_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS";
  var WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;
  function createSheetStore(spreadsheet, options = {}) {
    var _a;
    return new SpreadsheetStore(spreadsheet, (_a = options.withLock) != null ? _a : ((fn) => fn()));
  }
  function mapHeaders(table, headerRow) {
    var _a, _b;
    const def = TABLES[table];
    const normalized = headerRow.map((h) => h === null || h === void 0 ? "" : normalizeHeader(String(h)));
    const taken = /* @__PURE__ */ new Set();
    const columns = /* @__PURE__ */ new Map();
    const claim = (canonical2, key) => {
      if (!key) return false;
      const index = normalized.findIndex((n, i) => n === key && !taken.has(i));
      if (index < 0) return false;
      taken.add(index);
      columns.set(canonical2, index + 1);
      return true;
    };
    for (const canonical2 of def.headers) claim(canonical2, normalizeHeader(canonical2));
    for (const canonical2 of def.headers) {
      if (columns.has(canonical2)) continue;
      for (const alias of (_b = (_a = def.aliases) == null ? void 0 : _a[canonical2]) != null ? _b : []) {
        if (claim(canonical2, normalizeHeader(alias))) break;
      }
    }
    return columns;
  }
  function toSheetValue(value, toSheetDate = (d) => d) {
    if (value === null || value === void 0) return "";
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : toSheetDate(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : "";
    if (typeof value === "boolean") return value;
    const text2 = String(value);
    if (FORMULA_START.test(text2) && !NUMERIC_TEXT.test(text2)) {
      return `'${text2.slice(0, MAX_CELL_CHARS - 1)}`;
    }
    return text2.length > MAX_CELL_CHARS ? text2.slice(0, MAX_CELL_CHARS) : text2;
  }
  function isBlank2(value) {
    return value === null || value === void 0 || typeof value === "string" && value.trim() === "";
  }
  function pad(n, width) {
    return String(n).padStart(width, "0");
  }
  function localDate(year, month, day, hour, minute, second, ms) {
    const d = new Date(2e3, 0, 1, 0, 0, 0, 0);
    d.setFullYear(year, month - 1, day);
    d.setHours(hour, minute, second, ms);
    return d;
  }
  var SheetTimeZone = class {
    constructor(spreadsheet) {
      this.spreadsheet = spreadsheet;
      /** The spreadsheet's zone when it differs from the script's, else null; undefined until looked up. */
      __publicField(this, "zone");
      __publicField(this, "readMemo", /* @__PURE__ */ new Map());
    }
    /** The spreadsheet zone, or null when no conversion is needed. */
    sheetZone() {
      if (this.zone === void 0) this.zone = this.lookUp();
      return this.zone;
    }
    /** A Date read from the sheet -> the same wall-clock time in the script zone. */
    fromSheet(value) {
      const zone = this.sheetZone();
      const t = value.getTime();
      if (zone === null || Number.isNaN(t)) return value;
      let local = this.readMemo.get(t);
      if (local === void 0) {
        const m = WALL_CLOCK_RE.exec(Utilities.formatDate(value, zone, WALL_CLOCK_FORMAT));
        local = m ? localDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], +m[7]).getTime() : t;
        this.readMemo.set(t, local);
      }
      return new Date(local);
    }
    /** A Date from the core -> a Date the sheet shows with the script zone's wall-clock time. */
    toSheet(value) {
      const zone = this.sheetZone();
      if (zone === null || Number.isNaN(value.getTime()) || value.getFullYear() < 0 || value.getFullYear() > 9999) return value;
      const wallClock = `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1, 2)}-${pad(value.getDate(), 2)}T${pad(value.getHours(), 2)}:${pad(value.getMinutes(), 2)}:${pad(value.getSeconds(), 2)}.${pad(value.getMilliseconds(), 3)}`;
      const converted = Utilities.parseDate(wallClock, zone, WALL_CLOCK_FORMAT);
      return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : value;
    }
    lookUp() {
      var _a;
      let sheetZone = "";
      try {
        sheetZone = String((_a = this.spreadsheet.getSpreadsheetTimeZone()) != null ? _a : "").trim();
      } catch {
        return null;
      }
      if (!sheetZone) return null;
      let scriptZone = "";
      try {
        scriptZone = Session.getScriptTimeZone();
      } catch {
      }
      return sheetZone === scriptZone ? null : sheetZone;
    }
  };
  var SpreadsheetStore = class {
    constructor(spreadsheet, withLock) {
      this.spreadsheet = spreadsheet;
      this.withLock = withLock;
      /** null = the tab does not exist. */
      __publicField(this, "layouts", /* @__PURE__ */ new Map());
      /** Data rows; dropped on every write to the tab. */
      __publicField(this, "rowCache", /* @__PURE__ */ new Map());
      __publicField(this, "timeZone");
      __publicField(this, "toSheetDate");
      this.timeZone = new SheetTimeZone(spreadsheet);
      this.toSheetDate = (d) => this.timeZone.toSheet(d);
    }
    invalidate(table) {
      if (table) {
        this.layouts.delete(table);
        this.rowCache.delete(table);
      } else {
        this.layouts.clear();
        this.rowCache.clear();
      }
    }
    ensureTable(table) {
      const def = TABLES[table];
      const existing = this.findSheet(table);
      if (!existing) {
        const sheet = this.spreadsheet.insertSheet(table, this.spreadsheet.getNumSheets());
        this.writeHeaderRow(sheet, def.headers, def.note);
        if (def.system) {
          try {
            sheet.hideSheet();
          } catch {
          }
        }
        this.invalidate(table);
        return { created: true, addedColumns: [] };
      }
      if (existing.getLastRow() === 0 && existing.getLastColumn() === 0) {
        this.writeHeaderRow(existing, def.headers, def.note);
        this.invalidate(table);
        return { created: false, addedColumns: [...def.headers] };
      }
      const layout = this.layout(table);
      const missing = layout ? def.headers.filter((h) => !layout.columns.has(h)) : [];
      if (layout && missing.length > 0) this.addColumns(layout, missing);
      return { created: false, addedColumns: missing };
    }
    columns(table) {
      const layout = this.layout(table);
      return layout ? [...layout.columns.keys()] : null;
    }
    read(table) {
      let rows = this.rowCache.get(table);
      if (!rows) {
        rows = this.loadRows(table);
        this.rowCache.set(table, rows);
      }
      return rows.map((row) => ({ rowNumber: row.rowNumber, data: { ...row.data } }));
    }
    append(table, rows) {
      if (rows.length === 0) return;
      this.withLock(() => {
        const layout = this.writableLayout(table, rows);
        this.writeRows(layout, layout.sheet.getLastRow() + 1, rows);
        this.rowCache.delete(table);
      });
    }
    update(table, rowNumber, patch) {
      if (!Number.isInteger(rowNumber) || rowNumber < 2) {
        throw new Error(`Invalid row number ${rowNumber} for ${table}`);
      }
      const layout = this.layout(table);
      if (!layout) throw new Error(`The ${table} tab is missing`);
      if (rowNumber > layout.sheet.getLastRow()) throw new Error(`Row ${rowNumber} of ${table} does not exist`);
      this.addMissingColumns(layout, Object.keys(patch));
      const cells = [];
      for (const [key, value] of Object.entries(patch)) {
        const column = layout.columns.get(key);
        if (column !== void 0 && value !== void 0) cells.push({ column, value: toSheetValue(value, this.toSheetDate) });
      }
      cells.sort((a, b) => a.column - b.column);
      let i = 0;
      while (i < cells.length) {
        let j = i + 1;
        while (j < cells.length && cells[j].column === cells[j - 1].column + 1) j += 1;
        const run = cells.slice(i, j);
        layout.sheet.getRange(rowNumber, run[0].column, 1, run.length).setValues([run.map((c) => c.value)]);
        i = j;
      }
      this.rowCache.delete(table);
    }
    overwrite(table, rows) {
      this.withLock(() => {
        const layout = this.writableLayout(table, rows);
        const { sheet } = layout;
        const lastRow = sheet.getLastRow();
        const lastColumn = sheet.getLastColumn();
        if (lastRow >= 2 && lastColumn >= 1) sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
        if (rows.length > 0) this.writeRows(layout, 2, rows);
        this.rowCache.delete(table);
      });
    }
    // -------------------------------------------------------------------------
    findSheet(table) {
      var _a;
      const exact = this.spreadsheet.getSheetByName(table);
      if (exact) return exact;
      const wanted = table.toLowerCase();
      return (_a = this.spreadsheet.getSheets().find((s) => s.getName().trim().toLowerCase() === wanted)) != null ? _a : null;
    }
    /** Header layout, from the memo or by reading just the header row. */
    layout(table) {
      const memo = this.layouts.get(table);
      if (memo !== void 0) return memo;
      const sheet = this.findSheet(table);
      let layout = null;
      if (sheet) {
        const lastColumn = sheet.getLastColumn();
        const header = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
        layout = { table, sheet, columns: mapHeaders(table, header) };
      }
      this.layouts.set(table, layout);
      return layout;
    }
    /** One getDataRange().getValues() for the whole tab; refreshes the layout too. */
    loadRows(table) {
      var _a, _b, _c;
      const sheet = (_b = (_a = this.layouts.get(table)) == null ? void 0 : _a.sheet) != null ? _b : this.findSheet(table);
      if (!sheet) {
        this.layouts.set(table, null);
        return [];
      }
      const values = sheet.getDataRange().getValues();
      const columns = mapHeaders(table, (_c = values[0]) != null ? _c : []);
      this.layouts.set(table, { table, sheet, columns });
      const rows = [];
      for (let r = 1; r < values.length; r += 1) {
        const line = values[r];
        const data = {};
        let blank = true;
        for (const [header, column] of columns) {
          const raw = line[column - 1];
          const value = raw instanceof Date ? this.timeZone.fromSheet(raw) : raw;
          data[header] = value;
          if (!isBlank2(value)) blank = false;
        }
        if (!blank) rows.push({ rowNumber: r + 1, data });
      }
      return rows;
    }
    /** Layout for a write: creates the tab if needed and adds any canonical columns the rows use. */
    writableLayout(table, rows) {
      let layout = this.layout(table);
      if (!layout || layout.columns.size === 0) {
        this.ensureTable(table);
        layout = this.layout(table);
      }
      if (!layout) throw new Error(`Could not create the ${table} tab`);
      const keys = /* @__PURE__ */ new Set();
      for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
      this.addMissingColumns(layout, [...keys]);
      return layout;
    }
    /** Writing a known column the treasurer deleted would silently lose data, so put the header back. */
    addMissingColumns(layout, keys) {
      const missing = TABLES[layout.table].headers.filter((h) => keys.includes(h) && !layout.columns.has(h));
      if (missing.length > 0) this.addColumns(layout, missing);
    }
    addColumns(layout, headers) {
      const { sheet } = layout;
      const start = sheet.getLastColumn() + 1;
      const needed = start + headers.length - 1 - sheet.getMaxColumns();
      if (needed > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed);
      sheet.getRange(1, start, 1, headers.length).setValues([[...headers]]).setFontWeight("bold");
      headers.forEach((h, i) => layout.columns.set(h, start + i));
      this.rowCache.delete(layout.table);
    }
    writeHeaderRow(sheet, headers, note) {
      const needed = headers.length - sheet.getMaxColumns();
      if (needed > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed);
      sheet.getRange(1, 1, 1, headers.length).setValues([[...headers]]).setFontWeight("bold");
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1).setNote(note);
    }
    /** Write rows as one block spanning only the columns the rows actually use. */
    writeRows(layout, startRow, rows) {
      const used = [];
      for (const [header, column] of layout.columns) {
        if (rows.some((row) => row[header] !== void 0)) used.push(column);
      }
      if (used.length === 0) return;
      const first = Math.min(...used);
      const last = Math.max(...used);
      const byColumn = /* @__PURE__ */ new Map();
      for (const [header, column] of layout.columns) byColumn.set(column, header);
      const matrix = rows.map((row) => {
        const line = [];
        for (let c = first; c <= last; c += 1) {
          const header = byColumn.get(c);
          line.push(header === void 0 ? "" : toSheetValue(row[header], this.toSheetDate));
        }
        return line;
      });
      const { sheet } = layout;
      const lastNeeded = startRow + rows.length - 1;
      if (lastNeeded > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), lastNeeded - sheet.getMaxRows());
      sheet.getRange(startRow, first, rows.length, last - first + 1).setValues(matrix);
    }
  };

  // src/gas/twilio.ts
  var MAX_SMS_CHARS = 1600;
  var MESSAGING_SERVICE_SID = /^MG[0-9a-f]{32}$/i;
  function toE164(raw) {
    const text2 = String(raw != null ? raw : "").trim();
    const digits = text2.replace(/\D/g, "");
    if (text2.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
    if (digits.length === 10) return `+1${digits}`;
    return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
  }
  function createTwilioSender(deps) {
    const { secrets, logger } = deps;
    function credentials() {
      const sid = secrets.get("TWILIO_ACCOUNT_SID");
      const token = secrets.get("TWILIO_AUTH_TOKEN");
      const from = secrets.get("TWILIO_FROM");
      return sid && token && from ? { sid, token, from } : null;
    }
    return {
      enabled: () => credentials() !== null,
      send(to, body) {
        var _a;
        const creds = credentials();
        if (!creds) throw new Error("Text messages are not configured");
        const phone = toE164(to);
        if (!phone) throw new Error("Invalid phone number for text message");
        const fields = { To: phone, Body: clip(String(body != null ? body : ""), MAX_SMS_CHARS) };
        if (MESSAGING_SERVICE_SID.test(creds.from)) fields.MessagingServiceSid = creds.from;
        else fields.From = (_a = toE164(creds.from)) != null ? _a : creds.from;
        const res = UrlFetchApp.fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.sid)}/Messages.json`,
          {
            method: "post",
            headers: { Authorization: `Basic ${Utilities.base64Encode(`${creds.sid}:${creds.token}`, Utilities.Charset.UTF_8)}` },
            contentType: "application/x-www-form-urlencoded",
            payload: formEncode(fields),
            muteHttpExceptions: true
          }
        );
        const code = res.getResponseCode();
        if (code < 200 || code >= 300) {
          const twilioCode = pick(parseJson(res.getContentText()), "code");
          logger.error("Twilio send failed", { status: code, code: twilioCode });
          throw new Error(`Text message failed (Twilio ${String(twilioCode != null ? twilioCode : `HTTP ${code}`)})`);
        }
      }
    };
  }

  // src/gas/services.ts
  var MAX_CACHE_TTL_SECONDS = 21600;
  var MAX_CACHE_KEY_CHARS = 250;
  var LOCK_TIMEOUT_MS = 2e4;
  function createGasServices() {
    const spreadsheet = SpreadsheetApp.getActive();
    if (!spreadsheet) {
      throw new Error("No spreadsheet: create this script from the TMA Google Sheet (Extensions → Apps Script).");
    }
    const withLock = createScriptLock({
      onAcquire: () => store.invalidate(),
      // another execution may have written while we waited
      beforeRelease: () => SpreadsheetApp.flush()
    });
    const store = createSheetStore(spreadsheet, { withLock });
    const setting = (key) => readSetting(store, key);
    const cache = createScriptCache();
    const clock = { now: () => /* @__PURE__ */ new Date() };
    const secrets = createScriptSecrets();
    const logger = createConsoleLogger();
    const push = createPushRelaySender({ secrets, cache, logger, relayUrl: () => setting("PUSH_RELAY_URL") });
    return {
      mode: "production",
      store,
      setting,
      flag: (key) => readFlag(store, key),
      cache,
      clock,
      crypto: createGasCrypto(),
      secrets,
      mailer: createGasMailer({
        relay: push,
        cache,
        logger,
        via: () => setting("EMAIL_VIA"),
        senderName: () => setting("ORG_NAME"),
        replyTo: () => setting("SUPPORT_EMAIL")
      }),
      sms: createTwilioSender({ secrets, logger }),
      push,
      payments: createPayPalGateway({
        cache,
        logger,
        config: () => ({
          clientId: setting("PAYPAL_CLIENT_ID"),
          env: setting("PAYPAL_ENV"),
          secret: secrets.get("PAYPAL_SECRET")
        })
      }),
      logger,
      withLock
    };
  }
  function createScriptCache() {
    const cache = () => CacheService.getScriptCache();
    const safeKey = (key) => key.length <= MAX_CACHE_KEY_CHARS ? key : `sha256:${bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8))}`;
    return {
      get: (key) => cache().get(safeKey(key)),
      put(key, value, ttlSeconds) {
        const ttl = Number.isFinite(ttlSeconds) ? Math.floor(ttlSeconds) : MAX_CACHE_TTL_SECONDS;
        cache().put(safeKey(key), value, clamp(ttl, 1, MAX_CACHE_TTL_SECONDS));
      },
      remove: (key) => cache().remove(safeKey(key))
    };
  }
  function createScriptLock(hooks, timeoutMs = LOCK_TIMEOUT_MS) {
    let depth = 0;
    return function withLock(fn) {
      if (depth > 0) {
        depth += 1;
        try {
          return fn();
        } finally {
          depth -= 1;
        }
      }
      const lock = LockService.getScriptLock();
      lock.waitLock(timeoutMs);
      depth = 1;
      try {
        hooks.onAcquire();
        return fn();
      } finally {
        try {
          hooks.beforeRelease();
        } finally {
          depth = 0;
          lock.releaseLock();
        }
      }
    };
  }
  function createGasCrypto() {
    return {
      hmacSha256Hex: (key, message) => bytesToHex(Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8)),
      uuid: () => Utilities.getUuid().toLowerCase(),
      randomDigits
    };
  }
  function randomDigits(length) {
    if (!Number.isInteger(length) || length < 1 || length > 64) {
      throw new RangeError("randomDigits: length must be an integer from 1 to 64");
    }
    let out = "";
    for (let attempt = 0; out.length < length; attempt += 1) {
      if (attempt > 1e3) throw new Error("randomDigits: Utilities.getUuid() returned unusable values");
      const hex = Utilities.getUuid().replace(/-/g, "").toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(hex)) continue;
      for (let i = 0; i < hex.length && out.length < length; i += 1) {
        if (i === 12 || i === 16) continue;
        const n = parseInt(hex[i], 16);
        if (n < 10) out += String(n);
      }
    }
    return out;
  }
  function createScriptSecrets() {
    const props = () => PropertiesService.getScriptProperties();
    return {
      get(name) {
        const value = props().getProperty(name);
        return value && value.trim() ? value.trim() : null;
      },
      set(name, value) {
        props().setProperty(name, value);
      }
    };
  }
  function createConsoleLogger() {
    return {
      info(message, data) {
        if (data === void 0) console.info(message);
        else console.info(message, data);
      },
      error(message, data) {
        if (data === void 0) console.error(message);
        else console.error(message, describeError(data));
      }
    };
  }

  // src/gas/entry.ts
  var VERSION = true ? "0.1.0" : "dev";
  var MENU_TITLE = "TMA App";
  var MAX_BODY_CHARS = 1e5;
  var MAX_TOKEN_CHARS = 4096;
  var SCHEDULED_HANDLERS = ["syncTick", "dailyTick"];
  var SECRET_NAMES = [
    "TOKEN_SECRET",
    "PAYPAL_SECRET",
    "PUSH_RELAY_SECRET",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM"
  ];
  function boot() {
    const services = createGasServices();
    return { services, app: createApp(services) };
  }
  function parseApiRequest(raw) {
    var _a, _b;
    if (typeof raw !== "string" || raw.trim() === "") return { error: "Missing request body" };
    if (raw.length > MAX_BODY_CHARS) return { error: "Request too large" };
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return { error: "Request body must be JSON" };
    }
    if (!isRecord2(body) || typeof body.action !== "string" || body.action.length > 64) {
      return { error: "Missing action" };
    }
    const params = (_a = body.params) != null ? _a : {};
    if (!isRecord2(params)) return { error: "params must be an object" };
    const token = (_b = body.token) != null ? _b : null;
    if (token !== null && (typeof token !== "string" || token.length > MAX_TOKEN_CHARS)) {
      return { error: "Invalid token" };
    }
    return { request: { action: body.action, params, token } };
  }
  function json(value) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  }
  function doPost(e) {
    var _a;
    const parsed = parseApiRequest((_a = e == null ? void 0 : e.postData) == null ? void 0 : _a.contents);
    let response;
    if ("error" in parsed) {
      response = { ok: false, error: { code: "BAD_REQUEST", message: parsed.error } };
    } else {
      try {
        response = boot().app.handle(parsed.request);
      } catch (error) {
        console.error("doPost failed", describeError(error));
        response = { ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please try again." } };
      }
    }
    return json(response);
  }
  function doGet(e) {
    var _a;
    if (((_a = e == null ? void 0 : e.parameter) == null ? void 0 : _a.action) === "health") {
      return json({ ok: true, data: { version: VERSION, time: (/* @__PURE__ */ new Date()).toISOString() } });
    }
    let orgName = SETTING_DEFAULTS.ORG_NAME;
    let appUrl = "";
    try {
      const services = createGasServices();
      orgName = services.setting("ORG_NAME");
      appUrl = services.setting("APP_URL");
    } catch (error) {
      console.error("doGet could not read Settings", describeError(error));
    }
    return HtmlService.createHtmlOutput(landingPage(orgName, appUrl)).setTitle(orgName).addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
  function landingPage(orgName, appUrl) {
    const name = escapeHtml2(orgName);
    const link = /^https?:\/\/[^\s"'<>]+$/i.test(appUrl) ? `<p><a href="${escapeHtml2(appUrl)}" target="_top" style="display:inline-block;background:#5a0f13;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Open the TMA app</a></p>` : "<p>Ask TMA for the app link.</p>";
    return [
      '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#141010">',
      `<h1 style="font-family:Georgia,'Times New Roman',serif;color:#5a0f13;font-size:24px">${name}</h1>`,
      "<p>This address is the TMA app's server. Families use the app instead:</p>",
      link,
      "</div>"
    ].join("");
  }
  function onOpen() {
    SpreadsheetApp.getUi().createMenu(MENU_TITLE).addItem("Run sync now", "syncTick").addItem("Send me a test notification", "sendTestPushToMe").addItem("Set up / repair tabs", "setupTma").addItem("Install schedules", "installTriggers").addItem("Status", "showTmaStatus").addToUi();
  }
  function syncTick(e) {
    const { services, app } = boot();
    const report = app.syncTick();
    if (report.errors.length > 0) services.logger.error("syncTick finished with errors", report.errors);
    if (!e) toast(`Sync finished. ${summarizeTick(report)}`);
    return report;
  }
  function dailyTick(e) {
    const { services, app } = boot();
    const report = app.dailyTick();
    if (report.errors.length > 0) services.logger.error("dailyTick finished with errors", report.errors);
    if (!e) toast(`Daily reminders finished. ${summarizeTick(report)}`);
    return report;
  }
  function setupTma() {
    return runSetup2(false);
  }
  function setupTmaWithSampleData() {
    return runSetup2(true);
  }
  function runSetup2(seedSampleData) {
    const { services, app } = boot();
    const report = services.withLock(() => {
      const result = app.setup({ seedSampleData });
      if (services.secrets.get("PUSH_RELAY_SECRET")) return result;
      services.secrets.set("PUSH_RELAY_SECRET", generateSecret(services.crypto, "PUSH_RELAY_SECRET"));
      return { ...result, secretsInitialized: [...result.secretsInitialized, "PUSH_RELAY_SECRET"] };
    });
    const push = linkPushWorker(services);
    services.logger.info("setup", { ...report, push });
    const lines = [
      report.createdTables.length ? `Created tabs: ${report.createdTables.join(", ")}` : "All tabs were already there.",
      report.addedColumns.length ? `Added columns: ${report.addedColumns.map((c) => `${c.table} › ${c.column}`).join(", ")}` : "No columns were missing.",
      report.seeded ? "Filled the empty tabs with sample (fictional) data." : "",
      report.secretsInitialized.length ? `Created secrets: ${report.secretsInitialized.join(", ")}` : "",
      ...push
    ].filter(Boolean);
    const next = "Next: Deploy → New deployment → Web app, then TMA App → Install schedules.";
    alert("TMA App set up", `${lines.join("\n")}

${next}`);
    return report;
  }
  function linkPushWorker(services) {
    const push = services.push;
    const base = push.baseUrl();
    if (!base) return ["⚠ Push notifications are off: Settings PUSH_RELAY_URL is not an https:// address."];
    const lines = [];
    try {
      const { first } = push.register();
      lines.push(first ? `Push: linked this sheet to the push Worker (${base}).` : `Push: this sheet is linked to the push Worker (${base}).`);
    } catch (error) {
      return [`⚠ Push: ${errorMessage2(error)} Phones won't get notifications until Set up links the push Worker; run it again later.`];
    }
    try {
      push.refreshPublicKey();
      lines.push("Push: saved the Worker's public key (Script Property PUSH_PUBLIC_KEY).");
    } catch (error) {
      lines.push(`⚠ Push: could not get the Worker's public key. ${errorMessage2(error)} Run Set up again later.`);
    }
    return lines;
  }
  function installTriggers() {
    let removed = 0;
    for (const trigger of ScriptApp.getProjectTriggers()) {
      if (SCHEDULED_HANDLERS.includes(trigger.getHandlerFunction())) {
        ScriptApp.deleteTrigger(trigger);
        removed += 1;
      }
    }
    ScriptApp.newTrigger("syncTick").timeBased().everyMinutes(15).create();
    ScriptApp.newTrigger("dailyTick").timeBased().everyDays(1).atHour(8).create();
    alert("Schedules installed", "Sync runs every 15 minutes and reminders go out daily around 8 AM.");
    return { removed, created: SCHEDULED_HANDLERS.length };
  }
  function sendTestPushToMe() {
    const report = sendSelfTest(createGasServices(), activeUserEmail());
    const lines = report.email ? [`Sent to ${report.email}:`] : [];
    if (report.devices > 0) {
      lines.push(`Push: delivered to ${report.push} of ${report.devices} device(s).`);
      if (report.removed > 0) lines.push(`Removed ${report.removed} expired device(s).`);
    }
    lines.push(`Email: ${testEmailLine(report)}`, ...report.notes);
    alert("Test notification", lines.join("\n"));
    return report;
  }
  function testEmailLine(report) {
    if (!report.emailSent) return "not sent.";
    if (report.emailVia === "cloudflare") return `sent from ${WORKER_EMAIL_FROM} through the push Worker (Cloudflare Email Sending).`;
    if (!report.emailWorkerReason) return "sent with Gmail from this Google account (Settings EMAIL_VIA is gmail).";
    const code = report.emailWorkerCode ? `, ${report.emailWorkerCode}` : "";
    return `sent with Gmail from this Google account instead of ${WORKER_EMAIL_FROM}, because ${describeWorkerReason(report.emailWorkerReason)}${code}.`;
  }
  function showTmaStatus() {
    const services = createGasServices();
    const handlers = safely2(() => ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()), []);
    const present = SECRET_NAMES.filter((name) => services.secrets.get(name) !== null);
    const missing = SECRET_NAMES.filter((name) => !present.includes(name));
    const yes = (on) => on ? "on" : "off";
    const health = services.push.baseUrl() ? services.push.health() : null;
    const lines = [
      // ScriptApp.getService().getUrl() reports the editor's test deployment, not the
      // live one, so point to where the real /exec URL is listed instead.
      "Web app URL: Deploy → Manage deployments → Web app (the URL ending in /exec)",
      `App link (Settings APP_URL): ${services.setting("APP_URL") || "not set"}`,
      `Schedules: sync every 15 min ${handlers.includes("syncTick") ? "✓" : "✗"}, daily reminders ${handlers.includes("dailyTick") ? "✓" : "✗"}${SCHEDULED_HANDLERS.every((h) => handlers.includes(h)) ? "" : " (TMA App → Install schedules)"}`,
      `Secrets set: ${present.join(", ") || "none"}`,
      `Secrets not set: ${missing.join(", ") || "none"}`,
      `PayPal: ${services.payments.enabled() ? `configured (${paypalEnv(services.setting("PAYPAL_ENV"))})` : "not configured"}; online payments ${yes(services.flag("ONLINE_PAYMENTS"))}`,
      ...pushStatus(services, health),
      `Text messages (Twilio): ${services.sms.enabled() ? "configured" : "not configured"}; SMS setting ${yes(services.flag("SMS_ENABLED"))}`,
      ...emailStatus(services, health),
      `Version: ${VERSION}`
    ];
    if (!present.includes("TOKEN_SECRET")) lines.push("", "TOKEN_SECRET is missing: run TMA App → Set up / repair tabs.");
    const text2 = lines.join("\n");
    alert("TMA App status", text2);
    return text2;
  }
  function pushStatus(services, health) {
    const push = services.push;
    const base = push.baseUrl();
    if (!base || !health) return ["Push Worker: not set (Settings PUSH_RELAY_URL must be an https:// address); push notifications off"];
    const setUp = " (TMA App → Set up / repair tabs)";
    const healthLine = health.reachable ? `Push Worker health: reachable ✓, linked to a sheet ${health.registered ? "✓" : `✗${setUp}`}, keys ${health.hasKeys ? "✓" : `✗${setUp}`}` : `Push Worker health: unreachable (${health.httpCode ? `HTTP ${health.httpCode}` : health.error || "no answer"})`;
    const keySaved = canonicalP256Key(services.secrets.get("PUSH_PUBLIC_KEY")) !== null;
    return [
      `Push Worker: ${base}`,
      healthLine,
      `Push public key (PUSH_PUBLIC_KEY): ${keySaved ? "saved ✓" : `not saved yet${setUp}`}`,
      `Push notifications: ${push.enabled() ? "configured" : `not configured${setUp}`}`
    ];
  }
  function emailStatus(services, health) {
    var _a;
    const on = services.flag("EMAIL_ENABLED") ? "on" : "notifications off (sign-in codes are still emailed)";
    const route = safely2(() => services.mailer.route(), null);
    const quota = safely2(() => services.mailer.gmailQuota(), 0);
    const replyTo = `Reply-To ${replyToAddress(services.setting("SUPPORT_EMAIL"))}`;
    const key = route && !(route.via === "gmail" && route.reason === "setting") ? safely2(() => services.push.emailKey(), null) : null;
    const keyLine = key ? [`Email key for Cloudflare (Worker secret EMAIL_KEY): ${key}`] : [];
    if ((route == null ? void 0 : route.via) === "cloudflare") {
      let worker = "";
      if (health && !health.reachable) worker = "; Worker unreachable right now, so Gmail sends meanwhile";
      else if ((health == null ? void 0 : health.email) && health.emailKey) worker = " (Cloudflare Email Sending ✓, email key ✓)";
      else if (health == null ? void 0 : health.email) worker = " (Cloudflare Email Sending ✓, email key ✗: add the Worker secret EMAIL_KEY below, so Gmail sends meanwhile; see docs/SETUP.md)";
      else if (health) worker = " (Cloudflare Email Sending ✗: not set up on the Worker yet, so Gmail sends meanwhile; see docs/SETUP.md)";
      return [`Email: ${on}; from ${route.from} through the push Worker${worker}; ${replyTo}; Gmail fallback: ${quota} emails left today`, ...keyLine];
    }
    let why = "Settings EMAIL_VIA is gmail";
    if (route && route.reason !== "setting") {
      const reason = (_a = route.detail) != null ? _a : route.reason;
      why = describeWorkerReason(reason);
      if (route.reason === "paused") why += ` (Gmail for up to ${pauseSeconds(reason) / 60} minutes, then the Worker is tried again)`;
    }
    return [`Email: ${on}; with Gmail from this Google account, because ${why}; ${replyTo}; ${quota} emails left today`, ...keyLine];
  }
  function errorMessage2(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function summarizeTick(report) {
    const n = report.notifications;
    const parts = [
      `Balance changes: ${report.balanceChanges}`,
      `fund requests posted: ${report.redemptionsPosted}`,
      `announcements: ${report.announcementsSent}`,
      `reminders: ${report.remindersSent}`,
      `sent push ${n.push}, email ${n.email}, sms ${n.sms}`
    ];
    if (report.waiting) parts.push(`${report.waiting} row(s) still being edited in the sheet go out at a later sync`);
    if (report.errors.length > 0) parts.push(`${report.errors.length} error(s), see Log`);
    return `${parts.join(" · ")}.`;
  }
  function activeUserEmail() {
    return safely2(() => Session.getActiveUser().getEmail(), "");
  }
  function safely2(fn, fallback) {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }
  function alert(title, message) {
    try {
      const ui = SpreadsheetApp.getUi();
      ui.alert(title, message, ui.ButtonSet.OK);
    } catch {
      console.info(`${title}: ${message}`);
    }
  }
  function toast(message) {
    try {
      SpreadsheetApp.getActive().toast(message, MENU_TITLE, 10);
    } catch {
      console.info(message);
    }
  }
  return __toCommonJS(entry_exports);
})();

// Apps Script entry points
function doGet(e) {
  return TMA.doGet(e);
}

function doPost(e) {
  return TMA.doPost(e);
}

function onOpen(e) {
  return TMA.onOpen(e);
}

function syncTick(e) {
  return TMA.syncTick(e);
}

function dailyTick(e) {
  return TMA.dailyTick(e);
}

function setupTma(e) {
  return TMA.setupTma(e);
}

function setupTmaWithSampleData(e) {
  return TMA.setupTmaWithSampleData(e);
}

function installTriggers(e) {
  return TMA.installTriggers(e);
}

function sendTestPushToMe(e) {
  return TMA.sendTestPushToMe(e);
}

function showTmaStatus(e) {
  return TMA.showTmaStatus(e);
}
