/* Two behaviours of the reading column: the table of contents follows the scroll, and the
   section menu remembers which groups are open.

   Both are progressive: without this file the page still works (the menu is open, the ToC
   is a list of anchors). */
(function () {
  /* ---------------------------------------------------------- section menu -- */

  var groups = Array.prototype.slice.call(document.querySelectorAll("details.nav-group"));
  var STORE = "guide.nav.";

  groups.forEach(function (group) {
    var key = STORE + group.dataset.section;
    var stored = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      stored = null;
    }
    var current = Boolean(group.querySelector('a[aria-current="page"]'));
    if (stored === "closed" && !current) group.open = false;
    if (stored === "open") group.open = true;

    group.addEventListener("toggle", function () {
      try {
        window.localStorage.setItem(key, group.open ? "open" : "closed");
      } catch {
        /* a private window simply forgets the choice */
      }
    });
  });

  /* ------------------------------------------------------------ contents -- */

  var toc = document.querySelector(".toc-col");
  if (!toc) return;

  var links = Array.prototype.slice.call(toc.querySelectorAll("a[data-target]"));
  if (!links.length) return;

  var targets = links
    .map(function (link) {
      var heading = document.getElementById(link.dataset.target);
      return heading ? { id: link.dataset.target, heading: heading, link: link } : null;
    })
    .filter(Boolean);
  if (!targets.length) return;

  var header = document.querySelector(".top");
  var offset = (header ? header.getBoundingClientRect().height : 56) + 24;
  var active = null;
  var ticking = false;

  function update() {
    ticking = false;
    var current = targets[0];
    for (var i = 0; i < targets.length; i += 1) {
      if (targets[i].heading.getBoundingClientRect().top - offset <= 1) current = targets[i];
    }
    if (current === active) return;
    if (active) active.link.removeAttribute("aria-current");
    active = current;
    active.link.setAttribute("aria-current", "location");
  }

  function request() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request);
  update();
})();
