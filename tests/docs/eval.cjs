/*
  How well the invoice checker reads real-looking documents. Run: node tests/docs/eval.cjs [--pdf-only]

  Every document in truth.json is read in headless Chromium the way the page reads a dropped file
  (assets/js/files.js, then reader.js), as a PDF and as its photos. Each field and line is compared
  with its label. Then every pair is put together (pair.js) and checked (matcher.js), and the
  differences found are compared with the differences built in.

  Scores go to tests/docs/eval-result.json, with a summary printed at the end. Nothing here is part
  of the site; it needs Playwright (not installed by this repo).
*/
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "..");
const TRUTH = JSON.parse(fs.readFileSync(path.join(__dirname, "truth.json"), "utf8"));
const pdfOnly = process.argv.includes("--pdf-only");
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".gz": "application/gzip", ".json": "application/json" };
const PAGE = `<!doctype html><meta charset=utf-8><body>
<script src="/assets/js/matcher.js"></script><script src="/assets/js/reader.js"></script><script src="/assets/js/pair.js"></script><script src="/assets/js/files.js"></script>
<script>
window.readUrl = async (u) => {
  const r = await fetch(u); const b = await r.blob();
  const f = new File([b], u.split('/').pop(), { type: b.type });
  const t0 = performance.now();
  const got = await DocFiles.extract(f);
  const doc = got.text != null ? DocReader.fromText(got.text, { csv: got.csv, name: f.name }) : DocReader.read(got.items, { name: f.name });
  return { method: got.method, lang: got.lang, n: (got.items || []).length, ms: Math.round(performance.now() - t0), doc };
};
window.checkPair = (a, b, an, bn) => {
  const pr = DocPair.pair({ doc: b, name: bn }, { doc: a, name: an, target: true });
  const res = InvoiceChecker.check(pr.order, pr.invoice, pr.options);
  return { findings: res.findings.map(f => ({ rule: f.rule, severity: f.severity, code: f.code || null })), notes: pr.notes.map(n => n.title), warnings: pr.warnings.map(w => w.title),
    orderIsA: pr.roles.order.name === an, matched: pr.matched, orderCodes: pr.order.lines.map(l => l.code) };
};
</script>`;

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((q, r) => {
      const p = decodeURIComponent(q.url.split("?")[0]);
      if (p === "/__eval.html") { r.writeHead(200, { "Content-Type": TYPES[".html"] }); return r.end(PAGE); }
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); r.end(d); });
    });
    s.listen(0, () => resolve(s));
  });
}

const cents = (s) => (s == null ? null : Math.round(parseFloat(s) * 100));
const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
function words(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean); }
function like(a, b) { const A = words(a), B = words(b); if (!A.length || !B.length) return 0; let s = 0; const u = {}; A.forEach((w) => { const i = B.findIndex((x, j) => !u[j] && x === w); if (i >= 0) { u[i] = 1; s++; } }); return (2 * s) / (A.length + B.length); }

function scoreDoc(truth, got) {
  const d = got.doc, out = { fields: {}, lines: { truth: truth.lines.length, right: 0, found: d.lines.length, wrong: [] } };
  const f = out.fields;
  f.kind = d.kind === truth.kind;
  f.number = norm(d.number) === norm(truth.number);
  if (truth.kind !== "order") f.orderNumber = norm(d.orderNumber) === norm(truth.orderNumber);
  f.currency = d.currency === truth.currency;
  if (truth.taxId && truth.taxId.value) f.taxId = !!d.taxId && norm(d.taxId.value).replace(/^(GB|DE|FR|ES)/, "") === norm(truth.taxId.value).replace(/^(GB|DE|FR|ES)/, "");
  f.issued = d.issued === truth.issued;
  if (truth.subtotal != null) f.subtotal = d.subtotalCents === cents(truth.subtotal);
  if (truth.tax != null) f.tax = d.taxCents === cents(truth.tax);
  if (truth.total != null) f.total = d.totalCents === cents(truth.total);
  if ((truth.tracking || []).length) f.trackingNotLines = !d.lines.some((l) => truth.tracking.some((t) => (l.description + " " + l.code).replace(/\s/g, "").includes(t.replace(/\s/g, ""))));
  const used = {};
  truth.lines.forEach((tl, ti) => {
    let best = -1, bestS = 0;
    d.lines.forEach((l, i) => {
      if (used[i]) return;
      let s = tl.code && l.code && norm(l.code) === norm(tl.code) ? 2 : like(l.description + " " + (l.code || ""), tl.description + " " + (tl.code || ""));
      if (s > bestS) { bestS = s; best = i; }
    });
    if (best < 0 || bestS < 0.5) { out.lines.wrong.push({ line: ti, why: "not found", truth: tl.code || tl.description }); return; }
    used[best] = 1;
    const l = d.lines[best];
    const qOk = tl.qty == null || l.qty === tl.qty;
    const uOk = tl.unit == null || l.unitCents === cents(tl.unit);
    const cOk = !tl.code || norm(l.code) === norm(tl.code);
    if (qOk && uOk && cOk) out.lines.right++;
    else out.lines.wrong.push({ line: ti, truth: [tl.code, tl.qty, tl.unit].join(" "), got: [l.code, l.qty, l.unitCents].join(" ") });
  });
  out.lines.extra = d.lines.length - Object.keys(used).length;
  return out;
}

const EXPECT = { "price-higher": ["price-higher"], "qty-over": ["quantity-over"], "qty-under": ["quantity-short"], "extra-line": ["extra-line"], "missing-line": ["missing-line"],
  "gst-wrong": ["gst"], "totals-wrong": ["total", "subtotal"] };

