// Checks on the pages themselves: colour contrast, honesty rules, links and images.
// Run from the project folder:  node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const PAGES = ["index.html", "privacy-checker.html", "invoice-checker.html", "3d/index.html"];
const css = read("assets/css/site.css");

// ---------- colour contrast (WCAG 2) ----------
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}
// Light is the default (:root); dark overrides it.
const light = tokens(css.match(/:root\s*\{([\s\S]*?)\n\}/)[1]);
const dark = { ...light, ...tokens(css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1]) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum]. Text needs 4.5:1. Borders and the focus ring need 3:1.
const PAIRS = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["text", "surface-2", 4.5],
  ["muted", "bg", 4.5], ["muted", "surface", 4.5], ["muted", "surface-2", 4.5],
  ["accent", "bg", 4.5], ["accent", "surface", 4.5], ["accent-ink", "accent", 4.5],
  ["btn-ink", "btn", 4.5], ["text", "stage", 4.5], ["muted", "stage", 4.5], ["accent", "stage", 4.5], ["accent", "surface-2", 4.5],
  ["check", "check-bg", 4.5], ["note", "note-bg", 4.5], ["ok", "ok-bg", 4.5],
  ["line-strong", "bg", 3], ["line-strong", "surface", 3],
  ["check", "surface", 3], ["note", "surface", 3], ["ok", "surface", 3],
];
for (const [name, theme] of [["dark", dark], ["light", light]]) {
  test(`contrast: ${name} theme`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= min, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}

test("motion: reduced motion switches the animation off, and focus is visible", () => {
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(reduced, "no reduced-motion block");
  assert.match(reduced[1], /animation:\s*none/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid/);
  assert.ok((css.match(/@keyframes/g) || []).length <= 1, "one piece of motion at most (the AI-tell test below also bans any animation that runs without a user action)");
});

// ---------- the pages ----------
// Things the site must never say. Each is a rule from the evidence file or the brief.
const NEVER = [
  /\bDiscord\b/i, /\bCopilot\b/i, /Power Automate/i, /Power BI/i, /\bSQL\b/, /\bPython\b(?!-stdnum)/i,
  /Rift Assistant/i, /game server/i, /integrations?\b/i, /independent review/i, /code review/i,
  /every release/i, /\bseven years\b(?<!nearly seven years)/i, /I wrote the (code|website|user guide)/i,
  /\b(our|my) (users|customers)\b/i, /[–—]/, /\b0\d{2}[ -]?\d{3}[ -]?\d{3,5}\b/,
];

for (const page of PAGES) {
  const html = read(page);
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");

  test(`${page}: unlisted, one h1, a language and a title`, () => {
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<html lang="en-NZ"/);
    assert.match(html, /<title>[^<]{10,}<\/title>/);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  });

  test(`${page}: says nothing it must not say`, () => {
    for (const rule of NEVER) {
      const hit = visible.match(rule);
      assert.equal(hit, null, `found "${hit && hit[0]}" (${rule})`);
    }
  });

  test(`${page}: links are relative, files exist, nothing loads from another site`, () => {
    for (const m of html.matchAll(/<(a|link|script|img|source|video|iframe)\b[^>]*?\s(href|src|srcset)="([^"]+)"/g)) {
      const [, tag, , url] = m;
      if (/^https?:/.test(url)) {
        assert.equal(tag, "a", `${tag} loads ${url} from another site`);
        continue;
      }
      if (url.startsWith("#") || url.startsWith("mailto:")) continue;
      assert.ok(!url.startsWith("/"), `${url} starts with a slash, so it breaks under a sub-path`);
      const file = url.split("#")[0].split(" ")[0];
      assert.ok(fs.existsSync(path.join(ROOT, path.dirname(page), file)), `${file} does not exist`);
    }
  });

  test(`${page}: in-page links and labels point at something`, () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `#${m[1]} has no target`);
    for (const m of html.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
      for (const id of m[1].split(" ")) assert.ok(ids.has(id), `aria reference to missing id ${id}`);
    }
    assert.equal(ids.size, [...html.matchAll(/\sid="([^"]+)"/g)].length, "an id is used twice");
  });

  test(`${page}: images are sized, described and lazy-loaded`, () => {
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const img = m[0];
      assert.match(img, /\salt="[^"]{10,}"/, `no alt text: ${img.slice(0, 60)}`);
      assert.match(img, /\swidth="\d+"/);
      assert.match(img, /\sheight="\d+"/);
      if (!/fetchpriority="high"/.test(img)) assert.match(img, /\sloading="lazy"/);
    }
  });
}

