/*
  The invoice checker page: an inbox of bills, the selected invoice as a document with its numbers
  editable in place, and a match panel built from the rules in matcher.js. Nothing leaves the page.
*/
(function () {
  "use strict";
  var C = window.InvoiceChecker, SAMPLES = window.InvoiceSamples;
  if (!C || !SAMPLES) return;
  var $ = function (id) { return document.getElementById(id); };
  var inboxEl = $("inbox"), paperEl = $("paper"), panelEl = $("panel"), tolEl = $("tolerance"), summaryEl = $("inbox-summary"), liveEl = $("inv-live");

  // Display details for the made-up bills (dates are sample data too).
  var META = {
    "match": { issued: "3 November 2026", due: "20 December 2026" },
    "price-quantity": { issued: "5 November 2026", due: "20 December 2026" },
    "lines": { issued: "6 November 2026", due: "20 December 2026" },
    "totals": { issued: "7 November 2026", due: "20 December 2026" }
  };

  var bills, selected = 1, tolerance = 0;
  function fresh() {
    return SAMPLES.map(function (s) {
      return { id: s.id, order: JSON.parse(JSON.stringify(s.order)), invoice: JSON.parse(JSON.stringify(s.invoice)), decision: null };
    });
  }
  bills = fresh();

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function money(c) { return C.formatMoney(c); }
  function plain(c) { return Number.isFinite(c) ? C.formatMoney(c) : ""; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function result(b) { return C.check(b.order, b.invoice, { priceTolerancePercent: tolerance }); }

  var ICON = {
    ok: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
    check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 6v5M10 14.2v.1"/><path d="M8.6 3.4L2.4 14.5A1.6 1.6 0 0 0 3.8 17h12.4a1.6 1.6 0 0 0 1.4-2.5L11.4 3.4a1.6 1.6 0 0 0-2.8 0z"/></svg>',
    note: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 9v4.5M10 6.6v.1"/></svg>'
  };
  function icon(kind) { var s = el("span", "ico ico-" + kind); s.innerHTML = ICON[kind]; return s; }

  function statusOf(b) {
    if (b.decision === "approved") return { cls: "is-done", text: "Approved" };
    if (b.decision === "held") return { cls: "is-held", text: "On hold" };
    var r = result(b);
    if (r.verdict === "check") return { cls: "is-warn", text: plural(r.checkCount, "issue", "issues") };
    if (r.verdict === "notes") return { cls: "is-note", text: "Ready, with notes" };
    return { cls: "is-done", text: "Ready to pay" };
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
      btn.appendChild(el("span", "bill-no", b.invoice.number + " · " + META[b.id].issued.replace(/ 2026$/, "")));
      var bottom = el("span", "bill-bottom");
      bottom.appendChild(el("span", "bill-amt", money(b.invoice.totalCents)));
      bottom.appendChild(el("span", "status-pill " + st.cls, st.text));
      btn.appendChild(bottom);
      btn.addEventListener("click", function () { selected = i; renderAll(); inboxEl.querySelectorAll(".bill")[i].focus(); });
      li.appendChild(btn);
      inboxEl.appendChild(li);
    });
    summaryEl.textContent = waiting ? plural(waiting, "bill needs", "bills need") + " review" : "Nothing waiting";
  }

  // ---------- the invoice as a document ----------
  // An editable number on the invoice. Money shows as "$1,288.00"; toCents reads the "$" and commas back.
  function numberInput(label, value, onValue) {
    var input = el("input", "cell");
    input.type = "text";
    input.inputMode = "decimal";
    input.value = value;
    input.setAttribute("aria-label", label);
    input.addEventListener("input", function () {
      onValue(input.value);
      renderInbox(); renderPanel(); refreshPaperTotals();
    });
    return input;
  }

  function renderPaper() {
    var b = bills[selected], inv = b.invoice, meta = META[b.id];
    paperEl.textContent = "";
    var head = el("div", "paper-head");
    var who = el("div");
    who.appendChild(el("div", "paper-sup", inv.supplier));
    who.appendChild(el("div", "paper-sub", "GST registered supplier (sample)"));
    head.appendChild(who);
    head.appendChild(el("div", "paper-title", "Tax invoice"));
    paperEl.appendChild(head);

    var meta1 = el("dl", "paper-meta");
    function row(t, v) { var d = el("div"); d.appendChild(el("dt", null, t)); var dd = el("dd"); if (typeof v === "string") dd.textContent = v; else dd.appendChild(v); d.appendChild(dd); meta1.appendChild(d); }
    row("Invoice", inv.number);
    row("Issued", meta.issued);
    var po = el("input", "cell cell-text");
    po.type = "text"; po.value = inv.orderNumber; po.setAttribute("aria-label", "Order number quoted on the invoice");
    po.addEventListener("input", function () { inv.orderNumber = po.value; renderInbox(); renderPanel(); });
    row("Your order", po);
    row("Due", meta.due);
    paperEl.appendChild(meta1);

    var table = el("table", "paper-lines");
    table.appendChild(el("caption", "visually-hidden", "Invoice lines. Quantities and prices can be changed."));
    var thead = el("thead"); var hr = el("tr");
    [["Item", ""], ["Qty", "n"], ["Unit price", "n"], ["Amount", "n"]].forEach(function (h) { var th = el("th", h[1], h[0]); th.scope = "col"; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el("tbody");
    inv.lines.forEach(function (line, idx) {
      var tr = el("tr"); tr.dataset.code = String(line.code).toUpperCase();
      var item = el("td");
      item.appendChild(el("span", "line-code", line.code));
      item.appendChild(el("span", "line-desc", line.description));
      var q = el("td", "n"); q.appendChild(numberInput("Quantity for " + line.code, String(line.qty), function (v) { line.qty = C.toQuantity(v); }));
      var p = el("td", "n"); p.appendChild(numberInput("Unit price for " + line.code, plain(line.unitCents), function (v) { line.unitCents = C.toCents(v); }));
      var a = el("td", "n line-amt"); a.dataset.idx = idx;
      tr.appendChild(item); tr.appendChild(q); tr.appendChild(p); tr.appendChild(a);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    paperEl.appendChild(table);

    var totals = el("dl", "paper-totals");
    [["Subtotal", "subtotalCents"], ["GST 15%", "gstCents"], ["Total", "totalCents"]].forEach(function (t) {
      var d = el("div", t[1] === "totalCents" ? "is-total" : "");
      d.appendChild(el("dt", null, t[0]));
      var dd = el("dd");
      dd.appendChild(numberInput(t[0] + " on the invoice", plain(inv[t[1]]), function (v) { inv[t[1]] = C.toCents(v); }));
      d.appendChild(dd); totals.appendChild(d);
    });
    paperEl.appendChild(totals);
    paperEl.appendChild(el("p", "paper-hint", "Every number on this invoice can be changed. The check updates as you type."));
    refreshPaperTotals();
  }

  function refreshPaperTotals() {
    var b = bills[selected], r = result(b);
    paperEl.querySelectorAll(".line-amt").forEach(function (cell) {
      var line = b.invoice.lines[+cell.dataset.idx];
      var amt = C.lineTotalCents(line);
      cell.textContent = Number.isFinite(amt) ? money(amt) : "?";
    });
    paperEl.querySelectorAll("tbody tr").forEach(function (tr) {
      var st = r.lineStatus[tr.dataset.code];
      tr.className = st === "check" ? "is-check" : st === "note" ? "is-note" : "";
    });
    paperEl.querySelectorAll("input.cell").forEach(function (input) {
      var bad = input.inputMode === "decimal" && input.value.trim() !== "" && Number.isNaN(C.toCents(input.value));
      input.setAttribute("aria-invalid", String(bad));
    });
  }

  // ---------- the match panel ----------
  function renderPanel() {
    var b = bills[selected], r = result(b), order = b.order, inv = b.invoice;
    panelEl.textContent = "";

    var verdict = el("div", "verdict-box v-" + r.verdict);
    verdict.appendChild(icon(r.verdict === "check" ? "check" : r.verdict === "notes" ? "note" : "ok"));
    var vt = el("div");
    var headline = r.verdict === "check" ? plural(r.checkCount, "thing", "things") + " to check before paying" : r.verdict === "notes" ? "Ready to pay, with " + plural(r.noteCount, "note", "notes") : "Matches the order. Ready to pay.";
    // Announce only the headline, and only when it changes, so typing a number is not read out in full.
    var live = headline + (b.decision ? ". " + statusOf(b).text : "");
    if (liveEl.textContent !== live) liveEl.textContent = live;
    vt.appendChild(el("p", "v-head", headline));
    vt.appendChild(el("p", "v-sub", r.queryCents > 0 ? money(r.queryCents) + " to raise with the supplier, before GST" : "Checked against order " + order.number));
    verdict.appendChild(vt);
    panelEl.appendChild(verdict);

    // Line by line
    panelEl.appendChild(el("h2", "pn-h", "Lines against order " + order.number));
    var t = el("table", "cmp");
    var th = el("tr");
    ["Item", "Ordered", "Invoiced", "Difference"].forEach(function (h, i) { var c = el("th", i ? "n" : "", h); c.scope = "col"; th.appendChild(c); });
    var thead = el("thead"); thead.appendChild(th); t.appendChild(thead);
    var tb = el("tbody");
    var codes = [];
    order.lines.concat(inv.lines).forEach(function (l) { var k = String(l.code).toUpperCase(); if (codes.indexOf(k) === -1) codes.push(k); });
    codes.forEach(function (k) {
      var o = order.lines.filter(function (l) { return String(l.code).toUpperCase() === k; });
      var v = inv.lines.filter(function (l) { return String(l.code).toUpperCase() === k; });
      var oq = o.reduce(function (s, l) { return s + l.qty; }, 0), vq = v.reduce(function (s, l) { return s + l.qty; }, 0);
      var oc = o.reduce(function (s, l) { return s + C.lineTotalCents(l); }, 0), vc = v.reduce(function (s, l) { return s + C.lineTotalCents(l); }, 0);
      var st = r.lineStatus[k] || "ok";
      var tr = el("tr", "st-" + st);
      var c1 = el("td"), item = el("span", "cmp-item");
      item.appendChild(icon(st === "check" ? "check" : st === "note" ? "note" : "ok"));
      item.appendChild(el("span", "cmp-code", o[0] ? o[0].code : v[0].code));
      c1.appendChild(item); tr.appendChild(c1);
      tr.appendChild(el("td", "n", o.length ? oq + " × " + money(o[0].unitCents) : "Not ordered"));
      tr.appendChild(el("td", "n", v.length ? vq + " × " + money(v[0].unitCents) + (v.length > 1 ? " (" + v.length + " lines)" : "") : "Not invoiced"));
      var diff = (Number.isFinite(vc) ? vc : 0) - (Number.isFinite(oc) ? oc : 0);
      tr.appendChild(el("td", "n cmp-diff" + (diff > 0 ? " up" : diff < 0 ? " down" : ""), diff === 0 ? "None" : (diff > 0 ? "+" : "") + money(diff)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var wrap = el("div", "cmp-wrap"); wrap.appendChild(t); panelEl.appendChild(wrap);

    // Document checks
    panelEl.appendChild(el("h2", "pn-h", "Invoice checks"));
    var rules = r.findings.map(function (f) { return f.rule; });
    var checks = [
      ["Order number", rules.indexOf("order-number") === -1, rules.indexOf("order-number") === -1 ? "Quotes " + order.number : "Quotes " + (inv.orderNumber || "nothing")],
      ["Supplier", rules.indexOf("supplier") === -1, inv.supplier],
      ["Subtotal", rules.indexOf("subtotal") === -1, "Lines add up to " + money(r.linesCents)],
      ["GST 15%", rules.indexOf("gst") === -1, "Expected " + money(r.expectedGstCents)],
      ["Total", rules.indexOf("total") === -1, Number.isFinite(inv.subtotalCents + inv.gstCents) ? "Subtotal plus GST is " + money(inv.subtotalCents + inv.gstCents) : "Cannot add up"]
    ];
    var ul = el("ul", "checks");
    checks.forEach(function (c) {
      var li = el("li", c[1] ? "" : "is-bad");
      li.appendChild(icon(c[1] ? "ok" : "check"));
      li.appendChild(el("span", "ck-name", c[0]));
      li.appendChild(el("span", "ck-detail", c[2]));
      ul.appendChild(li);
    });
    panelEl.appendChild(ul);

    // What to do
    if (r.findings.length) {
      panelEl.appendChild(el("h2", "pn-h", "What needs a person"));
      var ol = el("ol", "issues");
      r.findings.forEach(function (f) {
        var li = el("li", "sev-" + f.severity);
        li.appendChild(el("span", "issue-tag", f.severity === "check" ? "Check before paying" : "Note"));
        li.appendChild(el("p", "issue-title", f.title));
        li.appendChild(el("p", "issue-detail", f.detail));
        ol.appendChild(li);
      });
      panelEl.appendChild(ol);
    }

    // Decision
    var actions = el("div", "decide");
    var hold = el("button", "ui-btn", b.decision === "held" ? "On hold" : "Hold for supplier");
    hold.type = "button"; hold.id = "hold";
    hold.setAttribute("aria-pressed", String(b.decision === "held"));
    hold.addEventListener("click", function () { decide("held", "hold"); });
    var approve = el("button", "ui-btn ui-btn-primary", b.decision === "approved" ? "Approved" : r.verdict === "check" ? "Approve anyway" : "Approve for payment");
    approve.type = "button"; approve.id = "approve";
    approve.setAttribute("aria-pressed", String(b.decision === "approved"));
    approve.addEventListener("click", function () { decide("approved", "approve"); });
    actions.appendChild(hold); actions.appendChild(approve);
    panelEl.appendChild(actions);
    panelEl.appendChild(el("p", "decide-note", "Approve and Hold only change this page. Nothing is paid."));
  }

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
    renderInbox(); renderPanel(); refreshPaperTotals();
  });
  $("reset").addEventListener("click", function () { bills = fresh(); tolerance = 0; tolEl.value = "0"; renderAll(); });

  renderAll();
})();
