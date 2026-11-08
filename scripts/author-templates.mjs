#!/usr/bin/env node
/**
 * Author the four starting templates in every supported language.
 *
 * The layouts, names and copy in this file are remo's own. They are deliberately not a
 * capture of another product: a template is a teaching example, so it should be simple,
 * readable and ours (ADR-158).
 *
 * One file per language is written to `spec/`; `scripts/sync-templates.mjs` copies them
 * into `apps/web/public`. The app chooses the file by the account language (ADR-169).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Document colours come from the design system, not from a third copy of the palette.
 * `colorLevels.test.ts` already keeps the model's values equal to these tokens.
 */
const TOKENS = JSON.parse(
  readFileSync(join(ROOT, "packages", "ui", "src", "tokens", "tokens.json"), "utf8"),
);
const token = (name) => {
  const found = TOKENS.color.tokens.find((entry) => entry.name === name);
  if (!found) throw new Error(`unknown design token: ${name}`);
  return found.value;
};

const COPY = {
  en: {
    story: {
      title: "Story map",
      frames: ["Persona", "Goal", "Journey", "Stories", "Release"],
      prompts: [
        ["Who is this for?", "What do they care about?", "What is their context?"],
        ["What outcome?", "How do we measure it?", "What is out of scope?"],
        ["First step", "Main step", "Last step"],
        ["As a…", "I want…", "So that…"],
        ["Now", "Next", "Later"],
      ],
    },
    roadmap: {
      title: "Roadmap",
      example: "Roadmap example",
      cards: [
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
      ],
    },
    kanban: {
      title: "Kanban room",
      board: "Room",
      notes: "Notes",
      heading: "Kanban room",
      notesHint: "Add notes here",
      cards: [
        "Define the scope",
        "Draft the design",
        "Build the first slice",
        "Review with the team",
        "Ship to production",
        "Run the retrospective",
      ],
    },
  },
  ru: {
    story: {
      title: "Карта истории",
      frames: ["Персона", "Цель", "Путь", "Истории", "Релиз"],
      prompts: [
        ["Для кого это?", "Что для них важно?", "В каком они контексте?"],
        ["Какой результат?", "Как мы это измерим?", "Что вне рамок?"],
        ["Первый шаг", "Основной шаг", "Последний шаг"],
        ["Как…", "Я хочу…", "Чтобы…"],
        ["Сейчас", "Далее", "Позже"],
      ],
    },
    roadmap: {
      title: "Дорожная карта",
      example: "Пример дорожной карты",
      cards: [
        "Исследовать проблему",
        "Собрать прототип",
        "Бета с одной командой",
        "Публичный запуск",
        "Цены и оплата",
        "Гайд по онбордингу",
        "Регламент поддержки",
        "Аналитика использования",
        "Мобильная версия",
        "Публичный API",
        "Каталог партнёров",
        "Проверка доступности",
      ],
    },
    kanban: {
      title: "Канбан-комната",
      board: "Комната",
      notes: "Заметки",
      heading: "Канбан-комната",
      notesHint: "Добавьте заметки",
      cards: [
        "Определить объём",
        "Набросать дизайн",
        "Собрать первый срез",
        "Обсудить с командой",
        "Выпустить в продакшен",
        "Провести ретроспективу",
      ],
    },
  },
};

function author(locale) {
  const copy = COPY[locale];
  if (!copy) throw new Error(`unknown template locale: ${locale}`);
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
    widget("frame", { x, y, width, height }, { title, fillColor: token("neutral-0") });

  const text = (content, x, y, width, height, parentId = null, fontSize = 15) =>
    widget(
      "text",
      { x, y, width, height, parentId },
      { content, fillColor: "transparent", color: "#1a1a1a", fontSize },
    );

  const note = (content, x, y, width, height, parentId, fillColor) =>
    widget("sticky_note", { x, y, width, height, parentId }, { content, fillColor });

  const card = (title, x, y, width, height, parentId) =>
    widget("card", { x, y, width, height, parentId }, { title, fillColor: token("neutral-0") });

  function template(title, widgets) {
    const types = {};
    for (const item of widgets) types[item.type] = (types[item.type] ?? 0) + 1;
    return { title, types, widgets };
  }

  /* ------------------------------------------------------------- story map -- */

  const storyMap = (() => {
    const widgets = [text(copy.story.title, 0, -430, 900, 70, null, 40)];
    const fills = [
      "paper-grey-100",
      "paper-yellow-100",
      "paper-orange-100",
      "paper-pink-100",
      "paper-green-100",
    ].map(token);
    copy.story.frames.forEach((title, column) => {
      const x = (column - 2) * 300;
      const lane = frame(title, x, 0, 260, 560);
      widgets.push(lane);
      copy.story.prompts[column].forEach((prompt, row) => {
        widgets.push(note(prompt, x, -180 + row * 180, 210, 150, lane.id, fills[column]));
      });
    });
    return template(copy.story.title, widgets);
  })();

  /* --------------------------------------------------------------- roadmap -- */

  function roadmap(prefilled) {
    const widgets = [text(copy.roadmap.title, 0, -400, 900, 60, null, 40)];
    const kanban = widget("kanban", { x: 0, y: 0, width: 1200, height: 590 });
    widgets.push(kanban);
    if (prefilled) {
      copy.roadmap.cards.forEach((title) => {
        widgets.push(card(title, 0, 0, 250, 70, kanban.id));
      });
    }
    return template(prefilled ? copy.roadmap.example : copy.roadmap.title, widgets);
  }

  /* ---------------------------------------------------------------- kanban -- */

  const kanban = (() => {
    const boardFrame = frame(copy.kanban.board, 0, 0, 1400, 700);
    const notesFrame = frame(copy.kanban.notes, 1600, 0, 620, 700);
    const widgets = [
      boardFrame,
      notesFrame,
      text(copy.kanban.heading, 0, -310, 800, 60, boardFrame.id, 40),
    ];
    const board = widget("kanban", {
      x: 0,
      y: 0,
      width: 1200,
      height: 480,
      parentId: boardFrame.id,
    });
    widgets.push(board);
    for (const title of copy.kanban.cards) {
      widgets.push(card(title, 0, 0, 250, 70, board.id));
    }
    widgets.push(text(copy.kanban.notesHint, 1600, 0, 320, 120, notesFrame.id, 20));
    return template(copy.kanban.title, widgets);
  })();

  return {
    generatedBy: "scripts/author-templates.mjs",
    locale,
    templates: {
      "user-story-map-basic": storyMap,
      "product-roadmap-basic": roadmap(false),
      "product-roadmap-basic-prefilled": roadmap(true),
      "kanban-framework": kanban,
    },
  };
}

for (const locale of Object.keys(COPY)) {
  const file = author(locale);
  const path = join(ROOT, "spec", locale === "en" ? "templates.json" : `templates.${locale}.json`);
  writeFileSync(path, `${JSON.stringify(file, null, 1)}\n`);
  console.log(`authored ${Object.keys(file.templates).length} ${locale} templates → ${path}`);
}
