/*
  Purchase order and supplier invoice checker: the rules.
  Plain rules only. No AI calls, no network, no storage.
  All money is held as whole cents so sums are exact.
  Loads as a browser script (window.InvoiceChecker) and as a Node module (for the tests).
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.InvoiceChecker = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var GST_PERCENT = 15;      // New Zealand GST
  var GST_ROUNDING_CENTS = 1; // a supplier may round GST up or down by one cent
  // Inland Revenue's taxable supply information rules (from 1 April 2023): what a tax invoice must show.
  var TSI_GST_NUMBER_OVER_CENTS = 20000;   // over $200: the supplier's GST number
  var TSI_BUYER_OVER_CENTS = 100000;       // over $1,000: the buyer's name and one identifier

  // GST numbers use the IRD number check digit (Inland Revenue's 2026 to 2027 specification).
  function gstNumberIsValid(raw) {
    var n = String(raw).replace(/[\s-]/g, "");
    if (!/^\d{8,9}$/.test(n)) return false;
    var value = parseInt(n, 10);
    if (value < 10000000 || value > 200000000) return false;
    var body = n.slice(0, -1);
    while (body.length < 8) body = "0" + body;
    function digit(w) { var s = 0; for (var i = 0; i < 8; i++) s += w[i] * Number(body[i]); return ((-s % 11) + 11) % 11; }
    var c = digit([3, 2, 7, 6, 5, 4, 3, 2]);
    if (c === 10) c = digit([7, 4, 3, 2, 5, 2, 7, 6]);
    return c !== 10 && String(c) === n[n.length - 1];
  }

  // Say what a GST number check found. Only the check digit is tested. Whether the number is
  // registered is a question for Inland Revenue, and this does not ask them.
  function describeGstNumber(raw) {
    var n = String(raw == null ? "" : raw).replace(/[\s-]/g, "");
    if (!n) return { state: "empty", text: "Type or paste a GST number to check it." };
    if (!/^\d{8,9}$/.test(n)) return { state: "short", text: "A GST number has 8 or 9 digits. Spaces and dashes are fine." };
    if (gstNumberIsValid(n)) return { state: "valid", text: "Passes the IRD check digit. This does not confirm the number is registered." };
    return { state: "invalid", text: "Fails the IRD check digit, so it may be mistyped. Check it against the supplier's invoice." };
  }

  // ---------- duplicates ----------
  var DUPLICATE_DAYS = 5;
  var SUPPLIER_ENDINGS = /\s(ltd|limited|co|company|inc|incorporated|corp|corporation|nz|llc)$/;

  // "Example Fittings Ltd." and "EXAMPLE FITTINGS LIMITED" are the same supplier.
  function normaliseSupplier(name) {
    var t = String(name == null ? "" : name).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    var before;
    do { before = t; t = t.replace(SUPPLIER_ENDINGS, "").trim(); } while (t !== before);
    return t;
  }

  var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  // "3 November 2026", "3 Nov 2026", "2026-11-03" or "03/11/2026" (day first) -> a day number. NaN if unreadable.
  function parseDate(text) {
    var t = String(text == null ? "" : text).trim().toLowerCase();
    var d, m, y, hit;
    if ((hit = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
    else if ((hit = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/))) { d = +hit[1]; m = +hit[2]; y = +hit[3]; }
    else if ((hit = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/))) {
      d = +hit[1]; y = +hit[3];
      var idx = -1;
      MONTHS.forEach(function (name, i) { if (hit[2].length >= 3 && name.indexOf(hit[2]) === 0) idx = i; });
      m = idx + 1;
    } else return NaN;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return NaN;
    var ms = Date.UTC(y, m - 1, d);
    var back = new Date(ms);
    if (back.getUTCDate() !== d) return NaN;
    return Math.round(ms / 86400000);
  }

  function invoiceKey(number) {
    return String(number == null ? "" : number).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /*
    findDuplicates(bills) -> { billId: [{ otherId, kind, number, issued, totalCents }] }
    bills: [{ id, supplier, number, issued, totalCents }]
    A bill is a possible duplicate of another when the supplier is the same (loosely) and either
    the invoice number is the same, or the total is the same and the dates are within 5 days.
  */
  function findDuplicates(bills) {
    var out = {};
    function note(a, b, kind) {
      (out[a.id] = out[a.id] || []).push({ otherId: b.id, kind: kind, number: b.number, issued: b.issued, totalCents: b.totalCents });
    }
    for (var i = 0; i < bills.length; i++) {
      for (var j = i + 1; j < bills.length; j++) {
        var a = bills[i], b = bills[j];
        var sa = normaliseSupplier(a.supplier);
        if (!sa || sa !== normaliseSupplier(b.supplier)) continue;
        var ka = invoiceKey(a.number), kb = invoiceKey(b.number);
        var kind = null;
        if (ka && ka === kb) kind = "number";
        else if (Number.isFinite(a.totalCents) && a.totalCents > 0 && a.totalCents === b.totalCents) {
          var da = parseDate(a.issued), db = parseDate(b.issued);
          if (Number.isFinite(da) && Number.isFinite(db) && Math.abs(da - db) <= DUPLICATE_DAYS) kind = "total";
        }
        if (kind) { note(a, b, kind); note(b, a, kind); }
      }
    }
    return out;
  }

  // "1,234.50" or 1234.5 -> 123450. Returns NaN when the text is not a plain amount.
  function toCents(value) {
    if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : NaN;
    var text = String(value == null ? "" : value).replace(/[$,\s]/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(text)) return NaN;
    return Math.round(parseFloat(text) * 100);
  }

  // "12" or "2.5" -> number. NaN when it is not a plain quantity.
  function toQuantity(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    var text = String(value == null ? "" : value).replace(/[,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(text)) return NaN;
    return parseFloat(text);
  }

  // 123450 -> "$1,234.50". -500 -> "-$5.00".
  function formatMoney(cents) {
    if (!Number.isFinite(cents)) return "not a number";
    var negative = cents < 0;
    var whole = Math.abs(Math.round(cents));
    var dollars = String(Math.floor(whole / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var rest = String(whole % 100).padStart(2, "0");
    return (negative ? "-$" : "$") + dollars + "." + rest;
  }

  function formatQuantity(qty) {
    if (!Number.isFinite(qty)) return "not a number";
    return String(Math.round(qty * 1000) / 1000);
  }

  function lineTotalCents(line) {
    return Math.round(line.qty * line.unitCents);
  }

  function key(code) {
    return String(code == null ? "" : code).trim().toUpperCase();
  }

  function sameText(a, b) {
    var tidy = function (t) { return String(t == null ? "" : t).replace(/\s+/g, " ").trim().toUpperCase(); };
    return tidy(a) === tidy(b);
  }

  function validLine(line) {
    return Number.isFinite(line.qty) && line.qty >= 0 && Number.isFinite(line.unitCents) && line.unitCents >= 0;
  }

  // Group lines by item code, keeping the order they first appear in.
  function groupByCode(lines) {
    var order = [];
    var groups = {};
    lines.forEach(function (line) {
      var k = key(line.code);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(line);
    });
    return { order: order, groups: groups };
  }

  function sumQty(lines) {
    return lines.reduce(function (total, line) { return total + line.qty; }, 0);
  }

  /*
    check(order, invoice, options) -> result

    order:   { number, supplier, lines: [{ code, description, qty, unitCents }] }
    invoice: { number, supplier, orderNumber, lines: [...], subtotalCents, gstCents, totalCents }
    options: { priceTolerancePercent, priceToleranceCents, duplicates }
      A price difference inside either allowance is a note, not a hold. The percent allowance includes
      the edge; the cents allowance is for differences smaller than it ("under 5 cents").
      duplicates: possible duplicates of this bill, from findDuplicates.

    Each finding has a severity:
      "check" = a person must check this before the invoice is paid
      "note"  = worth knowing, does not hold payment
  */
  function check(order, invoice, options) {
    var tolerancePercent = options && Number.isFinite(options.priceTolerancePercent) && options.priceTolerancePercent > 0
      ? options.priceTolerancePercent : 0;
    var toleranceCents = options && Number.isFinite(options.priceToleranceCents) && options.priceToleranceCents > 0
      ? options.priceToleranceCents : 0;
    var findings = [];
    var lineStatus = {}; // item code -> "check" | "note" | "ok"

    function mark(code, severity) {
      var k = key(code);
      if (lineStatus[k] === "check") return;
      if (severity === "check" || !lineStatus[k] || lineStatus[k] === "ok") lineStatus[k] = severity;
    }
    // q is what to say to the supplier: { item, expected, invoiced }. Left out when the supplier cannot fix it.
    function add(rule, severity, code, title, detail, amountCents, q) {
      findings.push({ rule: rule, severity: severity, code: code, title: title, detail: detail, amountCents: amountCents || 0, query: q || null });
      if (code) mark(code, severity);
    }

    // 1. Does the invoice belong to this order?
    if (!sameText(invoice.orderNumber, order.number)) {
      add("order-number", "check", null,
        "The invoice quotes a different order number",
        "The invoice quotes order " + (String(invoice.orderNumber || "").trim() || "(none)") + ". This order is " + order.number +
        ". Confirm the invoice belongs to this order before anything is paid.", 0,
        { item: "Order number", expected: String(order.number), invoiced: String(invoice.orderNumber || "").trim() || "none" });
    }
    if (!sameText(invoice.supplier, order.supplier)) {
      add("supplier", "check", null,
        "The supplier name is different",
        "The order was placed with " + order.supplier + ". The invoice is from " + invoice.supplier + ". Confirm who should be paid.", 0,
        { item: "Supplier name", expected: order.supplier, invoiced: invoice.supplier });
    }

    // 2. Lines that cannot be read.
    var orderLines = order.lines.filter(function (line) {
      if (validLine(line)) return true;
      add("invalid-number", "check", line.code, line.code + ": a number on the order cannot be read",
        "The quantity or price for " + line.code + " on the order is not a plain number, so this line was not checked.");
      return false;
    });
    var invoiceLines = invoice.lines.filter(function (line) {
      if (validLine(line)) return true;
      add("invalid-number", "check", line.code, line.code + ": a number on the invoice cannot be read",
        "The quantity or price for " + line.code + " on the invoice is not a plain number, so this line was not checked.", 0,
        { item: line.code, expected: "a quantity and price as plain numbers", invoiced: "a number that cannot be read" });
      return false;
    });
    var unreadable = {};
    order.lines.concat(invoice.lines).forEach(function (line) { if (!validLine(line)) unreadable[key(line.code)] = true; });

    var ordered = groupByCode(orderLines);
    var invoiced = groupByCode(invoiceLines);

    // 3. Compare each invoiced item with the order.
    invoiced.order.forEach(function (k) {
      var invLines = invoiced.groups[k];
      var ordLines = ordered.groups[k];
      var code = invLines[0].code;
      var name = sameText(code, invLines[0].description) ? code : code + " (" + invLines[0].description + ")";

      if (invLines.length > 1) {
        add("duplicate-line", "check", code, code + " is on the invoice " + invLines.length + " times",
          name + " appears on " + invLines.length + " invoice lines. It may have been billed twice. The quantities are added together for the quantity check.", 0,
          { item: code, expected: "1 line", invoiced: invLines.length + " lines" });
      }

      if (!ordLines) {
        if (unreadable[k]) return; // already reported as unreadable on the order
        var extraCents = invLines.reduce(function (t, line) { return t + lineTotalCents(line); }, 0);
        add("extra-line", "check", code, code + " was not on the order",
          name + " is on the invoice for " + formatMoney(extraCents) + " but is not on the order. Someone needs to approve it, or ask the supplier for a credit.",
          extraCents, { item: code, expected: "not on the order", invoiced: formatQuantity(sumQty(invLines)) + " at " + formatMoney(invLines[0].unitCents) });
        return;
      }

      var orderPrice = ordLines[0].unitCents;
      var orderedQty = sumQty(ordLines);
      var invoicedQty = sumQty(invLines);

      // Quantity
      if (invoicedQty > orderedQty) {
        var overQty = invoicedQty - orderedQty;
        var overCents = Math.round(overQty * orderPrice);
        add("quantity-over", "check", code, code + ": more invoiced than ordered",
          "The invoice charges for " + formatQuantity(invoicedQty) + ". The order was for " + formatQuantity(orderedQty) +
          ". The extra " + formatQuantity(overQty) + " come to " + formatMoney(overCents) + " at the order price.",
          overCents, { item: code, expected: formatQuantity(orderedQty), invoiced: formatQuantity(invoicedQty) });
      } else if (invoicedQty < orderedQty) {
        add("quantity-short", "note", code, code + ": fewer invoiced than ordered",
          "The invoice charges for " + formatQuantity(invoicedQty) + " of the " + formatQuantity(orderedQty) +
          " ordered. The other " + formatQuantity(orderedQty - invoicedQty) + " may come on a later invoice.");
      }

      // Price, one check per invoice line so a repeated line with a different price is still caught.
      var allowanceCents = orderPrice * tolerancePercent / 100;
      invLines.forEach(function (line) {
        var diff = line.unitCents - orderPrice;
        if (diff === 0) return;
        var effect = Math.round(diff * line.qty);
        var insidePercent = Math.abs(diff) <= allowanceCents;
        if (insidePercent || Math.abs(diff) < toleranceCents) {
          add("price-within-allowance", "note", code, code + ": small price difference, inside the allowance",
            "The invoice price is " + formatMoney(line.unitCents) + " and the order price is " + formatMoney(orderPrice) +
            ". The difference is inside the " + (insidePercent ? tolerancePercent + "%" : toleranceCents + " cent") + " allowance.", effect);
        } else if (diff > 0) {
          add("price-higher", "check", code, code + ": invoice price is higher than the order price",
            "The invoice price is " + formatMoney(line.unitCents) + " each. The order price is " + formatMoney(orderPrice) +
            ". That is " + formatMoney(diff) + " more each, or " + formatMoney(effect) + " over " + formatQuantity(line.qty) + " units.",
            effect, { item: code, expected: formatMoney(orderPrice) + " each", invoiced: formatMoney(line.unitCents) + " each" });
        } else {
          add("price-lower", "note", code, code + ": invoice price is lower than the order price",
            "The invoice price is " + formatMoney(line.unitCents) + " each. The order price is " + formatMoney(orderPrice) +
            ". That is " + formatMoney(-effect) + " less in total. Confirm it is the same item and pack size.",
            effect);
        }
      });

      if (!lineStatus[k]) lineStatus[k] = "ok";
    });

    // 4. Ordered items that are not on the invoice at all.
    ordered.order.forEach(function (k) {
      if (invoiced.groups[k] || unreadable[k]) return;
      var line = ordered.groups[k][0];
      add("missing-line", "note", line.code, line.code + " is on the order but not on the invoice",
        formatQuantity(sumQty(ordered.groups[k])) + " of " + line.code + (sameText(line.code, line.description) ? "" : " (" + line.description + ")") +
        " were ordered. None are on this invoice. They may be on back order or on a later invoice.");
    });

    // 5. Totals. Each rule compares neighbouring figures, so one mistake raises one flag.
    var linesCents = invoiceLines.reduce(function (t, line) { return t + lineTotalCents(line); }, 0);
    var subtotal = invoice.subtotalCents, gst = invoice.gstCents, total = invoice.totalCents;
    var expectedGst = Number.isFinite(subtotal) ? Math.round(subtotal * GST_PERCENT / 100) : NaN;

    if (!Number.isFinite(subtotal) || !Number.isFinite(gst) || !Number.isFinite(total)) {
      add("invalid-number", "check", null, "A total on the invoice cannot be read",
        "The subtotal, GST or total on the invoice is not a plain amount, so the totals were not checked.");
    } else {
      // If a line could not be read, the lines cannot be added up, so the subtotal is left alone.
      if (invoiceLines.length === invoice.lines.length && subtotal !== linesCents) {
        add("subtotal", "check", null, "The subtotal does not match the lines",
          "The invoice lines add up to " + formatMoney(linesCents) + ". The invoice gives a subtotal of " + formatMoney(subtotal) +
          ", a difference of " + formatMoney(Math.abs(subtotal - linesCents)) + ".", subtotal - linesCents,
          { item: "Subtotal", expected: formatMoney(linesCents) + " (the lines added up)", invoiced: formatMoney(subtotal) });
      }
      if (Math.abs(gst - expectedGst) > GST_ROUNDING_CENTS) {
        add("gst", "check", null, gst === 0 ? "No GST is charged" : "The GST amount is not 15% of the subtotal",
          gst === 0
            ? "The invoice shows no GST. GST at 15% of the " + formatMoney(subtotal) + " subtotal would be " + formatMoney(expectedGst) + ". Confirm whether this supplier charges GST."
            : "GST at 15% of the " + formatMoney(subtotal) + " subtotal is " + formatMoney(expectedGst) + ". The invoice shows " + formatMoney(gst) +
              ", a difference of " + formatMoney(Math.abs(gst - expectedGst)) + ".",
          gst - expectedGst, { item: "GST", expected: formatMoney(expectedGst) + " (15% of the subtotal)", invoiced: formatMoney(gst) });
      }
      if (total !== subtotal + gst) {
        add("total", "check", null, "The total does not add up",
          "The subtotal plus GST is " + formatMoney(subtotal + gst) + ". The invoice total is " + formatMoney(total) +
          ", a difference of " + formatMoney(Math.abs(total - subtotal - gst)) + ".", total - subtotal - gst,
          { item: "Total", expected: formatMoney(subtotal + gst) + " (subtotal plus GST)", invoiced: formatMoney(total) });
      }
    }

    // 6. Tax invoice details (Inland Revenue's taxable supply information). Checked when the invoice
    //    record carries these fields. Without them the GST on the invoice cannot be claimed back.
    if ("gstNumber" in invoice && Number.isFinite(total)) {
      var gstNo = String(invoice.gstNumber || "").trim();
      if (total > TSI_GST_NUMBER_OVER_CENTS && !gstNo) {
        add("tax-gst-number", "check", null, "No GST number on the invoice",
          "Over $200, a tax invoice must show the supplier's GST number. Without it, the GST on this invoice cannot be claimed back. Ask the supplier for a corrected invoice.", 0,
          { item: "GST number", expected: "the supplier's GST number", invoiced: "none shown" });
      } else if (gstNo && !gstNumberIsValid(gstNo)) {
        add("tax-gst-number", "check", null, "The GST number is not valid",
          "GST numbers use the same check digit as IRD numbers, and " + gstNo + " fails it. It may be mistyped. Confirm it with the supplier before claiming the GST.", 0,
          { item: "GST number", expected: "a number that passes the IRD check digit", invoiced: gstNo });
      }
      if (!String(invoice.issued || "").trim()) {
        add("tax-date", "check", null, "No invoice date", "A tax invoice must show the date it was issued.", 0,
          { item: "Invoice date", expected: "the date it was issued", invoiced: "none shown" });
      }
      var buyer = invoice.buyer || {};
      if (total > TSI_BUYER_OVER_CENTS && !(options && options.buyerNotGstRegistered) &&
          (!String(buyer.name || "").trim() || !String(buyer.identifier || "").trim())) {
        add("tax-buyer", "check", null, "Your details are missing",
          "Over $1,000, a tax invoice to a GST-registered business must show the buyer's name and one identifier, such as an address, phone number, NZBN or GST number.", 0,
          { item: "Our details", expected: "our business name and one identifier", invoiced: "missing" });
      }
    }

    // 7. A possible duplicate of another bill in the same session.
    ((options && options.duplicates) || []).forEach(function (d) {
      var which = d.kind === "number"
        ? "has the same invoice number (" + d.number + ")"
        : "has the same total (" + formatMoney(d.totalCents) + ") and was issued within " + DUPLICATE_DAYS + " days (" + d.number + ", " + (d.issued || "no date") + ")";
      add("duplicate-invoice", "check", null, "Possible duplicate of " + d.number,
        "Another bill from this supplier " + which + ". It may have been sent twice. Check that it has not already been paid before paying this one.", 0,
        { item: "Possible duplicate", expected: "this invoice sent once", invoiced: "also sent as " + d.number + (d.kind === "number" ? " (same invoice number)" : " (same total, dated " + (d.issued || "no date") + ")") });
    });

    // Checks first, then notes. Within each, the order they were found in.
    var sorted = findings.filter(function (f) { return f.severity === "check"; })
      .concat(findings.filter(function (f) { return f.severity === "note"; }));
    var checkCount = sorted.filter(function (f) { return f.severity === "check"; }).length;
    var noteCount = sorted.length - checkCount;
    var queryCents = sorted.reduce(function (t, f) {
      return (f.rule === "price-higher" || f.rule === "quantity-over" || f.rule === "extra-line") ? t + f.amountCents : t;
    }, 0);

    return {
      verdict: checkCount ? "check" : (noteCount ? "notes" : "match"),
      findings: sorted,
      checkCount: checkCount,
      noteCount: noteCount,
      queryCents: queryCents,           // line differences to raise with the supplier, before GST
      linesCents: linesCents,           // what the invoice lines add up to
      expectedGstCents: expectedGst,    // 15% of the stated subtotal
      lineStatus: lineStatus
    };
  }

  /*
    supplierQuery(order, invoice, result) -> a short plain-text message for the supplier.
    It lists each thing a person must check, as: line, expected, invoiced. Notes are left out.
    Returns "" when there is nothing to raise.
  */
  function supplierQuery(order, invoice, result) {
    var items = result.findings.filter(function (f) { return f.severity === "check" && f.query; });
    if (!items.length) return "";
    var number = String(invoice.number || "").trim();
    var date = String(invoice.issued || "").trim();
    var buyer = invoice.buyer && String(invoice.buyer.name || "").trim();
    var out = ["Hello,", ""];
    out.push("I have checked " + (number ? "invoice " + number : "your invoice") + (date ? " (dated " + date + ")" : "") +
      " against our purchase order " + order.number + ", and some things do not match. Could you please look at these and send a corrected invoice or a credit note where it applies?");
    out.push("");
    items.forEach(function (f) { out.push("- " + f.query.item + ": expected " + f.query.expected + ", invoiced " + f.query.invoiced); });
    out.push("");
    out.push(buyer ? "Thank you," : "Thank you.");
    if (buyer) out.push(buyer);
    return out.join("\n");
  }

  return {
    GST_PERCENT: GST_PERCENT,
    DUPLICATE_DAYS: DUPLICATE_DAYS,
    normaliseSupplier: normaliseSupplier,
    parseDate: parseDate,
    findDuplicates: findDuplicates,
    describeGstNumber: describeGstNumber,
    supplierQuery: supplierQuery,
    toCents: toCents,
    toQuantity: toQuantity,
    formatMoney: formatMoney,
    formatQuantity: formatQuantity,
    lineTotalCents: lineTotalCents,
    gstNumberIsValid: gstNumberIsValid,
    check: check
  };
});