test("the email address is plain text with a Copy button, and there is a CV to download", () => {
  const html = read("index.html");
  assert.match(html, /<span class="email"[^>]*>chris\.a\.nottle@gmail\.com<\/span>/);
  assert.match(html, /data-copy="chris\.a\.nottle@gmail\.com"/);
  assert.match(html, /href="Christopher_Nottle_CV\.pdf"/);
  assert.ok(fs.statSync(path.join(ROOT, "Christopher_Nottle_CV.pdf")).size > 10000);
});

test("the live SwimSorted view is tied to the one address it is allowed on", () => {
  const js = read("assets/js/site.js");
  assert.match(js, /LIVE_ORIGIN = "https:\/\/langkurst\.github\.io"/);
  assert.match(js, /window\.location\.origin === LIVE_ORIGIN/);
  assert.match(read("index.html"), /data-live hidden/);
  for (const page of ["welcome", "features", "pricing", "about", "story"]) assert.ok(js.includes(`"${page}"`));
});



for (const page of ["privacy-checker.html", "invoice-checker.html"]) {
  test(`${page}: a security policy blocks every connection, so typed text cannot leave`, () => {
    const html = read(page);
    const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /default-src 'self'/);
    assert.ok(!/<script>[^<]/.test(html), "no inline scripts, which the policy would block");
    assert.ok(!/ style="/.test(html), "no inline styles, which the policy would block");
  });
}

test("both tools are linked from the home page, and the old privacy address forwards to NZ Redact", () => {
  assert.match(read("index.html"), /href="https:\/\/langkurst\.github\.io\/nz-redact\/"/);
  assert.match(read("index.html"), /href="https:\/\/github\.com\/Langkurst\/nz-redact"/);
  assert.match(read("index.html"), /href="invoice-checker.html"/);
  assert.match(read("privacy-checker.html"), /http-equiv="refresh" content="0; url=https:\/\/langkurst\.github\.io\/nz-redact\/"/);
  assert.match(read("invoice-checker.html"), /href="privacy-checker.html"/);
});

test("no tool branding on the tool pages or in the README", () => {
  for (const f of ["invoice-checker.html", "privacy-checker.html", "README.md", "assets/js/invoice-page.js", "assets/js/matcher.js", "assets/js/samples.js", "assets/css/system.css", "assets/css/invoice.css"]) {
    const m = read(f).match(/claude|anthropic|co-authored-by|ai agent|ai coding|coding agent|copilot/i);
    assert.equal(m, null, `${f}: "${m && m[0]}"`);
  }
});

test("at most one image per page skips lazy loading, and it is marked high priority", () => {
  for (const page of PAGES) {
    const eager = (read(page).match(/<img\b[^>]*fetchpriority="high"[^>]*>/g) || []).length;
    assert.ok(eager <= 1, `${page} has ${eager} high-priority images`);
  }
});


