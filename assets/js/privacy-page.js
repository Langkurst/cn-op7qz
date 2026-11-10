/*
  The privacy checker page. One document with highlights drawn in place, a findings panel with a
  switch per item, a redacted copy with numbered placeholders, and a step that puts the real details
  back into an AI's answer. Everything stays in this tab: nothing is sent and nothing is stored.
*/
(function () {
  "use strict";
  var P = window.PrivacyChecker;
  if (!P) return;
  var $ = function (id) { return document.getElementById(id); };

  var input = $("input"), marks = $("marks"), redactedView = $("redacted");
  var reply = $("reply"), restoredView = $("restored");
  var groupsBox = $("groups"), countEl = $("count"), statusEl = $("status"), charsEl = $("chars");
  var copyRedacted = $("copy-redacted"), copyRestored = $("copy-restored");
  var tabs = [$("tab-check"), $("tab-copy"), $("tab-back")];

  var EXAMPLE = [
    "Hi Mere,",
    "",
    "Can you sort out Sam's refund before Friday? His IRD number is 49-098-576 and the refund goes to 01-0902-0068389-00.",
    "",
    "He's on 021 123 4567, or email sam.example@example.co.nz. DOB 12/03/1985. For the ACC claim his NHI is ZAA0067, and his driver licence is AB123456.",
    "",
    "Order 4500012904 for 300 units arrived on 10/11/2026 and is not part of this.",
    "",
    "Thanks"
  ].join("\n");

  var kept = {};        // value keys the visitor switched off (left in the text)
  var current = { items: [], map: {}, text: "" };

  function keyOf(f) { return f.type + ":" + f.text.replace(/[\s\-()]/g, "").toLowerCase(); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function autosize(t, min) { t.style.height = "auto"; t.style.height = Math.max(t.scrollHeight, min || 340) + "px"; }

  function render() {
    var text = input.value;
    var all = P.scan(text);
    var active = all.filter(function (f) { return !kept[keyOf(f)]; });
    var r = P.redact(text, active);
    current = { items: r.items, map: r.map, text: r.text };
    var tokenByKey = {};
    r.items.forEach(function (f) { tokenByKey[keyOf(f)] = f.token; });

    // Highlights drawn behind the text area, in the same place as the words.
    marks.textContent = "";
    var at = 0;
    all.forEach(function (f) {
      marks.appendChild(document.createTextNode(text.slice(at, f.start)));
      var m = el("mark", "hl g-" + P.TYPES[f.type].group + (kept[keyOf(f)] ? " is-kept" : ""), text.slice(f.start, f.end));
      marks.appendChild(m);
      at = f.end;
    });
    marks.appendChild(document.createTextNode(text.slice(at) + "\n"));
    autosize(input);

    // Redacted copy with placeholders shown as chips.
    redactedView.textContent = "";
    if (!text) redactedView.appendChild(el("p", "doc-empty", "Paste text on the Check step first."));
    else {
      var parts = r.text.split(/(\[[A-Z_]+_\d+\])/g);
      parts.forEach(function (part) {
        if (/^\[[A-Z_]+_\d+\]$/.test(part)) {
          var type = Object.keys(P.TYPES).filter(function (k) { return part.indexOf("[" + P.TYPES[k].token + "_") === 0; })[0];
          redactedView.appendChild(el("span", "tok g-" + (type ? P.TYPES[type].group : "id"), part.slice(1, -1)));
        } else redactedView.appendChild(document.createTextNode(part));
      });
    }

    // Findings panel, grouped.
    groupsBox.textContent = "";
    var seen = {};
    var unique = all.filter(function (f) { var k = keyOf(f); if (seen[k]) return false; seen[k] = true; return true; });
    Object.keys(P.GROUPS).forEach(function (g) {
      var list = unique.filter(function (f) { return P.TYPES[f.type].group === g; });
      if (!list.length) return;
      var section = el("section", "grp");
      var head = el("h3", "grp-head");
      head.appendChild(el("span", "grp-dot g-" + g));
      head.appendChild(document.createTextNode(P.GROUPS[g]));
      head.appendChild(el("span", "grp-n", String(list.length)));
      section.appendChild(head);
      var ul = el("ul", "hits");
      list.forEach(function (f) {
        var k = keyOf(f), on = !kept[k];
        var li = el("li", "hit" + (on ? "" : " is-kept"));
        var body = el("div", "hit-body");
        var top = el("div", "hit-top");
        top.appendChild(el("span", "hit-label", P.TYPES[f.type].label));
        if (on && tokenByKey[k]) top.appendChild(el("span", "tok tok-sm g-" + g, tokenByKey[k].slice(1, -1)));
        if (!on) top.appendChild(el("span", "kept-pill", "Left in"));
        body.appendChild(top);
        body.appendChild(el("code", "hit-value", f.text));
        body.appendChild(el("span", "hit-why", f.why.charAt(0).toUpperCase() + f.why.slice(1) + "."));
        var sw = el("button", "switch");
        sw.type = "button";
        sw.setAttribute("role", "switch");
        sw.setAttribute("aria-checked", String(on));
        sw.setAttribute("aria-label", (on ? "Remove " : "Leave in ") + P.TYPES[f.type].label + " " + f.text);
        sw.addEventListener("click", function () {
          if (kept[k]) delete kept[k]; else kept[k] = true;
          render();
          var again = groupsBox.querySelector('[data-key="' + CSS.escape(k) + '"]');
          if (again) again.focus();
        });
        sw.dataset.key = k;
        li.appendChild(body);
        li.appendChild(sw);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      groupsBox.appendChild(section);
    });
    if (!unique.length) groupsBox.appendChild(el("p", "side-empty", text ? "Nothing found. Still read it through before you paste it." : "Findings appear here as you type."));

    var removed = Object.keys(r.map).length;
    countEl.textContent = String(unique.length);
    charsEl.textContent = plural(text.length, "character", "characters");
    statusEl.textContent = !text ? "Nothing yet" : removed ? plural(removed, "detail", "details") + " removed" : "Nothing to remove";
    statusEl.className = "status-pill" + (removed ? " is-done" : "");
    copyRedacted.disabled = !text;
    renderRestore();
  }

  function renderRestore() {
    var res = P.restore(reply.value, current.map);
    restoredView.textContent = "";
    if (!reply.value) { restoredView.appendChild(el("p", "doc-empty", "The answer with the real details appears here.")); copyRestored.disabled = true; return; }
    var parts = reply.value.split(/(\[\s*[A-Za-z_]+_\d+\s*\])/g);
    parts.forEach(function (part) {
      var m = part.match(/^\[\s*([A-Za-z_]+_\d+)\s*\]$/);
      if (m && current.map["[" + m[1].toUpperCase() + "]"]) restoredView.appendChild(el("mark", "back", current.map["[" + m[1].toUpperCase() + "]"]));
      else restoredView.appendChild(document.createTextNode(part));
    });
    copyRestored.disabled = false;
    copyRestored.dataset.text = res.text;
    if (res.unknown.length) {
      var note = el("p", "doc-note", "Not recognised, left as written: " + res.unknown.join(", ") + ".");
      restoredView.appendChild(note);
    }
  }

  // Tabs, with arrow keys.
  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
  }
  tabs.forEach(function (t, i) {
    t.tabIndex = i === 0 ? 0 : -1;
    t.addEventListener("click", function () { select(t); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      select(next); next.focus(); e.preventDefault();
    });
  });

  function copy(text, button, label) {
    var span = button.querySelector("span") || button;
    var done = function (ok) { span.textContent = ok ? "Copied" : "Select the text to copy it"; setTimeout(function () { span.textContent = label; }, 1800); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }
  copyRedacted.addEventListener("click", function () { copy(current.text, copyRedacted, "Copy redacted text"); });
  copyRestored.addEventListener("click", function () { copy(copyRestored.dataset.text || "", copyRestored, "Copy"); });

  var timer;
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(render, 60); });
  reply.addEventListener("input", function () { autosize(reply, 120); renderRestore(); });
  $("example").addEventListener("click", function () { kept = {}; input.value = EXAMPLE; render(); input.focus(); });
  $("clear").addEventListener("click", function () { kept = {}; input.value = ""; reply.value = ""; render(); input.focus(); });
  window.addEventListener("resize", function () { autosize(input); });

  input.value = EXAMPLE;
  render();
  // A sample AI answer, so step 3 shows what it does straight away.
  reply.value = "Thanks. I have drafted the refund note for [IRD_1] to account [BANK_ACCOUNT_1], and I will confirm by email to [EMAIL_1].";
  autosize(reply, 120);
  renderRestore();
})();
