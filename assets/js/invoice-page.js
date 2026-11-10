/*
  The invoice checker page: an inbox of bills, the selected invoice drawn as a sheet of paper with its
  numbers editable in place, and a review panel built from the rules in matcher.js. Nothing leaves the page.
*/
(function () {
  "use strict";
  var C = window.InvoiceChecker, SAMPLES = window.InvoiceSamples, E = window.InvoiceEntry;
  if (!C || !SAMPLES || !E) return;
  var $ = function (id) { return document.getElementById(id); };
  var inboxEl = $("inbox"), paperEl = $("paper"), panelEl = $("panel"), tolEl = $("tolerance"), summaryEl = $("inbox-summary"), liveEl = $("inv-live");
  var tolCentsEl = $("tolerance-cents"), copyLiveEl = $("copy-live"), printHeadEl = $("print-head"), appEl = $("app");
  var DEFAULT_CENTS = 5, COPIED_MS = 1500;
  var ICONS = "assets/img/icons.svg#";

  // Made-up supplier addresses for the invoice heading.
  var ADDRESS = { "Example Fittings Ltd": "Unit 4, 18 Example Road, Penrose, Auckland", "Sample Hardware Imports Ltd": "220 Sample Street, Hornby, Christchurch" };

  var bills, selected = 1, tolerance = 0, toleranceCents = DEFAULT_CENTS, enteredCount = 0;
  function fresh() {
    return SAMPLES.map(function (s) { return { id: s.id, order: JSON.parse(JSON.stringify(s.order)), invoice: JSON.parse(JSON.stringify(s.invoice)), decision: null }; });
  }
  bills = fresh();

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(name, cls) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "i" + (cls ? " " + cls : ""));
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", ICONS + name);
    svg.appendChild(use);
    return svg;
  }
  function money(c) { return C.formatMoney(c); }
  function asText(c) { return Number.isFinite(c) ? C.formatMoney(c) : ""; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  // Bills in this session that look like another bill: same supplier and invoice number, or total and date.
  function duplicateMap() {
    return C.findDuplicates(bills.map(function (b) {
      return { id: b.id, supplier: b.invoice.supplier, number: b.invoice.number, issued: b.invoice.issued, totalCents: b.invoice.totalCents };
    }));
  }
  function result(b, dupes) {
    return C.check(b.order, b.invoice, {
      priceTolerancePercent: tolerance, priceToleranceCents: toleranceCents,
      duplicates: (dupes || duplicateMap())[b.id] || []
    });
  }
  var STATUS_ICON = { check: "alert-triangle", note: "info", ok: "check" };

  function statusOf(b) {
    if (b.decision === "approved") return { cls: "is-ok", text: "Approved" };
    if (b.decision === "held") return { cls: "is-held", text: "On hold" };
    var r = result(b);
    if (r.verdict === "check") return { cls: "is-warn", text: plural(r.checkCount, "issue", "issues") };
    if (r.verdict === "notes") return { cls: "is-info", text: "Ready, with notes" };
    return { cls: "is-ok", text: "Ready to pay" };
  }

  // ---------- inbox ----------
  function renderInbox() {
    inboxEl.textContent = "";
    var waiting = 0;
    bills.forEach(function (b, i) {
      var st = statusOf(b);
      if (!b.decision && result(b).verdict === "check") waiting++;
      var li = el("li");
      var btn = el("button", "bill" + (i === selected ? " is-current" : ""));
      btn.type = "button";
      if (i === selected) btn.setAttribute("aria-current", "true");
      btn.appendChild(el("span", "bill-sup", b.invoice.supplier));
      btn.appendChild(el("span", "bill-no", b.invoice.number + " · " + String(b.invoice.issued || "No date").replace(/ 2026$/, "")));
      var bottom = el("span", "bill-bottom");
      bottom.appendChild(el("span", "bill-amt", money(b.invoice.totalCents)));
      bottom.appendChild(el("span", "pill " + st.cls, st.text));
      btn.appendChild(bottom);
      btn.addEventListener("click", function () { selected = i; renderAll(); inboxEl.querySelectorAll(".bill")[i].focus(); });
      li.appendChild(btn);
      inboxEl.appendChild(li);
    });
    summaryEl.textContent = waiting ? plural(waiting, "needs", "need") + " review" : "Nothing waiting";
  }

  // ---------- the invoice ----------
  function input(label, value, onValue, cls, mode) {
    var x = el("input", "cell" + (cls ? " " + cls : ""));
    x.type = "text";
    x.inputMode = mode || "decimal";
    x.value = value;
    x.setAttribute("aria-label", label);
    x.addEventListener("input", function () { onValue(x.value); renderInbox(); renderPanel(); refreshPaper(); });
    return x;
  }

  function renderPaper() {
    var b = bills[selected], inv = b.invoice;
    paperEl.textContent = "";

    var head = el("div", "paper-head");
    var who = el("div");
    who.appendChild(el("p", "paper-sup", inv.supplier));
    who.appendChild(el("p", "paper-addr", ADDRESS[inv.supplier] || ""));
    head.appendChild(who);
    var title = el("div", "paper-title");
    title.appendChild(el("h2", null, "Tax invoice"));
    title.appendChild(el("p", null, inv.number));
    head.appendChild(title);
    paperEl.appendChild(head);

    var meta = el("dl", "paper-meta");
    function row(t, v, cls) { var d = el("div", cls); d.appendChild(el("dt", null, t)); var dd = el("dd"); if (typeof v === "string") dd.textContent = v; else dd.appendChild(v); d.appendChild(dd); meta.appendChild(d); }
    row("GST number", input("Supplier GST number", inv.gstNumber || "", function (v) { inv.gstNumber = v; }, "cell-text", "text"));
    row("Issued", input("Date issued", inv.issued || "", function (v) { inv.issued = v; renderInbox(); }, "cell-text", "text"));
    row("Your order", input("Order number quoted on the invoice", inv.orderNumber || "", function (v) { inv.orderNumber = v; }, "cell-text", "text"));
    row("Due", inv.due || "Not given");
    var billTo = el("span");
    var buyer = inv.buyer || {};
    billTo.appendChild(el("strong", null, buyer.name || "Not shown"));
    if (buyer.identifier) { billTo.appendChild(document.createElement("br")); billTo.appendChild(document.createTextNode(buyer.identifier)); }
    row("Bill to", billTo, "billto");
    paperEl.appendChild(meta);

    var table = el("table", "lines");
    table.appendChild(el("caption", "visually-hidden", "Invoice lines. Quantities and prices can be changed."));
    var thead = el("thead"), hr = el("tr");
    [["Item", ""], ["Qty", "n"], ["Unit price", "n"], ["Amount", "n"]].forEach(function (h) { var th = el("th", h[1], h[0]); th.scope = "col"; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el("tbody");
    inv.lines.forEach(function (line, idx) {
      var tr = el("tr"); tr.dataset.code = String(line.code).toUpperCase();
      var item = el("td");
      item.appendChild(el("span", "line-code", line.code));
      if (line.description && line.description !== line.code) item.appendChild(el("span", "line-desc", line.description));
      var q = el("td", "n"); q.appendChild(input("Quantity for " + line.code, String(line.qty), function (v) { line.qty = C.toQuantity(v); }, "cell-qty"));
      var p = el("td", "n"); p.appendChild(input("Unit price for " + line.code, asText(line.unitCents), function (v) { line.unitCents = C.toCents(v); }));
      var a = el("td", "n line-amt"); a.dataset.idx = idx;
      tr.appendChild(item); tr.appendChild(q); tr.appendChild(p); tr.appendChild(a);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    paperEl.appendChild(table);

    var totals = el("dl", "totals");
    [["Subtotal", "subtotalCents"], ["GST 15%", "gstCents"], ["Total due", "totalCents"]].forEach(function (t) {
      var d = el("div", t[1] === "totalCents" ? "is-total" : "");
      d.appendChild(el("dt", null, t[0]));
      var dd = el("dd");
      dd.appendChild(input(t[0] + " on the invoice", asText(inv[t[1]]), function (v) { inv[t[1]] = C.toCents(v); }));
      d.appendChild(dd); totals.appendChild(d);
    });
    paperEl.appendChild(totals);
    var foot = el("div", "paper-foot");
    foot.appendChild(el("span", null, "Every number and the GST number can be changed. The review updates as you type."));
    foot.appendChild(el("span", null, b.entered ? "Entered by you" : "Sample data"));
    paperEl.appendChild(foot);
    refreshPaper();
  }

  function refreshPaper() {
    var b = bills[selected], r = result(b);
    paperEl.querySelectorAll(".line-amt").forEach(function (cell) {
      var amt = C.lineTotalCents(b.invoice.lines[+cell.dataset.idx]);
      cell.textContent = Number.isFinite(amt) ? money(amt) : "?";
    });
    paperEl.querySelectorAll("tbody tr").forEach(function (tr) {
      var st = r.lineStatus[tr.dataset.code];
      tr.className = st === "check" ? "is-check" : st === "note" ? "is-note" : "";
    });
    paperEl.querySelectorAll("input.cell").forEach(function (x) {
      var bad = x.inputMode === "decimal" && x.value.trim() !== "" && Number.isNaN(C.toCents(x.value));
      if (x.getAttribute("aria-label") === "Supplier GST number") bad = !!r.findings.some(function (f) { return f.rule === "tax-gst-number"; });
      x.setAttribute("aria-invalid", String(bad));
    });
  }

  // ---------- review panel ----------
  function renderPanel() {
    var b = bills[selected], r = result(b), order = b.order, inv = b.invoice;
    panelEl.textContent = "";
    var rules = r.findings.map(function (f) { return f.rule; });
    var has = function (rule) { return rules.indexOf(rule) !== -1; };

    var headline = r.verdict === "check" ? plural(r.checkCount, "thing", "things") + " to check before paying"
      : r.verdict === "notes" ? "Ready to pay, with " + plural(r.noteCount, "note", "notes") : "Matches the order. Ready to pay.";
    var live = inv.supplier + ", " + inv.number + ": " + headline + (b.decision ? ". " + statusOf(b).text : "");
    if (liveEl.textContent !== live) liveEl.textContent = live;

    var verdict = el("div", "verdict v-" + r.verdict);
    var vi = el("span", "verdict-icon"); vi.appendChild(icon(r.verdict === "check" ? "alert-triangle" : r.verdict === "notes" ? "info" : "circle-check"));
    verdict.appendChild(vi);
    var vt = el("div");
    vt.appendChild(el("p", "v-head", headline));
    vt.appendChild(el("p", "v-sub", "Against order " + order.number + " from " + order.supplier));
    verdict.appendChild(vt);
    panelEl.appendChild(verdict);
    if (r.queryCents > 0) {
      var amt = el("p", "v-amount");
      amt.appendChild(el("strong", null, money(r.queryCents)));
      amt.appendChild(el("span", null, "to raise with the supplier, before GST"));
      panelEl.appendChild(amt);
    }

    // Line by line
    var h1 = el("h3", "pn-h"); h1.appendChild(el("span", "label-mono", "Lines")); h1.appendChild(el("span", "label-mono", "Ordered and invoiced"));
    panelEl.appendChild(h1);
    var t = el("table", "cmp"), thead = el("thead"), th = el("tr");
    ["Item", "Ordered", "Invoiced", "Change"].forEach(function (h, i) { var c = el("th", i ? "n" : "", h); c.scope = "col"; th.appendChild(c); });
    thead.appendChild(th); t.appendChild(thead);
    var tb = el("tbody"), codes = [];
    order.lines.concat(inv.lines).forEach(function (l) { var k = String(l.code).toUpperCase(); if (codes.indexOf(k) === -1) codes.push(k); });
    codes.forEach(function (k) {
      var o = order.lines.filter(function (l) { return String(l.code).toUpperCase() === k; });
      var v = inv.lines.filter(function (l) { return String(l.code).toUpperCase() === k; });
      var oq = o.reduce(function (s, l) { return s + l.qty; }, 0), vq = v.reduce(function (s, l) { return s + l.qty; }, 0);
      var oc = o.reduce(function (s, l) { return s + C.lineTotalCents(l); }, 0), vc = v.reduce(function (s, l) { return s + C.lineTotalCents(l); }, 0);
      var st = r.lineStatus[k] || "ok";
      var tr = el("tr", "st-" + st);
      var c1 = el("td"), item = el("span", "cmp-item");
      var stIcon = el("span", "st"); stIcon.appendChild(icon(STATUS_ICON[st] || "check")); item.appendChild(stIcon);
      item.appendChild(el("span", "cmp-code", o[0] ? o[0].code : v[0].code));
      c1.appendChild(item); tr.appendChild(c1);
      tr.appendChild(el("td", "n", o.length ? oq + " × " + money(o[0].unitCents) : "Not ordered"));
      tr.appendChild(el("td", "n", v.length ? vq + " × " + money(v[0].unitCents) + (v.length > 1 ? " (" + v.length + " lines)" : "") : "Not invoiced"));
      var diff = (Number.isFinite(vc) ? vc : 0) - (Number.isFinite(oc) ? oc : 0);
      tr.appendChild(el("td", "n cmp-diff" + (diff > 0 ? " up" : diff < 0 ? " down" : ""), diff === 0 ? "None" : (diff > 0 ? "+" : "") + money(diff)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    panelEl.appendChild(t);

    // Invoice checks
    var h2 = el("h3", "pn-h"); h2.appendChild(el("span", "label-mono", "Invoice checks")); panelEl.appendChild(h2);
    var buyer = inv.buyer || {};
    var checks = [
      ["Order number", !has("order-number"), "Quotes " + (inv.orderNumber || "nothing")],
      ["Supplier", !has("supplier"), inv.supplier],
      ["Subtotal", !has("subtotal"), "Lines add to " + money(r.linesCents)],
      ["GST 15%", !has("gst"), "Expected " + money(r.expectedGstCents)],
      ["Total", !has("total"), Number.isFinite(inv.subtotalCents + inv.gstCents) ? "Should be " + money(inv.subtotalCents + inv.gstCents) : "Cannot add up"],
      ["GST number", !has("tax-gst-number"), inv.gstNumber ? (has("tax-gst-number") ? "Fails the check digit" : "Valid check digit") : "Not shown"],
      ["Date", !has("tax-date"), inv.issued || "Not shown"],
      ["Duplicates", !has("duplicate-invoice"), has("duplicate-invoice") ? "Possible duplicate" : "None found"],
      ["Your details", !has("tax-buyer"), buyer.name ? buyer.name : "Not shown"]
    ];
    var ul = el("ul", "checks");
    checks.forEach(function (c) {
      var li = el("li", c[1] ? "ck-ok" : "ck-bad");
      var s = el("span", "st"); s.appendChild(icon(c[1] ? "check" : "alert-triangle")); li.appendChild(s);
      li.appendChild(el("span", "ck-name", c[0]));
      li.appendChild(el("span", "ck-detail", c[2]));
      ul.appendChild(li);
    });
    panelEl.appendChild(ul);

    if (r.findings.length) {
      var h3 = el("h3", "pn-h"); h3.appendChild(el("span", "label-mono", "What needs a person")); panelEl.appendChild(h3);
      var ol = el("ol", "issues");
      r.findings.forEach(function (f) {
        var li = el("li", "sev-" + f.severity);
        var tag = el("span", "issue-tag"); tag.appendChild(icon(f.severity === "check" ? "alert-triangle" : "info")); tag.appendChild(document.createTextNode(f.severity === "check" ? "Check before paying" : "Note"));
        li.appendChild(tag);
        li.appendChild(el("p", "issue-title", f.title));
        li.appendChild(el("p", "issue-detail", f.detail));
        ol.appendChild(li);
      });
      panelEl.appendChild(ol);
    }

    var helpers = el("div", "helpers" + (r.verdict === "check" ? "" : " single"));
    if (r.verdict === "check") {
      var copy = el("button", "btn"); copy.type = "button"; copy.id = "copy-query";
      paintCopy(copy, false);
      copy.addEventListener("click", function () { copyQuery(copy, b, r); });
      helpers.appendChild(copy);
    }
    var print = el("button", "btn"); print.type = "button"; print.id = "print-summary";
    print.appendChild(icon("printer")); print.appendChild(el("span", null, "Print summary"));
    print.addEventListener("click", function () { window.print(); });
    helpers.appendChild(print);
    panelEl.appendChild(helpers);

    var actions = el("div", "decide");
    var hold = el("button", "btn", b.decision === "held" ? "On hold" : "Hold");
    hold.type = "button"; hold.id = "hold"; hold.insertBefore(icon("pause"), hold.firstChild);
    hold.setAttribute("aria-pressed", String(b.decision === "held"));
    hold.addEventListener("click", function () { decide("held", "hold"); });
    var approve = el("button", "btn btn-ink", b.decision === "approved" ? "Approved" : r.verdict === "check" ? "Approve anyway" : "Approve");
    approve.type = "button"; approve.id = "approve"; approve.insertBefore(icon("check"), approve.firstChild);
    approve.setAttribute("aria-pressed", String(b.decision === "approved"));
    approve.addEventListener("click", function () { decide("approved", "approve"); });
    actions.appendChild(hold); actions.appendChild(approve);
    panelEl.appendChild(actions);
    panelEl.appendChild(el("p", "decide-note", "Approve and Hold only change this page. Nothing is paid."));
  }

  // ---------- copy a query for the supplier, and print ----------
  function paintCopy(btn, copied) {
    btn.textContent = "";
    btn.classList.toggle("is-copied", copied);
    var label = el("span", "copy-label");
    label.appendChild(icon(copied ? "check" : "copy"));
    label.appendChild(document.createTextNode(copied ? "Copied" : "Copy query for supplier"));
    btn.appendChild(label);
  }
  function copyText(text) {
    function old() {
      return new Promise(function (resolve, reject) {
        var box = document.createElement("textarea");
        box.value = text; box.setAttribute("readonly", ""); box.className = "visually-hidden";
        document.body.appendChild(box); box.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(box);
        if (ok) resolve(); else reject(new Error("copy failed"));
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(old);
    return old();
  }
  var copyTimer = 0, copyClearTimer = 0;
  function copyQuery(btn, b, r) {
    var text = C.supplierQuery(b.order, b.invoice, r);
    copyText(text).then(function () {
      paintCopy(btn, true);
      copyLiveEl.textContent = "Query for the supplier copied to the clipboard.";
      clearTimeout(copyTimer); clearTimeout(copyClearTimer);
      copyTimer = setTimeout(function () { if (btn.isConnected) paintCopy(btn, false); }, COPIED_MS);
      copyClearTimer = setTimeout(function () { copyLiveEl.textContent = ""; }, 4000);
    }, function () {
      copyLiveEl.textContent = "The query could not be copied. Use Print summary instead.";
    });
  }
  // The heading that only shows on paper.
  window.addEventListener("beforeprint", function () {
    var b = bills[selected], r = result(b), inv = b.invoice;
    printHeadEl.textContent = "";
    printHeadEl.appendChild(el("h2", null, "Invoice check summary"));
    printHeadEl.appendChild(el("p", null, inv.supplier + ", invoice " + inv.number + (inv.issued ? ", dated " + inv.issued : "") + ", against order " + b.order.number));
    printHeadEl.appendChild(el("p", null, (r.verdict === "check" ? plural(r.checkCount, "thing", "things") + " to check before paying" : r.verdict === "notes" ? "Ready to pay, with " + plural(r.noteCount, "note", "notes") : "Matches the order") +
      (b.decision ? ". " + statusOf(b).text : "") + ". Printed " + new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" }) + "."));
  });

  // A decision toggles, and focus stays on the button that was pressed after the panel redraws.
  function decide(kind, id) {
    var b = bills[selected];
    b.decision = b.decision === kind ? null : kind;
    renderInbox(); renderPanel();
    $(id).focus();
  }

  function renderAll() { renderInbox(); renderPaper(); renderPanel(); }

  tolEl.addEventListener("input", function () {
    var n = C.toQuantity(tolEl.value);
    tolEl.setAttribute("aria-invalid", String(Number.isNaN(n)));
    tolerance = Number.isNaN(n) ? 0 : n;
    renderInbox(); renderPanel(); refreshPaper();
  });
  tolCentsEl.addEventListener("input", function () {
    var empty = tolCentsEl.value.trim() === "";
    var n = empty ? 0 : C.toQuantity(tolCentsEl.value);
    tolCentsEl.setAttribute("aria-invalid", String(Number.isNaN(n)));
    toleranceCents = Number.isNaN(n) ? 0 : n;
    renderInbox(); renderPanel(); refreshPaper();
  });
  $("reset").addEventListener("click", function () {
    bills = fresh(); tolerance = 0; tolEl.value = "0"; toleranceCents = DEFAULT_CENTS; tolCentsEl.value = String(DEFAULT_CENTS);
    tolEl.setAttribute("aria-invalid", "false"); tolCentsEl.setAttribute("aria-invalid", "false");
    selected = Math.min(selected, bills.length - 1);
    renderAll();
  });

  // ---------- check a GST number ----------
  var gstBox = $("gst-check"), gstResult = $("gst-result");
  gstBox.addEventListener("input", function () {
    var d = C.describeGstNumber(gstBox.value);
    gstResult.textContent = d.text;
    gstResult.setAttribute("data-state", d.state);
    gstBox.setAttribute("aria-invalid", String(d.state === "invalid"));
  });

  // ---------- enter your own bill ----------
  var entryDlg = $("entry"), entryForm = $("entry-form"), rowsEl = $("entry-rows"), errorEl = $("entry-error");
  var FIELD_IDS = ["entry-supplier", "entry-gst", "entry-invoice", "entry-date", "entry-order", "entry-buyer", "entry-buyer-id"];
  var HEADS = ["Item", "Ordered qty", "Order price", "Invoiced qty", "Invoice price"];
  var START_ROWS = 3;
  function emptyGrid(n) { var g = []; for (var i = 0; i < n; i++) g.push(new Array(E.COLUMNS).fill("")); return g; }
  function readGrid() {
    return Array.prototype.map.call(rowsEl.children, function (row) {
      return Array.prototype.map.call(row.querySelectorAll("input"), function (x) { return x.value; });
    });
  }
  function drawGrid(grid) {
    rowsEl.textContent = "";
    grid.forEach(function (cells, r) {
      var row = el("div", "eg-row");
      for (var c = 0; c < E.COLUMNS; c++) {
        var cell = el("label", "eg-cell" + (c === 0 ? " eg-item" : " num"));
        cell.appendChild(el("span", null, HEADS[c]));
        var x = el("input"); x.type = "text"; x.value = cells[c] || ""; x.autocomplete = "off";
        if (c > 0) x.inputMode = "decimal";
        x.setAttribute("aria-label", "Line " + (r + 1) + ", " + HEADS[c].toLowerCase());
        x.dataset.r = r; x.dataset.c = c;
        cell.appendChild(x); row.appendChild(cell);
      }
      var del = el("button", "icon-btn eg-del"); del.type = "button"; del.setAttribute("aria-label", "Remove line " + (r + 1));
      del.appendChild(icon("x"));
      del.addEventListener("click", function () {
        var g = readGrid(); g.splice(r, 1);
        if (!g.length) g = emptyGrid(1);
        drawGrid(g);
        var next = rowsEl.querySelectorAll(".eg-row")[Math.min(r, g.length - 1)];
        next.querySelector("input").focus();
      });
      row.appendChild(del);
      rowsEl.appendChild(row);
    });
  }
  // Pasting rows copied from a spreadsheet fills the grid from the cell you pasted into.
  rowsEl.addEventListener("paste", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "INPUT" || !e.clipboardData) return;
    var text = e.clipboardData.getData("text/plain");
    var cells = E.parsePaste(text);
    if (cells.length < 2 && (cells[0] || []).length < 2) return; // one value: paste as usual
    e.preventDefault();
    var r = +t.dataset.r, c = +t.dataset.c;
    drawGrid(E.fillGrid(readGrid(), r, c, text, E.COLUMNS));
    rowsEl.querySelectorAll(".eg-row")[r].querySelectorAll("input")[c].focus();
    errorEl.textContent = "";
  });
  $("entry-add").addEventListener("click", function () {
    var g = readGrid(); g.push(new Array(E.COLUMNS).fill(""));
    drawGrid(g);
    rowsEl.lastElementChild.querySelector("input").focus();
  });
  function clearEntry() {
    FIELD_IDS.forEach(function (id) { $(id).value = ""; });
    drawGrid(emptyGrid(START_ROWS));
    errorEl.textContent = "";
  }
  drawGrid(emptyGrid(START_ROWS));
  $("new-check").addEventListener("click", function () { errorEl.textContent = ""; entryDlg.showModal(); $("entry-supplier").focus(); });
  $("entry-close").addEventListener("click", function () { entryDlg.close(); });
  $("entry-cancel").addEventListener("click", function () { entryDlg.close(); });
  entryForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var made = E.buildBill({
      supplier: $("entry-supplier").value, gstNumber: $("entry-gst").value, invoiceNumber: $("entry-invoice").value,
      date: $("entry-date").value, orderNumber: $("entry-order").value, buyerName: $("entry-buyer").value,
      buyerIdentifier: $("entry-buyer-id").value, rows: readGrid()
    });
    if (!made.ok) { errorEl.textContent = made.errors.join("\n"); return; }
    enteredCount++;
    bills.push({ id: "mine-" + enteredCount, order: made.bill.order, invoice: made.bill.invoice, decision: null, entered: true });
    selected = bills.length - 1;
    clearEntry();
    entryDlg.close();
    renderAll();
    focusBill(selected);
  });

  // ---------- keyboard ----------
  var keysDlg = $("keys");
  $("keys-open").addEventListener("click", function () { keysDlg.showModal(); });
  $("keys-close").addEventListener("click", function () { keysDlg.close(); });
  keysDlg.addEventListener("click", function (e) {
    var box = keysDlg.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) keysDlg.close();
  });
  function isTyping(t) {
    var tag = t && t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!(t && t.isContentEditable);
  }
  function focusBill(i) { var list = inboxEl.querySelectorAll(".bill"); if (list[i]) list[i].focus(); }
  function moveTo(i) {
    if (i < 0 || i > bills.length - 1 || i === selected) return;
    selected = i; renderAll(); focusBill(i);
  }
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (document.querySelector("dialog[open]")) return;
    var k = e.key;
    var inApp = appEl.contains(document.activeElement);
    if (k === "j" || (k === "ArrowDown" && inApp)) { e.preventDefault(); moveTo(selected + 1); }
    else if (k === "k" || (k === "ArrowUp" && inApp)) { e.preventDefault(); moveTo(selected - 1); }
    else if (k === "a" && !e.repeat) { e.preventDefault(); decide("approved", "approve"); }
    else if (k === "h" && !e.repeat) { e.preventDefault(); decide("held", "hold"); }
    else if (k === "?") { e.preventDefault(); keysDlg.showModal(); }
  });

  // Theme switch (the choice is kept in this browser only, shared with the rest of the site).
  var themeBtn = $("theme");
  function paintTheme() {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    themeBtn.querySelector("use").setAttribute("href", ICONS + (dark ? "sun" : "moon"));
  }
  themeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    paintTheme();
  });
  paintTheme();

  renderAll();
})();
