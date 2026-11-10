// Tests for the invoice checker rules. Run from the project folder:  node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../assets/js/matcher.js");
const samples = require("../assets/js/samples.js");

// A small matching order and invoice. Each test changes one thing.
function pair() {
  const lines = () => [
    { code: "A-1", description: "Item A", qty: 10, unitCents: 1000 },
    { code: "B-2", description: "Item B", qty: 4, unitCents: 250 },
  ];
  return {
    order: { number: "4500000001", supplier: "Example Ltd", lines: lines() },
    invoice: {
      number: "INV-1", supplier: "Example Ltd", orderNumber: "4500000001", lines: lines(),
      subtotalCents: 11000, gstCents: 1650, totalCents: 12650,
    },
  };
}
// Set the invoice totals so they agree with its lines, leaving only the line change under test.
function retotal(invoice) {
  const sub = invoice.lines.reduce((t, l) => t + C.lineTotalCents(l), 0);
  invoice.subtotalCents = sub;
  invoice.gstCents = Math.round(sub * 0.15);
  invoice.totalCents = sub + invoice.gstCents;
  return invoice;
}
const rules = (result) => result.findings.map((f) => f.rule);
const find = (result, rule) => result.findings.find((f) => f.rule === rule);

test("money: text to cents", () => {
  assert.equal(C.toCents("1,234.50"), 123450);
  assert.equal(C.toCents("$12"), 1200);
  assert.equal(C.toCents("0.1") + C.toCents("0.2"), 30);
  assert.equal(C.toCents(19.99), 1999);
  assert.equal(C.toCents("19.99"), 1999); // 19.99 * 100 is 1998.9999999999998 before rounding
  assert.equal(C.toCents("0.29"), 29);
  assert.equal(C.toCents("4.35"), 435);
  assert.ok(Number.isNaN(C.toCents("12abc")));
  assert.ok(Number.isNaN(C.toCents("")));
});

test("money: cents to text", () => {
  assert.equal(C.formatMoney(123450), "$1,234.50");
  assert.equal(C.formatMoney(5), "$0.05");
  assert.equal(C.formatMoney(-2845), "-$28.45");
  assert.equal(C.formatMoney(100000000), "$1,000,000.00");
});

test("quantity: text to number", () => {
  assert.equal(C.toQuantity("1,200"), 1200);
  assert.equal(C.toQuantity("2.5"), 2.5);
  assert.ok(Number.isNaN(C.toQuantity("-3")));
  assert.ok(Number.isNaN(C.toQuantity("ten")));
});

test("a matching invoice has no findings", () => {
  const { order, invoice } = pair();
  const r = C.check(order, invoice);
  assert.equal(r.verdict, "match");
  assert.deepEqual(r.findings, []);
  assert.equal(r.lineStatus["A-1"], "ok");
  assert.equal(r.queryCents, 0);
});

test("a higher price must be checked, with the dollar effect", () => {
  const { order, invoice } = pair();
  invoice.lines[0].unitCents = 1040;
  const r = C.check(order, retotal(invoice));
  assert.deepEqual(rules(r), ["price-higher"]);
  const f = find(r, "price-higher");
  assert.equal(f.severity, "check");
  assert.equal(f.amountCents, 400);
  assert.match(f.detail, /\$0\.40 more each, or \$4\.00 over 10 units/);
  assert.equal(r.verdict, "check");
  assert.equal(r.lineStatus["A-1"], "check");
  assert.equal(r.lineStatus["B-2"], "ok");
});

test("a lower price is a note, not a hold", () => {
  const { order, invoice } = pair();
  invoice.lines[0].unitCents = 900;
  const r = C.check(order, retotal(invoice));
  assert.deepEqual(rules(r), ["price-lower"]);
  assert.equal(find(r, "price-lower").severity, "note");
  assert.equal(r.verdict, "notes");
  assert.equal(r.queryCents, 0);
});

test("price allowance: inside is a note, outside must be checked", () => {
  const { order, invoice } = pair();
  invoice.lines[0].unitCents = 1010; // 1% over
  retotal(invoice);
  assert.deepEqual(rules(C.check(order, invoice, { priceTolerancePercent: 1 })), ["price-within-allowance"]);
  assert.deepEqual(rules(C.check(order, invoice, { priceTolerancePercent: 0.5 })), ["price-higher"]);
  assert.deepEqual(rules(C.check(order, invoice)), ["price-higher"]);
});

test("more invoiced than ordered must be checked", () => {
  const { order, invoice } = pair();
  invoice.lines[1].qty = 6;
  const r = C.check(order, retotal(invoice));
  assert.deepEqual(rules(r), ["quantity-over"]);
  assert.equal(find(r, "quantity-over").amountCents, 500);
  assert.equal(r.queryCents, 500);
});

