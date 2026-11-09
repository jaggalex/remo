/**
 * Deterministic layout for the delivery-plan draft (ADR-189).
 *
 * A model is good at deciding what belongs in "mandatory", "desirable" and "risks";
 * it is bad at coordinates. The reply is therefore structured by zone, and this module
 * turns it into a plan with fixed geometry: three columns, one row per item, a summary
 * line above them. `validatePlan` still checks the result, and the ordinary writer puts
 * it on the board.
 */
import { PlanError, validatePlan } from "@remo/agent-plan";
import { centerDraftObjects } from "./agent-room-draft.mjs";

export const DELIVERY_LIMITS = Object.freeze({
  zones: 3,
  items: 60,
  perZone: 30,
  text: 400,
  meta: 80,
  label: 60,
  summary: 400,
  questions: 12,
  dependencies: 60,
  id: 40,
});

/** The three zones, in the order the reader sees them. */
export const DELIVERY_ZONES = Object.freeze([
  { key: "mandatory", ru: "Обязательно", en: "Mandatory" },
  { key: "desirable", ru: "Желательно", en: "Desirable" },
  { key: "risks", ru: "Риски и вопросы", en: "Risks and questions" },
]);

const ZONE_KEYS = new Set(DELIVERY_ZONES.map((zone) => zone.key));
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const DELIVERY_LAYOUT = Object.freeze({
  padding: 40,
  gap: 32,
  columnWidth: 320,
  headerHeight: 60,
  headerGap: 12,
  summaryHeight: 60,
  summaryGap: 16,
  itemHeight: 112,
  riskHeight: 76,
  itemGap: 14,
});

function text(value, field, max) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  if (result.length > max) {
    throw new PlanError("DELIVERY_TOO_LONG", `${field} is longer than ${max}`);
  }
  return result;
}

function clip(value, field, max) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  // Display text is clipped, not refused: a long label is not an unsafe plan.
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

function cleanId(value, field) {
  const id = text(value, field, DELIVERY_LIMITS.id);
  if (!ID.test(id)) {
    throw new PlanError(
      "DELIVERY_ID",
      `${field} must start with a letter and use letters, digits, "_" or "-"`,
    );
  }
  return id;
}

function array(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PlanError("DELIVERY_SCHEMA", `${field} must be an array`);
  return value;
}

export function parseDeliveryReply(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PlanError("DELIVERY_SCHEMA", "the model must return a JSON object");
  }
  const title = clip(raw.title, "title", DELIVERY_LIMITS.label);
  if (!title) throw new PlanError("DELIVERY_SCHEMA", "the plan needs a title");
  const summary = clip(raw.summary, "summary", DELIVERY_LIMITS.summary);
  const questions = array(raw.questions, "questions")
    .map((question, index) => clip(question, `questions[${index}]`, DELIVERY_LIMITS.text))
    .filter(Boolean)
    .slice(0, DELIVERY_LIMITS.questions);

  const zones = new Map();
  for (const [index, zone] of array(raw.zones, "zones").entries()) {
    const key = String(zone?.key ?? "").trim();
    if (!ZONE_KEYS.has(key)) {
      throw new PlanError("DELIVERY_ZONE", `zones[${index}].key must be mandatory, desirable or risks`);
    }
    if (zones.has(key)) throw new PlanError("DELIVERY_ZONE", `zone "${key}" appears twice`);
    const items = [];
    for (const [itemIndex, item] of array(zone?.items, `zones[${index}].items`).entries()) {
      if (items.length >= DELIVERY_LIMITS.perZone) {
        throw new PlanError("DELIVERY_TOO_LARGE", `zone "${key}" has more than ${DELIVERY_LIMITS.perZone} items`);
      }
      const id = cleanId(item?.id, `zones[${index}].items[${itemIndex}].id`);
      const label = clip(item?.text, `zones[${index}].items[${itemIndex}].text`, DELIVERY_LIMITS.text);
      if (!label) throw new PlanError("DELIVERY_SCHEMA", "every item needs text");
      items.push({
        id,
        text: label,
        meta: clip(item?.meta, `zones[${index}].items[${itemIndex}].meta`, DELIVERY_LIMITS.meta),
        sourceId: text(item?.sourceId, "sourceId", DELIVERY_LIMITS.text) || null,
      });
    }
    zones.set(key, {
      key,
      label: clip(zone?.label, `zones[${index}].label`, DELIVERY_LIMITS.label),
      items,
    });
  }

  const ids = new Set();
  for (const zone of zones.values()) {
    for (const item of zone.items) {
      if (ids.has(item.id)) throw new PlanError("DELIVERY_ID", `item id "${item.id}" is not unique`);
      ids.add(item.id);
    }
  }
  if (ids.size > DELIVERY_LIMITS.items) {
    throw new PlanError("DELIVERY_TOO_LARGE", `a plan allows ${DELIVERY_LIMITS.items} items`);
  }

  const dependencies = [];
  for (const [index, dependency] of array(raw.dependencies, "dependencies").entries()) {
    if (dependencies.length >= DELIVERY_LIMITS.dependencies) {
      throw new PlanError("DELIVERY_TOO_LARGE", `a plan allows ${DELIVERY_LIMITS.dependencies} dependencies`);
    }
    const from = String(dependency?.from ?? "").trim();
    const to = String(dependency?.to ?? "").trim();
    if (!ids.has(from) || !ids.has(to)) {
      throw new PlanError(
        "DELIVERY_DEPENDENCY",
        `dependencies[${index}] must join two items of this plan`,
      );
    }
    if (from === to) throw new PlanError("DELIVERY_DEPENDENCY", "an item cannot depend on itself");
    dependencies.push({
      from,
      to,
      label: clip(dependency?.label, `dependencies[${index}].label`, 40),
    });
  }

  return { title, summary, zones, questions, dependencies };
}

