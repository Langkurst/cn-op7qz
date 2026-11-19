/*
  Turns a dropped file into words with where they sit on the page, for reader.js.

  - PDF: its own text (pdf.js). A scanned PDF has none, so its pages are drawn and read like a photo.
  - Photo or scan (JPG, PNG, WebP, GIF, BMP): read on this device with Tesseract. English first;
    when the words look German, French or Spanish it reads again in that language.
  - CSV, TSV or text: read as rows and columns.

  Everything runs in the browser. The two libraries live in assets/vendor and only load when a file
  of their kind is dropped. Nothing is sent anywhere: the page's security policy blocks every
  connection, and the libraries' workers only fetch their own files from this site.
*/
(function (root) {
  "use strict";
  var here = (document.currentScript && document.currentScript.src) || location.href;
  var VENDOR = new URL("../vendor/", here).href;

  var pdfjsP = null, tessP = null, ocrWorker = null, ocrLang = null;

  function loadPdfjs() {
    if (!pdfjsP) {
      pdfjsP = import(VENDOR + "pdfjs/pdf.min.mjs").then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + "pdfjs/pdf.worker.min.mjs";
        return pdfjs;
      });
    }
    return pdfjsP;
  }
  function loadTesseract() {
    if (!tessP) {
      tessP = new Promise(function (resolve, reject) {
        if (root.Tesseract) return resolve(root.Tesseract);
        var s = document.createElement("script");
        s.src = VENDOR + "tesseract/tesseract.min.js";
        s.onload = function () { root.Tesseract ? resolve(root.Tesseract) : reject(new Error("Tesseract did not load")); };
        s.onerror = function () { reject(new Error("Tesseract did not load")); };
        document.head.appendChild(s);
      });
    }
    return tessP;
  }
  function getOcr(lang, onProgress) {
    if (ocrWorker && ocrLang === lang) return Promise.resolve(ocrWorker);
    return loadTesseract().then(function (T) {
      var old = ocrWorker;
      ocrWorker = null;
      return (old ? old.terminate() : Promise.resolve()).then(function () {
        return T.createWorker(lang, 1, {
          workerPath: VENDOR + "tesseract/worker.min.js",
          corePath: VENDOR + "tesseract/",
          langPath: VENDOR + "tesseract/lang",
          gzip: true,
          workerBlobURL: false,
          cacheMethod: "none",
          logger: function (m) { if (onProgress && m && typeof m.progress === "number") onProgress(m.status, m.progress); }
        });
      }).then(function (w) { ocrWorker = w; ocrLang = lang; return w; });
    });
  }

  function kindOf(file) {
    var n = (file.name || "").toLowerCase(), t = (file.type || "").toLowerCase();
    if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
    if (/^image\/(jpeg|png|webp|gif|bmp)$/.test(t) || /\.(jpe?g|png|webp|gif|bmp)$/.test(n)) return "image";
    if (/\.(heic|heif)$/.test(n) || /heic|heif/.test(t)) return "heic";
    if (/\.(csv)$/.test(n) || t === "text/csv") return "csv";
    if (/\.(tsv|txt|text)$/.test(n) || /^text\//.test(t)) return "text";
    if (/\.(xlsx|xls|ods|docx|doc)$/.test(n)) return "office";
    return "other";
  }

  // ---------- PDF ----------
  function pdfItems(buf, onProgress) {
    return loadPdfjs().then(function (pdfjs) {
      return pdfjs.getDocument({
        data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
        cMapUrl: VENDOR + "pdfjs/cmaps/", cMapPacked: true
      }).promise.then(function (doc) {
        var items = [], pages = doc.numPages, chars = 0, p = 0;
        function next() {
          p++;
          if (p > pages) return Promise.resolve();
          if (onProgress) onProgress("Reading page " + p + " of " + pages, p / pages);
          return doc.getPage(p).then(function (page) {
            var vp = page.getViewport({ scale: 1 });
            return page.getTextContent().then(function (tc) {
              tc.items.forEach(function (it) {
                if (!it.str || !it.str.trim()) return;
                var tr = it.transform, h = Math.hypot(tr[2], tr[3]) || it.height || 10;
                chars += it.str.trim().length;
                items.push({ str: it.str, x: tr[4], y: vp.height - tr[5] - h * 0.8, w: it.width, h: h, page: p });
              });
            });
          }).then(next);
        }
        return next().then(function () {
          // Fewer than about 20 letters a page: a scan. Draw each page and read it as a photo.
          if (chars >= 20 * pages) return { items: items, method: "pdf-text", pages: pages };
          return scannedPdf(doc, onProgress);
        });
      });
    });
  }
  function scannedPdf(doc, onProgress) {
    var all = [], p = 0, pages = Math.min(doc.numPages, 10);
    function next() {
      p++;
      if (p > pages) return Promise.resolve({ items: all, method: "pdf-scan", pages: doc.numPages });
      return doc.getPage(p).then(function (page) {
        var vp = page.getViewport({ scale: 2 });
        var canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise.then(function () {
          return ocr(canvas, onProgress, p);
        }).then(function (r) {
          r.items.forEach(function (it) { all.push(it); });
        });
      }).then(next);
    }
    return next();
  }

  // ---------- photos ----------
  var LANG_HINT = [
    ["deu", /\b(rechnung|bestellung|menge|einzelpreis|mwst|ust-?id|lieferschein|gesamtbetrag|auftragsbest)/i],
    ["fra", /\b(facture|commande|quantit[eé]|prix unitaire|tva|montant|livraison)\b/i],
    ["spa", /\b(factura|pedido|cantidad|precio|iva|importe|albar[aá]n)\b/i]
  ];
  /*
    A phone photo is never quite straight, and a tilt of one or two degrees moves the end of a table
    row a whole line up or down. So the words are turned back by the tilt of Tesseract's own text
    lines (their baselines) before they're put into rows.
  */
  function tiltOf(lines) {
    var angles = [];
    (lines || []).forEach(function (l) {
      var b = l.baseline;
      if (!b || b.x1 - b.x0 < 80) return;
      angles.push(Math.atan2(b.y1 - b.y0, b.x1 - b.x0));
    });
    if (!angles.length) return 0;
    angles.sort(function (a, b) { return a - b; });
    var m = angles[Math.floor(angles.length / 2)];
    return Math.abs(m) < 0.2 ? m : 0;
  }
  // Each word takes its text line's top and height: a word with no tall letters ("runner") has a
  // small box of its own, which would split rows and break wrapped descriptions apart.
  function wordsToItems(data, page) {
    var a = -tiltOf(data.lines), cos = Math.cos(a), sin = Math.sin(a);
    function turn(x, y) { return { x: x * cos - y * sin, y: x * sin + y * cos }; }
    var items = [];
    var lines = (data.lines || []).filter(function (l) { return l.words && l.words.length; });
    if (!lines.length) lines = [{ words: data.words || [], bbox: null }];
    lines.forEach(function (l) {
      var lb = l.bbox;
      l.words.forEach(function (w) {
        if (!w || !w.text || !w.text.trim() || w.confidence <= 20) return;
        var b = w.bbox;
        var top = lb ? lb.y0 : b.y0, bottom = lb ? lb.y1 : b.y1;
        var mid = turn(b.x0, (top + bottom) / 2);
        var h = Math.max(b.y1 - b.y0, (bottom - top) * 0.8);
        items.push({ str: w.text, x: mid.x, y: mid.y - h / 2, w: b.x1 - b.x0, h: h, page: page || 1 });
      });
    });
    return items;
  }
  function ocr(image, onProgress, page) {
    var say = function (status, p) { if (onProgress) onProgress(status === "recognizing text" ? "Reading the photo" : "Getting the reader ready", p); };
    return getOcr("eng", say).then(function (w) { return w.recognize(image, { rotateAuto: true }); }).then(function (res) {
      var text = res.data.text || "";
      var hint = LANG_HINT.filter(function (h) { return h[1].test(text); })[0];
      if (!hint) return { items: wordsToItems(res.data, page), method: "ocr", lang: "eng", ocrText: text };
      return getOcr(hint[0], say).then(function (w2) { return w2.recognize(image, { rotateAuto: true }); }).then(function (res2) {
        return { items: wordsToItems(res2.data, page), method: "ocr", lang: hint[0], ocrText: res2.data.text || "" };
      });
    });
  }
  /*
    A phone photo has a grey cast, uneven light and soft edges. Before reading: grey only, the
    darkest and lightest 1% stretched to black and white, then a light sharpen. Tesseract does its
    own black-and-white step after this.
  */
  function clean(g, w, h) {
    var im = g.getImageData(0, 0, w, h), d = im.data, n = w * h;
    var grey = new Uint8ClampedArray(n), hist = new Uint32Array(256);
    for (var i = 0; i < n; i++) { var v = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000; grey[i] = v; hist[grey[i]]++; }
    var lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
    acc = 0;
    while (hi > 0 && (acc += hist[hi]) < n * 0.01) hi--;
    var span = Math.max(1, hi - lo);
    var out = new Uint8ClampedArray(n);
    for (i = 0; i < n; i++) out[i] = (grey[i] - lo) * 255 / span;
    // Sharpen: each pixel against its four neighbours.
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var k = y * w + x;
        var v2 = out[k] * 1.8 - (out[k - 1] + out[k + 1] + out[k - w] + out[k + w]) * 0.2;
        var o = k * 4;
        d[o] = d[o + 1] = d[o + 2] = v2 < 0 ? 0 : v2 > 255 ? 255 : v2;
      }
    }
    g.putImageData(im, 0, 0);
  }

  // A photo much bigger than a page needs is scaled down first: faster, and no less accurate.
  function imageForOcr(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        // Tesseract reads best with letters about 20 to 30 pixels high, so a small photo is enlarged
        // (up to twice) and a huge one shrunk.
        var long = Math.max(img.naturalWidth, img.naturalHeight);
        var s = long < 2400 ? Math.min(2, 2400 / long) : Math.min(1, 3200 / long);
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        var g = c.getContext("2d");
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        clean(g, c.width, c.height);
        resolve(c);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("This image could not be opened.")); };
      img.src = url;
    });
  }

  /*
    extract(file, onProgress) -> Promise of { items, method, pages } or { text, csv, method } for text files.
    Rejects with a plain message when the file can't be read here.
  */
  function extract(file, onProgress) {
    var kind = kindOf(file);
    if (kind === "pdf") return file.arrayBuffer().then(function (buf) { return pdfItems(buf, onProgress); });
    if (kind === "image") return imageForOcr(file).then(function (c) { return ocr(c, onProgress, 1); });
    if (kind === "csv" || kind === "text") return file.text().then(function (t) { return { text: t, csv: kind === "csv", method: "text" }; });
    if (kind === "heic") return Promise.reject(new Error("iPhone photos (HEIC) can't be opened in a browser. Take it as a JPG, or share it as a PDF."));
    if (kind === "office") return Promise.reject(new Error("Save it as a PDF or CSV first. Spreadsheets and Word files aren't read here."));
    return Promise.reject(new Error("This kind of file isn't read here. Use a PDF, a photo (JPG or PNG) or a CSV."));
  }

  root.DocFiles = { extract: extract, kindOf: kindOf };
})(typeof self !== "undefined" ? self : this);
