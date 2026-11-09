/**
 * The generic zoned layout (ADR-192).
 *
 * A skill supplies a procedure and a zone catalogue; the server owns the geometry. Items
 * are arranged in a grid of zone columns, each zone with a header and a stack of notes.
 * The same shape serves requirements discovery now and later retrospective or planning
 * skills without another endpoint.
 */
import { PlanError, validatePlan } from "@remo/agent-plan";
import { centerDraftObjects } from "./agent-room-draft.mjs";

export const ZONE_LIMITS = Object.freeze({
  columns: 3,
  items: 80,
  perZone: 20,
  text: 400,
  meta: 80,
  label: 60,
  summary: 400,
  questions: 12,
  id: 40,
});

export const ZONE_LAYOUT = Object.freeze({
  padding: 40,
  gap: 32,
  columnWidth: 300,
  headerHeight: 60,
  headerGap: 12,
  summaryHeight: 60,
  summaryGap: 16,
  itemHeight: 108,
  textHeight: 76,
  itemGap: 14,
  rowGap: 28,
});

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function clip(value, field, max) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

function text(value, field, max) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  if (result.length > max) throw new PlanError("ZONE_TOO_LONG", `${field} is longer than ${max}`);
  return result;
}

function cleanId(value, field) {
  const id = text(value, field, ZONE_LIMITS.id);
  if (!ID.test(id)) {
    throw new PlanError("ZONE_ID", `${field} must start with a letter and use letters, digits, "_" or "-"`);
  }
  return id;
}

function array(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PlanError("ZONE_SCHEMA", `${field} must be an array`);
  return value;
}

/**
 * `spec` is `{ zones: [{key, ru, en, text?}], questionsKey }`.
 *
 * A reply must name every zone exactly once; an empty zone is valid, because "no
 * constraints found" is a result, not a missing answer.
 */
export function parseZonedReply(raw, spec) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PlanError("ZONE_SCHEMA", "the model must return a JSON object");
  }
  const title = clip(raw.title, "title", ZONE_LIMITS.label);
  if (!title) throw new PlanError("ZONE_SCHEMA", "the draft needs a title");
  const summary = clip(raw.summary, "summary", ZONE_LIMITS.summary);
  const questions = array(raw.questions, "questions")
    .map((question, index) => clip(question, `questions[${index}]`, ZONE_LIMITS.text))
    .filter(Boolean)
    .slice(0, ZONE_LIMITS.questions);

  const keys = new Set(spec.zones.map((zone) => zone.key));
  const zones = new Map();
  for (const [index, zone] of array(raw.zones, "zones").entries()) {
    const key = String(zone?.key ?? "").trim();
    if (!keys.has(key)) {
      throw new PlanError("ZONE_KEY", `zones[${index}].key must be one of ${[...keys].join(", ")}`);
    }
    if (zones.has(key)) throw new PlanError("ZONE_KEY", `zone "${key}" appears twice`);
    const items = [];
    for (const [itemIndex, item] of array(zone?.items, `zones[${index}].items`).entries()) {
      if (items.length >= ZONE_LIMITS.perZone) {
        throw new PlanError("ZONE_TOO_LARGE", `zone "${key}" has more than ${ZONE_LIMITS.perZone} items`);
      }
      const id = cleanId(item?.id, `zones[${index}].items[${itemIndex}].id`);
      const label = clip(item?.text, `zones[${index}].items[${itemIndex}].text`, ZONE_LIMITS.text);
      if (!label) throw new PlanError("ZONE_SCHEMA", "every item needs text");
      items.push({
        id,
        text: label,
        meta: clip(item?.meta, `zones[${index}].items[${itemIndex}].meta`, ZONE_LIMITS.meta),
        sourceId: text(item?.sourceId, "sourceId", ZONE_LIMITS.text) || null,
      });
    }
    zones.set(key, {
      key,
      label: clip(zone?.label, `zones[${index}].label`, ZONE_LIMITS.label),
      items,
    });
  }

  const ids = new Set();
  for (const zone of zones.values()) {
    for (const item of zone.items) {
      if (ids.has(item.id)) throw new PlanError("ZONE_ID", `item id "${item.id}" is not unique`);
      ids.add(item.id);
    }
  }
  if (ids.size > ZONE_LIMITS.items) {
    throw new PlanError("ZONE_TOO_LARGE", `a draft allows ${ZONE_LIMITS.items} items`);
  }

  return { title, summary, zones, questions };
}

