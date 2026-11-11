// Checks on the pictures and clips on the home page.
// - Every still is a lossless WebP with a JPG fallback that keeps full colour detail (no chroma
//   subsampling). A lossy WebP smeared the SwimSorted text and washed out its colours in November 2026.
// - The KeaClip figure and the SwimSorted "Try the demo" link stay on the page.
// - Nothing plays until the visitor presses a button: the page is loaded with site.js in a small
//   stand-in for the browser, and no video may exist or start until a play button is clicked.
// Run from the project folder:  node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const bytes = (file) => fs.readFileSync(path.join(ROOT, file));
const html = read("index.html");
const js = read("assets/js/site.js");

// A screenshot of a whole screen at about 1200 x 720 is well over these sizes when it is stored
// without loss. The lossy SwimSorted WebP that looked smeared was 9 KB.
const MIN_WEBP = 20 * 1024;
const MIN_JPG = 30 * 1024;
const MAX_CLIP = 3 * 1024 * 1024;

// ---------- reading the files themselves ----------
// WebP: "VP8L" is the lossless format, "VP8 " the lossy one. Returns { lossless, width, height }.
function webpInfo(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  let lossless = null, width = 0, height = 0;
  for (let at = 12; at + 8 <= buf.length;) {
    const kind = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (kind === "VP8 ") {
      lossless = false;
      width = buf.readUInt16LE(body + 6) & 0x3fff;
      height = buf.readUInt16LE(body + 8) & 0x3fff;
    } else if (kind === "VP8L" && lossless === null) {
      lossless = true;
      const b = buf.readUInt32LE(body + 1);
      width = (b & 0x3fff) + 1;
      height = ((b >>> 14) & 0x3fff) + 1;
    }
    at = body + size + (size % 2);
  }
  return { lossless, width, height };
}
// JPEG: size, and whether every colour component keeps full resolution ("4:4:4"): all components
// carry the same sampling factors. ffmpeg writes 1x2 for all three, a subsampled file 2x2 then 1x1.
function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let at = 2; at + 4 <= buf.length;) {
    if (buf[at] !== 0xff) return null;
    const marker = buf[at + 1];
    const len = buf.readUInt16BE(at + 2);
    if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = buf.readUInt16BE(at + 5), width = buf.readUInt16BE(at + 7), n = buf[at + 9];
      const sampling = [];
      for (let i = 0; i < n; i++) sampling.push(buf[at + 11 + i * 3]);
      return { width, height, fullColour: sampling.every((s) => s === sampling[0]) };
    }
    at += 2 + len;
  }
  return null;
}
// MP4: H.264, the index before the data (so it starts playing while it downloads), no sound,
// its picture size and its length in seconds.
function mp4Info(buf) {
  const top = [];
  for (let at = 0; at + 8 <= buf.length;) {
    const size = buf.readUInt32BE(at);
    top.push({ kind: buf.toString("ascii", at + 4, at + 8), at, size });
    if (size < 8) break;
    at += size;
  }
  const moov = top.find((b) => b.kind === "moov"), mdat = top.find((b) => b.kind === "mdat");
  if (!moov || !mdat) return null;
  const box = buf.subarray(moov.at, moov.at + moov.size);
  const mvhd = box.indexOf("mvhd") - 4;
  const version = box[mvhd + 8];
  const scale = version ? box.readUInt32BE(mvhd + 28) : box.readUInt32BE(mvhd + 20);
  const length = version ? Number(box.readBigUInt64BE(mvhd + 32)) : box.readUInt32BE(mvhd + 24);
  const tkhd = box.indexOf("tkhd") - 4, tkhdSize = box.readUInt32BE(tkhd);
  return {
    h264: box.includes("avc1"),
    fastStart: moov.at < mdat.at,
    sound: box.includes("soun"),
    width: box.readUInt32BE(tkhd + tkhdSize - 8) / 65536,
    height: box.readUInt32BE(tkhd + tkhdSize - 4) / 65536,
    seconds: length / scale,
  };
}

