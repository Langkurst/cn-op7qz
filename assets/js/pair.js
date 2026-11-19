/*
  Puts two read documents together for the check: which one is the order (what was agreed) and
  which is the bill (what is being charged), and lines up their lines.

  - A purchase order against an invoice, an order confirmation or a delivery note. An order
    confirmation against an invoice (the confirmation is what was agreed). Two documents of the
    same kind: the one the other quotes is the order; otherwise the one dropped onto is the order.
  - Lines are matched by item code first. When the supplier uses its own codes, by description:
    "Drawer runner 500mm pair" matches "Drawer runner, 500 mm, pair". Each match made that way is
    said, so a person can see it.
  - Different currencies: with a rate, the order's prices are converted into the bill's currency
    and compared. Without one, prices are not compared and the check says so.

  The result is the order and invoice that matcher.js checks, the options for that country, and the
  notes to show beside the result. Pure functions. Loads in the browser (window.DocPair) and in Node.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DocPair = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TAX_NAME = { NZ: "GST", AU: "GST", SG: "GST", CA: "GST", IN: "GST" };
  var RANK = { order: 3, confirmation: 2, invoice: 1, delivery: 1, unknown: 0 };

  function fold(s) {
    var t = String(s == null ? "" : s).toLowerCase();
    return t.normalize ? t.normalize("NFD").replace(/[̀-ͯ]/g, "") : t;
  }
  function codeKey(code) { return String(code == null ? "" : code).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  // A photo can read O as 0, S as 5, I or L as 1, B as 8 and Z as 2. Codes that differ only by those match.
  function looseKey(code) { return codeKey(code).replace(/O/g, "0").replace(/[IL]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2"); }
  function numberKey(n) { return String(n == null ? "" : n).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, ""); }

  // Words of a description, with "500 mm" and "500mm" the same, and small words left out.
  var STOP = { the: 1, and: 1, of: 1, for: 1, with: 1, a: 1, an: 1, x: 1, de: 1, der: 1, die: 1, das: 1, und: 1, mit: 1, le: 1, la: 1, les: 1, et: 1, pour: 1, el: 1, los: 1, y: 1, con: 1, para: 1 };
  function words(text) {
    var t = fold(text).replace(/(\d)[\s]+(mm|cm|m|kg|g|l|ml|lt|ltr|litres?|liters?|pcs?|pk|pack|ea)\b/g, "$1$2").replace(/[^a-z0-9.]+/g, " ");
    return t.split(" ").filter(function (w) { return w && !STOP[w] && w !== "."; });
  }
  // How alike two descriptions are, 0 to 1 (Dice's coefficient on their words).
  function likeness(a, b) {
    var A = words(a), B = words(b);
    if (!A.length || !B.length) return 0;
    var used = {}, same = 0;
    A.forEach(function (w) {
      for (var i = 0; i < B.length; i++) {
        if (used[i]) continue;
        if (B[i] === w || (w.length > 4 && B[i].length > 4 && (B[i].indexOf(w) === 0 || w.indexOf(B[i]) === 0))) { used[i] = true; same++; break; }
      }
    });
    return (2 * same) / (A.length + B.length);
  }

  function roles(a, b) {
    var an = numberKey(a.doc.number), bn = numberKey(b.doc.number);
    var aRef = numberKey(a.doc.orderNumber), bRef = numberKey(b.doc.orderNumber);
    if (RANK[a.doc.kind] !== RANK[b.doc.kind] && RANK[a.doc.kind] && RANK[b.doc.kind]) return RANK[a.doc.kind] > RANK[b.doc.kind] ? [a, b] : [b, a];
    if (an && bRef && an === bRef && an !== bn) return [a, b];
    if (bn && aRef && bn === aRef && an !== bn) return [b, a];
    if (RANK[a.doc.kind] !== RANK[b.doc.kind]) return RANK[a.doc.kind] > RANK[b.doc.kind] ? [a, b] : [b, a];
    // The same kind and no reference between them: the one dropped onto is the order.
    return a.target ? [a, b] : b.target ? [b, a] : [a, b];
  }

  function moneyFormatter(currency) {
    if (!currency || currency === "NZD") return null; // the checker's own "$1,234.50"
    var nf;
    try { nf = new Intl.NumberFormat("en-NZ", { style: "currency", currency: currency }); } catch (e) { return null; }
    return function (cents) {
      if (!Number.isFinite(cents)) return "not a number";
      return nf.format(cents / 100);
    };
  }

  function dateWords(isoDate) {
    if (!isoDate) return "";
    var m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(isoDate);
    var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return +m[3] + " " + MONTHS[+m[2] - 1] + " " + m[1];
  }

  function sumLines(lines) {
    return lines.reduce(function (t, l) { return t + Math.round(l.qty * l.unitCents); }, 0);
  }

  /*
    pair(first, second, opts) -> { order, invoice, options, notes, warnings, roles, currency }
    first, second: { doc (from DocReader.read), name, target (true for the one dropped onto) }
    opts: { rate } (1 unit of the order's currency in the bill's currency), { tolerancePercent, toleranceCents }.
  */
  function pair(first, second, opts) {
    opts = opts || {};
    var r = roles(first, second);
    var O = r[0], B = r[1];
    var od = O.doc, bd = B.doc;
    var notes = [], warnings = [];

    var orderCurrency = od.currency || bd.currency || "NZD";
    var billCurrency = bd.currency || od.currency || "NZD";
    var rate = Number(opts.rate);
    var converted = false, pricesCompared = true;
    if (orderCurrency !== billCurrency) {
      if (rate > 0) {
        converted = true;
        notes.push({ title: "Prices converted", detail: "The order is in " + orderCurrency + " and the bill in " + billCurrency + ". Order prices were converted at 1 " + orderCurrency + " = " + rate + " " + billCurrency + (opts.rateSource ? " (" + opts.rateSource + ")" : "") + " before comparing." });
      } else {
        pricesCompared = false;
        warnings.push({ title: "Different currencies", detail: "The order is in " + orderCurrency + " and the bill in " + billCurrency + ". Prices are not compared until you enter the exchange rate. Quantities and lines are still checked." });
      }
    }

    // ----- line up the lines -----
    var oLines = od.lines.map(function (l, i) { return { src: l, i: i, key: codeKey(l.code), used: false }; });
    var bLines = bd.lines.map(function (l, i) { return { src: l, i: i, key: codeKey(l.code), match: null, how: null }; });
    // 1. Same code.
    bLines.forEach(function (b) {
      if (!b.key) return;
      var hit = oLines.filter(function (o) { return !o.used && o.key === b.key; })[0] || oLines.filter(function (o) { return o.key === b.key; })[0];
      if (hit) { b.match = hit; b.how = "code"; hit.used = true; }
    });
    // 1b. The same code allowing for a photo's usual misreadings.
    bLines.forEach(function (b) {
      if (b.match || !b.key) return;
      var lk = looseKey(b.src.code);
      var hit = oLines.filter(function (o) { return !o.used && o.key && looseKey(o.src.code) === lk; })[0];
      if (hit) { b.match = hit; b.how = "code"; hit.used = true; }
    });
    // 2. Most alike description among the order lines not yet matched.
    bLines.forEach(function (b) {
      if (b.match || b.src.type) return;
      var best = null, bestScore = 0;
      oLines.forEach(function (o) {
        if (o.used) return;
        var s = likeness(b.src.description || b.src.code, o.src.description || o.src.code);
        // Same quantity or price is a tie-break between two near descriptions.
        if (o.src.qty === b.src.qty) s += 0.04;
        if (o.src.unitCents === b.src.unitCents) s += 0.04;
        if (s > bestScore) { bestScore = s; best = o; }
      });
      if (best && bestScore >= 0.55) {
        b.match = best; b.how = "description"; best.used = true;
        if (b.key && best.key && b.key !== best.key) {
          notes.push({ title: "Matched by description", detail: (b.src.code || "A line") + " on the " + (bd.kind === "invoice" ? "invoice" : bd.kind) + " was matched to " + (best.src.code || "a line") + " on the order by its description (“" + (b.src.description || "") + "”)." });
        }
      }
    });

    function label(l) { return l.code || l.description || "Line"; }
    var orderOut = oLines.map(function (o) {
      var code = o.src.code || o.src.description || ("Line " + (o.i + 1));
      var unit = o.src.unitCents;
      if (converted && Number.isFinite(unit)) unit = Math.round(unit * rate);
      var line = { code: code, description: o.src.description || "", qty: o.src.qty, unitCents: unit };
      if (o.src.type === "discount") line.discount = true;
      return line;
    });
    var billOut = bLines.map(function (b) {
      var code = b.match ? orderOut[b.match.i].code : (b.src.code || b.src.description || ("Line " + (b.i + 1)));
      var unit = b.src.unitCents;
      // A delivery note has no prices: only quantities are compared.
      if (!Number.isFinite(unit) && b.match) unit = orderOut[b.match.i].unitCents;
      if (!pricesCompared && b.match) orderOut[b.match.i].unitCents = unit;
      var line = { code: code, description: b.src.description || label(b.src), qty: b.src.qty, unitCents: unit };
      if (b.src.type === "discount") line.discount = true;
      return line;
    });
    // An order line with no price (some orders show none): take the bill's, so only quantities count.
    orderOut.forEach(function (o, i) {
      if (Number.isFinite(o.unitCents)) return;
      var b = bLines.filter(function (x) { return x.match && x.match.i === i; })[0];
      o.unitCents = b ? billOut[b.i].unitCents : 0;
      if (b) notes.push({ title: "No price on the order", detail: o.code + " has no price on the order, so only its quantity was checked." });
    });

    // ----- totals: a confirmation or delivery note often has none -----
    var country = bd.country || od.country || (billCurrency === "NZD" ? "NZ" : null);
    var taxPct = Number.isFinite(bd.taxPercent) ? bd.taxPercent : (country === "NZ" ? 15 : 0);
    var linesSum = sumLines(billOut);
    var sub = bd.subtotalCents, tax = bd.taxCents, total = bd.totalCents;
    var isTaxInvoice = bd.kind === "invoice";
    if (!Number.isFinite(sub) && !Number.isFinite(total)) {
      sub = linesSum; tax = Math.round(linesSum * taxPct / 100); total = sub + tax;
      if (bd.kind !== "delivery") notes.push({ title: "No totals shown", detail: "The " + (bd.kind === "unknown" ? "document" : bd.kind) + " shows no totals, so only its lines were checked." });
    } else {
      if (!Number.isFinite(sub) && Number.isFinite(total) && Number.isFinite(tax)) sub = total - tax;
      if (!Number.isFinite(tax) && Number.isFinite(total) && Number.isFinite(sub)) tax = total - sub;
      if (!Number.isFinite(sub)) sub = linesSum;
      if (!Number.isFinite(tax)) { tax = 0; taxPct = 0; }
      if (!Number.isFinite(total)) total = sub + tax;
    }

    var invoice = {
      number: bd.number || B.name || "No number",
      supplier: bd.supplier || od.supplier || "",
      orderNumber: bd.kind === "order" ? (bd.number || "") : (bd.orderNumber || ""),
      issued: dateWords(bd.issued),
      due: dateWords(bd.due),
      buyer: { name: bd.buyer || "", identifier: bd.buyerDetails || "" },
      lines: billOut,
      subtotalCents: sub, gstCents: tax, totalCents: total
    };
    var nz = country === "NZ" && isTaxInvoice;
    if (nz) invoice.gstNumber = bd.taxId && bd.taxId.type === "nz-gst" ? bd.taxId.value : "";
    if (!od.supplier && bd.supplier) notes.push({ title: "Supplier taken from the bill", detail: "The order doesn't name the supplier, so " + bd.supplier + " was used." });
    // A confirmation stands in for the order: the bill quotes the purchase order it confirms.
    var orderNo = od.number || od.orderNumber || O.name || "";
    if (od.kind === "confirmation" && od.orderNumber && numberKey(invoice.orderNumber) === numberKey(od.orderNumber)) orderNo = od.orderNumber;
    var order = {
      number: orderNo,
      supplier: od.supplier || bd.supplier || "",
      lines: orderOut
    };
    if (!od.number) warnings.push({ title: "No order number found", detail: "The order number couldn't be read from " + (O.name || "the order") + "." });

    var options = {
      taxPercent: taxPct,
      taxName: TAX_NAME[country] || (country ? "VAT" : "GST"),
      nzRules: nz,
      formatMoney: moneyFormatter(billCurrency),
      priceTolerancePercent: opts.tolerancePercent, priceToleranceCents: opts.toleranceCents
    };
    if (!nz) options.buyerNotGstRegistered = true;

    return {
      order: order, invoice: invoice, options: options, notes: notes, warnings: warnings,
      roles: { order: O, bill: B },
      currency: { order: orderCurrency, bill: billCurrency, converted: converted, compared: pricesCompared },
      matched: bLines.map(function (b) { return { bill: b.i, order: b.match ? b.match.i : null, how: b.how }; })
    };
  }

  return { pair: pair, likeness: likeness, codeKey: codeKey, moneyFormatter: moneyFormatter, dateWords: dateWords };
});
