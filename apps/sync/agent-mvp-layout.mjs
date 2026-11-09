/**
 * Matrix drafts: MVP scoping and the comparison skills (ADR-192).
 *
 * Columns and rows are named by the skill, cells carry short notes or scores. One
 * deterministic grid serves the story map (MVP / next / out), prioritisation,
 * competitor comparison, architecture decisions and idea shortlists. The model
 * supplies meaning; the server owns the geometry and the citations.
 */
import { PlanError, validatePlan } from "@remo/agent-plan";
import { centerDraftObjects } from "./agent-room-draft.mjs";

export const MATRIX_LIMITS = Object.freeze({
  columns: 8,
  rows: 30,
  items: 120,
  perCell: 6,
  text: 300,
  meta: 60,
  label: 40,
  summary: 400,
  recommendation: 600,
  questions: 10,
  id: 40,
});

export const MATRIX_LAYOUT = Object.freeze({
  padding: 40,
  gap: 24,
  labelWidth: 200,
  columnWidth: 260,
  headerHeight: 60,
  headerGap: 16,
  itemHeight: 92,
  textHeight: 76,
  itemGap: 10,
  rowGap: 18,
  boundaryGap: 18,
  boundaryHeight: 60,
  summaryHeight: 60,
  recommendationHeight: 60,
  questionsHeight: 60,
});

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function clip(value, field, max) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

function cleanId(value, field) {
  const id = clip(value, field, MATRIX_LIMITS.id);
  if (!ID.test(id)) {
    throw new PlanError("MATRIX_ID", `${field} must start with a letter and use letters, digits, "_" or "-"`);
  }
  return id;
}

function array(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PlanError("MATRIX_SCHEMA", `${field} must be an array`);
  return value;
}

export function parseMatrixReply(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PlanError("MATRIX_SCHEMA", "the model must return a JSON object");
  }
  const title = clip(raw.title, "title", MATRIX_LIMITS.label);
  if (!title) throw new PlanError("MATRIX_SCHEMA", "the plan needs a title");
  const summary = clip(raw.summary ?? raw.hypothesis, "summary", MATRIX_LIMITS.summary);
  const recommendation = clip(raw.recommendation, "recommendation", MATRIX_LIMITS.recommendation);
  const questions = array(raw.questions, "questions")
    .map((question, index) => clip(question, `questions[${index}]`, MATRIX_LIMITS.text))
    .filter(Boolean)
    .slice(0, MATRIX_LIMITS.questions);

  const columns = [];
  const columnKeys = new Set();
  for (const [index, column] of array(raw.columns, "columns").entries()) {
    const key = cleanId(column?.key, `columns[${index}].key`);
    if (columnKeys.has(key)) throw new PlanError("MATRIX_ID", `column "${key}" appears twice`);
    columnKeys.add(key);
    columns.push({ key, label: clip(column?.label, `columns[${index}].label`, MATRIX_LIMITS.label) || key });
  }
  if (!columns.length || columns.length > MATRIX_LIMITS.columns) {
    throw new PlanError("MATRIX_COLUMNS", `a plan allows 1 to ${MATRIX_LIMITS.columns} columns`);
  }

  const rows = [];
  const rowKeys = new Set();
  for (const [index, row] of array(raw.rows, "rows").entries()) {
    const key = cleanId(row?.key, `rows[${index}].key`);
    if (rowKeys.has(key)) throw new PlanError("MATRIX_ID", `row "${key}" appears twice`);
    rowKeys.add(key);
    rows.push({ key, label: clip(row?.label, `rows[${index}].label`, MATRIX_LIMITS.label) || key });
  }
  if (!rows.length || rows.length > MATRIX_LIMITS.rows) {
    throw new PlanError("MATRIX_ROWS", `a plan allows 1 to ${MATRIX_LIMITS.rows} rows`);
  }

  const cells = new Map();
  let total = 0;
  for (const [index, cell] of array(raw.cells, "cells").entries()) {
    const row = String(cell?.row ?? "");
    const column = String(cell?.column ?? "");
    if (!rowKeys.has(row) || !columnKeys.has(column)) {
      throw new PlanError("MATRIX_CELL", `cells[${index}] must name an existing row and column`);
    }
    const items = [];
    for (const [itemIndex, item] of array(cell?.items, `cells[${index}].items`).entries()) {
      if (items.length >= MATRIX_LIMITS.perCell) {
        throw new PlanError("MATRIX_TOO_LARGE", `a cell allows ${MATRIX_LIMITS.perCell} items`);
      }
      const text = clip(item?.text, `cells[${index}].items[${itemIndex}].text`, MATRIX_LIMITS.text);
      if (!text) throw new PlanError("MATRIX_SCHEMA", "every item needs text");
      items.push({
        text,
        meta: clip(item?.meta, `cells[${index}].items[${itemIndex}].meta`, MATRIX_LIMITS.meta),
        sourceId: clip(item?.sourceId, "sourceId", MATRIX_LIMITS.text) || null,
      });
    }
    total += items.length;
    if (total > MATRIX_LIMITS.items) {
      throw new PlanError("MATRIX_TOO_LARGE", `a plan allows ${MATRIX_LIMITS.items} items`);
    }
    cells.set(`${row}\u0000${column}`, items);
  }

  return { title, summary, recommendation, columns, rows, cells, questions };
}

