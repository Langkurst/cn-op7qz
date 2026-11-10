/*
  The desk at night: a pile of documents under a lamp. As the visitor scrolls, the top sheet
  is stamped CHECKED, then lifts, curls and slides onto the filed pile, showing the next one.

  The text on each sheet is read from the .paper cards in index.html, so the page has one
  source of wording. The scene is decorative (the canvas is aria-hidden); every word is in the HTML.
  It only draws a frame when something moves, and stops while the tab is hidden.
*/
import * as THREE from "./vendor/three.module.min.js";

const W = 1.0;                 // sheet width (A4 proportions)
const H = W * 1.414;
const SEG_X = 28;              // columns of vertices, so the sheet can curl smoothly
const GAP = 0.0055;            // paper thickness in the piles
const IN = { x: 0, z: 0 };     // the pile still to check
const OUT = { x: 1.7, z: 0.34 };  // the checked pile
const STAMP = [0.08, 0.30];    // part of the scroll between two sheets where the stamp lands
const FILE = [0.34, 0.96];     // part where the sheet is lifted across
const SANS = '"Geist", "Segoe UI", system-ui, -apple-system, Arial, sans-serif';
const MONO = '"Geist Mono", ui-monospace, Consolas, monospace';

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smooth = (v) => v * v * (3 - 2 * v);
const lerp = (a, b, t) => a + (b - a) * t;
const phase = (t, [a, b]) => smooth(clamp01((t - a) / (b - a)));