test("fewer invoiced than ordered is a note", () => {
  const { order, invoice } = pair();
  invoice.lines[1].qty = 1;
  const r = C.check(order, retotal(invoice));
  assert.deepEqual(rules(r), ["quantity-short"]);
  assert.equal(r.verdict, "notes");
  assert.equal(r.lineStatus["B-2"], "note");
});

test("an ordered item missing from the invoice is a note", () => {
  const { order, invoice } = pair();
  invoice.lines.pop();
  const r = C.check(order, retotal(invoice));
  assert.deepEqual(rules(r), ["missing-line"]);
  assert.equal(find(r, "missing-line").severity, "note");
});

test("an invoiced item that was never ordered must be checked", () => {
  const { order, invoice } = pair();
  invoice.lines.push({ code: "FRT", description: "Freight", qty: 1, unitCents: 8500 });
  const r = C.check(order, retotal(invoice));
  assert.deepEqual(rules(r), ["extra-line"]);
  assert.equal(find(r, "extra-line").amountCents, 8500);
  assert.equal(r.queryCents, 8500);
});

test("item codes match whatever the capitals and spaces", () => {
  const { order, invoice } = pair();
  invoice.lines[0].code = " a-1 ";
  assert.equal(C.check(order, invoice).verdict, "match");
});

test("the same item on two invoice lines is flagged and the quantities are added", () => {
  const { order, invoice } = pair();
  invoice.lines.push({ code: "A-1", description: "Item A", qty: 10, unitCents: 1000 });
  const r = C.check(order, retotal(invoice));
  assert.deepEqual(rules(r), ["duplicate-line", "quantity-over"]);
  assert.equal(find(r, "quantity-over").amountCents, 10000);
});

test("a split delivery on two lines that adds up to the order raises only the repeat flag", () => {
  const { order, invoice } = pair();
  invoice.lines[0].qty = 6;
  invoice.lines.push({ code: "A-1", description: "Item A", qty: 4, unitCents: 1000 });
  assert.deepEqual(rules(C.check(order, retotal(invoice))), ["duplicate-line"]);
});

test("GST that is not 15% of the subtotal must be checked", () => {
  const { order, invoice } = pair();
  invoice.gstCents = 1540; // 14%
  invoice.totalCents = 12540;
  const r = C.check(order, invoice);
  assert.deepEqual(rules(r), ["gst"]);
  assert.equal(find(r, "gst").amountCents, -110);
});

test("GST may be one cent out for rounding, but not two", () => {
  const { order, invoice } = pair();
  invoice.gstCents = 1651; invoice.totalCents = 12651;
  assert.equal(C.check(order, invoice).verdict, "match");
  invoice.gstCents = 1652; invoice.totalCents = 12652;
  assert.deepEqual(rules(C.check(order, invoice)), ["gst"]);
});

test("an invoice with no GST is flagged in its own words", () => {
  const { order, invoice } = pair();
  invoice.gstCents = 0; invoice.totalCents = 11000;
  const f = find(C.check(order, invoice), "gst");
  assert.equal(f.title, "No GST is charged");
});

test("one wrong subtotal raises one flag, not three", () => {
  const { order, invoice } = pair();
  invoice.subtotalCents = 11500;
  invoice.gstCents = 1725;   // 15% of the stated subtotal
  invoice.totalCents = 13225; // stated subtotal plus stated GST
  const r = C.check(order, invoice);
  assert.deepEqual(rules(r), ["subtotal"]);
  assert.equal(find(r, "subtotal").amountCents, 500);
});

test("a total that is not subtotal plus GST must be checked", () => {
  const { order, invoice } = pair();
  invoice.totalCents = 12660;
  const r = C.check(order, invoice);
  assert.deepEqual(rules(r), ["total"]);
  assert.equal(find(r, "total").amountCents, 10);
});

test("a different order number or supplier must be checked", () => {
  const { order, invoice } = pair();
  invoice.orderNumber = "4500000010";
  invoice.supplier = "Another Ltd";
  assert.deepEqual(rules(C.check(order, invoice)), ["order-number", "supplier"]);
  invoice.orderNumber = " 4500000001 ";
  invoice.supplier = "example  ltd";
  assert.equal(C.check(order, invoice).verdict, "match");
});

test("a number that cannot be read is flagged and that line is skipped", () => {
  const { order, invoice } = pair();
  invoice.lines[0].qty = NaN; // the stated subtotal no longer equals the readable lines, and that must not raise a second flag
  const r = C.check(order, invoice);
  assert.deepEqual(rules(r), ["invalid-number"]);
  assert.equal(r.lineStatus["A-1"], "check");
  invoice.totalCents = NaN;
  assert.ok(rules(C.check(order, invoice)).includes("invalid-number"));
});

test("checks are listed before notes", () => {
  const { order, invoice } = pair();
  invoice.lines[0].qty = 5;            // note
  invoice.lines[1].unitCents = 300;    // check
  const r = C.check(order, retotal(invoice));
  assert.deepEqual(r.findings.map((f) => f.severity), ["check", "note"]);
  assert.equal(r.checkCount, 1);
  assert.equal(r.noteCount, 1);
});

