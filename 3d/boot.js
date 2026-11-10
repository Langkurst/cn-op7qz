/*
  Decides between the 3D desk and the flat view, wires up Copy email and the view switch,
  and only then loads the 3D code, so the text is readable before any 3D arrives.
  No cookies, no tracking. The view choice is kept in this browser only.
*/
const root = document.documentElement;
root.classList.add("js");

function canUseWebGL() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch (e) { return false; }
}
function savedView() {
  try { return localStorage.getItem("view-3d"); } catch (e) { return null; }
}
function saveView(v) {
  try { localStorage.setItem("view-3d", v); } catch (e) { /* the choice lasts for this page only */ }
}

const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const saveData = !!(navigator.connection && navigator.connection.saveData);
const webgl = canUseWebGL();
let wantFlat = params.has("flat") || reduceMotion || saveData;
if (savedView() === "flat") wantFlat = true;
if (savedView() === "3d" && !params.has("flat")) wantFlat = false;
const flat = wantFlat || !webgl;
root.classList.add(flat ? "flat" : "three");

// ----- view switch
const toggle = document.querySelector("[data-view-toggle]");
if (toggle) {
  if (!webgl) toggle.hidden = true;
  toggle.textContent = flat ? "3D view" : "Flat view";
  toggle.setAttribute("aria-label", flat ? "Switch to the 3D view" : "Switch to the flat view, without 3D");
  toggle.addEventListener("click", () => {
    saveView(flat ? "3d" : "flat");
    const url = new URL(location.href);
    url.searchParams.delete("flat");
    location.replace(url.toString());
  });
}

// ----- Copy email
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
  const box = document.createElement("textarea");
  box.value = text; box.setAttribute("readonly", ""); box.style.position = "fixed"; box.style.opacity = "0";
  document.body.appendChild(box); box.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  box.remove();
  return ok;
}
document.querySelectorAll("[data-copy]").forEach((button) => {
  const label = button.textContent;
  const status = button.parentNode.querySelector("[data-copy-status]");
  let timer;
  button.addEventListener("click", async () => {
    const ok = await copyText(button.dataset.copy);
    button.textContent = ok ? "Copied" : "Select the address to copy it";
    if (status) status.textContent = ok ? "Email address copied." : "Copy did not work. Select the address to copy it.";
    clearTimeout(timer);
    timer = setTimeout(() => { button.textContent = label; if (status) status.textContent = ""; }, 2000);
  });
});

// ----- the 3D desk
if (!flat) {
  import("./scene.js")
    .then((m) => m.start(document.getElementById("scene")))
    .catch((err) => {
      // If anything goes wrong, fall back to the flat view rather than leave a blank page.
      console.warn("3D view unavailable:", err);
      root.classList.remove("three");
      root.classList.add("flat");
    });
}

// ----- running index on the right: which document is in view
const indexN = document.querySelector("[data-index-n]"), indexName = document.querySelector("[data-index-name]");
const stopsForIndex = [...document.querySelectorAll(".stop")];
if (indexN && indexName && "IntersectionObserver" in window) {
  const total = String(stopsForIndex.length).padStart(2, "0");
  const of = document.querySelector(".index-of");
  if (of) of.textContent = "/ " + total;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const i = stopsForIndex.indexOf(e.target);
      indexN.textContent = String(i + 1).padStart(2, "0");
      indexName.textContent = e.target.dataset.name || "";
    });
  }, { rootMargin: "-45% 0px -45% 0px" });
  stopsForIndex.forEach((s) => io.observe(s));
}