function seeded(seed) {
  let s = seed % 233280;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

function readPapers() {
  return [...document.querySelectorAll(".paper")].map((el) => ({
    label: (el.querySelector(".p-label")?.textContent || "").trim(),
    title: (el.querySelector(".p-title")?.textContent || "").trim(),
    lines: [...el.querySelectorAll(".p-line")].map((l) => l.textContent.trim()),
    rows: [...el.querySelectorAll(".p-row")].map((r) => [...r.children].map((c) => c.textContent.trim())),
    chips: [...el.querySelectorAll(".p-chip")].map((c) => ({ text: c.textContent.trim(), kind: c.classList.contains("money") ? "money" : c.classList.contains("contact") ? "contact" : "id" })),
    figure: (el.querySelector(".p-figure")?.textContent || "").trim(),
  }));
}

function wrap(g, text, maxW) {
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? line + " " + word : word;
    if (line && g.measureText(next).width > maxW) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function spacing(g, px) { if ("letterSpacing" in g) g.letterSpacing = px + "px"; }

function paperTexture(p, i, n, aniso) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 1448;
  const g = c.getContext("2d");
  g.fillStyle = "#f2eee4";
  g.fillRect(0, 0, c.width, c.height);
  const rnd = seeded(i * 97 + 13);
  for (let k = 0; k < 4000; k++) {           // paper fibre
    g.fillStyle = rnd() > 0.5 ? "rgba(120,105,80,0.035)" : "rgba(255,255,255,0.06)";
    g.fillRect(rnd() * 1024, rnd() * 1448, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // Printed like a real document: a mono header, a heavy title, ruled rows with values, and one big figure.
  const M = 92, R = 1024 - M, TW = R - M;
  const CHIP = { id: ["#fff0d9", "#efc27f", "#8a4b00"], money: ["#e7eeff", "#a7bdf0", "#234da8"], contact: ["#e2f3e7", "#97cfa9", "#1f6b3a"] };
  g.fillStyle = "#55524b";
  g.font = `500 28px ${MONO}`;
  spacing(g, 4);
  g.fillText(p.label.toUpperCase(), M, 132);
  g.textAlign = "right";
  g.fillText(`${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`, R, 132);
  g.textAlign = "left";
  spacing(g, 0);
  g.fillStyle = "#141413";
  g.fillRect(M, 160, TW, 4);

  let y = 290;
  g.fillStyle = "#141413";
  g.font = `650 84px ${SANS}`;
  spacing(g, -3);
  for (const l of wrap(g, p.title, TW)) { g.fillText(l, M, y); y += 90; }
  spacing(g, 0);
  y += 26;
  g.fillStyle = "#2c2a26";
  g.font = `450 44px ${SANS}`;
  for (const line of p.lines) {
    for (const l of wrap(g, line, TW)) { g.fillText(l, M, y); y += 56; }
    y += 14;
  }
  if (p.chips.length) {                       // placeholder chips, as NZ Redact shows them
    let x = M;
    g.font = `500 30px ${MONO}`;
    for (const c of p.chips) {
      const w = g.measureText(c.text).width + 32;
      if (x + w > R) { x = M; y += 64; }
      const [bg, line, ink] = CHIP[c.kind];
      g.fillStyle = bg; g.strokeStyle = line; g.lineWidth = 3;
      g.beginPath(); g.roundRect(x, y - 38, w, 52, 8); g.fill(); g.stroke();
      g.fillStyle = ink; g.fillText(c.text, x + 16, y);
      x += w + 14;
    }
    y += 52;
  }
  if (p.rows.length) {                        // ruled rows: label on the left, value on the right
    y += 18;
    for (const [a, b] of p.rows) {
      g.fillStyle = "#3a3732";
      g.font = `500 40px ${SANS}`;
      g.fillText(a || "", M, y);
      g.fillStyle = "#141413";
      g.font = `600 40px ${MONO}`;
      g.textAlign = "right";
      g.fillText(b || "", R, y);
      g.textAlign = "left";
      g.fillStyle = "rgba(20,20,19,0.18)";
      for (let dx = M; dx < R; dx += 14) g.fillRect(dx, y + 22, 7, 2);
      y += 84;
    }
  }
  if (p.figure) {
    g.fillStyle = "#1d5f67";
    g.font = `650 88px ${SANS}`;
    spacing(g, -3);
    const fl = wrap(g, p.figure, TW);
    let fy = 1296 - (fl.length - 1) * 96;
    for (const l of fl) { g.fillText(l, M, fy); fy += 96; }
    spacing(g, 0);
  }
  g.fillStyle = "rgba(20,20,19,0.14)";
  g.fillRect(M, 1340, TW, 2);
  g.fillStyle = "#6b675f";
  g.font = `400 24px ${MONO}`;
  g.fillText("Christopher Nottle · Auckland", M, 1390);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function stampTexture(aniso) {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 240;
  const g = c.getContext("2d");
  const ink = "rgba(29,127,114,0.95)";
  g.strokeStyle = ink;
  g.lineWidth = 14;
  g.beginPath();
  g.roundRect(14, 14, 612, 212, 28);
  g.stroke();
  g.lineWidth = 20; g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); g.moveTo(64, 124); g.lineTo(108, 170); g.lineTo(184, 74); g.stroke();
  g.fillStyle = ink;
  g.textBaseline = "middle";
  spacing(g, 6);
  let size = 110;
  do { g.font = `800 ${size}px ${SANS}`; size -= 4; } while (g.measureText("CHECKED").width > 380 && size > 40);
  g.fillText("CHECKED", 222, 128);
  g.globalCompositeOperation = "destination-out";   // worn ink
  const r = seeded(4242);
  for (let k = 0; k < 1600; k++) {
    g.fillStyle = `rgba(0,0,0,${0.2 + 0.5 * r()})`;
    g.fillRect(r() * 640, r() * 240, 1 + 2 * r(), 1 + 2 * r());
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function tableTexture(aniso) {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#151d20";
  g.fillRect(0, 0, 1024, 1024);
  const r = seeded(777);
  for (let k = 0; k < 220; k++) {            // long, soft grain
    const y = r() * 1024, h = 1 + r() * 2;
    g.fillStyle = r() > 0.5 ? "rgba(255,240,220,0.010)" : "rgba(0,0,0,0.028)";
    g.fillRect(0, y, 1024, h);
  }
  for (let k = 0; k < 24000; k++) {
    g.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.05)";
    g.fillRect(r() * 1024, r() * 1024, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.anisotropy = aniso;
  return t;
}

function makeSheet(texture, stampTex) {
  const geo = new THREE.PlaneGeometry(W, H, SEG_X, 2);
  const base = Float32Array.from(geo.attributes.position.array);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.rotation.x = -Math.PI / 2;             // lie flat, text towards the camera
  const stampW = 0.46;
  // The stamp is drawn into its own small mesh in the sheet's coordinates, so it can bend with the paper.
  const stampGeo = new THREE.PlaneGeometry(stampW, stampW * 240 / 640, 12, 1);
  const sa = stampGeo.attributes.position.array;
  const rz = 0.16, cx = -0.08, cy = -0.14;
  for (let k = 0; k < sa.length; k += 3) {           // rotate and move it onto the sheet once
    const x = sa[k], y = sa[k + 1];
    sa[k] = cx + x * Math.cos(rz) - y * Math.sin(rz);
    sa[k + 1] = cy + x * Math.sin(rz) + y * Math.cos(rz);
  }
  const stampBase = Float32Array.from(sa);
  const stamp = new THREE.Mesh(stampGeo,
    new THREE.MeshBasicMaterial({ map: stampTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  stamp.position.z = 0.0025;
  stamp.renderOrder = 2;
  mesh.add(stamp);
  const group = new THREE.Group();
  group.rotation.order = "YZX";
  group.add(mesh);
  return { group, mesh, geo, base, stamp, stampGeo, stampBase, curl: -1 };
}

// Lift the right-hand edge in a smooth bend, and keep the stamp sitting on the paper.
function setCurl(s, amount) {
  if (Math.abs(s.curl - amount) < 1e-4) return;
  s.curl = amount;
  const pos = s.geo.attributes.position;
  const a = pos.array;
  for (let k = 0; k < pos.count; k++) {
    const u = (s.base[k * 3] + W / 2) / W;
    a[k * 3 + 2] = amount * u * u * W * 0.6;
  }
  pos.needsUpdate = true;
  s.geo.computeVertexNormals();
  const sp = s.stampGeo.attributes.position;          // same bend for the stamp, so it never sinks into the paper
  for (let k = 0; k < sp.count; k++) {
    const u = (s.stampBase[k * 3] + W / 2) / W;
    sp.array[k * 3 + 2] = amount * u * u * W * 0.6;
  }
  sp.needsUpdate = true;
}

// Scale the stamp about its own centre on the sheet (it is built in sheet coordinates).
function setStamp(s, opacity, scale) {
  s.stamp.material.opacity = opacity;
  const cx = -0.08, cy = -0.14;
  s.stamp.scale.set(scale, scale, 1);
  s.stamp.position.x = cx * (1 - scale);
  s.stamp.position.y = cy * (1 - scale);
}

export async function start(canvas) {
  const root = document.documentElement;
  // Draw the sheets only once the fonts are ready, so the printed text uses Geist, not a fallback.
  if (document.fonts && document.fonts.load) {
    await Promise.all([`650 84px ${SANS}`, `400 40px ${SANS}`, `500 28px ${MONO}`].map((f) => document.fonts.load(f).catch(() => null)));
  }
  const papers = readPapers();
  const n = papers.length;
  if (!n) throw new Error("no sheets found");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;   // keeps printed ink dark; the filmic curve washed it out
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1012);
  scene.fog = new THREE.Fog(0x0b1012, 6, 13);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);

  scene.add(new THREE.HemisphereLight(0xc9d6d8, 0x2a2622, 1.1));
  const lamp = new THREE.SpotLight(0xffeedd, 120, 12, Math.PI / 5.5, 0.75, 1.4);
  lamp.position.set(-1.1, 4.1, 1.7);
  lamp.target.position.set(0.78, 0, 0.15);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 1;
  lamp.shadow.camera.far = 9;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.012;
  if ("intensity" in lamp.shadow) lamp.shadow.intensity = 0.7;   // softer, lighter shadows where supported
  scene.add(lamp, lamp.target);
  const rim = new THREE.DirectionalLight(0xcfd8da, 0.12);
  rim.position.set(3, 2, -2.5);
  scene.add(rim);

  const table = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map: tableTexture(aniso), roughness: 0.92, metalness: 0 }));
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  const stampTex = stampTexture(aniso);
  const rnd = seeded(2026);
  // One sheet at a time, with a pause between, so drawing nine textures never blocks the page for long.
  const textures = [];
  for (let i = 0; i < n; i++) {
    textures.push(paperTexture(papers[i], i, n, aniso));
    await new Promise((r) => setTimeout(r, 0));
  }
  const sheets = papers.map((p, i) => {
    const s = makeSheet(textures[i], stampTex);
    s.yawIn = (rnd() - 0.5) * 0.16;
    s.yawOut = 0.07 + (rnd() - 0.5) * 0.1;
    s.dxIn = (rnd() - 0.5) * 0.05;
    s.dzIn = (rnd() - 0.5) * 0.05;
    scene.add(s.group);
    return s;
  });

  // ----- camera framing: the piles sit to the right of the text on wide screens, above it on narrow ones
  const look = new THREE.Vector3();
  const camBase = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  // The piles are framed into the free space: right of the text panel on wide screens, above it on narrow ones.
  // setViewOffset moves the picture's centre without turning the camera, so the perspective stays the same.
  const panel = document.querySelector(".panel");
  function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    const wide = w >= 896;                       // matches the 56rem breakpoint in style.css
    const panelRight = wide && panel ? Math.min(panel.getBoundingClientRect().right, w * 0.6) : 0;
    const availW = wide ? w - panelRight : w;
    const availH = wide ? h * 0.8 : h * 0.42;
    const dx = wide ? (panelRight + w) / 2 - w / 2 : 0;
    const dy = wide ? 0 : -(h / 2 - h * 0.26);
    const fullW = w + 2 * Math.abs(dx), fullH = h + 2 * Math.abs(dy);
    camera.aspect = fullW / fullH;
    camera.fov = wide ? 30 : 38;
    camera.setViewOffset(fullW, fullH, dx > 0 ? 0 : 2 * Math.abs(dx), dy > 0 ? 0 : 2 * Math.abs(dy), w, h);
    camera.updateProjectionMatrix();
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const spanW = 2.4, spanH = 1.5;             // the pile to check fills the frame; the filed pile sits at the edge            // both piles across, and their depth as seen from above at an angle
    const dist = Math.max(3.0,
      (spanW * fullH) / (2 * tanH * availW * 0.88),
      (spanH * fullH) / (2 * tanH * availH * 0.9));
    look.set((IN.x + OUT.x) / 2, 0, 0.18);
    const dir = new THREE.Vector3(-0.12, 1, 0.92).normalize();
    camBase.copy(look).addScaledVector(dir, dist);
    scene.fog.near = dist + 1.2;                // fog only beyond the piles, whatever the camera distance
    scene.fog.far = dist + 8;
    camera.position.copy(camBase);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    dirty = true;
  }

  // ----- scroll position to "which sheet": 0 when the first panel is centred, 1 at the second, and so on
  const stops = [...document.querySelectorAll(".stop")];
  function targetFromScroll() {
    const mid = window.scrollY + window.innerHeight * 0.5;
    const centres = stops.map((s) => s.offsetTop + s.offsetHeight / 2);
    if (mid <= centres[0]) return 0;
    for (let i = 0; i < centres.length - 1; i++) {
      if (mid < centres[i + 1]) return i + (mid - centres[i]) / (centres[i + 1] - centres[i]);
    }
    return n - 1;
  }

  function place(cur) {
    for (let i = 0; i < n; i++) {
      const s = sheets[i];
      const t = i === n - 1 ? 0 : clamp01(cur - i);     // the last sheet (contact) stays on the desk
      const st = phase(t, STAMP);
      setStamp(s, st * 0.92, 1.35 - 0.35 * st);
      const u = phase(t, FILE);
      const lift = Math.sin(Math.PI * u);
      const yIn = (n - 1 - i) * GAP, yOut = i * GAP;
      s.group.position.set(
        lerp(IN.x + s.dxIn, OUT.x, u),
        lerp(yIn, yOut, u) + lift * 0.5 + 0.001,
        lerp(IN.z + s.dzIn, OUT.z, u),
      );
      s.group.rotation.set(0, lerp(s.yawIn, s.yawOut, u), lift * 0.22);
      setCurl(s, lift * 0.55);
    }
  }

  let target = targetFromScroll();
  let cur = target;
  let dirty = true;
  const par = { x: 0, y: 0 }, parTarget = { x: 0, y: 0 };
  const clock = new THREE.Clock();

  layout();
  place(cur);

  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const before = cur;
    cur += (target - cur) * (1 - Math.exp(-dt * 7));
    if (Math.abs(target - cur) < 1e-4) cur = target;
    const pk = 1 - Math.exp(-dt * 4);
    const px = par.x, py = par.y;
    par.x += (parTarget.x - par.x) * pk;
    par.y += (parTarget.y - par.y) * pk;
    const moving = cur !== before || Math.abs(par.x - px) > 1e-5 || Math.abs(par.y - py) > 1e-5;
    if (!moving && !dirty) return;
    place(cur);
    camera.position.copy(camBase).addScaledVector(right, par.x * 0.16).addScaledVector(up, par.y * 0.1);
    camera.lookAt(look);
    renderer.render(scene, camera);
    dirty = false;
    if (!canvas.classList.contains("ready")) canvas.classList.add("ready");
  }
  requestAnimationFrame(frame);

  window.addEventListener("scroll", () => { target = targetFromScroll(); }, { passive: true });
  window.addEventListener("resize", () => { layout(); target = targetFromScroll(); });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;      // touch would leave the tilt stuck
    parTarget.x = (e.clientX / window.innerWidth - 0.5) * 2;
    parTarget.y = -(e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });
  document.addEventListener("visibilitychange", () => { clock.getDelta(); dirty = true; });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    root.classList.remove("three");
    root.classList.add("flat");
  });

  // For checks in a real browser: the current position and how many frames have been drawn.
  window.__desk = { get position() { return cur; }, sheets: n, renderer, camera, scene, lamp, jump(p) { cur = target = p; dirty = true; } };
}