test("checking does not change the order or the invoice", () => {
  const { order, invoice } = pair();
  invoice.lines[0].unitCents = 1100;
  const before = JSON.stringify({ order, invoice });
  C.check(order, invoice, { priceTolerancePercent: 2 });
  assert.equal(JSON.stringify({ order, invoice }), before);
});

test("every rule has the severity the page says it has", () => {
  const HOLD = ["order-number", "supplier", "invalid-number", "duplicate-line", "extra-line", "quantity-over", "price-higher", "subtotal", "gst", "total",
    "tax-gst-number", "tax-date", "tax-buyer"];
  const NOTE = ["quantity-short", "price-lower", "price-within-allowance", "missing-line"];
  const seen = {};
  const record = (r) => r.findings.forEach((f) => { (seen[f.rule] = seen[f.rule] || new Set()).add(f.severity); });
  for (const s of samples) record(C.check(s.order, s.invoice));
  // one more case that reaches the rules the samples do not
  const { order, invoice } = pair();
  invoice.supplier = "Another Ltd";
  invoice.lines[0].unitCents = 900;            // price-lower
  invoice.lines[1].unitCents = 251;            // inside a 1% allowance
  invoice.lines.push({ code: "X-9", description: "Item X", qty: NaN, unitCents: 100 }); // invalid-number
  invoice.subtotalCents += 1;                  // not flagged: a line is unreadable
  record(C.check(order, invoice, { priceTolerancePercent: 1 }));
  const two = pair(); two.invoice.subtotalCents = 11001; two.invoice.gstCents = 1650; two.invoice.totalCents = 12651;
  record(C.check(two.order, two.invoice));     // subtotal
  const three = JSON.parse(JSON.stringify(samples[0]));
  three.invoice.issued = ""; three.invoice.buyer = { name: "Example Kitchens Ltd", identifier: "" };
  record(C.check(three.order, three.invoice)); // tax-date, tax-buyer
  for (const rule of HOLD) assert.deepEqual([...(seen[rule] || [])], ["check"], rule);
  for (const rule of NOTE) assert.deepEqual([...(seen[rule] || [])], ["note"], rule);
  assert.deepEqual(Object.keys(seen).sort(), [...HOLD, ...NOTE].sort());
});

for (const sample of samples) {
  test(`sample "${sample.label}" flags what it says it flags`, () => {
    const r = C.check(sample.order, sample.invoice);
    assert.deepEqual(rules(r).sort(), [...sample.expect].sort());
    assert.equal(r.verdict, sample.expect.length ? "check" : "match");
  });
}

test("the figures quoted on the home page match the second sample", () => {
  const r = C.check(samples[1].order, samples[1].invoice);
  assert.equal(find(r, "price-higher").amountCents, 4000);
  assert.equal(find(r, "quantity-over").amountCents, 18500);
  assert.equal(r.queryCents, 22500);
});

test("tax invoice details: Inland Revenue's thresholds and the GST number check digit", () => {
  const base = () => JSON.parse(JSON.stringify(samples[0]));
  const rulesOf = (s, opt) => C.check(s.order, s.invoice, opt).findings.map((f) => f.rule).filter((r) => r.startsWith("tax-"));
  assert.deepEqual(rulesOf(base()), [], "the matching sample has everything a tax invoice needs");
  const noGst = base(); noGst.invoice.gstNumber = "";
  assert.deepEqual(rulesOf(noGst), ["tax-gst-number"]);
  const bad = base(); bad.invoice.gstNumber = "124-587-302";
  assert.deepEqual(rulesOf(bad), ["tax-gst-number"]);
  assert.match(C.check(bad.order, bad.invoice).findings[0].detail, /124-587-302 fails it/);
  const noBuyer = base(); delete noBuyer.invoice.buyer;
  assert.deepEqual(rulesOf(noBuyer), ["tax-buyer"]);
  assert.deepEqual(rulesOf(noBuyer, { buyerNotGstRegistered: true }), [], "not needed when the buyer is not GST registered");
  // A small invoice: $200 or less needs no GST number, $1,000 or less needs no buyer details.
  const small = { order: { number: "1", supplier: "A", lines: [{ code: "X", description: "x", qty: 1, unitCents: 17000 }] },
    invoice: { number: "2", supplier: "A", orderNumber: "1", gstNumber: "", issued: "1 Nov", lines: [{ code: "X", description: "x", qty: 1, unitCents: 17000 }],
      subtotalCents: 17000, gstCents: 2550, totalCents: 19550 } };
  assert.deepEqual(rulesOf(small), []);
  assert.ok(C.gstNumberIsValid("49-098-576") && !C.gstNumberIsValid("49-098-577"));
});

test("invoices without tax invoice fields are not held for them", () => {
  const { order, invoice } = pair();
  assert.deepEqual(C.check(order, invoice).findings.filter((f) => f.rule.startsWith("tax-")), []);
});
