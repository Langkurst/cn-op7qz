/*
  Runs before the page paints, so the chosen theme shows straight away.
  Light is the default. A visitor's choice of light or dark is kept in their own browser only.
*/
(function () {
  var theme = "light";
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch (e) { /* storage blocked: stay on the default */ }
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.add("js");
})();
