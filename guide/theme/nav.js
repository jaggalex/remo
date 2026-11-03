/* The section menu on a phone is a drawer, not a five-screen list before the article.
   Desktop keeps the sticky column; below 900px the same nav becomes off-canvas. */
(function () {
  var toggle = document.getElementById("menu-toggle");
  var nav = document.getElementById("guide-nav");
  var scrim = document.getElementById("scrim");
  if (!toggle || !nav || !scrim) return;

  var narrow = window.matchMedia("(max-width: 767px)");
  var lastFocus = null;

  function isOpen() {
    return nav.classList.contains("open");
  }

  function open() {
    if (!narrow.matches) return;
    lastFocus = document.activeElement;
    nav.classList.add("open");
    scrim.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("nav-open");
    var first = nav.querySelector("a");
    if (first) first.focus();
  }

  function close(returnFocus) {
    if (!isOpen()) return;
    nav.classList.remove("open");
    scrim.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-open");
    if (returnFocus && lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  toggle.addEventListener("click", function () {
    if (isOpen()) close(true);
    else open();
  });

  scrim.addEventListener("click", function () {
    close(true);
  });

  nav.addEventListener("click", function (event) {
    if (event.target.closest("a")) close(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isOpen()) close(true);
  });

  // Leaving the narrow layout must not leave the page with a locked scroll.
  narrow.addEventListener("change", function () {
    if (!narrow.matches) close(false);
  });
})();