function zoneLabel(zone, lang) {
  if (zone.label) return zone.label;
  const fallback = DELIVERY_ZONES.find((entry) => entry.key === zone.key);
  return lang === "en" ? fallback.en : fallback.ru;
}

/**
 * Turn the structured reply into the same plan shape the ordinary writer already knows.
 *
 * The plan is validated here, so a malformed or oversized result is refused before a
 * single object is written. Coordinates are fixed by `DELIVERY_LAYOUT`; the reply only
 * supplies meaning.
 */
export function deliveryPlan(reply, {
  lang = "ru",
  sourceIds = [],
  existingWidgets = [],
  existingConnectors = [],
} = {}) {
  // Copy the items: questions are appended below, and a second layout of the same
  // parsed reply must not see them twice.
  const zones = DELIVERY_ZONES.map((entry) => {
    const zone = reply.zones.get(entry.key) ?? { key: entry.key, label: "", items: [] };
    return { ...zone, items: [...zone.items] };
  });
  const riskZone = zones.find((zone) => zone.key === "risks");
  for (const [index, question] of reply.questions.entries()) {
    riskZone.items.push({ id: `question-${index + 1}`, text: question, meta: "", sourceId: null });
  }
  if (riskZone.items.length > DELIVERY_LIMITS.perZone) {
    throw new PlanError("DELIVERY_TOO_LARGE", `the risks zone has more than ${DELIVERY_LIMITS.perZone} items`);
  }

  const { padding, gap, columnWidth, headerHeight, headerGap, summaryHeight, summaryGap, itemHeight, riskHeight, itemGap } =
    DELIVERY_LAYOUT;
  const columnsWidth = zones.length * columnWidth + (zones.length - 1) * gap;
  const width = padding * 2 + columnsWidth;
  const headerY = padding + summaryHeight + summaryGap;
  const itemsY = headerY + headerHeight + headerGap;
  const rows = Math.max(1, ...zones.map((zone) => zone.items.length));
  const tallest = Math.max(itemHeight, riskHeight);
  const height = itemsY + rows * (tallest + itemGap) - itemGap + padding;

  const objects = [
    {
      tempId: "frame",
      type: "frame",
      x: 0,
      y: 0,
      width,
      height,
      title: reply.title,
    },
  ];
  if (reply.summary) {
    objects.push({
      tempId: "summary",
      type: "text",
      parentRef: "frame",
      x: padding,
      y: padding,
      width: columnsWidth,
      height: summaryHeight,
      text: reply.summary,
      style: { fontSize: 14, textAlign: "left", textVAlign: "middle" },
    });
  }

  const labels = [];
  const citations = [];
  for (const [column, zone] of zones.entries()) {
    const x = padding + column * (columnWidth + gap);
    objects.push({
      tempId: `zone-${zone.key}`,
      type: "text",
      parentRef: "frame",
      x,
      y: headerY,
      width: columnWidth,
      height: headerHeight,
      text: zoneLabel(zone, lang),
      style: { fontSize: 16, textAlign: "center", textVAlign: "middle" },
    });
    for (const [row, item] of zone.items.entries()) {
      const isRisk = zone.key === "risks";
      const tempId = `item-${item.id}`;
      objects.push({
        tempId,
        type: isRisk ? "text" : "sticky_note",
        parentRef: "frame",
        x,
        y: itemsY + row * (tallest + itemGap),
        width: columnWidth,
        height: isRisk ? riskHeight : itemHeight,
        text: item.meta ? `${item.text}\n\n${item.meta}` : item.text,
        ...(isRisk
          ? { style: { fontSize: 13, textAlign: "left", textVAlign: "top" } }
          : {}),
      });
      if (item.sourceId) citations.push({ tempId, sourceId: item.sourceId });
    }
  }

  const connectors = reply.dependencies.map((dependency) => ({
    from: `item-${dependency.from}`,
    to: `item-${dependency.to}`,
    arrow: "end",
    routing: "elbow",
  }));
  for (const dependency of reply.dependencies) {
    if (dependency.label) {
      labels.push({
        from: `item-${dependency.from}`,
        to: `item-${dependency.to}`,
        text: dependency.label,
      });
    }
  }

  return {
    title: reply.title,
    summary: reply.summary,
    questions: reply.questions,
    plan: validatePlan(
      { version: 1, template: null, origin: { x: 0, y: 0 },
        objects: centerDraftObjects(objects), connectors, warnings: [] },
      { existingWidgets, existingConnectors },
    ),
    labels,
    citations: citations.filter((citation) => sourceIds.map(String).includes(citation.sourceId)),
  };
}
