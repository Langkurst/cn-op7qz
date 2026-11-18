/*
  The desk: drop your own purchase orders, order confirmations and invoices, then drag one onto
  another and they're checked against each other. Or drop a file straight onto a document already on
  the desk. Without a mouse: select one document (tap, Enter or Space), then the one to check it
  against.

  Each file is read on this device (files.js, then reader.js), paired (pair.js) and checked with the
  same rules as the typed-in bills (matcher.js). The result joins Bills to pay and opens. Nothing is
  sent or stored.

  Motion only answers what the person does: a picked-up document follows the pointer, the one under
  it lights up, and on letting go it settles onto it. With reduced motion there's no movement.
*/
(function () {
  "use strict";
  var R = window.DocReader, P = window.DocPair, F = window.DocFiles, page = window.InvoicePage;
  var drop = document.getElementById("desk-drop"), list = document.getElementById("desk-cards");
  var input = document.getElementById("desk-file"), live = document.getElementById("desk-live"), hint = document.getElementById("desk-hint");
  if (!R || !P || !F || !drop || !list || !input) return;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var docs = [];          // { id, file, name, status: "reading"|"ready"|"failed", doc, error, progress, el }
  var picked = null;      // the id selected without a mouse
  var nextId = 1;

  var KIND = { order: "Purchase order", confirmation: "Order confirmation", invoice: "Invoice", delivery: "Delivery note", unknown: "Document" };
  function say(text) { live.textContent = ""; setTimeout(function () { live.textContent = text; }, 30); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "i"); svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "assets/img/icons.svg#" + name);
    svg.appendChild(use);
    return svg;
  }
  function byId(id) { return docs.filter(function (d) { return d.id === id; })[0]; }
  function money(d, cents) {
    var f = P.moneyFormatter(d.doc.currency);
    return f ? f(cents) : window.InvoiceChecker.formatMoney(cents);
  }

  // ---------- reading ----------
  function add(files, onto) {
    var added = [];
    Array.prototype.forEach.call(files, function (file) {
      var d = { id: "d" + nextId++, file: file, name: file.name || "Document", status: "reading", progress: 0, note: "Opening" };
      docs.push(d);
      added.push(d);
      render();
      F.extract(file, function (status, p) { d.note = status; d.progress = p || 0; paint(d); }).then(function (got) {
        d.doc = got.text != null ? R.fromText(got.text, { csv: got.csv, name: d.name }) : R.read(got.items, { name: d.name });
        d.method = got.method;
        d.status = d.doc.lines.length ? "ready" : "failed";
        if (d.status === "failed") d.error = d.doc.warnings[0] || "Couldn't find any lines in it.";
        paint(d);
        say(d.name + ": " + summary(d));
        afterRead(d, onto);
      }).catch(function (err) {
        d.status = "failed";
        d.error = (err && err.message) || "This file couldn't be read.";
        paint(d);
        say(d.name + ": " + d.error);
      });
    });
    return added;
  }
  // Dropped straight onto a document, or two dropped together: check as soon as both are read.
  function afterRead(d, onto) {
    var other = onto && byId(onto);
    if (other) {
      if (other.status === "ready" && d.status === "ready") check(d, other);
      else if (other.status === "reading") other.waiting = d.id;
      return;
    }
    if (d.waiting) {
      var w = byId(d.waiting);
      d.waiting = null;
      if (w && w.status === "ready" && d.status === "ready") check(w, d);
    }
    if (d.pairWith) {
      var p = byId(d.pairWith);
      if (p && p.status === "ready" && d.status === "ready") { d.pairWith = null; p.pairWith = null; check(d, p); }
    }
  }

  function summary(d) {
    if (d.status === "reading") return d.note || "Reading";
    if (d.status === "failed") return d.error;
    var doc = d.doc, bits = [KIND[doc.kind] || "Document"];
    if (doc.number) bits[0] += " " + doc.number;
    if (doc.supplier) bits.push(doc.supplier);
    bits.push(doc.lines.length + (doc.lines.length === 1 ? " line" : " lines"));
    if (Number.isFinite(doc.totalCents)) bits.push(money(d, doc.totalCents) + (doc.currency && doc.currency !== "NZD" ? " " + doc.currency : ""));
    return bits.join(", ");
  }

  // ---------- drawing ----------
  function render() {
    list.textContent = "";
    docs.forEach(function (d) { list.appendChild(card(d)); paint(d); });
    hint.hidden = docs.length > 0;
    drop.classList.toggle("has-docs", docs.length > 0);
  }
  function card(d) {
    var li = el("li", "doc-card");
    li.dataset.id = d.id;
    var b = el("button", "doc-body");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.appendChild(icon("file-text"));
    var txt = el("span", "doc-text");
    txt.appendChild(el("span", "doc-kind"));
    txt.appendChild(el("span", "doc-name", d.name));
    txt.appendChild(el("span", "doc-sum"));
    b.appendChild(txt);
    var bar = el("span", "doc-bar"); bar.appendChild(el("span", "doc-bar-fill"));
    b.appendChild(bar);
    li.appendChild(b);
    var x = el("button", "icon-btn doc-x");
    x.type = "button";
    x.setAttribute("aria-label", "Take " + d.name + " off the desk");
    x.appendChild(icon("x"));
    x.addEventListener("click", function () { remove(d.id); });
    li.appendChild(x);
    d.el = li;
    b.addEventListener("click", function (e) { if (dragging && dragging.moved) return; pick(d.id); });
    b.addEventListener("pointerdown", function (e) { startDrag(e, d); });
    li.addEventListener("dragover", function (e) { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); li.classList.add("is-target"); } });
    li.addEventListener("dragleave", function () { li.classList.remove("is-target"); });
    li.addEventListener("drop", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      li.classList.remove("is-target");
      add(e.dataTransfer.files, d.id);
    });
    return li;
  }
  function paint(d) {
    if (!d.el) return;
    var li = d.el;
    li.className = "doc-card is-" + d.status + (picked === d.id ? " is-picked" : "");
    li.querySelector(".doc-kind").textContent = d.status === "ready" ? (KIND[d.doc.kind] || "Document") + (d.doc.number ? " " + d.doc.number : "") : d.status === "failed" ? "Couldn't read this" : "Reading";
    li.querySelector(".doc-sum").textContent = d.status === "ready" ? summary(d).split(", ").slice(1).join(", ") : summary(d);
    li.querySelector(".doc-bar-fill").style.transform = "scaleX(" + (d.status === "reading" ? Math.max(0.04, d.progress || 0) : 1) + ")";
    var b = li.querySelector(".doc-body");
    b.setAttribute("aria-pressed", String(picked === d.id));
    b.setAttribute("aria-label", d.name + ". " + summary(d) + (d.status === "ready" ? ". Select, then select another document to check them against each other." : ""));
  }
  function remove(id) {
    docs = docs.filter(function (d) { return d.id !== id; });
    if (picked === id) picked = null;
    render();
  }

  // ---------- pairing without a mouse ----------
  function pick(id) {
    var d = byId(id);
    if (!d || d.status !== "ready") return;
    if (!picked) { picked = id; docs.forEach(paint); say(d.name + " selected. Now select the document to check it against."); return; }
    if (picked === id) { picked = null; docs.forEach(paint); say("Nothing selected."); return; }
    var first = byId(picked);
    picked = null;
    docs.forEach(paint);
    check(first, d);
  }

  // ---------- dragging one document onto another (mouse, pen or finger) ----------
  var dragging = null;
  function startDrag(e, d) {
    if (d.status !== "ready" || e.button > 0) return;
    var li = d.el, rect = li.getBoundingClientRect();
    dragging = { d: d, x0: e.clientX, y0: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false, over: null, pointer: e.pointerId };
    li.querySelector(".doc-body").setPointerCapture(e.pointerId);
  }
  function overCard(x, y, self) {
    var hit = null;
    docs.forEach(function (o) {
      if (o === self || !o.el || o.status !== "ready") return;
      var r = o.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = o;
    });
    return hit;
  }
  document.addEventListener("pointermove", function (e) {
    if (!dragging || e.pointerId !== dragging.pointer) return;
    var dx = e.clientX - dragging.x0, dy = e.clientY - dragging.y0;
    if (!dragging.moved && Math.hypot(dx, dy) < 6) return;
    if (!dragging.moved) { dragging.moved = true; dragging.d.el.classList.add("is-lifted"); drop.classList.add("is-dragging"); }
    if (!reduce) dragging.d.el.style.transform = "translate(" + dx + "px," + dy + "px) rotate(-1.5deg)";
    var over = overCard(e.clientX, e.clientY, dragging.d);
    if (over !== dragging.over) {
      if (dragging.over) dragging.over.el.classList.remove("is-target");
      dragging.over = over;
      if (over) over.el.classList.add("is-target");
    }
  });
  function endDrag(e, cancelled) {
    if (!dragging || e.pointerId !== dragging.pointer) return;
    var g = dragging;
    drop.classList.remove("is-dragging");
    if (!g.moved) { dragging = null; return; }
    var li = g.d.el;
    li.classList.remove("is-lifted");
    if (g.over && !cancelled) {
      g.over.el.classList.remove("is-target");
      // Settle onto the document underneath, then check.
      var to = g.over.el.getBoundingClientRect(), from = li.getBoundingClientRect();
      var base = li.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      var bx = base ? +base[1] : 0, by = base ? +base[2] : 0;
      if (!reduce) {
        li.classList.add("is-settling");
        li.style.transform = "translate(" + (bx + to.left - from.left + 10) + "px," + (by + to.top - from.top + 8) + "px) rotate(0deg)";
      }
      var target = g.over;
      setTimeout(function () { li.classList.remove("is-settling"); li.style.transform = ""; check(g.d, target, true); }, reduce ? 0 : 140);
    } else {
      li.style.transform = "";
    }
    setTimeout(function () { dragging = null; }, 0);
  }
  document.addEventListener("pointerup", function (e) { endDrag(e, false); });
  document.addEventListener("pointercancel", function (e) { endDrag(e, true); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && picked) { picked = null; docs.forEach(paint); say("Nothing selected."); }
  });

  // ---------- files from outside the page ----------
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
  drop.addEventListener("dragover", function (e) { if (hasFiles(e)) { e.preventDefault(); drop.classList.add("is-over"); } });
  drop.addEventListener("dragleave", function (e) { if (!drop.contains(e.relatedTarget)) drop.classList.remove("is-over"); });
  drop.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    drop.classList.remove("is-over");
    var added = add(e.dataTransfer.files);
    // Two dropped together: check them against each other as soon as both are read.
    if (added.length === 2) { added[0].pairWith = added[1].id; added[1].pairWith = added[0].id; }
  });
  // A file dropped anywhere else on the page is not opened by the browser in place of the page.
  window.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", function (e) { if (hasFiles(e) && !drop.contains(e.target)) e.preventDefault(); });
  input.addEventListener("change", function () {
    var added = add(input.files);
    if (added.length === 2) { added[0].pairWith = added[1].id; added[1].pairWith = added[0].id; }
    input.value = "";
  });

  // ---------- the check ----------
  function check(moved, onto) {
    var made = build(moved, onto);
    var orderSide = made.orderSide, billSide = made.billSide;
    page.addBill({
      order: made.pr.order, invoice: made.pr.invoice, options: made.pr.options, notes: made.pr.notes, warnings: made.warnings, title: made.title,
      source: billSide.name + " against " + orderSide.name,
      currency: made.pr.currency,
      // Different currencies: the result offers an exchange rate box, and this runs the check again with it.
      rerun: function (rate) { var again = build(moved, onto, rate); return { order: again.pr.order, invoice: again.pr.invoice, options: again.pr.options, notes: again.pr.notes, warnings: again.warnings, currency: again.pr.currency }; }
    });
    // Both leave the desk once they're a bill.
    docs = docs.filter(function (d) { return d !== moved && d !== onto; });
    render();
    say("Checked " + billSide.name + " against " + orderSide.name + ". The result is open below.");
  }

  function build(moved, onto, rate) {
    var pr = P.pair({ doc: moved.doc, name: moved.name }, { doc: onto.doc, name: onto.name, target: true }, { rate: rate > 0 ? rate : undefined });
    var orderSide = pr.roles.order.doc === moved.doc ? moved : onto;
    var billSide = orderSide === moved ? onto : moved;
    // What the reader couldn't find goes with the result.
    var warnings = pr.warnings.slice();
    [orderSide, billSide].forEach(function (d) {
      (d.doc.warnings || []).forEach(function (w) { warnings.push({ title: "From " + d.name, detail: w }); });
      if (d.method === "ocr" || d.method === "pdf-scan") pr.notes.push({ title: "Read from a photo", detail: d.name + " was read from an image. Check any figure that looks wrong on the invoice beside the result: you can change it there." });
      if (d.doc.lines.some(function (l) { return l.mismatch; })) warnings.push({ title: "A line doesn't add up", detail: "On " + d.name + ", a line's quantity times its price isn't its amount. It may have been misread, or the document has a mistake." });
    });
    var title = billSide.doc.kind === "confirmation" ? "Order confirmation" : billSide.doc.kind === "delivery" ? "Delivery note" : (pr.options.nzRules ? "Tax invoice" : "Invoice");
    return { pr: pr, orderSide: orderSide, billSide: billSide, warnings: warnings, title: title };
  }
})();
