/*
  Small behaviours shared by both pages: the light and dark switch, the Copy email button,
  the SwimSorted recording, and the live SwimSorted view (only on the one address it is allowed on).
  No cookies, no tracking, no outside requests.
*/
(function () {
  "use strict";
  var root = document.documentElement;

  // ----- light and dark switch
  var toggle = document.querySelector("[data-theme-toggle]");
  function paintToggle() {
    if (!toggle) return;
    var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    toggle.textContent = next === "light" ? "Light theme" : "Dark theme";
    toggle.setAttribute("aria-label", "Switch to the " + next + " theme");
  }
  if (toggle) {
    paintToggle();
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* choice lasts for this page only */ }
      paintToggle();
    });
  }

  // ----- Copy email
  // Try the modern clipboard first. If the browser refuses it, fall back to the older way.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return copyTextOldWay(text); });
    }
    return copyTextOldWay(text);
  }
  function copyTextOldWay(text) {
    return new Promise(function (resolve, reject) {
      var box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(box);
      if (ok) resolve(); else reject(new Error("copy failed"));
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (button) {
    var label = button.textContent;
    var status = button.parentNode.querySelector("[data-copy-status]");
    var timer;
    button.addEventListener("click", function () {
      copyText(button.getAttribute("data-copy")).then(function () {
        button.textContent = "Copied";
        if (status) status.textContent = "Email address copied.";
      }, function () {
        button.textContent = "Select the address to copy it";
        if (status) status.textContent = "Copy did not work. Select the address to copy it.";
      }).then(function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          button.textContent = label;
          if (status) status.textContent = "";
        }, 2000);
      });
    });
  });

  // ----- SwimSorted: play the recording in place of the still
  var shot = document.querySelector("[data-swimsorted]");
  if (!shot) return;
  var frame = shot.querySelector(".frame");
  var playButton = shot.querySelector("[data-play]");

  function showVideo() {
    var video = document.createElement("video");
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.width = 1280;
    video.height = 800;
    video.poster = "assets/img/swimsorted-site.jpg";
    video.setAttribute("aria-label", "Recording of the SwimSorted website being scrolled, sample data only");
    [["assets/media/swimsorted-site.webm", "video/webm"], ["assets/media/swimsorted-site.mp4", "video/mp4"]].forEach(function (s) {
      var source = document.createElement("source");
      source.src = s[0];
      source.type = s[1];
      video.appendChild(source);
    });
    frame.textContent = "";
    frame.appendChild(video);
    var started = video.play();
    if (started && started.catch) started.catch(function () { /* the controls are there to press */ });
    video.focus();
  }
  if (playButton) playButton.addEventListener("click", function () { showVideo(); playButton.hidden = true; });

  // ----- SwimSorted: live view. Allowed only when this page is served from the address below.
  var LIVE_ORIGIN = "https://langkurst.github.io";
  var LIVE_PAGES = [["Welcome", "welcome"], ["Features", "features"], ["Pricing", "pricing"], ["About", "about"], ["Story", "story"]];
  var liveButton = shot.querySelector("[data-live]");
  if (liveButton && window.location.origin === LIVE_ORIGIN) {
    liveButton.hidden = false;
    liveButton.addEventListener("click", function () {
      var iframe = document.createElement("iframe");
      iframe.title = "The live SwimSorted website";
      iframe.loading = "lazy";
      iframe.referrerPolicy = "no-referrer";
      iframe.src = "https://swimsorted.co.nz/" + LIVE_PAGES[0][1];
      frame.textContent = "";
      frame.appendChild(iframe);

      var pages = document.createElement("div");
      pages.className = "shot-actions";
      pages.setAttribute("role", "group");
      pages.setAttribute("aria-label", "SwimSorted page to show");
      LIVE_PAGES.forEach(function (page, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-quiet";
        b.textContent = page[0];
        b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
        b.addEventListener("click", function () {
          iframe.src = "https://swimsorted.co.nz/" + page[1];
          Array.prototype.forEach.call(pages.children, function (other) { other.setAttribute("aria-pressed", String(other === b)); });
        });
        pages.appendChild(b);
      });
      frame.parentNode.insertBefore(pages, frame.nextSibling);
      liveButton.hidden = true;
      if (playButton) playButton.hidden = true;
    });
  }
})();

/*
  Gentle reveal as sections arrive, and the menu marks the section in view.
  The reveal only switches on once this script runs, so text is never hidden if it fails,
  and it stays off for anyone who prefers reduced motion.
*/
(function () {
  "use strict";
  var items = document.querySelectorAll("[data-reveal]");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (items.length && "IntersectionObserver" in window && !reduce) {
    document.documentElement.classList.add("reveal-ready");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });
    items.forEach(function (el) { io.observe(el); });
    // Anything already on screen at load shows at once.
    items.forEach(function (el) { if (el.getBoundingClientRect().top < innerHeight) el.classList.add("is-in"); });
  }

  var links = document.querySelectorAll('.site-nav a[href^="#"]');
  if (links.length && "IntersectionObserver" in window) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var a = byId[e.target.id];
        if (a && e.isIntersecting) { links.forEach(function (l) { l.classList.remove("is-active"); }); a.classList.add("is-active"); }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
  }
})();
