import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as UI from "../index";
import type { UiKey, UiStrings } from "../i18n";

// Echo strings: the test proves components ask for keys, not that the words are right
// (the words are the product's i18n tables and are type-checked there).
const strings: UiStrings = {
  t: (key: UiKey, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key),
  count: (key, n) => `${n} ${key}`,
  locale: "ru-RU",
};
const render = (el: ReactElement) => renderToStaticMarkup(h(UI.UiStringsProvider, { value: strings }, el));

describe("components render with the strings contract", () => {
  const cases: [string, ReactElement][] = [
    ["Button", h(UI.Button, { variant: "primary", icon: "share" }, "Share")],
    ["IconButton", h(UI.IconButton, { icon: "more", label: "More" })],
    ["Input", h(UI.Input, { label: "Budget", error: "Too high", suffix: "$" })],
    ["Select", h(UI.Select, { label: "Model", options: ["a", "b"] })],
    ["Checkbox", h(UI.Checkbox, { label: "x", indeterminate: true })],
    ["Badge", h(UI.Badge, { tone: "success", icon: "check" }, "Done")],
    ["AvatarStack", h(UI.AvatarStack, { names: ["A B", "C D", "E", "F", "G"] })],
    ["Menu", h(UI.Menu, { items: [{ label: "Copy", shortcut: ["⌘", "C"] }, { separator: true }, { label: "Delete", danger: true }] })],
    ["ConfirmDialog", h(UI.ConfirmDialog, { inline: true, count: 12 })],
    ["Tabs", h(UI.Tabs, { tabs: [{ id: "a", label: "A", count: 3 }] })],
    ["Segmented", h(UI.Segmented, { options: [{ value: "5", label: "5" }, { value: "10", label: "10" }], value: "5", onChange: () => {} })],
    ["ChoiceCard", h(UI.ChoiceCard, { options: [{ value: "a", title: "A", hint: "h" }, { value: "b", title: "B" }], value: "a", onChange: () => {} })],
    ["Toast", h(UI.Toast, { tone: "danger", title: "x" })],
    ["TopBar", h(UI.TopBar, { boardName: "Retro", sync: "offline", readOnly: true, presence: ["A"] })],
    ["FloatingBar", h(UI.FloatingBar, { count: 3, actions: [{ icon: "lock", label: "Lock" }] })],
    ["AccessRow", h(UI.AccessRow, { name: "Maria", role: "editor", source: "Team PM", removable: true })],
    ["PublicLink", h(UI.PublicLink, { enabled: true, url: "https://example.test" })],
    ["JournalList", h(UI.JournalList, { entries: [{ seq: 1, time: "14:05", action: "x", agent: "a", model: "m", tokens: 1200, cost: 0.004, status: "failed" }] })],
    ["Sticker", h(UI.Sticker, { text: "x", state: "locked", lockedBy: "Alex", votes: 2 })],
    ["Connector", h(UI.Connector, { routing: "curved", head: "block", state: "selected", waypoints: [{ x: 100, y: 10, rigid: true }] })],
    ["Ports", h(UI.Ports, { hot: 1, connected: [3] })],
    ["Frame", h(UI.Frame, { title: "Ideas", order: 1, state: "drop-target" })],
    ["Cursor", h(UI.Cursor, { name: "Maria", color: 2, state: "typing" })],
    ["TimerWidget", h(UI.TimerWidget, { seconds: 61, state: "paused" })],
    ["VoteCard", h(UI.VoteCard, { left: 2, total: 5, canEnd: true })],
    ["Minimap", h(UI.Minimap, {})],
  ];
  it.each(cases)("%s", (_, el) => {
    expect(render(el).length).toBeGreaterThan(20);
  });

  it("puts the role source next to the name (П7)", () => {
    expect(render(h(UI.AccessRow, { name: "Oleg", role: "editor", source: "Through team PM", locked: true }))).toContain("Through team PM");
  });

  it("marks exactly one segmented option as selected", () => {
    const html = render(
      h(UI.Segmented, {
        label: "Duration",
        options: [
          { value: "5", label: "5" },
          { value: "10", label: "10" },
          { value: "15", label: "15" },
        ],
        value: "10",
        onChange: () => {},
      }),
    );
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/is-selected"><input type="radio"[^>]*value="10"/);
  });

  it("makes a chosen choice card and its hint one radio group", () => {
    const html = render(
      h(UI.ChoiceCard, {
        label: "Anonymity",
        options: [
          { value: "a", title: "Anonymous", hint: "Names are never shown" },
          { value: "n", title: "Named" },
        ],
        value: "a",
        onChange: () => {},
      }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Names are never shown");
    expect(html).toContain("is-selected");
  });

  it("names the count on the confirm button (паттерн 6)", () => {
    expect(render(h(UI.ConfirmDialog, { inline: true, count: 12 }))).toContain("deleteCount(12 object)");
  });

  it("covers ТЗ's four connector types as routing × head, with no detached state (ADR-077)", () => {
    expect(render(h(UI.Connector, { head: "none" }))).not.toContain("marker-end");
    expect(render(h(UI.Connector, { head: "arrow" }))).toContain("is-open");
    expect(render(h(UI.Connector, { head: "block" }))).not.toContain("is-open");
    expect(render(h(UI.Connector, { routing: "elbow" }))).toMatch(/ H[\d.]+ V/);
  });

  it("marks segment midpoints filled and rigid waypoints hollow when selected (ADR-077)", () => {
    const html = render(h(UI.Connector, { state: "selected", waypoints: [{ x: 100, y: 10, rigid: true }, { x: 150, y: 40 }] }));
    expect(html.match(/rm-connector-mid/g)).toHaveLength(3);
    expect(html.match(/rm-connector-end/g)).toHaveLength(3);
  });

  it("refuses to render without the strings provider", () => {
    expect(() => renderToStaticMarkup(h(UI.Button, {}, h(UI.SyncStatus, { state: "saved" })))).toThrow(/UiStringsProvider/);
  });
});

describe("countPrimary (П2)", () => {
  it("counts primary and danger buttons through fragments and wrappers", () => {
    const footer = h("div", null, h(UI.Button, { variant: "secondary" }), h(UI.Button, { variant: "primary" }), h(UI.Button, { variant: "danger" }));
    expect(UI.countPrimary(footer)).toBe(2);
  });
});
