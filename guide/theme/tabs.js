/* `:::tabs` with `:::tab Title` children becomes a real tab set with the ARIA pattern.
   Without this file the sections stay visible, one after another, each with its heading —
   the content is never hidden behind a control that does not work. */
(function () {
  var containers = document.querySelectorAll(".tabs");
  if (!containers.length) return;

  Array.prototype.forEach.call(containers, function (container) {
    var tabs = Array.prototype.slice.call(container.querySelectorAll(":scope > .tab"));
    if (tabs.length < 2) return;

    var list = document.createElement("div");
    list.className = "tab-list";
    list.setAttribute("role", "tablist");

    container.insertBefore(list, tabs[0]);

    tabs.forEach(function (tab, index) {
      var title = tab.querySelector("h3");
      var name = tab.dataset.tab || (title ? title.textContent : "Tab " + (index + 1));
      if (title) title.remove();

      tab.classList.add("tab-panel");
      tab.id = tab.id || "tab-panel-" + index + "-" + Math.random().toString(36).slice(2, 7);
      tab.setAttribute("role", "tabpanel");
      tab.setAttribute("aria-label", name);
      tab.hidden = index !== 0;

      var button = document.createElement("button");
      button.type = "button";
      button.className = "tab-button";
      button.textContent = name;
      button.id = "tab-" + index + "-" + Math.random().toString(36).slice(2, 7);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", tab.id);
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
      button.tabIndex = index === 0 ? 0 : -1;
      list.appendChild(button);

      button.addEventListener("click", function () {
        activate(index, true);
      });

      button.addEventListener("keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        activate(next, true);
      });
    });

    function activate(index, focus) {
      tabs.forEach(function (tab, i) {
        var button = list.children[i];
        var selected = i === index;
        tab.hidden = !selected;
        button.setAttribute("aria-selected", selected ? "true" : "false");
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      });
    }
  });
})();