export function zonesPlan(reply, {
  spec,
  columns = ZONE_LIMITS.columns,
  lang = "ru",
  sourceIds = [],
  existingWidgets = [],
  existingConnectors = [],
} = {}) {
  const zones = spec.zones.map((entry) => {
    const zone = reply.zones.get(entry.key) ?? { key: entry.key, label: "", items: [] };
    return { ...zone, items: [...zone.items], text: entry.text === true };
  });
  const questionZone = zones.find((zone) => zone.key === spec.questionsKey);
  if (questionZone) {
    for (const [index, question] of reply.questions.entries()) {
      questionZone.items.push({ id: `question-${index + 1}`, text: question, meta: "", sourceId: null });
    }
  }

  const { padding, gap, columnWidth, headerHeight, headerGap, summaryHeight, summaryGap, itemHeight, textHeight, itemGap, rowGap } =
    ZONE_LAYOUT;
  const columnsCount = Math.max(1, Math.min(columns, zones.length));
  const width = padding * 2 + columnsCount * columnWidth + (columnsCount - 1) * gap;
  const headerY = padding + summaryHeight + summaryGap;

  // Row heights are the tallest zone in each row, so a busy column does not crush a
  // quiet one.
  const rows = [];
  for (let index = 0; index < zones.length; index += columnsCount) {
    const slice = zones.slice(index, index + columnsCount);
    const tallest = Math.max(
      itemHeight,
      ...slice.map((zone) => (zone.items.length ? zone.text ? textHeight : itemHeight : 0)),
    );
    const count = Math.max(1, ...slice.map((zone) => zone.items.length));
    rows.push({ zones: slice, height: headerHeight + headerGap + count * (tallest + itemGap) - itemGap });
  }
  const height = headerY + rows.reduce((sum, row) => sum + row.height + rowGap, 0) - rowGap + padding;

  const objects = [
    { tempId: "frame", type: "frame", x: 0, y: 0, width, height, title: reply.title },
  ];
  if (reply.summary) {
    objects.push({
      tempId: "summary",
      type: "text",
      parentRef: "frame",
      x: padding,
      y: padding,
      width: width - padding * 2,
      height: summaryHeight,
      text: reply.summary,
      style: { fontSize: 14, textAlign: "left", textVAlign: "middle" },
    });
  }

  const citations = [];
  let rowY = headerY;
  for (const row of rows) {
    for (const [column, zone] of row.zones.entries()) {
      const x = padding + column * (columnWidth + gap);
      const label = zone.label || (lang === "en" ? spec.zones.find((entry) => entry.key === zone.key)?.en : spec.zones.find((entry) => entry.key === zone.key)?.ru) || zone.key;
      objects.push({
        tempId: `zone-${zone.key}`,
        type: "text",
        parentRef: "frame",
        x,
        y: rowY,
        width: columnWidth,
        height: headerHeight,
        text: label,
        style: { fontSize: 16, textAlign: "center", textVAlign: "middle" },
      });
      for (const [index, item] of zone.items.entries()) {
        const tempId = `item-${item.id}`;
        objects.push({
          tempId,
          type: zone.text ? "text" : "sticky_note",
          parentRef: "frame",
          x,
          y: rowY + headerHeight + headerGap + index * (zone.text ? textHeight : itemHeight + itemGap),
          width: columnWidth,
          height: zone.text ? textHeight : itemHeight,
          text: item.meta ? `${item.text}\n\n${item.meta}` : item.text,
          ...(zone.text ? { style: { fontSize: 13, textAlign: "left", textVAlign: "top" } } : {}),
        });
        if (item.sourceId) citations.push({ tempId, sourceId: item.sourceId });
      }
    }
    rowY += row.height + rowGap;
  }

  return {
    title: reply.title,
    summary: reply.summary,
    questions: reply.questions,
    plan: validatePlan(
      { version: 1, template: null, origin: { x: 0, y: 0 }, objects: centerDraftObjects(objects), connectors: [], warnings: [] },
      { existingWidgets, existingConnectors },
    ),
    labels: [],
    citations: citations.filter((citation) => sourceIds.map(String).includes(citation.sourceId)),
  };
}

/** Requirements discovery: six zones in two rows of three (ADR-192). */
export const REQUIREMENTS_SPEC = Object.freeze({
  zones: Object.freeze([
    { key: "context", ru: "Контекст", en: "Context" },
    { key: "actors", ru: "Участники", en: "Actors" },
    { key: "scenarios", ru: "Сценарии", en: "Scenarios" },
    { key: "data", ru: "Данные и правила", en: "Data and rules" },
    { key: "constraints", ru: "Ограничения", en: "Constraints", text: true },
    { key: "questions", ru: "Вопросы", en: "Questions", text: true },
  ]),
  questionsKey: "questions",
});

export const RETRO_SPEC = Object.freeze({
  zones: Object.freeze([
    { key: "helped", ru: "Помогало", en: "Helped" },
    { key: "hindered", ru: "Мешало", en: "Hindered" },
    { key: "themes", ru: "Темы", en: "Themes" },
    { key: "experiments", ru: "Эксперименты", en: "Experiments" },
    { key: "questions", ru: "Вопросы", en: "Questions", text: true },
  ]),
  questionsKey: "questions",
});

export const DECISION_SPEC = Object.freeze({
  zones: Object.freeze([
    { key: "question", ru: "Вопрос решения", en: "Decision question" },
    { key: "criteria", ru: "Критерии", en: "Criteria" },
    { key: "options", ru: "Варианты", en: "Options" },
    { key: "disagreements", ru: "Разногласия", en: "Disagreements" },
    { key: "recommendation", ru: "Рекомендация", en: "Recommendation", text: true },
    { key: "questions", ru: "Что утвердить", en: "To approve", text: true },
  ]),
  questionsKey: "questions",
});

export const ACTIONS_SPEC = Object.freeze({
  zones: Object.freeze([
    { key: "decisions", ru: "Решения", en: "Decisions" },
    { key: "actions", ru: "Действия", en: "Actions" },
    { key: "open", ru: "Открытые вопросы", en: "Open questions", text: true },
    { key: "missing", ru: "Недостающие данные", en: "Missing data", text: true },
  ]),
  questionsKey: "open",
});

export function zonedPlan(raw, spec, options = {}) {
  const reply = parseZonedReply(raw, spec);
  return zonesPlan(reply, { ...options, spec, columns: 3 });
}

export function requirementsPlan(raw, options = {}) {
  return zonedPlan(raw, REQUIREMENTS_SPEC, options);
}

export function retrospectivePlan(raw, options = {}) {
  return zonedPlan(raw, RETRO_SPEC, options);
}

export function decisionPlan(raw, options = {}) {
  return zonedPlan(raw, DECISION_SPEC, options);
}

export function actionsPlan(raw, options = {}) {
  return zonedPlan(raw, ACTIONS_SPEC, options);
}