// ---------- the stills ----------
const pictures = [...html.matchAll(/<picture>\s*<source type="image\/webp" srcset="([^"]+)">\s*(<img\b[^>]*>)\s*<\/picture>/g)]
  .map((m) => ({ webp: m[1], img: m[2], jpg: m[2].match(/\ssrc="([^"]+)"/)[1], width: +m[2].match(/\swidth="(\d+)"/)[1], height: +m[2].match(/\sheight="(\d+)"/)[1] }));

test("stills: every picture has a WebP and a JPG, and the page uses the new SwimSorted and KeaClip ones", () => {
  assert.equal((html.match(/<picture>/g) || []).length, pictures.length, "a picture without a WebP source and a JPG");
  const used = pictures.map((p) => p.webp);
  for (const f of ["assets/img/swimsorted-visit.webp", "assets/img/keaclip-download.webp", "assets/img/nz-redact-app.webp"]) assert.ok(used.includes(f), `${f} is not on the page`);
});

for (const p of pictures) {
  test(`stills: ${p.webp} is lossless and its JPG keeps full colour detail`, () => {
    assert.ok(fs.existsSync(path.join(ROOT, p.webp)), `${p.webp} is missing`);
    assert.ok(fs.existsSync(path.join(ROOT, p.jpg)), `${p.jpg} is missing`);
    const w = webpInfo(bytes(p.webp));
    assert.ok(w, `${p.webp} is not a WebP file`);
    assert.equal(w.lossless, true, `${p.webp} is lossy WebP, which smears text. Encode it with -lossless 1`);
    assert.ok(bytes(p.webp).length >= MIN_WEBP, `${p.webp} is only ${bytes(p.webp).length} bytes`);
    assert.deepEqual([w.width, w.height], [p.width, p.height], `${p.webp} size differs from the img width and height`);
    const j = jpegInfo(bytes(p.jpg));
    assert.ok(j, `${p.jpg} is not a JPEG file`);
    assert.equal(j.fullColour, true, `${p.jpg} uses chroma subsampling. Encode it with format=yuvj444p`);
    assert.ok(bytes(p.jpg).length >= MIN_JPG, `${p.jpg} is only ${bytes(p.jpg).length} bytes`);
    assert.deepEqual([j.width, j.height], [p.width, p.height], `${p.jpg} size differs from the img width and height`);
  });
}

test("stills: the file checks themselves tell lossy from lossless", () => {
  // Smallest possible headers of each kind: the check must fail the lossy one.
  const chunk = (kind, body) => { const h = Buffer.alloc(8); h.write(kind, 0, "ascii"); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body]); };
  const riff = (c) => { const h = Buffer.alloc(12); h.write("RIFF", 0, "ascii"); h.writeUInt32LE(4 + c.length, 4); h.write("WEBP", 8, "ascii"); return Buffer.concat([h, c]); };
  const lossy = Buffer.alloc(10); lossy.writeUInt16LE(1200, 6); lossy.writeUInt16LE(720, 8);
  const lossless = Buffer.alloc(5); lossless[0] = 0x2f; lossless.writeUInt32LE((1200 - 1) | ((720 - 1) << 14), 1);
  assert.deepEqual(webpInfo(riff(chunk("VP8 ", lossy))), { lossless: false, width: 1200, height: 720 });
  assert.deepEqual(webpInfo(riff(chunk("VP8L", lossless))), { lossless: true, width: 1200, height: 720 });
  const sof = (a, b) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x02, 0xd0, 0x04, 0xb0, 3, 1, a, 0, 2, b, 1, 3, b, 1]);
  assert.deepEqual(jpegInfo(sof(0x22, 0x11)), { width: 1200, height: 720, fullColour: false }, "4:2:0 must be caught");
  assert.equal(jpegInfo(sof(0x21, 0x11)).fullColour, false, "4:2:2 must be caught");
  assert.equal(jpegInfo(sof(0x11, 0x11)).fullColour, true);
  assert.equal(jpegInfo(sof(0x12, 0x12)).fullColour, true, "ffmpeg's 4:4:4");
});

// ---------- the clips ----------
// The clip settings live in site.js; read them by running the same object literal.
const clipsSource = js.match(/var CLIPS = (\{[\s\S]*?\n {2}\});/);
const CLIPS = clipsSource ? vm.runInNewContext(`(${clipsSource[1]})`) : {};

test("clips: SwimSorted and KeaClip each have a clip, a poster and a description", () => {
  assert.deepEqual(Object.keys(CLIPS).sort(), ["keaclip", "swimsorted"]);
  assert.match(CLIPS.swimsorted.label, /How a visit works/);
  assert.match(CLIPS.swimsorted.label, /sample data/);
  assert.match(CLIPS.keaclip.label, /not a recording/, "the KeaClip clip is made from screenshots and must say so");
  assert.match(CLIPS.keaclip.label, /0\.4\.0/);
  assert.match(CLIPS.keaclip.label, /light theme/);
  assert.match(CLIPS.keaclip.label, /dark theme/);
});

