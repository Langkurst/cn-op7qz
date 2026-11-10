// Tests for the NZ privacy checker. Run from the project folder:  node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../assets/js/privacy.js");
const vectors = require("./fixtures/nz-vectors.json");

const types = (text) => P.scan(text).map((f) => f.type);
const texts = (text) => P.scan(text).map((f) => f.text);

test(`IRD numbers: all ${vectors.ird.length} cases agree with ${vectors.source}`, () => {
  const wrong = vectors.ird.filter(([n, valid]) => P.irdIsValid(n) !== valid);
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} disagree`);
  assert.ok(vectors.ird.some(([, v]) => v) && vectors.ird.some(([, v]) => !v), "the set holds valid and invalid numbers");
});

test(`Bank accounts: all ${vectors.bank.length} cases agree with ${vectors.source}`, () => {
  const wrong = vectors.bank.filter(([n, valid]) => P.bankIsValid(n) !== valid);
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} disagree`);
});

test("NHI: the six examples Health New Zealand publishes are valid", () => {
  for (const n of ["ZAA0067", "ZAA0075", "ZAA0083", "ACA31FM", "ASE37QK", "ARE62RS"]) assert.ok(P.nhiIsValid(n), n);
});

test("NHI: changing the check character always makes it invalid", () => {
  for (const n of ["ZAA0067", "ZAA0075", "ZAA0083"]) {
    for (let d = 0; d <= 9; d++) if (String(d) !== n[6]) assert.equal(P.nhiIsValid(n.slice(0, 6) + d), false, n.slice(0, 6) + d);
  }
  for (const n of ["ACA31FM", "ASE37QK", "ARE62RS"]) {
    for (const c of "ABCDEFGHJKLMNPQRSTUVWXYZ") if (c !== n[6]) assert.equal(P.nhiIsValid(n.slice(0, 6) + c), false, n.slice(0, 6) + c);
  }
});

test("NHI current format: a check value of 10 becomes the digit 0", () => {
  // Z=24, A=1, A=1, 0, 1, 3: 168+6+5+0+3+6 = 188; 188 mod 11 = 1; 11 - 1 = 10, written as 0.
  assert.ok(P.nhiIsValid("ZAA0130"));
  for (let d = 1; d <= 9; d++) assert.equal(P.nhiIsValid("ZAA013" + d), false);
});

test("NHI expanded format: a sum that divides exactly by 23 has no valid check letter", () => {
  // A,A,A,0,0,P: 7+6+5+0+0+28 = 46 = 2 x 23.
  for (const c of "ABCDEFGHJKLMNPQRSTUVWXYZ") assert.equal(P.nhiIsValid("AAA00P" + c), false, "AAA00P" + c);
});

test("NHI: the letters I and O are never part of an NHI", () => {
  assert.equal(P.nhiIsValid("ZIA0067"), false);
  assert.equal(P.nhiIsValid("ZOA0067"), false);
});

test("cards: the Luhn check", () => {
  assert.ok(P.luhnIsValid("4111 1111 1111 1111"));
  assert.ok(!P.luhnIsValid("4111 1111 1111 1112"));
});

const SAMPLE = [
  "Hi team, can you update Sam's file before Friday?",
  "IRD 49-098-576, NHI ZAA0067, pay to 01-0902-0068389-00.",
  "Mobile 021 123 4567, home (09) 123 4567, email sam.example@example.co.nz.",
  "Driver licence AB123456. Passport LA654321. DOB: 12/03/1985.",
  "Card on file 4111 1111 1111 1111.",
].join("\n");

test("finds each kind of detail in a realistic note, once each", () => {
  const found = P.scan(SAMPLE);
  assert.deepEqual(found.map((f) => f.type), ["ird", "nhi", "bank", "phone", "phone", "email", "licence", "passport", "dob", "card"]);
  assert.deepEqual(found.map((f) => f.text), ["49-098-576", "ZAA0067", "01-0902-0068389-00", "021 123 4567", "(09) 123 4567", "sam.example@example.co.nz", "AB123456", "LA654321", "12/03/1985", "4111 1111 1111 1111"]);
  for (const f of found) assert.ok(f.why && f.label, "every finding says why");
});

test("the cleaned copy keeps the wording and removes every detail", () => {
  const found = P.scan(SAMPLE);
  const cleaned = P.clean(SAMPLE, found);
  for (const f of found) assert.ok(!cleaned.includes(f.text), `${f.text} still present`);
  assert.match(cleaned, /IRD \[IRD NUMBER\], NHI \[NHI NUMBER\], pay to \[BANK ACCOUNT\]\./);
  assert.match(cleaned, /^Hi team, can you update Sam's file before Friday\?/);
  assert.equal(P.scan(cleaned).length, 0, "nothing left to find");
});

test("phone formats people actually write", () => {
  for (const p of ["021 123 4567", "0211234567", "022-123-4567", "+64 21 123 4567", "+64 9 123 4567", "(09) 123 4567", "09 123 4567", "03-123 4567"]) {
    assert.deepEqual(types(`Call ${p} today`), ["phone"], p);
  }
});

test("numbers too long or too short for an NZ phone are not reported as phones", () => {
  for (const t of ["Ref 09 1234 56789", "Ref 021 12345", "Ref 03 123 45"]) assert.deepEqual(types(t), [], t);
});

test("where two kinds overlap, only the stronger one is reported", () => {
  // 049 098 576 is a valid IRD number and also has the shape of an Auckland landline.
  assert.deepEqual(types("IRD 049 098 576"), ["ird"]);
});

test("does not flag ordinary business text", () => {
  const ordinary = [
    "Order 4500012904 for 300 units at $1,234.50 arrived on 10/11/2026.",
    "Product code AB123456 is out of stock.",
    "Invoice INV-20418, total $2,518.50 including GST.",
    "The meeting is at 10:30 on 12 March 2026 in room 4021.",
    "Version 1.433 passed 3,000 tests.",
  ];
  for (const t of ordinary) assert.deepEqual(types(t), [], t);
});

test("an IRD number with a wrong check digit is not reported as one", () => {
  assert.ok(!types("IRD 49-098-577").includes("ird"));
});

test("a bank account is reported as a bank account, not as a phone number", () => {
  assert.deepEqual(types("Pay 01-0902-0068389-00 today"), ["bank"]);
});

test("a licence-like code needs the word licence, driver or passport nearby", () => {
  assert.deepEqual(types("Ref AB123456"), []);
  assert.deepEqual(types("DL AB123456"), ["licence"]);
  assert.deepEqual(types("passport no. LA654321"), ["passport"]);
});

test("can be limited to chosen kinds of detail", () => {
  const found = P.scan(SAMPLE, { types: ["email", "ird"] });
  assert.deepEqual(found.map((f) => f.type), ["ird", "email"]);
});

test("scanning does not change the text, and finds the same things twice", () => {
  const copy = String(SAMPLE);
  assert.deepEqual(texts(SAMPLE), texts(copy));
  assert.equal(SAMPLE, copy);
});
