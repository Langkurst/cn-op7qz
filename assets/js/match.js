/*
  The invoice check on the home page. A purchase order on the left, its invoice in the in-tray on the right.
  Drag the invoice onto the order (or press Check) and it is checked line by line with the same rules
  and wording as the invoice checker (assets/js/matcher.js), on the same made-up samples (assets/js/samples.js).
  Nothing moves until the visitor drags or presses a button. With reduced motion nothing moves at all.
  The wording helpers at the bottom also load in Node, so tests/site.test.js can check them against the real rules.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else api.start(root);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- wording (pure, tested) ----------
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function verdictText(result, formatMoney) {
    var lines = [];
    if (result.verdict === "match") lines.push("Matches the order. Ready to pay.");
    else if (result.checkCount) lines.push(plural(result.checkCount, "thing", "things") + " to check before paying.");
    else lines.push("Ready to pay, with " + plural(result.noteCount, "note", "notes") + ".");
    if (result.queryCents > 0) lines.push(formatMoney(result.queryCents) + " to raise with the supplier, before GST.");
    return lines;
  }

  // ---------- the documents, as HTML (pure: the page has the first bill built in, and a test keeps it identical) ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function orderHTML(order, M) {
    var rows = order.lines.map(function (l) {
      return "<tr><th scope=\"row\"><code>" + esc(l.code) + "</code><span>" + esc(l.description) + "</span></th>" +
        "<td class=\"num\">" + esc(M.formatQuantity(l.qty)) + "</td><td class=\"num\">" + esc(M.formatMoney(l.unitCents)) + "</td></tr>";
    }).join("");
    return "<div class=\"doc-head\"><h4 id=\"po-h\">Purchase order <code>" + esc(order.number) + "</code></h4>" +
      "<p>" + esc(order.supplier) + "</p></div>" +
      "<table><caption class=\"visually-hidden\">Lines on purchase order " + esc(order.number) + "</caption>" +
      "<thead><tr><th scope=\"col\">Item</th><th scope=\"col\" class=\"num\">Qty</th><th scope=\"col\" class=\"num\">Unit price</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>";
  }
  function invoiceHTML(inv, M) {
    var rows = inv.lines.map(function (l, i) {
      return "<tr data-code=\"" + esc(l.code) + "\" data-i=\"" + i + "\"><th scope=\"row\"><code>" + esc(l.code) + "</code><span>" + esc(l.description) + "</span></th>" +
        "<td class=\"num\">" + esc(M.formatQuantity(l.qty)) + "</td><td class=\"num\">" + esc(M.formatMoney(l.unitCents)) + "</td>" +
        "<td class=\"num\">" + esc(M.formatMoney(M.lineTotalCents(l))) + "</td><td class=\"mark\"></td></tr>";
    }).join("");
    return "<div class=\"doc-head\"><h4 id=\"inv-h\">Tax invoice <code>" + esc(inv.number) + "</code></h4>" +
      "<p>" + esc(inv.supplier) + "<br>GST number <code>" + esc(inv.gstNumber) + "</code><br>" + esc(inv.issued) + ", for order <code>" + esc(inv.orderNumber) + "</code></p></div>" +
      "<table><caption class=\"visually-hidden\">Lines on invoice " + esc(inv.number) + "</caption>" +
      "<thead><tr><th scope=\"col\">Item</th><th scope=\"col\" class=\"num\">Qty</th><th scope=\"col\" class=\"num\">Unit price</th><th scope=\"col\" class=\"num\">Amount</th><th scope=\"col\"><span class=\"visually-hidden\">Result</span></th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "<tfoot><tr><th scope=\"row\" colspan=\"3\">Subtotal</th><td class=\"num\">" + esc(M.formatMoney(inv.subtotalCents)) + "</td><td></td></tr>" +
      "<tr><th scope=\"row\" colspan=\"3\">GST</th><td class=\"num\">" + esc(M.formatMoney(inv.gstCents)) + "</td><td></td></tr>" +
      "<tr class=\"grand\"><th scope=\"row\" colspan=\"3\">Total</th><td class=\"num\">" + esc(M.formatMoney(inv.totalCents)) + "</td><td></td></tr></tfoot></table>";
  }
  function billsHTML(S, current) {
    return S.map(function (s, i) {
      return "<li><button type=\"button\" class=\"bill\" data-bill=\"" + i + "\" aria-pressed=\"" + (i === current) + "\">" +
        "<code>" + esc(s.invoice.number) + "</code><span>" + esc(s.invoice.supplier) + "</span></button></li>";
    }).join("");
  }

  // ---------- the page ----------
  function start(win) {
    var doc = win.document;
    var M = win.InvoiceChecker, S = win.InvoiceSamples;
    var desk = doc.querySelector("[data-desk]");
    if (!M || !S || !desk) return;
    var reduce = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var poEl = desk.querySelector("[data-po]");
    var invEl = desk.querySelector("[data-inv]");
    var checkBtn = doc.querySelector("[data-check]");
    var resetBtn = doc.querySelector("[data-reset]");
    var resultEl = doc.querySelector("[data-result]");
    var billsEl = doc.querySelector("[data-bills]");
    var current = 1;           // start on the bill with a price and a quantity difference (FIRST below; built into the page)
    var timers = [];
    var placed = false;

    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function renderOrder(order) { poEl.innerHTML = orderHTML(order, M); }
    function renderInvoice(inv) { invEl.innerHTML = invoiceHTML(inv, M); }
    function renderBills() { billsEl.innerHTML = billsHTML(S, current); }

    function load(i) {
      clearTimers();
      current = i;
      placed = false;
      var s = S[i];
      renderOrder(s.order);
      renderInvoice(s.invoice);
      renderBills();
      invEl.classList.remove("is-placed", "is-dragging");
      invEl.style.removeProperty("--dx");
      invEl.style.removeProperty("--dy");
      resultEl.hidden = true;
      resultEl.innerHTML = "";
      checkBtn.disabled = false;
      resetBtn.hidden = true;
    }

    function check() {
      if (placed) return;
      placed = true;
      clearTimers();
      var s = S[current];
      var r = M.check(s.order, s.invoice);
      invEl.classList.remove("is-dragging");
      invEl.style.removeProperty("--dx");
      invEl.style.removeProperty("--dy");
      invEl.classList.add("is-placed");
      checkBtn.disabled = true;
      resetBtn.hidden = false;

      // Line by line: each line gets its mark in turn, the way the checker works through a bill.
      var rows = [].slice.call(invEl.querySelectorAll("tbody tr"));
      var step = reduce ? 0 : 260, at = reduce ? 0 : 450;
      rows.forEach(function (tr) {
        var status = r.lineStatus[String(tr.getAttribute("data-code")).toUpperCase()] || r.lineStatus[tr.getAttribute("data-code")] || "ok";
        var when = at;
        at += step;
        timers.push(setTimeout(function () {
          tr.classList.add("is-" + status);
          tr.querySelector(".mark").innerHTML = status === "check" ? "Check" : status === "note" ? "Note" : "<span aria-hidden=\"true\">&#10003;</span><span class=\"visually-hidden\">Matches</span>";
        }, when));
      });
      timers.push(setTimeout(function () {
        var lines = verdictText(r, M.formatMoney);
        var findings = r.findings.map(function (f) {
          return "<li class=\"is-" + esc(f.severity) + "\"><strong>" + esc(f.title) + "</strong><span>" + esc(f.detail) + "</span></li>";
        }).join("");
        resultEl.innerHTML = "<h4 id=\"result-h\">" + esc(lines[0]) + "</h4>" + (lines[1] ? "<p class=\"raise\">" + esc(lines[1]) + "</p>" : "") +
          (findings ? "<ul class=\"findings\">" + findings + "</ul>" : "");
        resultEl.hidden = false;
      }, at + (reduce ? 0 : 150)));
    }

    // ---------- drag the invoice onto the order ----------
    var drag = null;
    function overlaps(a, b) {
      var x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      var y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return (x * y) / (a.width * a.height);
    }
    // On the order: a fifth of the invoice covers it, or the pointer itself is over it (easier on a phone).
    function onOrder(e) {
      var po = poEl.getBoundingClientRect();
      var over = e.clientX >= po.left && e.clientX <= po.right && e.clientY >= po.top && e.clientY <= po.bottom;
      return over || overlaps(invEl.getBoundingClientRect(), po) > 0.2;
    }
    invEl.addEventListener("pointerdown", function (e) {
      if (placed || e.button !== 0 || e.target.closest("a, button")) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      invEl.setPointerCapture(e.pointerId);
      invEl.classList.add("is-dragging");
    });
    invEl.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      invEl.style.setProperty("--dx", (e.clientX - drag.x) + "px");
      invEl.style.setProperty("--dy", (e.clientY - drag.y) + "px");
      poEl.classList.toggle("is-target", onOrder(e));
    });
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var hit = onOrder(e);
      drag = null;
      poEl.classList.remove("is-target");
      if (hit) check();
      else {                                   // not on the order: it goes back to the tray
        invEl.classList.remove("is-dragging");
        invEl.style.removeProperty("--dx");
        invEl.style.removeProperty("--dy");
      }
    }
    invEl.addEventListener("pointerup", endDrag);
    invEl.addEventListener("pointercancel", endDrag);

    checkBtn.addEventListener("click", check);
    resetBtn.addEventListener("click", function () { load(current); checkBtn.focus(); });
    billsEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-bill]");
      if (b) load(Number(b.getAttribute("data-bill")));
    });

    doc.documentElement.classList.add("js");
    load(current);
  }

  return { start: start, verdictText: verdictText, orderHTML: orderHTML, invoiceHTML: invoiceHTML, billsHTML: billsHTML, FIRST: 1 };
});
