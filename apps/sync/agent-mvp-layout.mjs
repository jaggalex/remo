/**
 * MVP scoping as a story map (ADR-192).
 *
 * Columns are user actions, rows are release slices (MVP, next, out). The model decides
 * the map; the server owns a deterministic grid, the MVP boundary and the citations.
 * Cells are ordinary sticky notes, so the team edits the result like any other draft.
 */
import { PlanError, validatePlan } from "@remo/agent-plan";
import { centerDraftObjects } from "./agent-room-draft.mjs";

export const MVP_LIMITS = Object.freeze({
  columns: 6,
  rows: 4,
  items: 60,
  perCell: 6,
  text: 300,
  meta: 60,
  label: 40,
  hypothesis: 400,
  questions: 10,
  id: 40,
});

export const MVP_LAYOUT = Object.freeze({
  padding: 40,
  gap: 24,
  labelWidth: 180,
  columnWidth: 300,
  headerHeight: 60,
  headerGap: 16,
  itemHeight: 92,
  itemGap: 10,
  rowGap: 18,
  boundaryGap: 18,
  boundaryHeight: 60,
  hypothesisHeight: 60,
  questionsHeight: 60,
});

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function clip(value, field, max) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

function cleanId(value, field) {
  const id = clip(value, field, MVP_LIMITS.id);
  if (!ID.test(id)) {
    throw new PlanError("MVP_ID", `${field} must start with a letter and use letters, digits, "_" or "-"`);
  }
  return id;
}

function array(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PlanError("MVP_SCHEMA", `${field} must be an array`);
  return value;
}

export function parseMvpReply(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PlanError("MVP_SCHEMA", "the model must return a JSON object");
  }
  const title = clip(raw.title, "title", MVP_LIMITS.label);
  if (!title) throw new PlanError("MVP_SCHEMA", "the plan needs a title");
  const hypothesis = clip(raw.hypothesis, "hypothesis", MVP_LIMITS.hypothesis);
  const questions = array(raw.questions, "questions")
    .map((question, index) => clip(question, `questions[${index}]`, MVP_LIMITS.text))
    .filter(Boolean)
    .slice(0, MVP_LIMITS.questions);

  const columns = [];
  const columnKeys = new Set();
  for (const [index, column] of array(raw.columns, "columns").entries()) {
    const key = cleanId(column?.key, `columns[${index}].key`);
    if (columnKeys.has(key)) throw new PlanError("MVP_ID", `column "${key}" appears twice`);
    columnKeys.add(key);
    columns.push({ key, label: clip(column?.label, `columns[${index}].label`, MVP_LIMITS.label) || key });
  }
  if (!columns.length || columns.length > MVP_LIMITS.columns) {
    throw new PlanError("MVP_COLUMNS", `a plan allows 1 to ${MVP_LIMITS.columns} columns`);
  }

  const rows = [];
  const rowKeys = new Set();
  for (const [index, row] of array(raw.rows, "rows").entries()) {
    const key = cleanId(row?.key, `rows[${index}].key`);
    if (rowKeys.has(key)) throw new PlanError("MVP_ID", `row "${key}" appears twice`);
    rowKeys.add(key);
    rows.push({ key, label: clip(row?.label, `rows[${index}].label`, MVP_LIMITS.label) || key });
  }
  if (!rows.length || rows.length > MVP_LIMITS.rows) {
    throw new PlanError("MVP_ROWS", `a plan allows 1 to ${MVP_LIMITS.rows} rows`);
  }

  const cells = new Map();
  let total = 0;
  for (const [index, cell] of array(raw.cells, "cells").entries()) {
    const row = String(cell?.row ?? "");
    const column = String(cell?.column ?? "");
    if (!rowKeys.has(row) || !columnKeys.has(column)) {
      throw new PlanError("MVP_CELL", `cells[${index}] must name an existing row and column`);
    }
    const items = [];
    for (const [itemIndex, item] of array(cell?.items, `cells[${index}].items`).entries()) {
      if (items.length >= MVP_LIMITS.perCell) {
        throw new PlanError("MVP_TOO_LARGE", `a cell allows ${MVP_LIMITS.perCell} items`);
      }
      const text = clip(item?.text, `cells[${index}].items[${itemIndex}].text`, MVP_LIMITS.text);
      if (!text) throw new PlanError("MVP_SCHEMA", "every item needs text");
      items.push({
        text,
        meta: clip(item?.meta, `cells[${index}].items[${itemIndex}].meta`, MVP_LIMITS.meta),
        sourceId: clip(item?.sourceId, "sourceId", MVP_LIMITS.text) || null,
      });
    }
    total += items.length;
    if (total > MVP_LIMITS.items) {
      throw new PlanError("MVP_TOO_LARGE", `a plan allows ${MVP_LIMITS.items} items`);
    }
    cells.set(`${row}\u0000${column}`, items);
  }

  return { title, hypothesis, columns, rows, cells, questions };
}

