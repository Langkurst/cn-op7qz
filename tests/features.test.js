// Tests for the invoice checker's added features: entering your own bill, duplicates, the supplier
// query, the GST number box, the cents allowance, the keyboard sheet and the support link.
// Run from the project folder:  node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../assets/js/matcher.js");
const E = require("../assets/js/entry.js");
const samples = require("../assets/js/samples.js");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const html = read("invoice-checker.html");
const page = read("assets/js/invoice-page.js");
const css = read("assets/css/invoice.css");
const system = read("assets/css/system.css");
const rules = (r) => r.findings.map((f) => f.rule);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- 1. Enter your own bill ----------
function form(extra) {
  return Object.assign({
    supplier: "Kauri Bolts Ltd", gstNumber: "124-587-301", invoiceNumber: "KB-100", date: "2026-11-03",
    orderNumber: "PO-77", buyerName: "Example Kitchens Ltd", buyerIdentifier: "GST 112-345-671",
    rows: [["Bolt M8", "100", "1.20", "100", "1.20"], ["Washer M8", "200", "0.10", "200", "0.10"]],
  }, extra);
}

test("entry: a filled form becomes an order and an invoice the rules can check", () => {
  const r = E.buildBill(form());
  assert.equal(r.ok, true);
  const { order, invoice } = r.bill;
  assert.equal(order.number, "PO-77");
  assert.equal(invoice.orderNumber, "PO-77");
  assert.equal(invoice.issued, "3 November 2026");
  assert.equal(invoice.lines[0].unitCents, 120);
  assert.equal(invoice.subtotalCents, 14000);
  assert.equal(invoice.gstCents, 2100);
  assert.equal(invoice.totalCents, 16100);
  const result = C.check(order, invoice);
  assert.equal(result.verdict, "match");
});

test("entry: the same rules catch a higher price on an entered bill", () => {
  const r = E.buildBill(form({ rows: [["Bolt M8", "100", "1.20", "100", "1.50"]] }));
  assert.deepEqual(rules(C.check(r.bill.order, r.bill.invoice)), ["price-higher"]);
});

test("entry: a line with nothing invoiced is a note, and an unordered line is an extra", () => {
  const r = E.buildBill(form({ rows: [["Bolt M8", "100", "1.20", "", ""], ["Freight", "", "", "1", "40.00"]] }));
  assert.equal(r.ok, true);
  const found = rules(C.check(r.bill.order, r.bill.invoice));
  assert.ok(found.includes("missing-line"));
  assert.ok(found.includes("extra-line"));
});

test("entry: missing or unreadable input is refused with a plain message", () => {
  assert.equal(E.buildBill(form({ supplier: " " })).ok, false);
  assert.equal(E.buildBill(form({ invoiceNumber: "" })).ok, false);
  assert.equal(E.buildBill(form({ orderNumber: "" })).ok, false);
  assert.equal(E.buildBill(form({ rows: [["", "", "", "", ""]] })).ok, false);
  const bad = E.buildBill(form({ rows: [["Bolt", "ten", "1.20", "10", "1.20"]] }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /Line 1/);
  const half = E.buildBill(form({ rows: [["Bolt", "10", "", "10", "1.20"]] }));
  assert.equal(half.ok, false);
});

test("entry: blank rows are ignored", () => {
  const r = E.buildBill(form({ rows: [["Bolt M8", "1", "2", "1", "2"], ["", "", "", "", ""], ["", "", "", "", ""]] }));
  assert.equal(r.ok, true);
  assert.equal(r.bill.invoice.lines.length, 1);
});

test("entry: dates read as typed or picked", () => {
  assert.equal(E.formatDate("2026-11-03"), "3 November 2026");
  assert.equal(E.formatDate(""), "");
  assert.equal(E.formatDate("not a date"), "not a date");
});

test("paste: tab-separated rows from a spreadsheet are split into cells", () => {
  assert.deepEqual(E.parsePaste("Bolt\t10\t1.20\r\nNut\t5\t0.50\r\n"), [["Bolt", "10", "1.20"], ["Nut", "5", "0.50"]]);
  assert.deepEqual(E.parsePaste('"Bolt, M8"\t10'), [["Bolt, M8", "10"]]);
  assert.deepEqual(E.parsePaste("single"), [["single"]]);
});

test("paste: rows fill from the cell you paste into, to the right and down, adding rows", () => {
  const grid = [["", "", "", "", ""]];
  const out = E.fillGrid(grid, 0, 0, "Bolt\t10\t1.20\nNut\t5\t0.50", 5);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], ["Bolt", "10", "1.20", "", ""]);
  assert.deepEqual(out[1], ["Nut", "5", "0.50", "", ""]);
  // pasted into the invoice quantity column, two columns land in the last two cells
  const out2 = E.fillGrid(out, 0, 3, "9\t1.30", 5);
  assert.deepEqual(out2[0], ["Bolt", "10", "1.20", "9", "1.30"]);
  // too many columns are cut off at the edge instead of spilling
  const out3 = E.fillGrid([["", "", "", "", ""]], 0, 3, "1\t2\t3\t4", 5);
  assert.deepEqual(out3[0], ["", "", "", "1", "2"]);
  assert.equal(grid.length, 1, "the original grid is not changed");
});

