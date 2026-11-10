/*
  Entering your own bill: turns the form into one purchase order and its invoice, and handles
  pasting rows from a spreadsheet into the line grid. Nothing here stores or sends anything.
  Loads as a browser script (window.InvoiceEntry) and as a Node module (for the tests).
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./matcher.js"));
  else root.InvoiceEntry = factory(root.InvoiceChecker);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  var COLUMNS = 5; // description, ordered quantity, order price, invoiced quantity, invoice price
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // "2026-11-03" (from a date box) -> "3 November 2026". Anything else is kept as typed.
  function formatDate(text) {
    var t = String(text == null ? "" : text).trim();
    var m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m || +m[2] < 1 || +m[2] > 12) return t;
    return +m[3] + " " + MONTH_NAMES[+m[2] - 1] + " " + m[1];
  }

  // Text copied from a spreadsheet: rows end with a new line, cells with a tab.
  function parsePaste(text) {
    var rows = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    while (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
    return rows.map(function (row) {
      return row.split("\t").map(function (cell) {
        var c = cell.trim();
        if (c.length > 1 && c[0] === '"' && c[c.length - 1] === '"') c = c.slice(1, -1).replace(/""/g, '"');
        return c;
      });
    });
  }

  // Put pasted rows into the grid, starting at one cell, going right and down. New rows are added.
  // Cells beyond the last column are dropped. The grid passed in is not changed.
  function fillGrid(grid, row, col, text, columns) {
    var cols = columns || COLUMNS;
    var out = grid.map(function (r) { return r.slice(); });
    parsePaste(text).forEach(function (cells, i) {
      while (out.length <= row + i) out.push(new Array(cols).fill(""));
      cells.forEach(function (cell, j) {
        if (col + j < cols) out[row + i][col + j] = cell;
      });
    });
    return out;
  }

  function blank(cell) { return String(cell == null ? "" : cell).trim() === ""; }

  /*
    buildBill(values) -> { ok: true, bill: { order, invoice } } or { ok: false, errors: [text] }
    values: { supplier, gstNumber, invoiceNumber, date, orderNumber, buyerName, buyerIdentifier, rows }
    Each row is [description, ordered qty, order price, invoiced qty, invoice price]. A row can have
    only the ordered pair (not invoiced) or only the invoiced pair (not ordered).
    Subtotal, GST and total are worked out from the invoice lines. They can be changed on the invoice.
  */
  function buildBill(v) {
    var errors = [];
    var supplier = String(v.supplier || "").trim();
    var invoiceNumber = String(v.invoiceNumber || "").trim();
    var orderNumber = String(v.orderNumber || "").trim();
    if (!supplier) errors.push("Enter the supplier's name.");
    if (!invoiceNumber) errors.push("Enter the invoice number.");
    if (!orderNumber) errors.push("Enter the purchase order number.");

    var orderLines = [], invoiceLines = [], used = 0;
    (v.rows || []).forEach(function (cells, i) {
      cells = cells || [];
      if (cells.every(blank)) return;
      used++;
      var label = "Line " + (i + 1);
      var description = String(cells[0] || "").trim();
      if (!description) { errors.push(label + ": enter a description."); return; }
      var pairs = [[cells[1], cells[2], "ordered", orderLines], [cells[3], cells[4], "invoiced", invoiceLines]];
      var any = false;
      pairs.forEach(function (p) {
        if (blank(p[0]) && blank(p[1])) return;
        any = true;
        var qty = C.toQuantity(p[0]), price = C.toCents(p[1]);
        if (Number.isNaN(qty) || Number.isNaN(price) || price < 0) {
          errors.push(label + " (" + description + "): the " + p[2] + " quantity and price must both be plain numbers.");
          return;
        }
        p[3].push({ code: description, description: description, qty: qty, unitCents: price });
      });
      if (!any) errors.push(label + " (" + description + "): enter a quantity and price.");
    });
    if (!used) errors.push("Add at least one line.");
    if (errors.length) return { ok: false, errors: errors };

    var subtotal = invoiceLines.reduce(function (t, l) { return t + C.lineTotalCents(l); }, 0);
    var gst = Math.round(subtotal * C.GST_PERCENT / 100);
    return {
      ok: true,
      bill: {
        order: { number: orderNumber, supplier: supplier, lines: orderLines },
        invoice: {
          number: invoiceNumber, supplier: supplier, orderNumber: orderNumber,
          gstNumber: String(v.gstNumber || "").trim(), issued: formatDate(v.date), due: "",
          buyer: { name: String(v.buyerName || "").trim(), identifier: String(v.buyerIdentifier || "").trim() },
          lines: invoiceLines, subtotalCents: subtotal, gstCents: gst, totalCents: subtotal + gst
        }
      }
    };
  }

  return { COLUMNS: COLUMNS, formatDate: formatDate, parsePaste: parsePaste, fillGrid: fillGrid, buildBill: buildBill };
});
