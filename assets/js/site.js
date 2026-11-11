/*
  Small behaviours shared by both pages: the light and dark switch, the Copy email button,
  the SwimSorted recording and the KeaClip screens (each plays only when its button is pressed),
  and the live SwimSorted view (only on the one address it is allowed on).
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

  // ----- Clips: the SwimSorted recording and the KeaClip screens. Each one replaces its still only
  // when its button is pressed; nothing plays on load. Once started it repeats, with its controls showing.
  var CLIPS = {
    swimsorted: {
      file: "assets/media/swimsorted-site",
      poster: "assets/img/swimsorted-site.jpg",
      width: 1200,
      height: 720,
      label: "Recording of the How a visit works demo on swimsorted.co.nz, with sample data, played a little slower than normal. " +
        "A phone goes through a visit: the Pools list, entering the water test readings, the doses to add, " +
        "saving the visit and the report the pool owner gets, then the office view. The list of five steps " +
        "beside it marks each step as it plays. It runs for 35 seconds and then repeats."
    },
    keaclip: {
      file: "assets/media/keaclip-screens",
      poster: "assets/img/keaclip-download.jpg",
      width: 1180,
      height: 780,
      label: "Four screenshots from KeaClip version 0.4.0, each shown for about 4 seconds with a short fade " +
        "between them, then repeated. They are still screens from the app, not a recording: Download in the " +
        "light theme, Queue in the dark theme, Editor in the dark theme and Library in the light theme."
    }
  };
  function playClip(figure, clip) {
    var frame = figure.querySelector(".frame");
    var video = document.createElement("video");
    video.controls = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.width = clip.width;
    video.height = clip.height;
    video.poster = clip.poster;
    video.setAttribute("aria-label", clip.label);
    [["webm", "video/webm"], ["mp4", "video/mp4"]].forEach(function (s) {
      var source = document.createElement("source");
      source.src = clip.file + "." + s[0];
      source.type = s[1];
      video.appendChild(source);
    });
    frame.textContent = "";
    frame.appendChild(video);
    var started = video.play();
    if (started && started.catch) started.catch(function () { /* the controls are there to press */ });
    video.focus();
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-clip]"), function (figure) {
    var clip = CLIPS[figure.getAttribute("data-clip")];
    var button = figure.querySelector("[data-play]");
    if (!clip || !button) return;
    button.addEventListener("click", function () {
      playClip(figure, clip);
      button.hidden = true;
    });
  });

  // ----- SwimSorted: live view. Allowed only when this page is served from the address below.
  var shot = document.querySelector("[data-swimsorted]");
  if (!shot) return;
  var frame = shot.querySelector(".frame");
  var playButton = shot.querySelector("[data-play]");
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