test("entry: the page has a New check button, a form, a grid, a paste handler and a memory-only line", () => {
  assert.match(html, /id="new-check"[^>]*>[\s\S]*?New check/);
  assert.match(html, /<dialog[^>]*id="entry"/);
  assert.match(html, /<form[^>]*id="entry-form"/);
  assert.match(html, /id="entry-supplier"/);
  assert.match(html, /id="entry-gst"/);
  assert.match(html, /id="entry-invoice"/);
  assert.match(html, /id="entry-date"/);
  assert.match(html, /id="entry-buyer"/);
  assert.match(html, /id="entry-grid"/);
  assert.match(html, /Nothing you enter here is saved or sent/);
  assert.match(page, /addEventListener\("paste"/);
  assert.match(page, /E\.fillGrid/);
  assert.match(page, /E\.buildBill/);
  assert.match(html, /<script src="assets\/js\/entry\.js"><\/script>/);
});

// ---------- 2. Duplicate check ----------
test("suppliers compare loosely: case, punctuation and endings are ignored", () => {
  const n = C.normaliseSupplier;
  assert.equal(n("Example Fittings Ltd"), n("EXAMPLE FITTINGS LIMITED"));
  assert.equal(n("Example Fittings Ltd."), n("example fittings"));
  assert.equal(n("Smith & Co"), n("Smith and Co."));
  assert.equal(n("Smith, Jones Co. Ltd"), n("smith jones"));
  assert.notEqual(n("Example Fittings Ltd"), n("Sample Hardware Imports Ltd"));
  assert.equal(n(""), "");
});

test("dates in the usual forms read to the same day", () => {
  const d = C.parseDate;
  assert.equal(d("3 November 2026"), d("2026-11-03"));
  assert.equal(d("3 Nov 2026"), d("03/11/2026"));
  assert.equal(d("4 November 2026") - d("3 November 2026"), 1);
  assert.ok(Number.isNaN(d("")));
  assert.ok(Number.isNaN(d("soon")));
});

const bill = (id, supplier, number, issued, totalCents) => ({ id, supplier, number, issued, totalCents });

test("duplicates: same supplier and invoice number", () => {
  const d = C.findDuplicates([
    bill("a", "Example Fittings Ltd", "INV-20418", "3 November 2026", 251850),
    bill("b", "EXAMPLE FITTINGS LIMITED", "inv 20418", "20 January 2027", 100),
    bill("c", "Other Co", "INV-20418", "3 November 2026", 251850),
  ]);
  assert.equal(d.a.length, 1);
  assert.equal(d.a[0].otherId, "b");
  assert.equal(d.a[0].kind, "number");
  assert.equal(d.b.length, 1);
  assert.equal(d.c, undefined, "a different supplier is not a duplicate");
});

test("duplicates: same supplier and same total within 5 days, not 6", () => {
  const base = bill("a", "Example Fittings Ltd", "A-1", "3 November 2026", 50000);
  const near = C.findDuplicates([base, bill("b", "Example Fittings", "B-2", "8 November 2026", 50000)]);
  assert.equal(near.a[0].kind, "total");
  const far = C.findDuplicates([base, bill("b", "Example Fittings", "B-2", "9 November 2026", 50000)]);
  assert.equal(far.a, undefined);
  const other = C.findDuplicates([base, bill("b", "Example Fittings", "B-2", "5 November 2026", 50001)]);
  assert.equal(other.a, undefined);
  const nodate = C.findDuplicates([base, bill("b", "Example Fittings", "B-2", "", 50000)]);
  assert.equal(nodate.a, undefined, "without a date the total alone is not enough");
});

test("duplicates: blank invoice numbers do not match each other, and the demo bills are clear", () => {
  const blank = C.findDuplicates([bill("a", "X Ltd", "", "3 November 2026", 100), bill("b", "X Ltd", " ", "20 December 2026", 200)]);
  assert.deepEqual(blank, {});
  const demo = C.findDuplicates(samples.map((s) => ({ id: s.id, supplier: s.invoice.supplier, number: s.invoice.number, issued: s.invoice.issued, totalCents: s.invoice.totalCents })));
  assert.deepEqual(demo, {});
});

test("duplicates: a duplicate holds the bill like the other hold reasons", () => {
  const s = clone(samples[0]);
  const none = C.check(s.order, s.invoice);
  assert.equal(none.verdict, "match");
  const dup = [{ otherId: "x", kind: "number", number: "INV-20418", issued: "3 November 2026", totalCents: 251850 }];
  const r = C.check(s.order, s.invoice, { duplicates: dup });
  assert.deepEqual(rules(r), ["duplicate-invoice"]);
  assert.equal(r.findings[0].severity, "check");
  assert.equal(r.verdict, "check");
  assert.match(r.findings[0].detail, /same invoice number/);
  const byTotal = C.check(s.order, s.invoice, { duplicates: [{ otherId: "x", kind: "total", number: "B-2", issued: "5 November 2026", totalCents: 251850 }] });
  assert.match(byTotal.findings[0].detail, /same total/);
});

test("duplicates: the page asks for them and lists the rule", () => {
  assert.match(page, /findDuplicates/);
  assert.match(page, /duplicates:/);
  assert.match(page, /"duplicate-invoice"/);
  assert.match(html, /A possible duplicate/);
});

// ---------- 3. Supplier query and print ----------
test("query: lists each mismatch as line, expected, invoiced, in a polite plain message", () => {
  const s = clone(samples[1]);
  const r = C.check(s.order, s.invoice);
  const q = C.supplierQuery(s.order, s.invoice, r);
  assert.match(q, /^Hello,/);
  assert.match(q, /SHI-7731/);
  assert.match(q, /4500012904/);
  assert.match(q, /RUN-500: expected \$15\.60 each, invoiced \$16\.10 each/);
  assert.match(q, /LED-2M: expected 50, invoiced 60/);
  assert.match(q, /Thank you/);
  assert.match(q, /Example Kitchens Ltd\s*$/);
  assert.ok(!/!/.test(q));
  assert.ok(!/[–—]/.test(q));
  assert.ok(!/LEG-100/.test(q), "a note is not raised with the supplier");
});

test("query: covers totals, tax details and an extra line", () => {
  const s = clone(samples[3]);
  const q = C.supplierQuery(s.order, s.invoice, C.check(s.order, s.invoice));
  assert.match(q, /Order number: expected 4500012958, invoiced 4500012985/);
  assert.match(q, /GST/);
  assert.match(q, /Total/);
  const t = clone(samples[2]);
  const q2 = C.supplierQuery(t.order, t.invoice, C.check(t.order, t.invoice));
  assert.match(q2, /FRT: expected not on the order, invoiced 1 at \$85\.00/);
});

test("query: a bill with nothing to raise gives an empty query", () => {
  const s = clone(samples[0]);
  assert.equal(C.supplierQuery(s.order, s.invoice, C.check(s.order, s.invoice)), "");
});

test("copy and print: buttons, a pre-mounted status region, a tick, 1.5 seconds, and a print stylesheet", () => {
  assert.match(html, /<p[^>]*id="copy-live"[^>]*role="status"|<p[^>]*role="status"[^>]*id="copy-live"/);
  assert.match(page, /Copy query for supplier/);
  assert.match(page, /Print summary/);
  assert.match(page, /"Copied"/);
  assert.match(page, /1500/);
  assert.match(page, /window\.print\(\)/);
  assert.match(page, /navigator\.clipboard/);
  assert.match(css, /@media print/);
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /\.inbox[^{]*\{[^}]*display:\s*none/);
  assert.ok(!/toast/i.test(page + css + html), "no toast");
});

// ---------- 4. GST number box ----------
test("gst box: a standalone field uses the same check digit code", () => {
  assert.match(html, /id="gst-check"/);
  assert.match(html, /id="gst-result"[^>]*role="status"|role="status"[^>]*id="gst-result"/);
  assert.match(html, /Check a GST number/);
  assert.match(page, /describeGstNumber/);
  assert.match(read("assets/js/matcher.js"), /function describeGstNumber[\s\S]*?gstNumberIsValid\(n\)/);
  assert.equal(C.gstNumberIsValid("124-587-301"), true);
  assert.equal(C.gstNumberIsValid("136-900-425"), false);
  assert.equal(typeof C.describeGstNumber, "function");
  assert.equal(C.describeGstNumber("").state, "empty");
  assert.equal(C.describeGstNumber("12").state, "short");
  assert.equal(C.describeGstNumber("124 587 301").state, "valid");
  assert.equal(C.describeGstNumber("136-900-425").state, "invalid");
  assert.equal(C.describeGstNumber("12a-587-301").state, "short");
  assert.match(C.describeGstNumber("124-587-301").text, /does not confirm|not confirm/i);
});

// ---------- 5. Cents allowance ----------
function pair() {
  const lines = () => [{ code: "A-1", description: "Item A", qty: 10, unitCents: 1000 }];
  return {
    order: { number: "1", supplier: "S Ltd", lines: lines() },
    invoice: { number: "I", supplier: "S Ltd", orderNumber: "1", lines: [{ code: "A-1", description: "Item A", qty: 10, unitCents: 1003 }], subtotalCents: 10030, gstCents: 1505, totalCents: 11535 },
  };
}
test("cents allowance: a difference under the allowance is a note, at or over it holds", () => {
  const { order, invoice } = pair();
  assert.deepEqual(rules(C.check(order, invoice)), ["price-higher"]);
  const within = C.check(order, invoice, { priceToleranceCents: 5 });
  assert.deepEqual(rules(within), ["price-within-allowance"]);
  assert.match(within.findings[0].detail, /inside the 5 cent allowance/);
  assert.deepEqual(rules(C.check(order, invoice, { priceToleranceCents: 3 })), ["price-higher"]);
  invoice.lines[0].unitCents = 1005;
  invoice.subtotalCents = 10050; invoice.gstCents = 1508; invoice.totalCents = 11558;
  assert.deepEqual(rules(C.check(order, invoice, { priceToleranceCents: 5 })), ["price-higher"]);
});

test("cents allowance: works beside the percent allowance, the larger one wins", () => {
  const { order, invoice } = pair();
  assert.deepEqual(rules(C.check(order, invoice, { priceToleranceCents: 1, priceTolerancePercent: 1 })), ["price-within-allowance"]);
  assert.deepEqual(rules(C.check(order, invoice, { priceToleranceCents: 0, priceTolerancePercent: 0 })), ["price-higher"]);
});

test("cents allowance: the page has the field, defaulting to 5", () => {
  assert.match(html, /id="tolerance-cents"[^>]*value="5"/);
  assert.match(html, /Ignore differences under/);
  assert.match(page, /priceToleranceCents/);
});

// ---------- 6. Keyboard ----------
test("keyboard: j, k, arrows, a and h are handled, never while typing, and ? opens the sheet", () => {
  assert.match(page, /addEventListener\("keydown"/);
  for (const k of ['"j"', '"k"', '"ArrowDown"', '"ArrowUp"', '"a"', '"h"', '"?"']) assert.ok(page.includes(k), k);
  assert.match(page, /keydown",\s*function \(e\) \{[^]*?if \(isTyping\(e\.target\)\) return;[^]*?"j"/, "the handler must return before acting when typing");
  const src = page.match(/function isTyping\(t\) \{[^]*?\n  \}/)[0];
  const isTyping = new Function(`${src}; return isTyping;`)();
  assert.equal(isTyping({ tagName: "INPUT" }), true);
  assert.equal(isTyping({ tagName: "TEXTAREA" }), true);
  assert.equal(isTyping({ tagName: "SELECT" }), true);
  assert.equal(isTyping({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTyping({ tagName: "BUTTON" }), false);
  assert.equal(isTyping(null), false);
  assert.match(page, /INPUT|TEXTAREA|SELECT/);
  assert.match(page, /isContentEditable/);
  assert.match(page, /ctrlKey|metaKey|altKey/);
  assert.match(html, /<dialog[^>]*id="keys"/);
  assert.match(html, /aria-label="Keyboard shortcuts"|aria-labelledby="keys-h"/);
  assert.match(page, /showModal/);
});

test("keyboard sheet: opacity and scale from 0.98 over 150 ms, off for reduced motion", () => {
  assert.match(css, /@keyframes sheet-in\s*\{[^}]*opacity:\s*0[^}]*scale\(\.98\)|@keyframes sheet-in\s*\{[^}]*scale\(0\.98\)/);
  assert.match(css, /dialog\.sheet\[open\]\s*\{[^}]*animation:[^;}]*var\(--sheet\)/);
  assert.match(system, /--sheet:\s*\.15s/);
  assert.match(system, /--ease-out:\s*cubic-bezier\(0?\.22,\s*1,\s*0?\.36,\s*1\)/);
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(reduced, "no reduced-motion block");
  assert.match(reduced[1], /animation:\s*none/);
});

test("motion: new styles animate transform and opacity only", () => {
  const added = css.slice(css.indexOf("/* Added features */"));
  assert.ok(added.length > 100, "marker comment missing");
  for (const m of added.matchAll(/transition:\s*([^;]+);/g)) {
    for (const part of m[1].split(",")) {
      const prop = part.trim().split(/\s+/)[0];
      assert.ok(["opacity", "transform"].includes(prop), `transition on ${prop}`);
    }
  }
  for (const m of added.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)) {
    assert.ok(!/\b(width|height|top|left|margin|background|color|filter)\s*:/.test(m[1]), "keyframes touch more than transform and opacity");
  }
});

// ---------- 7. Support link ----------
test("support link: one plain line in the footer, no widget, no script", () => {
  const foot = html.slice(html.indexOf('<footer'), html.indexOf("</footer>"));
  assert.match(foot, /Free to use\. If it saved you time, you can support my work on <a [^>]*href="https:\/\/ko-fi\.com\/keaclip"[^>]*>Ko-fi<\/a>\./);
  assert.match(foot, /rel="noopener noreferrer"/);
  assert.ok(!/<script/i.test(foot));
  assert.ok(!/<iframe|ko-fi\.com\/widgets|overlay/i.test(html));
  assert.equal((html.match(/ko-fi/gi) || []).length, 2, "the link and its text, nothing more");
  assert.ok(!/popup|banner|modal-first|first.visit/i.test(page));
});

// ---------- the page as a whole ----------
test("the security policy is unchanged and nothing is stored", () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(csp, "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(page.replace(/localStorage\.setItem\("theme"/, "")));
  assert.ok(!/ style="/.test(html));
  assert.ok(!/<script>[^<]/.test(html));
});

test("the new scripts parse", () => {
  const { spawnSync } = require("child_process");
  for (const f of ["assets/js/entry.js", "assets/js/invoice-page.js", "assets/js/matcher.js"]) {
    const r = spawnSync(process.execPath, ["--check", path.join(ROOT, f)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test("the new wording avoids the banned words, dashes and exclamation marks", () => {
  const banned = /\b(seamless|effortless|easy|simple|simply|powerful|streamlined|workflow|insights|solution|leverage|ensure)\b/i;
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const [name, text] of [["html", visible], ["invoice-page.js", page], ["entry.js", read("assets/js/entry.js")], ["matcher.js", read("assets/js/matcher.js")]]) {
    const hit = text.match(banned);
    assert.equal(hit, null, `${name}: ${hit && hit[0]}`);
    assert.ok(!/[–—]/.test(text), `${name}: dash`);
  }
  assert.ok(!/!/.test(visible.replace(/<!doctype html>/i, "")), "exclamation mark in the page text");
  assert.ok(!/[a-z]!\s*["'`)]/.test(page), "exclamation mark in a message");
});
