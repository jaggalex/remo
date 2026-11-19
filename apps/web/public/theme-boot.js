/*
 * Paint the stored theme before the first frame, so a dark-theme person never sees a
 * white flash while the bundle loads. A classic, blocking script on purpose.
 *
 * It is a file rather than an inline <script> so the Content-Security-Policy can say
 * `script-src 'self'` with no hash or nonce to keep in step with index.html (ADR-172).
 * `useTheme` reads the same `remo.theme` key once the app is running.
 */
(function () {
  try {
    var stored = localStorage.getItem("remo.theme") || "system";
    var dark =
      stored === "dark" ||
      (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (error) {
    /* storage blocked: the app picks the theme itself once it starts */
  }
})();
