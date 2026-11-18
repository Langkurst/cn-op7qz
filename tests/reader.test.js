/*
  Reading your own documents (assets/js/reader.js and pair.js), checked on the 39 made-up PDFs in
  tests/docs (8 layouts, 5 languages, 5 currencies). Each PDF's text is taken out with the same
  pdf.js the page uses (assets/vendor/pdfjs), then read and compared with tests/docs/truth.json;
  every pair is checked and must find exactly the differences built into it.

  These hold the PDF scores at 100%. Photos are measured by tests/docs/eval.cjs, which needs a
  browser; its last scores are in tests/docs/eval-result.json.
*/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const R = require("../assets/js/reader.js");
const P = require("../assets/js/pair.js");
const M = require("../assets/js/matcher.js");

const DOCS = path.join(__dirname, "docs");
const TRUTH = JSON.parse(fs.readFileSync(path.join(DOCS, "truth.json"), "utf8"));
const cents = (s) => (s == null ? null : Math.round(parseFloat(s) * 100));
const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");

let pdfjs;
async function items(file) {
  if (!pdfjs) {
    // pdf.js warns that it can't draw pages in Node; only its text is used here.
    const warn = console.warn, log = console.log;
    console.warn = () => {}; console.log = () => {};
    pdfjs = await import(path.join(__dirname, "..", "assets", "vendor", "pdfjs", "pdf.min.mjs"));
    pdfjs.GlobalWorkerOptions.workerSrc = path.join(__dirname, "..", "assets", "vendor", "pdfjs", "pdf.worker.min.mjs");
    console.warn = warn; console.log = log;
  }
  const data = new Uint8Array(fs.readFileSync(path.join(DOCS, file)));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, verbosity: 0,
    cMapUrl: path.join(__dirname, "..", "assets", "vendor", "pdfjs", "cmaps") + "/", cMapPacked: true }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tr = it.transform, h = Math.hypot(tr[2], tr[3]) || it.height || 10;
      out.push({ str: it.str, x: tr[4], y: vp.height - tr[5] - h * 0.8, w: it.width, h, page: p });
    }
  }
  return out;
}

const read = {};
test("every PDF in the test set is read field for field and line for line", async () => {
  const problems = [];
  for (const t of TRUTH.docs) {
    const d = R.read(await items(t.file), { name: path.basename(t.file) });
    read[t.file] = d;
    const bad = [];
    if (d.kind !== t.kind) bad.push("kind " + d.kind);
    if (norm(d.number) !== norm(t.number)) bad.push("number " + d.number);
    if (t.kind !== "order" && norm(d.orderNumber) !== norm(t.orderNumber)) bad.push("order number " + d.orderNumber);
    if (d.currency !== t.currency) bad.push("currency " + d.currency);
    if (d.issued !== t.issued) bad.push("date " + d.issued);
    if (t.total != null && d.totalCents !== cents(t.total)) bad.push("total " + d.totalCents);
    if (t.tax != null && d.taxCents !== cents(t.tax)) bad.push("tax " + d.taxCents);
    if (d.lines.length !== t.lines.length) bad.push(d.lines.length + " lines, not " + t.lines.length);
    t.lines.forEach((tl, i) => {
      const l = d.lines[i];
      if (!l) return;
      if (tl.code && norm(l.code) !== norm(tl.code)) bad.push("line " + (i + 1) + " code " + l.code);
      if (tl.qty != null && l.qty !== tl.qty) bad.push("line " + (i + 1) + " qty " + l.qty);
      if (tl.unit != null && l.unitCents !== cents(tl.unit)) bad.push("line " + (i + 1) + " price " + l.unitCents);
    });
    if (bad.length) problems.push(t.file + ": " + bad.join(", "));
  }
  assert.deepEqual(problems, []);
});

const RULES = { "price-higher": ["price-higher"], "qty-over": ["quantity-over"], "qty-under": ["quantity-short"], "extra-line": ["extra-line"],
  "missing-line": ["missing-line"], "gst-wrong": ["gst"], "totals-wrong": ["total", "subtotal"] };

