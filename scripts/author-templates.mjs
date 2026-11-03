#!/usr/bin/env node
/**
 * Author the four starting templates.
 *
 * The layouts, names and copy in this file are remo's own. They are deliberately not a
 * capture of another product: a template is a teaching example, so it should be simple,
 * readable and ours (ADR-158).
 *
 * The app loads `/templates.json`; `scripts/sync-templates.mjs` copies this generated
 * file into `apps/web/public`.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "spec", "templates.json");

let serial = 0;
let z = 0;

const id = () => `w${String((serial += 1)).padStart(4, "0")}`;

function widget(type, box, extra = {}) {
  return {
    z: (z += 1) - 1,
    id: id(),
    type,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    parentId: box.parentId ?? null,
    ...extra,
  };
}

const frame = (title, x, y, width, height) =>
  widget("frame", { x, y, width, height }, { title, fillColor: "#ffffff" });

const text = (content, x, y, width, height, parentId = null, fontSize = 15) =>
  widget(
    "text",
    { x, y, width, height, parentId },
    { content, fillColor: "transparent", color: "#1a1a1a", fontSize },
  );

const note = (content, x, y, width, height, parentId, fillColor) =>
  widget("sticky_note", { x, y, width, height, parentId }, { content, fillColor });

const card = (title, x, y, width, height, parentId) =>
  widget("card", { x, y, width, height, parentId }, { title, fillColor: "#ffffff" });

function template(widgets) {
  const types = {};
  for (const item of widgets) types[item.type] = (types[item.type] ?? 0) + 1;
  return { types, widgets };
}

/* --------------------------------------------------------------- story map -- */

const storyMap = (() => {
  const widgets = [text("Story map", 0, -430, 900, 70, null, 40)];
  const columns = [
    ["Persona", ["Who is this for?", "What do they care about?", "What is their context?"]],
    ["Goal", ["What outcome?", "How do we measure it?", "What is out of scope?"]],
    ["Journey", ["First step", "Main step", "Last step"]],
    ["Stories", ["As a…", "I want…", "So that…"]],
    ["Release", ["Now", "Next", "Later"]],
  ];
  const fills = ["#efece8", "#ffe07a", "#ffcd9e", "#ffc6d9", "#b9ecac"];
  columns.forEach(([title, prompts], column) => {
    const x = (column - 2) * 300;
    const lane = frame(title, x, 0, 260, 560);
    widgets.push(lane);
    prompts.forEach((prompt, row) => {
      widgets.push(note(prompt, x, -120 + row * 180, 210, 150, lane.id, fills[column]));
    });
  });
  return template(widgets);
})();

/* ----------------------------------------------------------------- roadmap -- */

const roadmapCards = [
  "Research the problem",
  "Prototype the flow",
  "Beta with one team",
  "Public launch",
  "Pricing and billing",
  "Onboarding guide",
  "Support playbook",
  "Usage analytics",
  "Mobile layout",
  "Public API",
  "Partner directory",
  "Accessibility review",
];

function roadmap(prefilled) {
  const widgets = [text("Roadmap", 0, -400, 900, 60, null, 40)];
  const kanban = widget("kanban", { x: 0, y: 0, width: 1200, height: 590 });
  widgets.push(kanban);
  if (prefilled) {
    roadmapCards.forEach((title) => {
      widgets.push(card(title, 0, 0, 250, 70, kanban.id));
    });
  }
  return template(widgets);
}

/* ------------------------------------------------------------------ kanban -- */

const kanban = (() => {
  const boardFrame = frame("Board", 0, 0, 1400, 700);
  const notesFrame = frame("Notes", 1600, 0, 620, 700);
  const widgets = [
    boardFrame,
    notesFrame,
    text("Kanban board", 0, -330, 800, 60, boardFrame.id, 40),
  ];
  const board = widget("kanban", { x: 0, y: 0, width: 1200, height: 480, parentId: boardFrame.id });
  widgets.push(board);
  for (const title of [
    "Define the scope",
    "Draft the design",
    "Build the first slice",
    "Review with the team",
    "Ship to production",
    "Run the retrospective",
  ]) {
    widgets.push(card(title, 0, 0, 250, 70, board.id));
  }
  widgets.push(text("Add notes here", 1600, 0, 320, 120, notesFrame.id, 20));
  return template(widgets);
})();

const file = {
  generatedBy: "scripts/author-templates.mjs",
  templates: {
    "user-story-map-basic": storyMap,
    "product-roadmap-basic": roadmap(false),
    "product-roadmap-basic-prefilled": roadmap(true),
    "kanban-framework": kanban,
  },
};

writeFileSync(OUT, `${JSON.stringify(file, null, 1)}\n`);
console.log(`authored ${Object.keys(file.templates).length} templates → spec/templates.json`);
