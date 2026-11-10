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
  assert.equal((css.match(/@keyframes/g) || []).length, 1, "one piece of motion only");
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

test("3d page: every sheet has a label and a title, and the scene stays decorative", () => {
  const html = read("3d/index.html");
  const papers = html.split('class="paper"').length - 1;
  const stops = html.split('class="stop"').length - 1;
  assert.equal(papers, stops, "one paper card per section");
  assert.equal((html.match(/class="p-label"/g) || []).length, papers);
  assert.equal((html.match(/class="p-title"/g) || []).length, papers);
  assert.match(html, /<canvas id="scene" aria-hidden="true">/);
  assert.match(html, /href="\.\.\/index\.html"/, "links back to the plain site");
});

test("3d page: falls back to the flat view, and loads the 3D code only when it will be used", () => {
  const boot = read("3d/boot.js");
  assert.match(boot, /prefers-reduced-motion: reduce/);
  assert.match(boot, /webgl2/);
  assert.match(boot, /saveData/);
  assert.match(boot, /if \(!flat\) \{\s*import\("\.\/scene\.js"\)/);
  assert.ok(!/^import /m.test(boot), "boot.js must not import three.js up front");
  assert.ok(fs.existsSync(path.join(ROOT, "3d/vendor/three.module.min.js")));
  assert.ok(fs.existsSync(path.join(ROOT, "3d/vendor/LICENSE-three.txt")));
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

test("3d page: the 3D scripts parse, so a typo can't quietly drop every visitor to the flat view", () => {
  const { spawnSync } = require("child_process");
  for (const f of ["3d/scene.js", "3d/boot.js"]) {
    const r = spawnSync(process.execPath, ["--check", path.join(ROOT, f)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});