for (const [name, clip] of Object.entries(CLIPS)) {
  test(`clips: ${name} is H.264 and VP9 under 3 MB, starts while it downloads, has no sound, and has the shape of its still`, () => {
    for (const ext of ["mp4", "webm"]) {
      const f = `${clip.file}.${ext}`;
      assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
      assert.ok(bytes(f).length < MAX_CLIP, `${f} is ${bytes(f).length} bytes`);
    }
    const m = mp4Info(bytes(`${clip.file}.mp4`));
    assert.ok(m && m.h264, "the MP4 is not H.264");
    assert.ok(m.fastStart, "the MP4 needs +faststart");
    assert.ok(!m.sound, "the MP4 has a sound track");
    assert.ok(Math.abs(m.width / m.height - clip.width / clip.height) < 0.005, `the clip is ${m.width}x${m.height}, not the shape of ${clip.width}x${clip.height}`);
    // Each step or screen stays up for at least 3 seconds: SwimSorted has 5 steps, KeaClip 4 screens.
    assert.ok(m.seconds >= (name === "swimsorted" ? 5 : 4) * 3, `the clip is only ${m.seconds} s long`);
    const webm = bytes(`${clip.file}.webm`);
    assert.equal(webm.readUInt32BE(0), 0x1a45dfa3, "the WebM is not a WebM file");
    assert.ok(webm.includes("V_VP9"), "the WebM is not VP9");
    const poster = jpegInfo(bytes(clip.poster));
    assert.ok(poster && poster.fullColour, `${clip.poster} is missing or uses chroma subsampling`);
    assert.ok(Math.abs(poster.width / poster.height - clip.width / clip.height) < 0.005, `${clip.poster} is not the shape of the clip`);
  });
}

// ---------- what must stay on the page ----------
const article = (id) => (html.match(new RegExp(`<article class="project" id="${id}"[\\s\\S]*?</article>`)) || [""])[0];

test("KeaClip: a figure of the real app with a Play the screens button, and never the demo GIF or video", () => {
  const kea = article("keaclip");
  assert.match(kea, /<figure class="shot" data-keaclip data-clip="keaclip">/);
  assert.match(kea, /srcset="assets\/img\/keaclip-download\.webp"/);
  assert.match(kea, /<img src="assets\/img\/keaclip-download\.jpg" width="1180" height="780"/);
  assert.match(kea, /alt="KeaClip version 0\.4\.0, the Download screen/);
  assert.match(kea, /<button type="button" class="btn-quiet needs-js" data-play>Play the screens<\/button>/);
  for (const [file, text] of [["index.html", html], ["assets/js/site.js", js]]) {
    assert.doesNotMatch(text, /keaclip-demo|\.gif\b/i, `${file} uses the KeaClip demo GIF or video`);
  }
  const media = [...fs.readdirSync(path.join(ROOT, "assets/img")), ...fs.readdirSync(path.join(ROOT, "assets/media"))];
  assert.deepEqual(media.filter((f) => /keaclip-demo|\.gif$/i.test(f)), [], "the KeaClip demo GIF or video is in the site files");
});

test("SwimSorted: Try the demo opens the demo in a new tab, next to Open swimsorted.co.nz, and is never framed", () => {
  const swim = article("swimsorted");
  assert.match(swim, /<a href="https:\/\/swimsorted\.co\.nz" rel="noopener">Open swimsorted\.co\.nz<\/a> <a href="https:\/\/swimsorted\.co\.nz\/\?demo" target="_blank" rel="noopener">Try the demo<span class="visually-hidden"> \(opens in a new tab\)<\/span><\/a>/);
  assert.match(swim, /<button type="button" class="btn-quiet needs-js" data-play>Play the recording<\/button>/);
  // The demo refuses to be shown inside another page (frame-ancestors 'none').
  assert.doesNotMatch(js, /\?demo/, "site.js must not put the demo in a frame");
});

// ---------- nothing plays until a button is pressed ----------
test("motion: no video, sound or frame is in the page, and nothing is set to play by itself", () => {
  assert.doesNotMatch(html, /<(video|audio|iframe)\b/i, "media in the page itself starts loading, and may play, without a press");
  for (const [file, text] of [["index.html", html], ["assets/js/site.js", js]]) {
    assert.doesNotMatch(text, /autoplay/i, `${file} mentions autoplay`);
    assert.doesNotMatch(text, /setInterval|requestAnimationFrame/, `${file} runs something on a timer`);
  }
});

// A small stand-in for the browser: enough of the DOM for site.js, built from the page's own figures.
function fakePage() {
  const made = [];
  class El {
    constructor(tag, attrs = {}) {
      this.tagName = tag.toUpperCase();
      this.attrs = { ...attrs };
      this.children = [];
      this.parentNode = null;
      this.listeners = {};
      this.hidden = "hidden" in attrs;
      this.plays = 0;
      this._text = "";
      const el = this;
      this.classList = {
        add: (c) => { const s = new Set((el.attrs.class || "").split(" ").filter(Boolean)); s.add(c); el.attrs.class = [...s].join(" "); },
        contains: (c) => (el.attrs.class || "").split(" ").includes(c),
      };
    }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    hasAttribute(n) { return n in this.attrs; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) { c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
    get nextSibling() { const s = this.parentNode && this.parentNode.children; return s ? s[s.indexOf(this) + 1] || null : null; }
    get textContent() { return this._text; }
    set textContent(v) { this.children = []; this._text = String(v); }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    click() { for (const fn of this.listeners.click || []) fn.call(this, { type: "click", currentTarget: this }); }
    focus() {}
    play() { this.plays++; return Promise.resolve(); }
    matches(sel) {
      const m = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (m) return m[1] in this.attrs && (m[2] === undefined || this.attrs[m[1]] === m[2]);
      if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
      return this.tagName === sel.toUpperCase();
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    all() { const out = []; const walk = (e) => { for (const c of e.children) { out.push(c); walk(c); } }; walk(this); return out; }
  }
  const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] === undefined ? "" : m[2]]));
  const body = new El("body");
  for (const m of html.matchAll(/(<figure\b[^>]*>)([\s\S]*?)<\/figure>/g)) {
    const figure = body.appendChild(new El("figure", attrsOf(m[1])));
    if (/class="frame"/.test(m[2])) figure.appendChild(new El("div", { class: "frame" })).appendChild(new El("picture"));
    const actions = figure.appendChild(new El("div", { class: "shot-actions" }));
    for (const b of m[2].matchAll(/(<button\b[^>]*>)([^<]*)<\/button>/g)) actions.appendChild(new El("button", attrsOf(b[1]))).textContent = b[2];
  }
  const document = {
    documentElement: new El("html", { "data-theme": "light" }),
    body,
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    createElement: (tag) => { const e = new El(tag); made.push(e); return e; },
    execCommand: () => true,
  };
  const window = { location: { origin: "http://localhost:8787" }, isSecureContext: false };
  vm.runInNewContext(js, { document, window, navigator: {}, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, Promise });
  return { body, made };
}