test("every pair finds the differences built into it, and nothing else that holds the bill", async () => {
  const problems = [];
  for (const p of TRUTH.pairs) {
    if (!read[p.a]) read[p.a] = R.read(await items(p.a), { name: path.basename(p.a) });
    if (!read[p.b]) read[p.b] = R.read(await items(p.b), { name: path.basename(p.b) });
    // The second document is dropped onto the first.
    const pr = P.pair({ doc: read[p.b], name: p.b }, { doc: read[p.a], name: p.a, target: true });
    const res = M.check(pr.order, pr.invoice, pr.options);
    const used = new Set();
    p.differences.forEach((diff) => {
      if (diff.type === "code-differs") {
        if (!pr.notes.some((n) => n.title === "Matched by description")) problems.push(`${p.a} + ${p.b}: ${diff.item} not matched by description`);
        return;
      }
      if (diff.type === "currency-differs") {
        if (!pr.warnings.some((w) => w.title === "Different currencies")) problems.push(`${p.a} + ${p.b}: currencies not noticed`);
        return;
      }
      const i = res.findings.findIndex((f, k) => !used.has(k) && RULES[diff.type].includes(f.rule));
      if (i < 0) problems.push(`${p.a} + ${p.b}: missed ${diff.type} ${diff.item || ""}`);
      else used.add(i);
    });
    res.findings.forEach((f, k) => { if (!used.has(k) && f.severity === "check") problems.push(`${p.a} + ${p.b}: false alarm ${f.rule} ${f.code || ""}`); });
  }
  assert.deepEqual(problems, []);
});

test("money in other formats: 1.234,56 and 1 234,56 and a trailing minus", () => {
  assert.equal(R.parseAmount("1.234,56", ","), 123456);
  assert.equal(R.parseAmount("1 234,56 €", ","), 123456);
  assert.equal(R.parseAmount("$1,234.56", "."), 123456);
  assert.equal(R.parseAmount("100.00-", "."), -10000);
  assert.equal(R.parseAmount("(12.50)", "."), -1250);
  assert.equal(R.parseAmount("1:35", "."), 135, "a photo's colon for a decimal point");
});

test("dates in the forms suppliers use", () => {
  assert.equal(R.parseDateText("5 November 2026"), "2026-11-05");
  assert.equal(R.parseDateText("02-Oct-2026"), "2026-10-02");
  assert.equal(R.parseDateText("19.10.2026"), "2026-10-19");
  assert.equal(R.parseDateText("10 de octubre de 2026"), "2026-10-10");
  assert.equal(R.parseDateText("10/09/2026", true), "2026-10-09", "American month first");
  assert.equal(R.parseDateText("10/09/2026"), "2026-09-10");
});

test("courier tracking numbers are noticed and never read as lines", () => {
  const rows = R.toRows(R.textToItems("Dispatched via UPS, tracking 1Z999AA10123456784\nNZ Post LZ158768409NZ\nFedEx tracking 7712 3456 7890"));
  const found = R.findTracking(rows);
  assert.ok(found.includes("1Z999AA10123456784"));
  assert.ok(found.includes("LZ158768409NZ"));
  assert.ok(found.includes("771234567890"));
});

test("the page reads files without letting anything leave it", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "invoice-checker.html"), "utf8");
  for (const s of ["reader.js", "pair.js", "files.js", "desk.js"]) assert.ok(html.includes(`<script src="assets/js/${s}"></script>`), s);
  const files = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "files.js"), "utf8");
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(files), "files.js makes no requests of its own");
  assert.match(files, /workerBlobURL: false/);
  assert.ok(!/localStorage|indexedDB|sessionStorage/.test(files + fs.readFileSync(path.join(__dirname, "..", "assets", "js", "desk.js"), "utf8")), "nothing is stored");
});
