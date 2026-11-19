/* Search is a dialog, not a panel under the header.
 *
 * The data source is behind one seam: `createSearchSource(url)` returns an object with
 * `load()`. Today it fetches the generated `search.json`; a real search service replaces
 * that function and nothing else in this file changes.
 *
 * Keyboard: Ctrl/⌘+K or the button opens it, ↑ ↓ move, Enter opens, Esc closes and the
 * focus returns to whatever opened it. The result count is announced politely.
 */
(function () {
  var SOURCE_URL = "/guide/search.json";
  var MAX_RESULTS = 12;

  function createSearchSource(url) {
    var cache = null;
    var pending = null;
    return {
      load: function (locale) {
        if (cache) return Promise.resolve(cache[locale] || []);
        if (!pending) {
          pending = fetch(url)
            .then(function (response) {
              if (!response.ok) throw new Error("HTTP " + response.status);
              return response.json();
            })
            .then(function (data) {
              cache = data;
              pending = null;
              return cache[locale] || [];
            })
            .catch(function (error) {
              pending = null;
              throw error;
            });
        }
        return pending.then(function () {
          return cache[locale] || [];
        });
      },
    };
  }

  var dialog = document.getElementById("search-dialog");
  var opener = document.getElementById("search-open");
  if (!dialog || !opener) return;

  var input = document.getElementById("search-input");
  var list = document.getElementById("search-results");
  var status = document.getElementById("search-status");
  var panel = dialog.querySelector(".search-panel");
  var locale = document.documentElement.lang === "en" ? "en" : "ru";
  var source = createSearchSource(SOURCE_URL);
  var pages = null;
  var results = [];
  var active = -1;
  var lastFocus = null;
  var seq = 0;

  var strings = {
    ru: {
      empty: "Ничего не найдено. Попробуйте другое слово.",
      error: "Поиск недоступен: не удалось загрузить индекс.",
      loading: "Ищу…",
      found: function (n) {
        return "Найдено: " + n;
      },
    },
    en: {
      empty: "Nothing found. Try another word.",
      error: "Search is unavailable: the index could not be loaded.",
      loading: "Searching…",
      found: function (n) {
        return "Found: " + n;
      },
    },
  }[locale];

  // On a Mac the shortcut reads ⌘K; on everything else Ctrl K.
  var keyHint = document.getElementById("search-key");
  if (keyHint && /Mac|iPhone|iPad/.test(navigator.platform || "")) keyHint.textContent = "⌘K";

  function isOpen() {
    return !dialog.hidden;
  }

  function setStatus(text) {
    status.textContent = text;
  }

  // Clears the rendered options only; `results` belongs to the current query.
  function clearList() {
    list.innerHTML = "";
    active = -1;
    input.removeAttribute("aria-activedescendant");
  }

  function render() {
    clearList();
    if (!results.length) return;
    results.forEach(function (page, index) {
      var item = document.createElement("li");
      item.id = "search-result-" + index;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      var link = document.createElement("a");
      link.href = page.url;
      link.innerHTML =
        '<span class="search-result-title"></span>' +
        '<span class="search-result-section"></span>' +
        '<span class="search-result-snippet"></span>';
      link.querySelector(".search-result-title").textContent = page.title;
      link.querySelector(".search-result-section").textContent = page.section || "";
      link.querySelector(".search-result-snippet").textContent = snippet(page);
      item.appendChild(link);
      list.appendChild(item);
    });
    setActive(0);
  }

  function snippet(page) {
    var query = input.value.trim();
    if (!query) return page.summary || "";
    var text = page.text || "";
    var at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) return page.summary || "";
    var start = Math.max(0, at - 60);
    var end = Math.min(text.length, at + query.length + 90);
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }

  function setActive(index) {
    active = index;
    Array.prototype.forEach.call(list.children, function (item, i) {
      var selected = i === index;
      item.setAttribute("aria-selected", selected ? "true" : "false");
      item.classList.toggle("active", selected);
    });
    if (index >= 0 && list.children[index]) {
      input.setAttribute("aria-activedescendant", list.children[index].id);
      list.children[index].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function search(query) {
    var words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      results = [];
      setStatus("");
      clearList();
      return;
    }
    var matches = pages.filter(function (page) {
      var haystack = (page.title + " " + page.summary + " " + page.text).toLowerCase();
      return words.every(function (word) {
        return haystack.indexOf(word) !== -1;
      });
    });
    results = matches.slice(0, MAX_RESULTS);
    if (!matches.length) {
      results = [];
      setStatus(strings.empty);
      clearList();
      return;
    }
    setStatus(strings.found(matches.length));
    render();
  }

  function open() {
    if (isOpen()) return;
    // A shortcut can fire with nothing focused; the button is the honest return point.
    lastFocus = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : opener;
    results = [];
    dialog.hidden = false;
    document.body.classList.add("search-open");
    input.value = "";
    clearList();
    setStatus(pages ? "" : strings.loading);
    input.focus();

    if (!pages) {
      source
        .load(locale)
        .then(function (data) {
          pages = data;
          setStatus("");
        })
        .catch(function () {
          setStatus(strings.error);
        });
    }
  }

  function close() {
    if (!isOpen()) return;
    dialog.hidden = true;
    document.body.classList.remove("search-open");
    clearList();
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function trapFocus(event) {
    var focusable = panel.querySelectorAll("input, a[href], button");
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  opener.addEventListener("click", open);
  dialog.addEventListener("click", function (event) {
    if (event.target.closest("[data-close]")) close();
  });

  document.addEventListener("keydown", function (event) {
    var command = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    if (command) {
      event.preventDefault();
      if (isOpen()) close();
      else open();
      return;
    }
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      trapFocus(event);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) setActive((active + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActive((active - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      var item = results[active];
      if (item) {
        event.preventDefault();
        window.location.href = item.url;
      }
    }
  });

  input.addEventListener("input", function () {
    var token = ++seq;
    var query = input.value.trim();
    if (!query) {
      results = [];
      setStatus("");
      clearList();
      return;
    }
    if (!pages) {
      setStatus(strings.loading);
      source
        .load(locale)
        .then(function (data) {
          pages = data;
          if (token === seq) search(input.value.trim());
        })
        .catch(function () {
          if (token === seq) setStatus(strings.error);
        });
      return;
    }
    search(query);
  });
})();