test("motion: loading the page creates and plays nothing; each play button starts only its own clip, which repeats with controls", () => {
  const { body, made } = fakePage();
  const media = () => made.filter((e) => ["VIDEO", "AUDIO", "IFRAME"].includes(e.tagName));
  assert.deepEqual(media().map((e) => e.tagName), [], "something was made on load, before any press");

  const figures = body.querySelectorAll("[data-clip]");
  assert.deepEqual(figures.map((f) => f.getAttribute("data-clip")), ["swimsorted", "keaclip"]);
  figures.forEach((figure, i) => {
    const name = figure.getAttribute("data-clip");
    const button = figure.querySelector("[data-play]");
    assert.ok(button, `${name} has no play button`);
    button.click();
    assert.equal(media().length, i + 1, `pressing ${name}'s button should make one video, and only one`);
    const video = figure.querySelector("video");
    assert.ok(video, `${name}'s video is not in its own figure`);
    assert.equal(video.plays, 1, `${name}'s video should start once, after the press`);
    assert.equal(video.loop, true, `${name}'s video should repeat`);
    assert.equal(video.controls, true, `${name}'s video should show its controls`);
    assert.equal(video.muted, true);
    assert.ok(!video.autoplay && !video.hasAttribute("autoplay"), `${name}'s video is set to autoplay`);
    assert.equal(button.hidden, true, "the play button goes once the clip is showing");
    const sources = video.querySelectorAll("source").map((s) => s.src);
    assert.deepEqual(sources, [`${CLIPS[name].file}.webm`, `${CLIPS[name].file}.mp4`]);
    for (const s of sources) assert.ok(fs.existsSync(path.join(ROOT, s)), `${s} is missing`);
    assert.ok(fs.existsSync(path.join(ROOT, video.poster)), `${video.poster} is missing`);
    assert.ok(video.getAttribute("aria-label").length > 40, `${name}'s video has no description`);
  });
  assert.equal(made.filter((e) => e.tagName === "VIDEO" && e.plays === 0).length, 0, "a video was made that nobody started");
});
