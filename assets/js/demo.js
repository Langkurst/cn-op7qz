/*
  The checker page: draws the order and the invoice, reads what the visitor types,
  and shows what the rules in matcher.js make of it. Nothing leaves the browser.
*/
(function () {
  "use strict";
  var C = window.InvoiceChecker;
  var SAMPLES = window.InvoiceSamples;
  if (!C || !SAMPLES) return;

  var docsEl = document.getElementById("docs");
  var verdictEl = document.getElementById("verdict");
  var verdictSubEl = document.getElementById("verdict-sub");
  var findingsEl = document.getElementById("findings");
  var sampleListEl = document.getElementById("sample-list");
  var toleranceEl = document.getElementById("tolerance");
  var resetEl = document.getElementById("reset");

  var state = { sample: null, order: null, invoice: null, tolerance: 0 };
  var rows = { order: [], invoice: [] }; // the table rows on screen, in line order

  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (name) {
      if (name === "text") node.textContent = attrs[name];
      else if (name === "class") node.className = attrs[name];
      else node.setAttribute(name, attrs[name]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function plainMoney(cents) { return (cents / 100).toFixed(2); }

  // One text box. "read" turns the text into a number, "store" keeps it.
  function numberBox(label, value, read, store) {
    var input = el("input", { type: "text", inputmode: "decimal", "aria-label": label, value: value });
    input.addEventListener("input", function () {
      var parsed = read(input.value);
      if (Number.isNaN(parsed)) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      store(parsed);
      update();
    });
    return input;
  }

  function buildTable(kind, doc) {
    var who = kind === "order" ? "Order" : "Invoice";
    var body = el("tbody");
    rows[kind] = [];

    doc.lines.forEach(function (line) {
      var chip = el("span", { class: "chip", hidden: "" });
      var totalCell = el("td", { class: "n", text: C.formatMoney(C.lineTotalCents(line)) });
      var qty = numberBox(who + " quantity for " + line.code, String(line.qty), C.toQuantity, function (n) { line.qty = n; });
      var price = numberBox(who + " unit price for " + line.code, plainMoney(line.unitCents), C.toCents, function (n) { line.unitCents = n; });
      var tr = el("tr", {}, [
        el("td", {}, [el("span", { class: "code", text: line.code }), el("span", { class: "desc", text: line.description }), chip]),
        el("td", { class: "n has-input" }, [qty]),
        el("td", { class: "n has-input" }, [price]),
        totalCell
      ]);
      body.appendChild(tr);
      rows[kind].push({ line: line, tr: tr, chip: chip, totalCell: totalCell });
    });

    var head = el("thead", {}, [el("tr", {}, [
      el("th", { scope: "col", text: "Item" }),
      el("th", { scope: "col", class: "n col-qty", text: "Qty" }),
      el("th", { scope: "col", class: "n col-price", text: "Unit price" }),
      el("th", { scope: "col", class: "n col-total", text: "Line total" })
    ])]);

    var foot = el("tfoot");
    linesSumElFor(kind, foot);
    if (kind === "invoice") {
      [["Subtotal on the invoice", "subtotalCents"], ["GST on the invoice", "gstCents"], ["Total on the invoice", "totalCents"]].forEach(function (pair) {
        var box = numberBox(pair[0], plainMoney(doc[pair[1]]), C.toCents, function (n) { doc[pair[1]] = n; });
        foot.appendChild(el("tr", { class: "given" }, [
          el("th", { scope: "row", colspan: "2", text: pair[0] }),
          el("td", { class: "n has-input", colspan: "2" }, [box])
        ]));
      });
    }

    return el("div", { class: "table-scroll" }, [el("table", {}, [
      el("caption", { class: "visually-hidden", text: who + " lines. Quantities and prices can be changed." }), head, body, foot
    ])]);
  }

  var sumEls = {};
  function linesSumElFor(kind, foot) {
    var cell = el("td", { class: "n", colspan: "2" });
    sumEls[kind] = cell;
    foot.appendChild(el("tr", {}, [
      el("th", { scope: "row", colspan: "2", text: kind === "order" ? "Order value before GST" : "Invoice lines add up to" }), cell
    ]));
  }

  function metaRow(term, valueNode) { return [el("dt", { text: term }), el("dd", {}, [valueNode])]; }

  function draw() {
    docsEl.textContent = "";
    var order = state.order, invoice = state.invoice;

    var orderMeta = el("dl", { class: "doc-meta" }, []
      .concat(metaRow("Order number", el("span", { class: "num", text: order.number })))
      .concat(metaRow("Supplier", el("span", { text: order.supplier }))));

    var quoted = el("input", { type: "text", "aria-label": "Order number quoted on the invoice", value: invoice.orderNumber });
    quoted.addEventListener("input", function () { invoice.orderNumber = quoted.value; update(); });
    var invoiceMeta = el("dl", { class: "doc-meta" }, []
      .concat(metaRow("Invoice number", el("span", { class: "num", text: invoice.number })))
      .concat(metaRow("Supplier", el("span", { text: invoice.supplier })))
      .concat(metaRow("Order number quoted", quoted)));

    docsEl.appendChild(el("section", { class: "doc", "aria-labelledby": "order-h" }, [
      el("h2", { id: "order-h", text: "Purchase order" }), orderMeta, buildTable("order", order)
    ]));
    docsEl.appendChild(el("section", { class: "doc", "aria-labelledby": "invoice-h" }, [
      el("h2", { id: "invoice-h", text: "Supplier invoice" }), invoiceMeta, buildTable("invoice", invoice)
    ]));
    update();
  }

  var CHIP = { check: ["chip chip-check", "Check"], note: ["chip chip-note", "Note"], ok: ["chip chip-ok", "Matches"] };

  function paintRow(row, status) {
    row.tr.className = status === "check" ? "is-check" : status === "note" ? "is-note" : "";
    if (!status) { row.chip.hidden = true; return; }
    row.chip.hidden = false;
    row.chip.className = CHIP[status][0];
    row.chip.textContent = CHIP[status][1];
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function update() {
    var result = C.check(state.order, state.invoice, { priceTolerancePercent: state.tolerance });
    var invoicedCodes = {};
    state.invoice.lines.forEach(function (line) { invoicedCodes[String(line.code).trim().toUpperCase()] = true; });

    rows.invoice.forEach(function (row) {
      row.totalCell.textContent = C.formatMoney(C.lineTotalCents(row.line));
      paintRow(row, result.lineStatus[String(row.line.code).trim().toUpperCase()] || "ok");
    });
    rows.order.forEach(function (row) {
      var code = String(row.line.code).trim().toUpperCase();
      row.totalCell.textContent = C.formatMoney(C.lineTotalCents(row.line));
      // On the order, a row is marked only when the invoice does not mention it or its numbers cannot be read.
      var status = result.lineStatus[code];
      paintRow(row, !invoicedCodes[code] || !Number.isFinite(C.lineTotalCents(row.line)) ? status : null);
      if (!invoicedCodes[code] && status === "note") row.chip.textContent = "Not on the invoice";
    });

    sumEls.order.textContent = C.formatMoney(state.order.lines.reduce(function (t, l) { return t + C.lineTotalCents(l); }, 0));
    sumEls.invoice.textContent = C.formatMoney(result.linesCents);

    verdictEl.setAttribute("data-verdict", result.verdict);
    if (result.verdict === "match") {
      verdictEl.textContent = "Nothing to check. The invoice matches the order.";
      verdictSubEl.textContent = "Prices, quantities, lines, GST and totals all agree.";
    } else if (result.verdict === "notes") {
      verdictEl.textContent = "Nothing holds payment. " + plural(result.noteCount, "note", "notes") + " to read.";
      verdictSubEl.textContent = "";
    } else {
      verdictEl.textContent = plural(result.checkCount, "thing", "things") + " to check before paying" +
        (result.noteCount ? ", and " + plural(result.noteCount, "note", "notes") + "." : ".");
      verdictSubEl.textContent = result.queryCents > 0
        ? "Line differences to raise with the supplier: " + C.formatMoney(result.queryCents) + " before GST."
        : "";
    }

    findingsEl.textContent = "";
    result.findings.forEach(function (finding) {
      var chip = finding.severity === "check"
        ? el("span", { class: "chip chip-check", text: "Check before paying" })
        : el("span", { class: "chip chip-note", text: "Note" });
      findingsEl.appendChild(el("li", {}, [chip, el("h3", { text: finding.title }), el("p", { text: finding.detail })]));
    });
    findingsEl.hidden = result.findings.length === 0;
  }

  function load(sample) {
    state.sample = sample;
    state.order = copy(sample.order);
    state.invoice = copy(sample.invoice);
    draw();
  }

  SAMPLES.forEach(function (sample, i) {
    var id = "sample-" + sample.id;
    var radio = el("input", { type: "radio", name: "sample", id: id, value: sample.id });
    if (i === 1) radio.checked = true;
    radio.addEventListener("change", function () { if (radio.checked) load(sample); });
    sampleListEl.appendChild(el("span", {}, [radio, el("label", { for: id, text: sample.label })]));
  });

  toleranceEl.addEventListener("input", function () {
    var n = C.toQuantity(toleranceEl.value);
    if (Number.isNaN(n)) { toleranceEl.setAttribute("aria-invalid", "true"); state.tolerance = 0; }
    else { toleranceEl.removeAttribute("aria-invalid"); state.tolerance = n; }
    update();
  });
  resetEl.addEventListener("click", function () {
    toleranceEl.value = "0";
    toleranceEl.removeAttribute("aria-invalid");
    state.tolerance = 0;
    load(state.sample);
  });

  load(SAMPLES[1]);
})();
