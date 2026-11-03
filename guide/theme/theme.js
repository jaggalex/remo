/* Light, dark or the system's choice. The first paint is handled by a tiny inline script
   in <head>; this file owns the toggle and keeps "system" live when the OS changes. */
(function () {
  var KEY = "guide.theme";
  var root = document.documentElement;
  var button = document.getElementById("theme-toggle");
  var icon = document.getElementById("theme-icon");
  if (!button || !icon) return;

  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var labels = {
    ru: {
      system: "Тема: как в системе. Переключить на светлую",
      light: "Тема: светлая. Переключить на тёмную",
      dark: "Тема: тёмная. Переключить на системную",
    },
    en: {
      system: "Theme: system. Switch to light",
      light: "Theme: light. Switch to dark",
      dark: "Theme: dark. Switch to system",
    },
  }[root.lang === "en" ? "en" : "ru"];

  function stored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return value === "light" || value === "dark" || value === "system" ? value : "system";
    } catch {
      return "system";
    }
  }

  function apply(mode) {
    var dark = mode === "dark" || (mode === "system" && media.matches);
    root.dataset.theme = dark ? "dark" : "light";
    icon.textContent = mode === "system" ? "◐" : mode === "dark" ? "☾" : "☀";
    button.setAttribute("aria-label", labels[mode]);
    button.setAttribute("title", labels[mode]);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#1d1b1a" : "#fcfbfa");
  }

  function set(mode) {
    try {
      window.localStorage.setItem(KEY, mode);
    } catch {
      /* a private window keeps the choice for this page only */
    }
    apply(mode);
  }

  var order = ["system", "light", "dark"];
  button.addEventListener("click", function () {
    var next = order[(order.indexOf(stored()) + 1) % order.length];
    set(next);
  });

  // "System" must follow the OS without a reload.
  media.addEventListener("change", function () {
    if (stored() === "system") apply("system");
  });

  apply(stored());
})();
