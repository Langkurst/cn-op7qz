/*
  The privacy checker page: reads the text, shows each finding highlighted with its reason,
  and builds the cleaned copy. Nothing leaves the browser, and nothing is stored.
*/
(function () {
  "use strict";
  var P = window.PrivacyChecker;
  if (!P) return;

  var input = document.getElementById("input");
  var viewMarked = document.getElementById("view-marked");
  var viewClean = document.getElementById("view-clean");
  var summary = document.getElementById("summary");
  var count = document.getElementById("count");
  var copyBtn = document.getElementById("copy");
  var foundList = document.getElementById("found");
  var kindsBox = document.getElementById("kinds");
  var tabs = [document.getElementById("tab-marked"), document.getElementById("tab-clean")];

  var EXAMPLE = [
    "Hi team, can you update Sam's file before Friday?",
    "",
    "IRD 49-098-576. NHI ZAA0067. Refund to 01-0902-0068389-00.",
    "Mobile 021 123 4567, or the office on (09) 123 4567.",
    "Email sam.example@example.co.nz. DOB: 12/03/1985.",
    "Driver licence AB123456. Card on file 4111 1111 1111 1111.",
    "",
    "Order 4500012904 for 300 units arrived on 10/11/2026. Thanks!"
  ].join("\n");

  var enabled = {};
  Object.keys(P.TYPES).forEach(function (k) { enabled[k] = true; });

  // One checkbox per kind of detail, so a visitor can choose what to remove.
  Object.keys(P.TYPES).forEach(function (k) {
    var id = "kind-" + k;
    var label = document.createElement("label");
    label.className = "kind";
    label.setAttribute("for", id);
    var box = document.createElement("input");
    box.type = "checkbox";
    box.id = id;
    box.checked = true;
    box.addEventListener("change", function () { enabled[k] = box.checked; render(); });
    var dot = document.createElement("span");
    dot.className = "kind-dot t-" + k;
    dot.setAttribute("aria-hidden", "true");
    label.appendChild(box);
    label.appendChild(dot);
    label.appendChild(document.createTextNode(P.TYPES[k].label));
    kindsBox.appendChild(label);
  });

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function render() {
    var text = input.value;
    count.textContent = plural(text.length, "character", "characters");
    var types = Object.keys(enabled).filter(function (k) { return enabled[k]; });
    var found = P.scan(text, { types: types });

    // Highlighted view, built from text nodes so pasted text is never treated as HTML.
    viewMarked.textContent = "";
    var at = 0;
    found.forEach(function (f, i) {
      viewMarked.appendChild(document.createTextNode(text.slice(at, f.start)));
      var mark = document.createElement("mark");
      mark.className = "t-" + f.type;
      mark.id = "f-" + i;
      mark.title = f.label + ": " + f.why;
      mark.textContent = text.slice(f.start, f.end);
      viewMarked.appendChild(mark);
      at = f.end;
    });
    viewMarked.appendChild(document.createTextNode(text.slice(at)));
    if (!text) viewMarked.innerHTML = '<p class="empty">The highlighted text appears here.</p>';

    var cleaned = P.clean(text, found);
    viewClean.textContent = text ? cleaned : "";
    if (!text) viewClean.innerHTML = '<p class="empty">The cleaned copy appears here.</p>';

    // Findings list
    foundList.textContent = "";
    found.forEach(function (f, i) {
      var li = document.createElement("li");
      var tag = document.createElement("span");
      tag.className = "found-tag t-" + f.type;
      tag.textContent = f.label;
      var value = document.createElement("code");
      value.textContent = f.text;
      var why = document.createElement("span");
      why.className = "found-why";
      why.textContent = f.why.charAt(0).toUpperCase() + f.why.slice(1) + ".";
      li.appendChild(tag);
      li.appendChild(value);
      li.appendChild(why);
      foundList.appendChild(li);
    });

    if (!text) summary.textContent = "Paste some text to start.";
    else if (!found.length) summary.textContent = "Nothing found. Still read it through before you paste it.";
    else summary.textContent = plural(found.length, "detail", "details") + " found and replaced in the cleaned copy.";
    copyBtn.disabled = !text;
    copyBtn.dataset.text = cleaned;
  }

  var timer;
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(render, 80); });
  document.getElementById("example").addEventListener("click", function () { input.value = EXAMPLE; render(); input.focus(); });
  document.getElementById("clear").addEventListener("click", function () { input.value = ""; render(); input.focus(); });

  // Tabs: click, or arrow keys between them.
  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
  }
  tabs.forEach(function (t, i) {
    t.tabIndex = i === 0 ? 0 : -1;
    t.addEventListener("click", function () { select(t); });
    t.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        var next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        select(next); next.focus(); e.preventDefault();
      }
    });
  });

  copyBtn.addEventListener("click", function () {
    var text = copyBtn.dataset.text || "";
    var done = function (ok) {
      copyBtn.textContent = ok ? "Copied" : "Select the cleaned copy to copy it";
      setTimeout(function () { copyBtn.textContent = "Copy cleaned text"; }, 2000);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  });

  input.value = EXAMPLE;
  render();
})();