/** The old name stays for the MVP tests and callers. */
export const parseMvpReply = parseMatrixReply;

export function matrixPlan(raw, options = {}) {
  const reply = raw?.cells instanceof Map ? raw : parseMatrixReply(raw);
  const {
    lang = "ru",
    sourceIds = [],
    existingWidgets = [],
    existingConnectors = [],
    cellType = "text",
    cellHeight = MATRIX_LAYOUT.textHeight,
    labelWidth = MATRIX_LAYOUT.labelWidth,
    columnWidth = MATRIX_LAYOUT.columnWidth,
    boundaryRow = null,
  } = options;

  const { padding, gap, headerHeight, headerGap, itemGap, rowGap, boundaryGap, boundaryHeight, summaryHeight, recommendationHeight, questionsHeight } =
    MATRIX_LAYOUT;
  const columnsWidth = reply.columns.length * columnWidth + (reply.columns.length - 1) * gap;
  const width = padding * 2 + labelWidth + gap + columnsWidth;
  const headerY = padding + (reply.summary ? summaryHeight + headerGap : 0);
  const rowsY = headerY + headerHeight + headerGap;
  const rowHeights = reply.rows.map((row) => {
    const counts = reply.columns.map((column) => (reply.cells.get(`${row.key}\u0000${column.key}`) ?? []).length);
    const count = Math.max(1, ...counts);
    return count * (cellHeight + itemGap) - itemGap;
  });
  const hasBoundary = Boolean(boundaryRow) && reply.rows.some((row) => row.key === boundaryRow);
  const height =
    rowsY +
    rowHeights.reduce((sum, value) => sum + value, 0) +
    (reply.rows.length - 1) * rowGap +
    (hasBoundary ? boundaryHeight + boundaryGap : 0) +
    (reply.recommendation ? recommendationHeight + rowGap : 0) +
    (reply.questions.length ? questionsHeight + rowGap : 0) +
    padding;

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
          type: cellType,
          parentRef: "frame",
          x: padding + labelWidth + gap + columnIndex * (columnWidth + gap),
          y: rowY + itemIndex * (cellHeight + itemGap),
          width: columnWidth,
          height: cellHeight,
          text: item.meta ? `${item.text}\n\n${item.meta}` : item.text,
          ...(cellType === "text"
            ? { style: { fontSize: 13, textAlign: "left", textVAlign: "middle" } }
            : {}),
        });
        if (item.sourceId) citations.push({ tempId, sourceId: item.sourceId });
      }
    }
    rowY += rowHeight + rowGap;
    if (row.key === boundaryRow && hasBoundary) {
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

  if (reply.recommendation) {
    objects.push({
      tempId: "recommendation",
      type: "text",
      parentRef: "frame",
      x: padding,
      y: rowY,
      width: width - padding * 2,
      height: recommendationHeight,
      text: `${lang === "en" ? "Recommendation" : "Рекомендация"}: ${reply.recommendation}`,
      style: { fontSize: 13, textAlign: "left", textVAlign: "top" },
    });
    rowY += recommendationHeight + rowGap;
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
    summary: reply.summary,
    recommendation: reply.recommendation,
    questions: reply.questions,
    plan: validatePlan(
      { version: 1, template: null, origin: { x: 0, y: 0 }, objects: centerDraftObjects(objects), connectors: [], warnings: [] },
      { existingWidgets, existingConnectors },
    ),
    labels: [],
    citations: citations.filter((citation) => sourceIds.map(String).includes(citation.sourceId)),
  };
}

/** MVP scoping keeps its story-map defaults: sticky cells and the boundary row. */
export function mvpPlan(raw, options = {}) {
  return matrixPlan(raw, {
    ...options,
    cellType: "sticky_note",
    cellHeight: MATRIX_LAYOUT.itemHeight,
    labelWidth: 180,
    boundaryRow: "mvp",
  });
}
