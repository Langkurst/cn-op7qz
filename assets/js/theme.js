/*
  Runs before the page paints, so the chosen theme shows straight away.
  It follows the device's light or dark setting until the visitor picks one.
  That choice is kept in their own browser only.
*/
(function () {
  var theme = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch (e) { /* storage blocked: stay on the default */ }
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.add("js");
})();
