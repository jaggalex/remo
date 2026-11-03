/**
 * The built-in `diagram` skill: a description becomes shapes and connectors on a board.
 *
 * The model only produces a small graph — nodes, edges, labels. Geometry is computed
 * here, because language models are bad at coordinates and a deterministic layout can be
 * tested. The same module builds the prompt, validates the reply and writes to Yjs, so
 * there is one place to change the contract (spec/AI-agents-v1.md, skill `diagram@1`).
 */
import { Y } from "./y.mjs";

export const DIAGRAM_LIMITS = { maxNodes: 30, maxEdges: 60, label: 120 };

const KINDS = ["rectangle", "round_rectangle", "ellipse", "diamond", "triangle"];

const SIZES = {
  rectangle: { width: 220, height: 100 },
  round_rectangle: { width: 220, height: 100 },
  ellipse: { width: 180, height: 100 },
  diamond: { width: 200, height: 120 },
  triangle: { width: 200, height: 110 },
};

export class DiagramError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DiagramError";
    this.code = code;
  }
}

export function diagramPrompt({ intent, selection = [] }) {
  const context = selection
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .slice(0, 20)
    .map((item) => `- ${String(item.text).trim().slice(0, 200)}`)
    .join("\n");

  return {
    system: [
      "You plan diagrams for a whiteboard.",
      "Turn the request into a small directed graph and reply with JSON only, no prose.",
      "Shape:",
      '{"title": string, "nodes": [{"id": string, "label": string, "kind": "rectangle|round_rectangle|ellipse|diamond|triangle"}], "edges": [{"from": id, "to": id, "label"?: string}]}',
      `Rules: 2 to ${DIAGRAM_LIMITS.maxNodes} nodes; unique ids like n1; labels at most 80 characters;`,
      "edges only between listed nodes; no self-loops; at most one edge per ordered pair;",
      "use diamond for decisions, ellipse for start/end, rectangle for steps;",
      "write labels in the language of the request; omit coordinates.",
    ].join(" "),
    user: [
      `Request: ${intent}`,
      context ? `Selected content:\n${context}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function text(value, limit = DIAGRAM_LIMITS.label) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/**
 * Validate what the model said. Anything the board cannot represent is dropped here,
 * with a code the task can report, rather than surfacing as a broken document.
 */
export function parseDiagram(raw, limits = DIAGRAM_LIMITS) {
  if (!raw || typeof raw !== "object") throw new DiagramError("BAD_DIAGRAM", "no diagram object");
  const nodes = [];
  const seen = new Set();
  for (const candidate of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (nodes.length >= limits.maxNodes) break;
    const label = text(candidate?.label);
    if (!label) continue;
    let id = text(candidate?.id, 40) || `n${nodes.length + 1}`;
    if (seen.has(id)) id = `${id}-${nodes.length + 1}`;
    seen.add(id);
    const kind = KINDS.includes(candidate?.kind) ? candidate.kind : "rectangle";
    nodes.push({ id, label, kind });
  }
  if (nodes.length === 0) throw new DiagramError("EMPTY_DIAGRAM", "the model returned no nodes");

  const edges = [];
  const pairs = new Set();
  for (const candidate of Array.isArray(raw.edges) ? raw.edges : []) {
    if (edges.length >= limits.maxEdges) break;
    const from = text(candidate?.from, 40);
    const to = text(candidate?.to, 40);
    if (!from || !to || from === to) continue;
    if (!seen.has(from) || !seen.has(to)) continue;
    const key = `${from}->${to}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    edges.push({ from, to, label: text(candidate?.label, 80) });
  }

  return { title: text(raw.title, 120), nodes, edges };
}

function levelsOf(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) continue;
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }

  const level = new Map();
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) level.set(id, 0);
  let index = 0;
  while (index < queue.length) {
    const id = queue[index++];
    for (const next of outgoing.get(id) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, (level.get(id) ?? 0) + 1));
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }

  // A cycle has no source; put its members in one column after the acyclic part.
  const fallback = Math.max(0, ...level.values()) + 1;
  for (const node of nodes) if (!level.has(node.id)) level.set(node.id, fallback);
  return level;
}

/**
 * Deterministic layered layout: columns are depth, rows are order within a depth.
 * A second entry point keeps it testable without a board.
 */
