/* Copy is a promise: the button says what it does, and the page confirms it happened.
   Works for code blocks and for section links; if the clipboard is unavailable the
   confirmation says so instead of pretending. */
(function () {
  var label = document.documentElement.lang === "en"
    ? { code: "Copy", copied: "Copied", failed: "Could not copy", link: "Copy link to this section" }
    : { code: "Копировать", copied: "Скопировано", failed: "Не удалось скопировать", link: "Скопировать ссылку на раздел" };

  var toast = document.createElement("p");
  toast.className = "copy-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.appendChild(toast);
  var timer = null;

  function announce(text) {
    toast.textContent = text;
    toast.classList.add("visible");
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      toast.classList.remove("visible");
    }, 2000);
  }

  function write(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (error) {
        reject(error);
      } finally {
        document.body.removeChild(area);
      }
    });
  }

  /* ------------------------------------------------------------------ code -- */

  Array.prototype.forEach.call(document.querySelectorAll("article pre"), function (pre) {
    // A fenced block without a language is a diagram, not code: it gets no copy button.
    var code = pre.querySelector("code");
    if (!code || !/\blanguage-/.test(code.className)) return;

    var block = document.createElement("div");
    block.className = "code-block";
    pre.parentNode.insertBefore(block, pre);
    block.appendChild(pre);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = label.code;
    button.setAttribute("aria-label", label.code);
    block.appendChild(button);

    button.addEventListener("click", function () {
      write(pre.textContent)
        .then(function () {
          button.textContent = label.copied;
          announce(label.copied);
          window.setTimeout(function () {
            button.textContent = label.code;
          }, 1600);
        })
        .catch(function () {
          announce(label.failed);
        });
    });
  });

  /* --------------------------------------------------------------- anchors -- */

  Array.prototype.forEach.call(document.querySelectorAll("article h2[id], article h3[id], article h4[id]"), function (heading) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "anchor-copy";
    button.textContent = "#";
    button.setAttribute("aria-label", label.link);
    button.setAttribute("title", label.link);
    heading.appendChild(button);

    button.addEventListener("click", function () {
      var url = window.location.origin + window.location.pathname + "#" + heading.id;
      write(url)
        .then(function () {
          announce(label.copied);
          if (window.history.replaceState) window.history.replaceState(null, "", "#" + heading.id);
        })
        .catch(function () {
          announce(label.failed);
        });
    });
  });
})();
