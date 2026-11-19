/**
 * Layered graph drafts (ADR-192): dependencies, user flows and architecture.
 *
 * The model names nodes and edges; the server computes the layers and the geometry.
 * A cycle is allowed in the picture: layering breaks back edges instead of refusing
 * the draft, because a dependency loop is itself a finding the team must see.
 */
import { PlanError, validatePlan } from "@remo/agent-plan";
import { centerDraftObjects } from "./agent-room-draft.mjs";

export const GRAPH_LIMITS = Object.freeze({
  nodes: 80,
  edges: 120,
  text: 300,
  label: 80,
  summary: 400,
  questions: 12,
  id: 40,
  layers: 9,
});

export const GRAPH_LAYOUT = Object.freeze({
  padding: 40,
  gapX: 110,
  gapY: 36,
  nodeWidth: 220,
  nodeHeight: 90,
  summaryHeight: 60,
  summaryGap: 16,
  questionsHeight: 60,
});

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const KINDS = new Set(["step", "decision", "component", "store", "actor", "external", "task", "milestone"]);

function clip(value, field, max) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

function array(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PlanError("GRAPH_SCHEMA", `${field} must be an array`);
  return value;
}

function cleanId(value, field) {
  const id = clip(value, field, GRAPH_LIMITS.id);
  if (!ID.test(id)) {
    throw new PlanError("GRAPH_ID", `${field} must start with a letter and use letters, digits, "_" or "-"`);
  }
  return id;
}

