// The invoice checker must not carry the design tells people now read as AI-made.
// Each rule is one line of the "Mechanical check" list in AI-TELLS.md (PERSONAL STUFF\Portfolio).
// It reads what the page really uses: invoice-checker.html, every stylesheet it links and every
// script it loads. The last test feeds each rule a known bad example, so a rule that can no longer
// fail is caught too.
// Run from the project folder:  node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const PAGE = "invoice-checker.html";

function loadPage() {
  const html = read(PAGE);
  const sheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  return {
    html,
    css: sheets.map((f) => read(f)).join("\n"),
    js: scripts.map((f) => read(f)).join("\n"),
    sheets,
    scripts,
  };
}

// ---------- helpers ----------
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
// Every innermost "selector { declarations }" block, including those inside @media.
function cssRules(css) {
  const out = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    const list = [];
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i === -1) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      const value = d.slice(i + 1).trim();
      if (!prop) continue;
      decls[prop] = value;
      list.push([prop, value]);
    }
    out.push({ selector: m[1].trim(), decls, list });
  }
  return out;
}
// Text a visitor can read: the HTML without its tags, scripts, styles and comments.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/i, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&middot;|&#183;|&#xb7;/gi, "·")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
// The string literals in the scripts: the text the scripts can put on the page. Comments are left out.
function jsCode(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[;{},)])[ \t]*\/\/.*$/gm, "$1");
}
function jsStrings(js) {
  return [...jsCode(js).matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g)].map((m) =>
    m[0].slice(1, -1).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
}
// A CSS length in px. em is taken against the given font size; rem and % against 16px.
function px(token, fontPx = 14) {
  const m = String(token).trim().match(/^(-?[\d.]+)(px|em|rem|%)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  if (!m[2]) return n;
  return m[2] === "px" ? n : m[2] === "em" ? n * fontPx : m[2] === "rem" ? n * 16 : (n / 100) * 16;
}
// The font size a rule sets, in px, or null. clamp(), min() and max() count at their largest value.
function ruleFontPx(decls) {
  let v = decls["font-size"];
  if (!v && decls.font) { const m = decls.font.match(/(?:^|\s)([\d.]+(?:px|rem|em))(?:\/|\s)/); if (m) v = m[1]; }
  if (!v) return null;
  const sizes = [...v.matchAll(/[\d.]+(?:px|rem|em)/g)].map((m) => px(m[0], 16));
  return sizes.length ? Math.max(...sizes) : null;
}

// ---------- the rules, one per line of the Mechanical check ----------
const RULES = {
  // font-style: italic inside any h1/h2. This page uses no italics at all, so any italic fails.
  italic({ html, css, js }) {
    const hits = [];
    for (const r of cssRules(css)) {
      for (const [p, v] of r.list) {
        if ((p === "font-style" && /italic|oblique/i.test(v)) || (p === "font" && /\b(italic|oblique)\b/i.test(v))) hits.push(`${r.selector} { ${p}: ${v} }`);
      }
    }
    for (const m of html.matchAll(/<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      if (/<(em|i|cite|var|dfn)\b/i.test(m[2])) hits.push(`italic element inside <${m[1]}>: ${m[2].trim().slice(0, 60)}`);
    }
    const body = html.replace(/<head[\s\S]*?<\/head>/i, "");
    for (const m of body.matchAll(/<(em|i|cite|var|dfn|address)\b/gi)) hits.push(`<${m[1]}> is drawn in italics by default`);
    for (const m of js.matchAll(/(?:el|createElement)\(\s*"(em|i|cite|var|dfn|address)"/g)) hits.push(`script makes <${m[1]}>`);
    return hits;
  },

  // text-transform: uppercase anywhere except keyboard keys, and no all-caps label text either.
  uppercase({ html, css, js }) {
    const hits = [];
    for (const r of cssRules(css)) {
      const caps = (r.decls["text-transform"] && /uppercase/i.test(r.decls["text-transform"])) || /small-caps|all-petite-caps|titling-caps/i.test(`${r.decls["font-variant"] || ""} ${r.decls["font-variant-caps"] || ""} ${r.decls.font || ""}`);
      if (!caps) continue;
      const onlyKeys = r.selector.split(",").every((s) => /^kbd\b/.test(s.trim()));
      if (!onlyKeys) hits.push(`${r.selector} sets capitals`);
    }
    // Two or more words in capitals in a row is a label written in capitals. Codes with digits
    // (INV-20418, RUN-500) and single abbreviations (GST, IRD, NZBN) are fine.
    const capsRun = /\b[A-Z][A-Z'&]{1,}(?:[ \t]+[A-Z][A-Z'&]{1,}\b)+/g;
    for (const text of [visibleText(html), ...jsStrings(js)]) {
      for (const m of text.matchAll(capsRun)) hits.push(`capitals: "${m[0]}"`);
    }
    return hits;
  },

  // letter-spacing above 0.02em on text under 16px.
  letterSpacing({ css }) {
    const hits = [];
    for (const r of cssRules(css)) {
      const v = r.decls["letter-spacing"];
      if (!v || /^(normal|0|inherit|initial|unset)$/.test(v.trim())) continue;
      const size = ruleFontPx(r.decls) || 14; // the page's text is 14px unless the rule says otherwise
      const em = /em$/.test(v.trim()) && !/rem$/.test(v.trim()) ? parseFloat(v) : px(v, size) / size;
      if (em > 0.02 && size < 16) hits.push(`${r.selector} { letter-spacing: ${v} } at ${size}px`);
    }
    return hits;
  },

  // " · " in visible text (any middle dot or bullet used as a separator).
  middleDot({ html, css, js }) {
    const DOTS = /[·•∙⋅・]/;
    const hits = [];
    const text = visibleText(html);
    if (DOTS.test(text)) hits.push(`page text: "${text.match(new RegExp(".{0,20}" + DOTS.source + ".{0,20}"))[0].trim()}"`);
    for (const s of jsStrings(js)) if (DOTS.test(s)) hits.push(`script text: "${s.slice(0, 50)}"`);
    for (const r of cssRules(css)) {
      const c = r.decls.content;
      if (c && (DOTS.test(c) || /\\0*(b7|2022|2219|22c5)\b/i.test(c))) hits.push(`${r.selector} { content: ${c} }`);
    }
    return hits;
  },

  // A visible "01", "02", "03" sequence used as decoration.
  numberedMarkers({ html, css, js }) {
    const hits = [];
    for (const r of cssRules(css)) {
      const c = r.decls.content;
      if (c && /counter\(/.test(c)) hits.push(`${r.selector} shows a counter: ${c}`);
      for (const [p, v] of r.list) if (/decimal-leading-zero/.test(v)) hits.push(`${r.selector} { ${p}: ${v} }`);
    }
    const lone = [...visibleText(html).matchAll(/(?:^|[\s>(])(0[1-9])(?=[\s.):<]|$)/g)].map((m) => m[1]);
    if (lone.length) hits.push(`numbers with a leading zero in the page text: ${lone.join(", ")}`);
    // Padding cents in a money amount ($15.60) is not a marker, so lines that work on "% 100" are skipped.
    for (const line of jsCode(js).split("\n")) {
      if (/%\s*100/.test(line)) continue;
      for (const m of line.matchAll(/padStart\(\s*2\s*,\s*["']0["']\s*\)|["']0["']\s*\+\s*\(?\s*(?:i|n|idx|index|row|r)\b/g)) hits.push(`script pads a number with a zero: ${m[0]}`);
    }
    return hits;
  },

  // Any font family named Instrument Serif, Geist, Inter, Space Grotesk, Fraunces, Newsreader.
  bannedFonts({ html, css }) {
    const NAMES = /instrument[\s-]?serif|geist|\binter\b|space[\s-]?grotesk|fraunces|newsreader/i;
    const hits = [];
    for (const r of cssRules(css)) {
      for (const [p, v] of r.list) {
        if ((p === "font-family" || p === "font" || p === "src" || /^--/.test(p)) && NAMES.test(v)) hits.push(`${r.selector} { ${p}: ${v} }`);
      }
    }
    for (const m of html.matchAll(/<link\b[^>]*href="([^"]+)"/g)) if (NAMES.test(m[1])) hits.push(`page loads ${m[1]}`);
    return hits;
  },

  // border-left wider than 1px used on a card or note for colour (or the same stripe drawn another way).
  colouredLeftRule({ css }) {
    const hits = [];
    const width = (v) => {
      const w = String(v).match(/(?:^|\s)(thin|medium|thick|[\d.]+(?:px|em|rem))(?=\s|$)/);
      if (!w) return 0;
      return { thin: 1, medium: 3, thick: 5 }[w[1]] || px(w[1], 14);
    };
    for (const r of cssRules(css)) {
      for (const [p, v] of r.list) {
        if (/^border-(left|inline-start)$/.test(p) && width(v) > 1) hits.push(`${r.selector} { ${p}: ${v} }`);
        if (/^border-(left|inline-start)-width$/.test(p) && width(v) > 1) hits.push(`${r.selector} { ${p}: ${v} }`);
        if (p === "border-width") {
          const parts = v.split(/\s+/);
          const left = parts.length === 4 ? parts[3] : parts.length >= 2 ? parts[1] : null;
          if (left && width(left) > 1 && parts.length > 1 && width(parts[0]) <= 1) hits.push(`${r.selector} { border-width: ${v} }`);
        }
        if (p === "box-shadow" && /\binset\b/.test(v)) {
          for (const part of v.split(/,(?![^(]*\))/)) {
            const nums = part.replace(/rgba?\([^)]*\)|var\([^)]*\)|#[0-9a-f]+/gi, "").match(/-?[\d.]+(?:px|em|rem)?/g) || [];
            const [x, y, blur] = nums.map((n) => px(n));
            if (/\binset\b/.test(part) && Math.abs(x) >= 2 && !y && !blur) hits.push(`${r.selector} draws a stripe: box-shadow: ${part.trim()}`);
          }
        }
      }
      if (/::?(before|after)/.test(r.selector) && r.decls.background && /^[2-6]px$/.test((r.decls.width || "").trim())) hits.push(`${r.selector} draws a stripe`);
    }
    return hits;
  },

  // A number over 40px with a small caption under it outside a data table.
  // Nothing on this page needs text over 40px, so any size over 40px fails.
  bigNumber({ css }) {
    const hits = [];
    for (const r of cssRules(css)) {
      const size = ruleFontPx(r.decls);
      if (size != null && size > 40) hits.push(`${r.selector} sets ${size}px text`);
    }
    return hits;
  },

  // Any animation that runs without a user action.
  animationOnLoad({ css, js }) {
    // The states a person causes: a dialog opened, the Copy button pressed, a different bill opened.
    const USER = /\[open\]|\.is-copied|\.is-opening/;
    const hits = [];
    for (const r of cssRules(css)) {
      const a = r.decls.animation || r.decls["animation-name"];
      if (!a || /^none\b/.test(a.trim())) continue;
      if (/^(from|to|\d+%)/.test(r.selector)) continue; // inside @keyframes
      for (const s of r.selector.split(",")) if (!USER.test(s)) hits.push(`${s.trim()} animates without a user action: ${a}`);
    }
    for (const m of js.matchAll(/\b(setInterval|requestAnimationFrame)\s*\(|\.animate\s*\(/g)) hits.push(`script runs motion by itself: ${m[0]}`);
    // The "opening" fade is only started after a bill has already been shown, never on the first draw.
    const calls = [...js.matchAll(/^.*\bshowOpening\(\);.*$/gm)].map((m) => m[0]);
    for (const line of calls) if (!/if \(paintedId !== null\) showOpening\(\);/.test(line)) hits.push(`showOpening() is called without the "already shown" guard: ${line.trim()}`);
    for (const m of js.matchAll(/classList\.(?:add|toggle)\("is-opening"/g)) {
      const fn = js.slice(js.lastIndexOf("function", m.index), m.index);
      if (!/^function showOpening\(\)/.test(fn)) hits.push("is-opening is added outside showOpening()");
    }
    for (const m of js.matchAll(/paintCopy\(\s*\w+\s*,\s*true\s*\)/g)) {
      const before = js.slice(Math.max(0, m.index - 200), m.index);
      if (!/copyText\([^)]*\)\.then\(function \(\) \{\s*$/.test(before)) hits.push("Copied is shown without a copy");
    }
    return hits;
  },

  // Page background in the cream range (hue 30-60, lightness above 94%, chroma above 0.005).
  // Lightness and chroma are OKLCH. The hue range 30-60 is where cream sits in HSL degrees; in OKLCH
  // the same colours sit at about 75 to 95. Either reading counts, so the old paper #f4f0e6
  // (HSL hue 43, OKLCH hue 89) is caught.
  creamBackground({ css }) {
    const hits = [];
    const SURFACES = ["bg", "panel", "sunken"];
    const blocks = cssRules(css).filter((r) => /:root/.test(r.selector) && Object.keys(r.decls).some((k) => k.startsWith("--")));
    const check = (where, hex) => {
      const c = oklch(hex), h = hslHue(hex);
      const warm = (h >= 30 && h <= 60) || (c && c.h >= 60 && c.h <= 100);
      if (c && warm && c.l > 0.94 && c.c > 0.005) hits.push(`${where} ${hex} is cream (OKLCH L ${c.l.toFixed(3)}, C ${c.c.toFixed(4)}, h ${c.h.toFixed(1)}; HSL hue ${h.toFixed(1)})`);
    };
    for (const b of blocks) for (const s of SURFACES) if (b.decls["--" + s]) check(`${b.selector} --${s}`, b.decls["--" + s]);
    for (const r of cssRules(css)) {
      if (!/^(html|body)$/.test(r.selector)) continue;
      const bg = r.decls.background || r.decls["background-color"];
      const hex = bg && bg.match(/#[0-9a-f]{6}\b/i);
      if (hex) check(`${r.selector} background`, hex[0]);
    }
    return hits;
  },
};

function hslHue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return NaN;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
// sRGB hex to OKLCH (Björn Ottosson's OKLab).
function oklch(hex) {
  const m = String(hex).trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}

// ---------- the page passes every rule ----------
const page = loadPage();

test("tells: the check reads what the page really loads", () => {
  assert.deepEqual(page.sheets, ["assets/css/invoice.css"], "the page links only its own stylesheet");
  assert.ok(page.scripts.includes("assets/js/invoice-page.js"));
  assert.ok(page.css.length > 1000 && page.js.length > 1000);
});

const NAMES = {
  italic: "no italic type (none inside h1 or h2, and none anywhere else)",
  uppercase: "no capitals set by CSS except on keyboard keys, and no labels written in capitals",
  letterSpacing: "no letter-spacing above 0.02em on text under 16px",
  middleDot: "no middle dots in the page text or the text the scripts write",
  numberedMarkers: "no 01, 02, 03 markers drawn by CSS counters or written into the page",
  bannedFonts: "no Instrument Serif, Geist, Inter, Space Grotesk, Fraunces or Newsreader",
  colouredLeftRule: "no coloured left rule wider than 1px on a card or note",
  bigNumber: "no text over 40px, so no big number over a small caption",
  animationOnLoad: "no animation runs without a user action",
  creamBackground: "the page background is not cream",
};
for (const [rule, name] of Object.entries(NAMES)) {
  test(`tells: ${name}`, () => {
    const hits = RULES[rule](page);
    assert.deepEqual(hits, [], hits.join("\n"));
  });
}

// ---------- each rule still catches the tell it is for ----------
test("tells: every rule fails on a known bad example and passes the plain version", () => {
  const cases = [
    ["italic", { css: "h1 em { font-style: italic; }" }, { css: "h1 { font-weight: 600; }" }],
    ["italic", { html: "<h1>Matched <em>line by line.</em></h1>" }, { html: "<h1>Invoice checker</h1>" }],
    ["uppercase", { css: ".label { font-size: 12px; text-transform: uppercase; }" }, { css: "kbd { text-transform: uppercase; }" }],
    ["uppercase", { html: "<p>DEMO WITH MADE-UP BILLS</p>" }, { html: "<p>GST 15% on INV-20418, IRD check digit</p>" }],
    ["letterSpacing", { css: ".label { font: 500 12px/1.2 var(--mono); letter-spacing: .06em; }" }, { css: "h2 { font-size: 20px; letter-spacing: .03em; }" }],
    ["middleDot", { html: "<p>INV-20418 · 3 November</p>" }, { html: "<p>INV-20418, 3 November</p>" }],
    ["middleDot", { js: 'x.textContent = b.number + " \\u00b7 " + b.issued;' }, { js: 'x.textContent = b.number;' }],
    ["numberedMarkers", { css: ".lines td::before { content: counter(row, decimal-leading-zero); }" }, { css: ".lines td { padding: 6px; }" }],
    ["numberedMarkers", { html: "<span>01</span> Upload <span>02</span> Check" }, { html: "<p>Order 4500012904, 3 November 2026</p>" }],
    ["bannedFonts", { css: 'body { font-family: "Instrument Serif", serif; }' }, { css: 'body { font-family: system-ui, "Segoe UI", sans-serif; }' }],
    ["bannedFonts", { css: '@font-face { font-family: "Ledger Sans"; src: url("../fonts/geist.woff2"); }' }, { css: "@font-face { font-family: X; src: url(x.woff2); }" }],
    ["colouredLeftRule", { css: ".issues li { border-left: 2px solid var(--hold); }" }, { css: ".issues li { border-left: 1px solid var(--border); }" }],
    ["colouredLeftRule", { css: ".bill.is-current { box-shadow: inset 2px 0 0 var(--red-ink); }" }, { css: "dialog { box-shadow: 0 8px 28px rgba(0,0,0,.2); }" }],
    ["bigNumber", { css: ".v-amount strong { font: 400 52px/1 var(--serif); }" }, { css: ".page-head h2 { font-size: 20px; }" }],
    ["bigNumber", { css: ".intro h1 { font-size: clamp(56px, 9vw, 112px); }" }, { css: ".product { font-size: 1rem; }" }],
    ["animationOnLoad", { css: ".paper.is-writing .w { animation: write-in .18s ease both; }" }, { css: "dialog.sheet[open] { animation: sheet-in .15s ease; }" }],
    ["animationOnLoad", { js: "if (paintedId !== b.id) { showOpening(); paintedId = b.id; }" }, { js: "if (paintedId !== null) showOpening();" }],
    ["creamBackground", { css: ":root { --bg: #f4f0e6; }" }, { css: ":root { --bg: #eef0f2; }" }],
  ];
  for (const [rule, bad, good] of cases) {
    const withDefaults = (x) => ({ html: "", css: "", js: "", ...x });
    assert.ok(RULES[rule](withDefaults(bad)).length > 0, `${rule} missed: ${JSON.stringify(bad)}`);
    assert.deepEqual(RULES[rule](withDefaults(good)), [], `${rule} wrongly caught: ${JSON.stringify(good)}`);
  }
});

module.exports = { RULES, loadPage, oklch };