export function layoutDiagram(diagram, origin = { x: 0, y: 0 }, options = {}) {
  const gapX = options.gapX ?? 90;
  const gapY = options.gapY ?? 50;
  if (!diagram.nodes.length) return { nodes: [], width: 0, height: 0 };
  const level = levelsOf(diagram.nodes, diagram.edges);
  const columns = new Map();
  for (const node of diagram.nodes) {
    const depth = level.get(node.id) ?? 0;
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth).push(node);
  }

  const depths = [...columns.keys()].sort((a, b) => a - b);
  const maxRows = Math.max(...depths.map((depth) => columns.get(depth).length));
  const widths = depths.map(
    (depth) => Math.max(...columns.get(depth).map((node) => SIZES[node.kind].width)),
  );
  const columnX = [];
  let cursor = 0;
  for (const [index] of depths.entries()) {
    columnX[index] = cursor;
    cursor += widths[index] + gapX;
  }

  const placed = [];
  for (const [index, depth] of depths.entries()) {
    const column = columns.get(depth);
    const offset = ((maxRows - column.length) * (SIZES.rectangle.height + gapY)) / 2;
    column.forEach((node, row) => {
      const size = SIZES[node.kind];
      placed.push({
        ...node,
        x: origin.x + columnX[index] + (widths[index] - size.width) / 2,
        y: origin.y + offset + row * (SIZES.rectangle.height + gapY),
        width: size.width,
        height: size.height,
      });
    });
  }

  const right = Math.max(...placed.map((node) => node.x + node.width));
  const bottom = Math.max(...placed.map((node) => node.y + node.height));
  return {
    nodes: placed,
    width: right - origin.x,
    height: bottom - origin.y,
  };
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Shift the preferred origin right, then down, until the diagram has room. */
export function freeOrigin(origin, size, existing = []) {
  const boxes = existing.filter(
    (widget) => widget && widget.type !== "connector" && Number.isFinite(widget.x),
  );
  let candidate = { x: origin.x, y: origin.y, width: size.width, height: size.height };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!boxes.some((box) => overlaps(candidate, box))) return { x: candidate.x, y: candidate.y };
    const right = Math.max(...boxes.filter((box) => overlaps(candidate, box)).map((box) => box.x + box.width));
    candidate = { ...candidate, x: right + 80 };
  }
  const bottom = Math.max(0, ...boxes.map((box) => box.y + box.height));
  return { x: origin.x, y: bottom + 80 };
}

export function makeId(prefix) {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${random}`;
}

/**
 * Write the diagram into the document.
 *
 * One transaction for the whole result: collaborators see a complete diagram, undo
 * removes it as one step, and a failure halfway leaves nothing behind.
 */
export function applyDiagram(
  ydoc,
  diagram,
  { origin = { x: 0, y: 0 }, agent = null, taskId = null, skill = "diagram" } = {},
) {
  const existing = [...ydoc.getMap("widgets").values()];
  const laidOut = layoutDiagram(diagram, origin);
  const placedAt = freeOrigin(origin, laidOut, existing);
  const placed = layoutDiagram(diagram, placedAt).nodes;

  const widgets = ydoc.getMap("widgets");
  const texts = ydoc.getMap("texts");
  const byNode = new Map();
  const objects = [];
  const stamp = {
    ...(agent ? { agent: { id: agent.id, name: agent.name, taskId, skill } } : {}),
  };
  const author = agent ? `${agent.name} · AI` : "AI";

  ydoc.transact(() => {
    for (const node of placed) {
      const id = makeId("shape");
      byNode.set(node.id, id);
      widgets.set(id, {
        id,
        type: "shape",
        parentId: null,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        shapeKind: node.kind,
        title: node.label,
        style: {
          fillColor:
            node.kind === "diamond" ? "#fff7e6" : node.kind === "ellipse" ? "#eef4ff" : "#ffffff",
          strokeColor: "#1a1a1a",
          textAlign: "center",
          textVAlign: "middle",
        },
        createdBy: author,
        createdAt: Date.now(),
        ...stamp,
      });
      const text = new Y.Text();
      text.insert(0, node.label);
      texts.set(id, text);
      objects.push({ id, kind: "node", label: node.label });
    }

    for (const edge of diagram.edges) {
      const from = byNode.get(edge.from);
      const to = byNode.get(edge.to);
      if (!from || !to) continue;
      const source = widgets.get(from);
      const target = widgets.get(to);
      const id = makeId("connector");
      widgets.set(id, {
        id,
        type: "connector",
        parentId: null,
        x: (source.x + target.x) / 2,
        y: (source.y + target.y) / 2,
        width: Math.abs(target.x - source.x),
        height: Math.abs(target.y - source.y),
        start: { item: from },
        end: { item: to },
        arrow: "end",
        routing: "elbow",
        style: { strokeColor: "#1a1a1a", strokeWidth: 2 },
        createdBy: author,
        createdAt: Date.now(),
        ...stamp,
      });
      if (edge.label) {
        const text = new Y.Text();
        text.insert(0, edge.label);
        texts.set(id, text);
      }
      objects.push({ id, kind: "edge", from, to, label: edge.label || null });
    }
  });

  return {
    title: diagram.title,
    objects,
    nodes: placed.length,
    edges: objects.filter((object) => object.kind === "edge").length,
    origin: placedAt,
  };
}
