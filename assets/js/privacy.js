/*
  NZ privacy checker: the rules. Finds New Zealand personal details in text before it is pasted
  into an AI tool, and makes a cleaned copy. Plain rules only: no AI, no network, no storage.
  Loads as a browser script (window.PrivacyChecker) and as a Node module (for the tests).

  Sources for the rules:
  - IRD numbers: the check-digit method published by Inland Revenue, as implemented in python-stdnum (nz.ird).
  - Bank accounts: the checksum algorithms published by Inland Revenue for RWT and NRWT filing,
    as implemented in python-stdnum (nz.bankaccount). The bank-branch register is not included.
  - NHI numbers: Health New Zealand's two formats (AAANNNC with a mod 11 check digit, and AAANNAX
    with a mod 23 check letter). Tested against the six examples Health NZ publishes.
  - Card numbers: the Luhn check.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PrivacyChecker = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NHI_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I and O are never used; A = 1 ... Z = 24

  // ---------- check-digit rules ----------

  function irdIsValid(raw) {
    var n = String(raw).replace(/[\s-]/g, "");
    if (!/^\d{8,9}$/.test(n)) return false;
    var value = parseInt(n, 10);
    if (!(value > 10000000 && value < 150000000)) return false;
    var body = n.slice(0, -1);
    while (body.length < 8) body = "0" + body;
    var primary = [3, 2, 7, 6, 5, 4, 3, 2], secondary = [7, 4, 3, 2, 5, 2, 7, 6];
    function check(weights) {
      var sum = 0;
      for (var i = 0; i < 8; i++) sum += weights[i] * Number(body[i]);
      return ((-sum % 11) + 11) % 11;
    }
    var c = check(primary);
    if (c === 10) c = check(secondary);
    return c !== 10 && String(c) === n[n.length - 1];
  }

  function nhiValue(ch) {
    if (/\d/.test(ch)) return Number(ch);
    return NHI_LETTERS.indexOf(ch) + 1;
  }
  function nhiIsValid(raw) {
    var s = String(raw).toUpperCase();
    var current = /^[A-HJ-NP-Z]{3}\d{4}$/.test(s);
    var expanded = /^[A-HJ-NP-Z]{3}\d{2}[A-HJ-NP-Z]{2}$/.test(s);
    if (!current && !expanded) return false;
    var sum = 0;
    for (var i = 0; i < 6; i++) sum += nhiValue(s[i]) * (7 - i);
    if (current) {
      var m = sum % 11;
      if (m === 0) return false;
      var digit = 11 - m;
      if (digit === 10) digit = 0;
      return String(digit) === s[6];
    }
    // Expanded format: 23 minus (sum mod 23) gives the check letter's position. A zero remainder has
    // no valid check letter (as published on Wikipedia; not yet confirmed against HISO 10046 itself).
    var r = sum % 23;
    if (r === 0) return false;
    return NHI_LETTERS[23 - r - 1] === s[6];
  }

  var BANK_ALGORITHM = {
    "01": "A", "02": "A", "03": "A", "04": "A", "06": "A", "08": "D", "09": "E", "10": "A", "11": "A",
    "12": "A", "13": "A", "14": "A", "15": "A", "16": "A", "17": "A", "18": "A", "19": "A", "20": "A",
    "21": "A", "22": "A", "23": "A", "24": "A", "25": "F", "26": "G", "27": "A", "28": "G", "29": "G",
    "30": "A", "31": "X", "33": "F", "35": "A", "38": "A"
  };
  var BANK_WEIGHTS = {
    A: [0, 0, 6, 3, 7, 9, 0, 10, 5, 8, 4, 2, 1, 0, 0, 0],
    B: [0, 0, 0, 0, 0, 0, 0, 10, 5, 8, 4, 2, 1, 0, 0, 0],
    D: [0, 0, 0, 0, 0, 0, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0],
    E: [0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 4, 3, 2, 0, 0, 1],
    F: [0, 0, 0, 0, 0, 0, 1, 7, 3, 1, 7, 3, 1, 0, 0, 0],
    G: [0, 0, 0, 0, 0, 0, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1],
    X: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };
  var BANK_MODULI = { A: [11, 11], B: [11, 11], D: [11, 11], E: [9, 11], F: [10, 10], G: [9, 10], X: [1, 1] };

  function bankCompact(raw) {
    var parts = String(raw).trim().replace(/ /g, "-").split("-").filter(function (p) { return p !== ""; });
    var pad = function (s, n) { while (s.length < n) s = "0" + s; return s; };
    if (parts.length === 4) return pad(parts[0], 2) + pad(parts[1], 4) + pad(parts[2], 7) + pad(parts[3], 3);
    var joined = parts.join("");
    return joined.slice(0, 13) + pad(joined.slice(13), 3);
  }
  function bankIsValid(raw) {
    var n = bankCompact(raw);
    if (!/^\d{16}$/.test(n)) return false;
    var algorithm = BANK_ALGORITHM[n.slice(0, 2)];
    if (!algorithm) return false;                       // unknown bank code
    if (algorithm === "A" && n.slice(6, 13) >= "0990000") algorithm = "B";
    var w = BANK_WEIGHTS[algorithm], mod = BANK_MODULI[algorithm], sum = 0;
    for (var i = 0; i < 16; i++) {
      var c = w[i] * Number(n[i]);
      sum += c > mod[0] ? c % mod[0] : c;
    }
    return sum % mod[1] === 0;
  }

  function luhnIsValid(raw) {
    var d = String(raw).replace(/[\s-]/g, "");
    if (!/^\d{13,19}$/.test(d)) return false;
    var sum = 0;
    for (var i = 0; i < d.length; i++) {
      var x = Number(d[d.length - 1 - i]);
      if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; }
      sum += x;
    }
    return sum % 10 === 0;
  }

  // ---------- detectors ----------
  // Each returns matches {type, start, end, text, why}. Higher priority wins where matches overlap.

  var TYPES = {
    ird: { label: "IRD number", tag: "[IRD NUMBER]", priority: 9 },
    bank: { label: "Bank account", tag: "[BANK ACCOUNT]", priority: 9 },
    nhi: { label: "NHI number", tag: "[NHI NUMBER]", priority: 9 },
    card: { label: "Card number", tag: "[CARD NUMBER]", priority: 8 },
    licence: { label: "Driver licence", tag: "[DRIVER LICENCE]", priority: 7 },
    passport: { label: "Passport number", tag: "[PASSPORT NUMBER]", priority: 7 },
    dob: { label: "Date of birth", tag: "[DATE OF BIRTH]", priority: 6 },
    email: { label: "Email address", tag: "[EMAIL]", priority: 5 },
    phone: { label: "Phone number", tag: "[PHONE]", priority: 4 }
  };

  function each(re, text, fn) {
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(text))) {
      fn(m);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  function before(text, index, size) { return text.slice(Math.max(0, index - size), index).toLowerCase(); }

  var DETECTORS = [
    function ird(text, out) {
      each(/(?<![\w-])(\d{2,3}[\s-]?\d{3}[\s-]?\d{3})(?![\w-])/g, text, function (m) {
        if (irdIsValid(m[1])) out.push({ type: "ird", start: m.index, end: m.index + m[1].length, text: m[1], why: "8 or 9 digits, with a valid IRD check digit" });
      });
    },
    function bank(text, out) {
      each(/(?<![\w-])(\d{2}[- ]\d{4}[- ]\d{7}[- ]\d{2,4})(?![\w-])/g, text, function (m) {
        if (bankIsValid(m[1])) out.push({ type: "bank", start: m.index, end: m.index + m[1].length, text: m[1], why: "bank, branch, account and suffix, with a valid bank checksum" });
      });
    },
    function nhi(text, out) {
      each(/(?<![A-Za-z0-9])([A-HJ-NP-Z]{3}\d{4}|[A-HJ-NP-Z]{3}\d{2}[A-HJ-NP-Z]{2})(?![A-Za-z0-9])/g, text, function (m) {
        if (nhiIsValid(m[1])) out.push({ type: "nhi", start: m.index, end: m.index + m[1].length, text: m[1], why: "NHI format, with a valid check character" });
      });
    },
    function card(text, out) {
      each(/(?<![\d-])((?:\d[ -]?){12,18}\d)(?![\d-])/g, text, function (m) {
        var d = m[1].replace(/[ -]/g, "");
        if (/^(4|5[1-5]|2[2-7]|3[47]|6)/.test(d) && luhnIsValid(d)) out.push({ type: "card", start: m.index, end: m.index + m[1].length, text: m[1], why: "13 to 19 digits that pass the card (Luhn) check" });
      });
    },
    function licenceOrPassport(text, out) {
      each(/(?<![A-Za-z0-9])([A-Z]{2}\d{6})(?![A-Za-z0-9])/g, text, function (m) {
        var near = before(text, m.index, 48);
        if (/passport/.test(near)) out.push({ type: "passport", start: m.index, end: m.index + m[1].length, text: m[1], why: "2 letters and 6 digits after the word passport" });
        else if (/licen[cs]e|driver|\bdl\b/.test(near)) out.push({ type: "licence", start: m.index, end: m.index + m[1].length, text: m[1], why: "2 letters and 6 digits after the word licence or driver" });
      });
    },
    function dob(text, out) {
      each(/\b(?:dob|d\.o\.b\.?|date of birth|born(?: on)?)\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4})/gi, text, function (m) {
        var start = m.index + m[0].lastIndexOf(m[1]);
        out.push({ type: "dob", start: start, end: start + m[1].length, text: m[1], why: "a date after DOB, date of birth or born" });
      });
    },
    function email(text, out) {
      each(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, text, function (m) {
        out.push({ type: "email", start: m.index, end: m.index + m[0].length, text: m[0], why: "an email address" });
      });
    },
    function phone(text, out) {
      // NZ mobiles (02x), landlines (03 to 09) and the +64 forms, with spaces, dashes or brackets.
      each(/(?<![\w+])((?:\+64|0064)[\s-]?\(?0?([2-9])\)?|\(?0([2-9])\)?)[\s-]?(\d[\d\s-]{5,10}\d)(?![\w-])/g, text, function (m) {
        var area = m[2] || m[3];
        var rest = m[4].replace(/[\s-]/g, "");
        var ok = area === "2" ? /^\d{7,9}$/.test(rest) : /^\d{7}$/.test(rest);
        if (ok) out.push({ type: "phone", start: m.index, end: m.index + m[0].length, text: m[0], why: area === "2" ? "an NZ mobile number" : "an NZ landline number" });
      });
    }
  ];

  // Keep the strongest match where two overlap: higher priority first, then the longer match.
  function resolve(found) {
    found.sort(function (a, b) {
      return (TYPES[b.type].priority - TYPES[a.type].priority) || ((b.end - b.start) - (a.end - a.start)) || (a.start - b.start);
    });
    var kept = [];
    found.forEach(function (f) {
      var clash = kept.some(function (k) { return f.start < k.end && k.start < f.end; });
      if (!clash) kept.push(f);
    });
    return kept.sort(function (a, b) { return a.start - b.start; });
  }

  /* scan(text, {types}) -> findings. types: list of type keys to look for (default: all). */
  function scan(text, options) {
    var wanted = (options && options.types) || Object.keys(TYPES);
    var found = [];
    DETECTORS.forEach(function (detect) { detect(String(text), found); });
    return resolve(found.filter(function (f) { return wanted.indexOf(f.type) !== -1; })).map(function (f) {
      f.label = TYPES[f.type].label;
      return f;
    });
  }

  /* clean(text, findings) -> the text with each finding replaced by its tag. */
  function clean(text, findings) {
    var out = "", at = 0;
    findings.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (f) {
      out += text.slice(at, f.start) + TYPES[f.type].tag;
      at = f.end;
    });
    return out + text.slice(at);
  }

  return {
    TYPES: TYPES,
    irdIsValid: irdIsValid,
    nhiIsValid: nhiIsValid,
    bankIsValid: bankIsValid,
    luhnIsValid: luhnIsValid,
    scan: scan,
    clean: clean
  };
});
