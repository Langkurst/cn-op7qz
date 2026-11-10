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
    options: { priceTolerancePercent } a price difference inside this allowance is a note, not a hold

    Each finding has a severity:
      "check" = a person must check this before the invoice is paid
      "note"  = worth knowing, does not hold payment
  */
  function check(order, invoice, options) {
    var tolerancePercent = options && Number.isFinite(options.priceTolerancePercent) && options.priceTolerancePercent > 0
      ? options.priceTolerancePercent : 0;
    var findings = [];
    var lineStatus = {}; // item code -> "check" | "note" | "ok"

    function mark(code, severity) {
      var k = key(code);
      if (lineStatus[k] === "check") return;
      if (severity === "check" || !lineStatus[k] || lineStatus[k] === "ok") lineStatus[k] = severity;
    }
    function add(rule, severity, code, title, detail, amountCents) {
      findings.push({ rule: rule, severity: severity, code: code, title: title, detail: detail, amountCents: amountCents || 0 });
      if (code) mark(code, severity);
    }

    // 1. Does the invoice belong to this order?
    if (!sameText(invoice.orderNumber, order.number)) {
      add("order-number", "check", null,
        "The invoice quotes a different order number",
        "The invoice quotes order " + (String(invoice.orderNumber || "").trim() || "(none)") + ". This order is " + order.number +
        ". Confirm the invoice belongs to this order before anything is paid.");
    }
    if (!sameText(invoice.supplier, order.supplier)) {
      add("supplier", "check", null,
        "The supplier name is different",
        "The order was placed with " + order.supplier + ". The invoice is from " + invoice.supplier + ". Confirm who should be paid.");
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
        "The quantity or price for " + line.code + " on the invoice is not a plain number, so this line was not checked.");
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
      var name = code + " (" + invLines[0].description + ")";

      if (invLines.length > 1) {
        add("duplicate-line", "check", code, code + " is on the invoice " + invLines.length + " times",
          name + " appears on " + invLines.length + " invoice lines. It may have been billed twice. The quantities are added together for the quantity check.");
      }

      if (!ordLines) {
        if (unreadable[k]) return; // already reported as unreadable on the order
        var extraCents = invLines.reduce(function (t, line) { return t + lineTotalCents(line); }, 0);
        add("extra-line", "check", code, code + " was not on the order",
          name + " is on the invoice for " + formatMoney(extraCents) + " but is not on the order. Someone needs to approve it, or ask the supplier for a credit.",
          extraCents);
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
          overCents);
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
        if (Math.abs(diff) <= allowanceCents) {
          add("price-within-allowance", "note", code, code + ": small price difference, inside the allowance",
            "The invoice price is " + formatMoney(line.unitCents) + " and the order price is " + formatMoney(orderPrice) +
            ". The difference is inside the " + tolerancePercent + "% allowance.", effect);
        } else if (diff > 0) {
          add("price-higher", "check", code, code + ": invoice price is higher than the order price",
            "The invoice price is " + formatMoney(line.unitCents) + " each. The order price is " + formatMoney(orderPrice) +
            ". That is " + formatMoney(diff) + " more each, or " + formatMoney(effect) + " over " + formatQuantity(line.qty) + " units.",
            effect);
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
        formatQuantity(sumQty(ordered.groups[k])) + " of " + line.code + " (" + line.description +
        ") were ordered. None are on this invoice. They may be on back order or on a later invoice.");
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
          ", a difference of " + formatMoney(Math.abs(subtotal - linesCents)) + ".", subtotal - linesCents);
      }
      if (Math.abs(gst - expectedGst) > GST_ROUNDING_CENTS) {
        add("gst", "check", null, gst === 0 ? "No GST is charged" : "The GST amount is not 15% of the subtotal",
          gst === 0
            ? "The invoice shows no GST. GST at 15% of the " + formatMoney(subtotal) + " subtotal would be " + formatMoney(expectedGst) + ". Confirm whether this supplier charges GST."
            : "GST at 15% of the " + formatMoney(subtotal) + " subtotal is " + formatMoney(expectedGst) + ". The invoice shows " + formatMoney(gst) +
              ", a difference of " + formatMoney(Math.abs(gst - expectedGst)) + ".",
          gst - expectedGst);
      }
      if (total !== subtotal + gst) {
        add("total", "check", null, "The total does not add up",
          "The subtotal plus GST is " + formatMoney(subtotal + gst) + ". The invoice total is " + formatMoney(total) +
          ", a difference of " + formatMoney(Math.abs(total - subtotal - gst)) + ".", total - subtotal - gst);
      }
    }

    // 6. Tax invoice details (Inland Revenue's taxable supply information). Checked when the invoice
    //    record carries these fields. Without them the GST on the invoice cannot be claimed back.
    if ("gstNumber" in invoice && Number.isFinite(total)) {
      var gstNo = String(invoice.gstNumber || "").trim();
      if (total > TSI_GST_NUMBER_OVER_CENTS && !gstNo) {
        add("tax-gst-number", "check", null, "No GST number on the invoice",
          "Over $200, a tax invoice must show the supplier's GST number. Without it, the GST on this invoice cannot be claimed back. Ask the supplier for a corrected invoice.");
      } else if (gstNo && !gstNumberIsValid(gstNo)) {
        add("tax-gst-number", "check", null, "The GST number is not valid",
          "GST numbers use the same check digit as IRD numbers, and " + gstNo + " fails it. It may be mistyped. Confirm it with the supplier before claiming the GST.");
      }
      if (!String(invoice.issued || "").trim()) {
        add("tax-date", "check", null, "No invoice date", "A tax invoice must show the date it was issued.");
      }
      var buyer = invoice.buyer || {};
      if (total > TSI_BUYER_OVER_CENTS && !(options && options.buyerNotGstRegistered) &&
          (!String(buyer.name || "").trim() || !String(buyer.identifier || "").trim())) {
        add("tax-buyer", "check", null, "Your details are missing",
          "Over $1,000, a tax invoice to a GST-registered business must show the buyer's name and one identifier, such as an address, phone number, NZBN or GST number.");
      }
    }

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

  return {
    GST_PERCENT: GST_PERCENT,
    toCents: toCents,
    toQuantity: toQuantity,
    formatMoney: formatMoney,
    formatQuantity: formatQuantity,
    lineTotalCents: lineTotalCents,
    gstNumberIsValid: gstNumberIsValid,
    check: check
  };
});