export function mvpPlan(raw, options = {}) {
  const reply = raw?.cells instanceof Map ? raw : parseMvpReply(raw);
  const {
  lang = "ru",
  sourceIds = [],
  existingWidgets = [],
  existingConnectors = [],
  } = options;
  const { padding, gap, labelWidth, columnWidth, headerHeight, headerGap, itemHeight, itemGap, rowGap, boundaryGap, boundaryHeight, hypothesisHeight, questionsHeight } =
    MVP_LAYOUT;
  const columnsWidth = reply.columns.length * columnWidth + (reply.columns.length - 1) * gap;
  const width = padding * 2 + labelWidth + gap + columnsWidth;
  const headerY = padding + hypothesisHeight + headerGap;
  const rowsY = headerY + headerHeight + headerGap;
  const rowHeights = reply.rows.map((row) => {
    const counts = reply.columns.map((column) => (reply.cells.get(`${row.key}\u0000${column.key}`) ?? []).length);
    const count = Math.max(1, ...counts);
    return count * (itemHeight + itemGap) - itemGap;
  });
  const hasBoundary = reply.rows.some((row) => row.key === "mvp");
  const height =
    rowsY +
    rowHeights.reduce((sum, value) => sum + value, 0) +
    (reply.rows.length - 1) * rowGap +
    (hasBoundary ? boundaryHeight + boundaryGap : 0) +
    (reply.questions.length ? questionsHeight + rowGap : 0) +
    padding;

  const objects = [
    { tempId: "frame", type: "frame", x: 0, y: 0, width, height, title: reply.title },
  ];
  if (reply.hypothesis) {
    objects.push({
      tempId: "hypothesis",
      type: "text",
      parentRef: "frame",
      x: padding,
      y: padding,
      width: width - padding * 2,
      height: hypothesisHeight,
      text: reply.hypothesis,
      style: { fontSize: 14, textAlign: "left", textVAlign: "middle" },
    });
  }

  for (const [index, column] of reply.columns.entries()) {
    objects.push({
      tempId: `column-${column.key}`,
      type: "text",
      parentRef: "frame",
      x: padding + labelWidth + gap + index * (columnWidth + gap),
      y: headerY,
      width: columnWidth,
      height: headerHeight,
      text: column.label,
      style: { fontSize: 16, textAlign: "center", textVAlign: "middle" },
    });
  }

  const citations = [];
  let rowY = rowsY;
  for (const [rowIndex, row] of reply.rows.entries()) {
    const rowHeight = rowHeights[rowIndex];
    objects.push({
      tempId: `row-${row.key}`,
      type: "text",
      parentRef: "frame",
      x: padding,
      y: rowY,
      width: labelWidth,
      height: rowHeight,
      text: row.label,
      style: { fontSize: 15, textAlign: "center", textVAlign: "middle" },
    });
    for (const [columnIndex, column] of reply.columns.entries()) {
      const items = reply.cells.get(`${row.key}\u0000${column.key}`) ?? [];
      for (const [itemIndex, item] of items.entries()) {
        const tempId = `item-${row.key}-${column.key}-${itemIndex + 1}`;
        objects.push({
          tempId,
          type: "sticky_note",
          parentRef: "frame",
          x: padding + labelWidth + gap + columnIndex * (columnWidth + gap),
          y: rowY + itemIndex * (itemHeight + itemGap),
          width: columnWidth,
          height: itemHeight,
          text: item.meta ? `${item.text}\n\n${item.meta}` : item.text,
        });
        if (item.sourceId) citations.push({ tempId, sourceId: item.sourceId });
      }
    }
    rowY += rowHeight + rowGap;
    if (row.key === "mvp" && hasBoundary) {
      objects.push({
        tempId: "mvp-boundary",
        type: "text",
        parentRef: "frame",
        x: padding,
        y: rowY - rowGap / 2,
        width: width - padding * 2,
        height: boundaryHeight,
        text: lang === "en" ? "— MVP boundary —" : "— граница MVP —",
        style: { fontSize: 13, textAlign: "center", textVAlign: "middle" },
      });
      rowY += boundaryHeight + boundaryGap;
    }
  }

  if (reply.questions.length) {
    objects.push({
      tempId: "questions",
      type: "text",
      parentRef: "frame",
      x: padding,
      y: rowY,
      width: width - padding * 2,
      height: questionsHeight,
      text: `${lang === "en" ? "Open questions" : "Открытые вопросы"}: ${reply.questions.join("; ")}`,
      style: { fontSize: 13, textAlign: "left", textVAlign: "top" },
    });
  }

  return {
    title: reply.title,
    summary: reply.hypothesis,
    questions: reply.questions,
    plan: validatePlan(
      { version: 1, template: null, origin: { x: 0, y: 0 }, objects: centerDraftObjects(objects), connectors: [], warnings: [] },
      { existingWidgets, existingConnectors },
    ),
    labels: [],
    citations: citations.filter((citation) => sourceIds.map(String).includes(citation.sourceId)),
  };
}