export function parseGraphReply(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PlanError("GRAPH_SCHEMA", "the model must return a JSON object");
  }
  const title = clip(raw.title, "title", GRAPH_LIMITS.label);
  if (!title) throw new PlanError("GRAPH_SCHEMA", "the draft needs a title");
  const summary = clip(raw.summary, "summary", GRAPH_LIMITS.summary);
  const questions = array(raw.questions, "questions")
    .map((question, index) => clip(question, `questions[${index}]`, GRAPH_LIMITS.text))
    .filter(Boolean)
    .slice(0, GRAPH_LIMITS.questions);

  const nodes = [];
  const ids = new Set();
  for (const [index, node] of array(raw.nodes, "nodes").entries()) {
    if (nodes.length >= GRAPH_LIMITS.nodes) {
      throw new PlanError("GRAPH_TOO_LARGE", `a draft allows ${GRAPH_LIMITS.nodes} nodes`);
    }
    const id = cleanId(node?.id, `nodes[${index}].id`);
    if (ids.has(id)) throw new PlanError("GRAPH_ID", `node "${id}" appears twice`);
    ids.add(id);
    const label = clip(node?.label, `nodes[${index}].label`, GRAPH_LIMITS.text);
    if (!label) throw new PlanError("GRAPH_SCHEMA", "every node needs a label");
    const kind = String(node?.kind ?? "step");
    if (!KINDS.has(kind)) {
      throw new PlanError("GRAPH_KIND", `nodes[${index}].kind must be one of ${[...KINDS].join(", ")}`);
    }
    const layer = node?.layer === undefined ? null : Number(node.layer);
    if (layer !== null && (!Number.isInteger(layer) || layer < 0 || layer >= GRAPH_LIMITS.layers)) {
      throw new PlanError("GRAPH_LAYER", `nodes[${index}].layer must be 0..${GRAPH_LIMITS.layers - 1}`);
    }
    nodes.push({
      id,
      label,
      kind,
      layer,
      sourceId: clip(node?.sourceId, "sourceId", GRAPH_LIMITS.text) || null,
    });
  }
  if (!nodes.length) throw new PlanError("GRAPH_SCHEMA", "a draft needs at least one node");

  const edges = [];
  const pairs = new Set();
  for (const [index, edge] of array(raw.edges, "edges").entries()) {
    if (edges.length >= GRAPH_LIMITS.edges) {
      throw new PlanError("GRAPH_TOO_LARGE", `a draft allows ${GRAPH_LIMITS.edges} edges`);
    }
    const from = String(edge?.from ?? "");
    const to = String(edge?.to ?? "");
    if (!ids.has(from) || !ids.has(to)) {
      throw new PlanError("GRAPH_EDGE", `edges[${index}] must join two nodes of this draft`);
    }
    if (from === to) throw new PlanError("GRAPH_EDGE", "a node cannot point to itself");
    const pair = `${from}\u0000${to}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    edges.push({
      from,
      to,
      label: clip(edge?.label, `edges[${index}].label`, GRAPH_LIMITS.label),
    });
  }

  return { title, summary, nodes, edges, questions };
}

/** Longest-path layers; explicit `node.layer` wins, back edges are ignored. */
function layerNodes(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const layers = new Map(nodes.map((node) => [node.id, node.layer ?? 0]));
  for (let pass = 0; pass < GRAPH_LIMITS.layers; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to || to.layer !== null) continue;
      const next = Math.min(GRAPH_LIMITS.layers - 1, (layers.get(from.id) ?? 0) + 1);
      if (next > (layers.get(to.id) ?? 0)) {
        layers.set(to.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layers;
}

function shapeKind(kind) {
  if (kind === "decision") return "diamond";
  if (kind === "actor" || kind === "external") return "ellipse";
  if (kind === "store") return "rectangle";
  return "round_rectangle";
}

export function graphPlan(raw, options = {}) {
  const reply = parseGraphReply(raw);
  const {
    lang = "ru",
    sourceIds = [],
    existingWidgets = [],
    existingConnectors = [],
  } = options;
  const layers = layerNodes(reply.nodes, reply.edges);
  const byLayer = new Map();
  for (const node of reply.nodes) {
    const layer = layers.get(node.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(node);
  }
  const layerKeys = [...byLayer.keys()].sort((a, b) => a - b);
  const { padding, gapX, gapY, nodeWidth, nodeHeight, summaryHeight, summaryGap, questionsHeight } = GRAPH_LAYOUT;
  const layerHeights = layerKeys.map((key) => {
    const count = byLayer.get(key).length;
    return count * nodeHeight + Math.max(0, count - 1) * gapY;
  });
  const tallest = Math.max(...layerHeights);
  const width = padding * 2 + layerKeys.length * nodeWidth + Math.max(0, layerKeys.length - 1) * gapX;
  const top = padding + (reply.summary ? summaryHeight + summaryGap : 0);
  const height =
    top +
    tallest +
    (reply.questions.length ? questionsHeight + GRAPH_LAYOUT.summaryGap : 0) +
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

  const citations = [];
  for (const [column, key] of layerKeys.entries()) {
    const layerNodesList = byLayer.get(key);
    const startY = top + (tallest - layerHeights[column]) / 2;
    for (const [index, node] of layerNodesList.entries()) {
      const tempId = `node-${node.id}`;
      objects.push({
        tempId,
        type: "shape",
        parentRef: "frame",
        x: padding + column * (nodeWidth + gapX),
        y: startY + index * (nodeHeight + gapY),
        width: nodeWidth,
        height: nodeHeight,
        title: node.label,
        shapeKind: shapeKind(node.kind),
      });
      if (node.sourceId) citations.push({ tempId, sourceId: node.sourceId });
    }
  }

  if (reply.questions.length) {
    objects.push({
      tempId: "questions",
      type: "text",
      parentRef: "frame",
      x: padding,
      y: top + tallest + GRAPH_LAYOUT.summaryGap,
      width: width - padding * 2,
      height: questionsHeight,
      text: `${lang === "en" ? "Open questions" : "Открытые вопросы"}: ${reply.questions.join("; ")}`,
      style: { fontSize: 13, textAlign: "left", textVAlign: "top" },
    });
  }

  // The plan contract allows one connector per unordered pair. A two-node cycle is
  // drawn as one line with two heads; both labels are kept.
  const drawn = [];
  const byPair = new Map();
  for (const edge of reply.edges) {
    const key = [edge.from, edge.to].sort().join("\u0000");
    const existing = byPair.get(key);
    if (existing) {
      existing.both = true;
      if (edge.label) existing.labels.push(edge.label);
      continue;
    }
    const item = {
      from: edge.from,
      to: edge.to,
      both: false,
      labels: edge.label ? [edge.label] : [],
    };
    byPair.set(key, item);
    drawn.push(item);
  }
  const connectors = drawn.map((edge) => ({
    from: `node-${edge.from}`,
    to: `node-${edge.to}`,
    arrow: edge.both ? "both" : "end",
    routing: "elbow",
  }));
  const labels = drawn.flatMap((edge) =>
    edge.labels.map((text) => ({ from: `node-${edge.from}`, to: `node-${edge.to}`, text })),
  );

  return {
    title: reply.title,
    summary: reply.summary,
    questions: reply.questions,
    plan: validatePlan(
      { version: 1, template: null, origin: { x: 0, y: 0 }, objects: centerDraftObjects(objects), connectors, warnings: [] },
      { existingWidgets, existingConnectors },
    ),
    labels,
    citations: citations.filter((citation) => sourceIds.map(String).includes(citation.sourceId)),
  };
}