function scorePair(p, got) {
  const out = { expected: p.differences.length, found: 0, missed: [], falseAlarms: [] };
  const used = {};
  p.differences.forEach((diff) => {
    if (diff.type === "code-differs") {
      // Right when the two codes were matched and nothing holds that line.
      const ok = got.notes.includes("Matched by description") && !got.findings.some((f) => f.severity === "check" && /line/.test(f.rule));
      if (ok) out.found++; else out.missed.push(diff.type + " " + diff.item);
      return;
    }
    if (diff.type === "currency-differs") { if (got.warnings.includes("Different currencies")) out.found++; else out.missed.push("currency-differs"); return; }
    const rules = EXPECT[diff.type] || [];
    const i = got.findings.findIndex((f, k) => !used[k] && rules.includes(f.rule));
    if (i >= 0) { used[i] = 1; out.found++; } else out.missed.push(diff.type + " " + (diff.item || ""));
  });
  got.findings.forEach((f, k) => {
    if (used[k] || f.severity !== "check") return;
    // A tax-invoice rule about the buyer's details is a real finding only when the labels say so; count it apart.
    out.falseAlarms.push(f.rule + (f.code ? " " + f.code : ""));
  });
  return out;
}

(async () => {
  const server = await serve();
  const base = "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base + "/__eval.html");
  const read = {};
  const docs = [];
  for (const t of TRUTH.docs) {
    if (only && !t.file.includes(only)) continue;
    const files = [t.file].concat(pdfOnly ? [] : (t.variants || []));
    for (const file of files) {
      const got = await page.evaluate((u) => window.readUrl(u), "/tests/docs/" + file);
      read[file] = got.doc;
      const s = scoreDoc(t, got);
      const kind = file.endsWith(".pdf") ? "pdf" : /photo/.test(file) ? "photo" : "png";
      docs.push({ file, kind, ms: got.ms, method: got.method, ...s });
      const fBad = Object.keys(s.fields).filter((k) => !s.fields[k]);
      if (only) process.stdout.write("   " + got.lang + " " + got.n + " read: " + got.doc.lines.map((l) => [l.code, l.qty, l.unitCents].join(" ")).join(" | ") + "\n");
      process.stdout.write(`${file.padEnd(28)} ${String(got.ms).padStart(5)} ms  lines ${s.lines.right}/${s.lines.truth}${s.lines.extra ? " +" + s.lines.extra + " extra" : ""}  ${fBad.length ? "wrong: " + fBad.join(",") : "fields ok"}\n`);
    }
  }
  const pairs = [];
  for (const p of TRUTH.pairs) {
    if (only && !(p.a.includes(only) || p.b.includes(only))) continue;
    const sets = [["pdf", p.a, p.b]];
    if (!pdfOnly) {
      const va = (TRUTH.docs.find((d) => d.file === p.a) || {}).variants || [], vb = (TRUTH.docs.find((d) => d.file === p.b) || {}).variants || [];
      const pa = va.find((v) => /photo/.test(v)), pb = vb.find((v) => /photo/.test(v));
      if (pa && pb && read[pa] && read[pb]) sets.push(["photo", pa, pb]);
    }
    for (const [kind, a, b] of sets) {
      if (!read[a] || !read[b]) continue;
      const got = await page.evaluate(([x, y, an, bn]) => window.checkPair(x, y, an, bn), [read[a], read[b], a, b]);
      const s = scorePair(p, got);
      pairs.push({ a, b, kind, ...s, orderIsA: got.orderIsA });
      process.stdout.write(`pair ${kind.padEnd(5)} ${path.basename(a)} + ${path.basename(b)}: found ${s.found}/${s.expected}${s.missed.length ? " missed " + s.missed.join("; ") : ""}${s.falseAlarms.length ? "  false: " + s.falseAlarms.join("; ") : ""}${got.orderIsA ? "" : "  (roles swapped)"}\n`);
    }
  }
  await browser.close();
  server.close();

  function sum(list) {
    const lines = list.reduce((t, d) => t + d.lines.truth, 0), right = list.reduce((t, d) => t + d.lines.right, 0), extra = list.reduce((t, d) => t + d.lines.extra, 0);
    let fTot = 0, fOk = 0;
    list.forEach((d) => Object.values(d.fields).forEach((v) => { fTot++; if (v) fOk++; }));
    const ms = list.map((d) => d.ms).sort((a, b) => a - b);
    return { documents: list.length, lineAccuracy: +(right / lines * 100).toFixed(1), linesRight: right, lines, extraLines: extra, fieldAccuracy: +(fOk / fTot * 100).toFixed(1), medianMs: ms[Math.floor(ms.length / 2)], slowestMs: ms[ms.length - 1] };
  }
  function psum(list) {
    const exp = list.reduce((t, p) => t + p.expected, 0), found = list.reduce((t, p) => t + p.found, 0), fa = list.reduce((t, p) => t + p.falseAlarms.length, 0);
    return { pairs: list.length, differences: exp, found, missed: exp - found, falseAlarms: fa, falseAlarmsPer10Docs: +(fa / (list.length * 2) * 10).toFixed(2) };
  }
  const summary = {
    run: new Date().toISOString(),
    pdf: sum(docs.filter((d) => d.kind === "pdf")),
    png: sum(docs.filter((d) => d.kind === "png")),
    photo: sum(docs.filter((d) => d.kind === "photo")),
    pairsPdf: psum(pairs.filter((p) => p.kind === "pdf")),
    pairsPhoto: psum(pairs.filter((p) => p.kind === "photo"))
  };
  fs.writeFileSync(path.join(__dirname, "eval-result.json"), JSON.stringify({ summary, docs, pairs }, null, 1));
  console.log("\n" + JSON.stringify(summary, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