// ---------- AI-look tells (PERSONAL STUFF\Portfolio\AI-TELLS.md, November 2026) ----------
// Each of these is on the published lists of signs that a page was made by AI. Any hit fails.
const TELL_PAGES = [["index.html", "assets/css/site.css"]];
function tellsIn(html, sheet) {
  const found = [];
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
  const rules = sheet.replace(/@font-face\s*\{[^}]*\}/g, "");
  if (/font-style:\s*italic/.test(rules)) found.push("italic text styling");
  if (/text-transform:\s*uppercase/.test(rules)) found.push("uppercase labels");
  for (const m of rules.matchAll(/letter-spacing:\s*(\.\d+|\d+(?:\.\d+)?)em/g)) if (parseFloat(m[1]) > 0.02) found.push(`letter-spacing ${m[1]}em`);
  if (/ · /.test(visible)) found.push('" · " strings');
  if (/(^|\s)0[1-9](\s|$)/.test(visible)) found.push("01 / 02 / 03 markers");
  for (const f of ["Instrument Serif", "Geist", "Inter", "Space Grotesk", "Fraunces", "Newsreader"]) {
    if (new RegExp(`["']${f}["']`).test(sheet + html)) found.push(`font ${f}`);
  }
  if (/border-left:\s*(?:[2-9]|\d{2,})px/.test(rules)) found.push("thick coloured left rule");
  // Motion only after a user action: every animation must sit under .is-running (set by a button) or be "none".
  for (const m of rules.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*([^;}]+)/g)) {
    if (!/none/.test(m[2]) && !/is-running/.test(m[1])) found.push(`animation on load: ${m[1].trim()}`);
  }
  // Cream page: light, warm and tinted.
  const bg = (sheet.match(/:root\s*\{[\s\S]*?--bg:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  if (bg) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (l > 0.9 && s > 0.15 && h >= 25 && h <= 65) found.push(`cream page ${bg}`);
  }
  return found;
}
for (const [page, sheetFile] of TELL_PAGES) {
  test(`${page}: none of the AI-look tells`, () => {
    assert.deepEqual(tellsIn(read(page), read(sheetFile)), []);
  });
}
module.exports = { tellsIn };

// ---------- the invoice check on the home page (it replaced the 3D page) ----------
test("invoice check: uses the invoice checker's own rules and samples, works from a button, and the old address forwards to it", () => {
  const html = read("index.html");
  assert.match(html, /<script src="assets\/js\/matcher\.js"><\/script>/);
  assert.match(html, /<script src="assets\/js\/samples\.js"><\/script>/);
  assert.match(html, /<script src="assets\/js\/match\.js"><\/script>/);
  assert.match(html, /<button type="button" class="btn btn-primary" data-check>Check<\/button>/, "a keyboard and screen-reader way to run the check");
  assert.match(html, /aria-live="polite"/, "the result is announced");
  assert.ok(!/<canvas/.test(html) && !fs.existsSync(path.join(ROOT, "3d/vendor/three.module.min.js")), "no WebGL scene");
  assert.match(read("3d/index.html"), /http-equiv="refresh" content="0; url=\.\.\/index\.html#invoice"/, "old demo address forwards");
  const { spawnSync } = require("child_process");
  const r = spawnSync(process.execPath, ["--check", path.join(ROOT, "assets/js/match.js")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("invoice check: what it says after a check matches the real result for every sample bill", () => {
  const M = require(path.join(ROOT, "assets/js/matcher.js"));
  const S = require(path.join(ROOT, "assets/js/samples.js"));
  const { verdictText } = require(path.join(ROOT, "assets/js/match.js"));
  for (const s of S) {
    const r = M.check(s.order, s.invoice);
    const lines = verdictText(r, M.formatMoney);
    if (r.verdict === "match") assert.equal(lines[0], "Matches the order. Ready to pay.", s.id);
    if (r.checkCount) assert.match(lines[0], new RegExp(`^${r.checkCount} things? to check before paying\\.$`), s.id);
    if (r.queryCents > 0) assert.equal(lines[1], `${M.formatMoney(r.queryCents)} to raise with the supplier, before GST.`, s.id);
    else assert.equal(lines.length, 1, s.id);
  }
  const shi = S.find((s) => s.invoice.number === "SHI-7731");
  assert.deepEqual(verdictText(M.check(shi.order, shi.invoice), M.formatMoney),
    ["2 things to check before paying.", "$225.00 to raise with the supplier, before GST."], "the bill shown first");
});

test("invoice check: the first bill is built into the page, exactly as the script draws it, so nothing jumps on load", () => {
  const M = require(path.join(ROOT, "assets/js/matcher.js"));
  const S = require(path.join(ROOT, "assets/js/samples.js"));
  const D = require(path.join(ROOT, "assets/js/match.js"));
  const html = read("index.html");
  assert.ok(html.includes(D.orderHTML(S[D.FIRST].order, M)), "purchase order differs from the script's");
  assert.ok(html.includes(D.invoiceHTML(S[D.FIRST].invoice, M)), "invoice differs from the script's");
  assert.ok(html.includes(D.billsHTML(S, D.FIRST)), "bill list differs from the script's");
});
