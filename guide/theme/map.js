/* The capability map is a table in Markdown and a set of cards in the browser.
   One source of truth, two readings: "I want to scan everything" and "I want to find one
   thing". Filtering works on both views; an empty result says so and offers a reset. */
(function () {
  var table = document.querySelector("article table");
  var wrap = table && table.closest(".table-wrap");
  if (!table || !wrap) return;

  var en = document.documentElement.lang === "en";
  var text = {
    search: en ? "Filter by name or description" : "Фильтр по названию или описанию",
    category: en ? "Category" : "Категория",
    all: en ? "All categories" : "Все категории",
    table: en ? "Table" : "Таблица",
    cards: en ? "Cards" : "Карточки",
    empty: en ? "Nothing matches these filters." : "Под фильтры ничего не подошло.",
    reset: en ? "Reset filters" : "Сбросить фильтры",
    more: en ? "Read more" : "Подробнее",
  };

  var NAMES = {
    title: ["Возможность", "Capability"],
    category: ["Категория", "Category"],
    task: ["Задача", "Task"],
    result: ["Результат", "Result"],
    more: ["Подробнее", "More"],
  };

  var headers = Array.prototype.map.call(table.querySelectorAll("thead th"), function (cell) {
    return cell.textContent.trim();
  });
  function indexOf(name) {
    var variants = NAMES[name];
    for (var i = 0; i < headers.length; i += 1) {
      if (variants.indexOf(headers[i]) !== -1) return i;
    }
    return -1;
  }

  var cols = {
    title: indexOf("title"),
    category: indexOf("category"),
    task: indexOf("task"),
    result: indexOf("result"),
    more: indexOf("more"),
  };
  if (cols.title < 0) return;

  var rows = Array.prototype.map.call(table.querySelectorAll("tbody tr"), function (tr) {
    var cells = tr.children;
    var link = cells[cols.title] && cells[cols.title].querySelector("a");
    var more = cols.more >= 0 && cells[cols.more] ? cells[cols.more].querySelector("a") : null;
    return {
      row: tr,
      title: link ? link.textContent.trim() : cells[cols.title].textContent.trim(),
      href: link ? link.getAttribute("href") : null,
      category: cols.category >= 0 ? cells[cols.category].textContent.trim() : "",
      task: cols.task >= 0 ? cells[cols.task].textContent.trim() : "",
      result: cols.result >= 0 ? cells[cols.result].textContent.trim() : "",
      moreHref: more ? more.getAttribute("href") : null,
    };
  });

  /* ------------------------------------------------------------- toolbar -- */

  var toolbar = document.createElement("div");
  toolbar.className = "map-tools";
  toolbar.innerHTML =
    '<label class="map-search"><span class="visually-hidden"></span>' +
    '<input type="search" autocomplete="off"></label>' +
    '<label class="map-category"><span class="visually-hidden"></span>' +
    '<select></select></label>' +
    '<div class="map-views" role="group">' +
    '<button type="button" data-view="table" aria-pressed="true"></button>' +
    '<button type="button" data-view="cards" aria-pressed="false"></button>' +
    "</div>" +
    '<p class="map-count" role="status" aria-live="polite"></p>';

  var input = toolbar.querySelector("input");
  var select = toolbar.querySelector("select");
  var count = toolbar.querySelector(".map-count");
  var tableButton = toolbar.querySelector('[data-view="table"]');
  var cardsButton = toolbar.querySelector('[data-view="cards"]');
  input.placeholder = text.search;
  input.setAttribute("aria-label", text.search);
  select.setAttribute("aria-label", text.category);
  tableButton.textContent = text.table;
  cardsButton.textContent = text.cards;

  var categories = [];
  rows.forEach(function (item) {
    if (item.category && categories.indexOf(item.category) === -1) categories.push(item.category);
  });
  select.innerHTML =
    '<option value="">' + text.all + "</option>" +
    categories.map(function (name) {
      return '<option value="' + name.replace(/"/g, "&quot;") + '">' + name + "</option>";
    }).join("");

  wrap.parentNode.insertBefore(toolbar, wrap);

  /* ---------------------------------------------------------------- cards -- */

  var cards = document.createElement("div");
  cards.className = "map-cards";
  cards.hidden = true;
  rows.forEach(function (item) {
    var card = document.createElement("article");
    card.className = "map-card";
    var heading = document.createElement("h3");
    if (item.href) {
      var link = document.createElement("a");
      link.href = item.href;
      link.textContent = item.title;
      heading.appendChild(link);
    } else {
      heading.textContent = item.title;
    }
    card.appendChild(heading);
    if (item.category) {
      var badge = document.createElement("p");
      badge.className = "map-card-category";
      badge.textContent = item.category;
      card.appendChild(badge);
    }
    var description = document.createElement("p");
    description.className = "map-card-description";
    description.textContent = item.result || item.task;
    card.appendChild(description);
    if (item.moreHref) {
      var more = document.createElement("a");
      more.className = "map-card-more";
      more.href = item.moreHref;
      more.textContent = text.more;
      card.appendChild(more);
    }
    item.card = card;
    cards.appendChild(card);
  });

  var empty = document.createElement("div");
  empty.className = "map-empty";
  empty.hidden = true;
  empty.innerHTML = '<p>' + text.empty + "</p>";
  var reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ghost-button";
  reset.textContent = text.reset;
  empty.appendChild(reset);

  wrap.parentNode.insertBefore(cards, wrap.nextSibling);
  wrap.parentNode.insertBefore(empty, cards.nextSibling);

  /* ---------------------------------------------------------------- state -- */

  var view = "table";

  function apply() {
    var query = input.value.trim().toLowerCase();
    var category = select.value;
    var shown = 0;

    rows.forEach(function (item) {
      var haystack = (item.title + " " + item.task + " " + item.result).toLowerCase();
      var matches = (!query || haystack.indexOf(query) !== -1) && (!category || item.category === category);
      item.row.hidden = !matches;
      if (item.card) item.card.hidden = !matches;
      if (matches) shown += 1;
    });

    empty.hidden = shown !== 0;
    count.textContent = en ? shown + " of " + rows.length : shown + " из " + rows.length;
    wrap.hidden = view !== "table" || shown === 0;
    cards.hidden = view !== "cards" || shown === 0;
  }

  function setView(next) {
    view = next;
    tableButton.setAttribute("aria-pressed", String(next === "table"));
    cardsButton.setAttribute("aria-pressed", String(next === "cards"));
    apply();
  }

  input.addEventListener("input", apply);
  select.addEventListener("change", apply);
  tableButton.addEventListener("click", function () {
    setView("table");
  });
  cardsButton.addEventListener("click", function () {
    setView("cards");
  });
  reset.addEventListener("click", function () {
    input.value = "";
    select.value = "";
    apply();
    input.focus();
  });

  apply();
})();
