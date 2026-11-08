/**
 * `room-draft`: an assigned room agent writes a first draft as a frame (ADR-189).
 *
 * Unlike `brief-to-board` (ADR-142), the result is not a proposal for a tab: the server
 * validates it, places it in free space and writes it, so the draft exists even when
 * the author closed the room. The model returns a plan-shaped object; `validatePlan`
 * stays the one contract for geometry and kinds, and a small extra rule keeps every
 * object inside the single frame that gives the draft its identity.
 */
import { PlanError, validatePlan } from "@remo/agent-plan";
import { Y } from "./y.mjs";
import { freeOrigin, makeId } from "./diagram.mjs";

export const ROOM_DRAFT_SKILL = Object.freeze({
  slug: "room-draft",
  handler: "builtin:room-draft",
  version: 1,
  risk: "write",
  requiredCapabilities: Object.freeze(["board.read", "board.edit"]),
  tools: Object.freeze(["read_sources", "write_draft"]),
});

export const ROOM_DRAFT_LIMITS = Object.freeze({
  /** Objects in one draft; a readable map, not a data dump. */
  objects: 80,
  connectors: 80,
  /** Characters of source material sent to the model. */
  sourceChars: 12_000,
  sourceObjects: 24,
  perSourceChars: 2_000,
  /** Characters of thread history sent with a clarification. */
  threadChars: 4_000,
  threadMessages: 12,
  titleChars: 120,
  questionChars: 300,
  questions: 12,
  citations: 60,
});

const KINDS = new Set(["process", "problem-map"]);
const TEXT_TYPES = new Set(["sticky_note", "text", "shape", "card", "connector"]);
const ID_PREFIX = {
  frame: "frame",
  sticky_note: "sticky",
  text: "text",
  shape: "shape",
};

/** The widget's editable text, or the field a reader that does not materialise it sees. */
export function widgetText(ydoc, id) {
  const shared = ydoc.getMap("texts").get(id);
  if (shared && typeof shared.toString === "function") return shared.toString();
  const widget = ydoc.getMap("widgets").get(id);
  return String(widget?.content ?? widget?.title ?? "");
}

/**
 * The material the author explicitly selected, trimmed to a prompt-sized excerpt.
 *
 * Text is the one thing the rest of the agent surface deliberately withholds; here the
 * selection *is* the brief, and the panel names it before sending (ADR-189).
 */
export function sourceExcerpts(ydoc, ids) {
  const widgets = ydoc.getMap("widgets");
  const chosen = [];
  let total = 0;
  for (const id of (ids ?? []).slice(0, ROOM_DRAFT_LIMITS.sourceObjects)) {
    const widget = widgets.get(String(id));
    if (!widget) continue;
    const text = widgetText(ydoc, String(id)).trim().slice(0, ROOM_DRAFT_LIMITS.perSourceChars);
    if (!text) continue;
    if (total + text.length > ROOM_DRAFT_LIMITS.sourceChars) break;
    total += text.length;
    chosen.push({
      id: String(id),
      type: String(widget.type),
      title: String(widget.title ?? "").slice(0, ROOM_DRAFT_LIMITS.titleChars),
      text,
    });
  }
  return chosen;
}

function threadExcerpt(messages) {
  let total = 0;
  const lines = [];
  for (const message of (messages ?? []).slice(-ROOM_DRAFT_LIMITS.threadMessages)) {
    if (message.role === "system") continue;
    const text = String(message.text ?? "").trim();
    if (!text) continue;
    if (total + text.length > ROOM_DRAFT_LIMITS.threadChars) break;
    total += text.length;
    lines.push(`${message.role === "agent" ? "agent" : "person"}: ${text}`);
  }
  return lines.join("\n");
}

const PROCEDURES = {
  process: `Build a readable business-process model from the request and the sources.
- Find the start, the end and the result of the process.
- Name the participants and the hand-offs between them.
- Every decision is a diamond with a question inside; every outgoing line is labelled with its condition (yes/no or the actual rule).
- The ordinary path and the refusal/exceptions path must both be visible.
- Unknown owners or conditions become a separate question note, not a guess.`,
  "problem-map": `Build a problem map from interview material.
- Group observations into themes; keep every observation traceable to its source.
- A theme is a text heading, not a claim: do not invent a summary the sources do not support.
- Mark hypotheses separately from observations; a hypothesis is a question to verify, not a finding.
- Where two sources contradict each other, keep both and add a question note.
- Cite the source object for every observation that comes from one.`,
};

export function roomDraftPrompt({ kind, lang = "ru", intent, sources, thread }) {
  const chosen = KINDS.has(kind) ? kind : "process";
  const language = lang === "en" ? "English" : "Russian";
  const system = `You are a careful product analyst working inside a shared canvas.
You write a first draft that a team will edit. You never invent facts.

Return one JSON object and nothing else, in this shape:
{
  "title": "short name of the result",
  "objects": [
    {
      "tempId": "frame",
      "type": "frame",
      "x": 0, "y": 0, "width": 1200, "height": 800,
      "title": "short title"
    },
    {
      "tempId": "n1",
      "type": "shape",
      "parentRef": "frame",
      "x": 40, "y": 60, "width": 220, "height": 90,
      "title": "label",
      "shapeKind": "round_rectangle"
    }
  ],
  "connectors": [
    { "from": "n1", "to": "n2", "arrow": "end", "routing": "elbow", "label": "yes" }
  ],
  "citations": [{ "tempId": "n1", "sourceId": "source object id" }],
  "questions": ["an open question the team must settle"]
}

Rules:
- Exactly one object has type "frame"; every other object has "parentRef" equal to its tempId.
- Types are sticky_note, text, shape and frame. shapeKind is rectangle, round_rectangle, ellipse, diamond or triangle.
- A connector joins two objects of this draft. It never joins an existing board object.
- A connector label is the condition of the branch, not a description.
- "citations" may only name a tempId from this draft and a sourceId from the list below.
- Write the human-readable labels in ${language}.
- No markdown, no code fences, no commentary.

Procedure for this request:
${PROCEDURES[chosen]}`;

  const sourceBlock = sources.length
    ? sources
        .map(
          (source, index) =>
            `[${index + 1}] id=${source.id} type=${source.type} title=${JSON.stringify(source.title)}\n${source.text}`,
        )
        .join("\n\n")
    : "(no sources selected)";
  const threadBlock = thread ? `\nConversation so far:\n${thread}\n` : "";
  const user = `Request: ${intent}\n${threadBlock}\nSelected material:\n${sourceBlock}`;
  return { system, user };
}

function plainString(value, field, max) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (text.length > max) throw new PlanError("DRAFT_TOO_LONG", `${field} is longer than ${max}`);
  return text;
}

function arrayOf(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PlanError("BAD_DRAFT", `${field} must be an array`);
  return value;
}

/**
 * The reply is a plan without the operations envelope: objects and connectors are
 * already in the contract's shape, so one `validatePlan` checks geometry and kinds.
 */
export function parseRoomDraftReply(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PlanError("DRAFT_SCHEMA", "the model must return a JSON object");
  }
  const title = plainString(raw.title, "title", ROOM_DRAFT_LIMITS.titleChars);
  if (!title) throw new PlanError("DRAFT_SCHEMA", "the draft needs a title");
  const objects = arrayOf(raw.objects, "objects");
  if (!objects.length) throw new PlanError("DRAFT_SCHEMA", "the draft has no objects");
  if (objects.length > ROOM_DRAFT_LIMITS.objects) {
    throw new PlanError("DRAFT_TOO_LARGE", `a draft allows ${ROOM_DRAFT_LIMITS.objects} objects`);
  }
  const connectors = arrayOf(raw.connectors, "connectors");
  if (connectors.length > ROOM_DRAFT_LIMITS.connectors) {
    throw new PlanError("DRAFT_TOO_LARGE", `a draft allows ${ROOM_DRAFT_LIMITS.connectors} connectors`);
  }
  const citations = arrayOf(raw.citations, "citations");
  if (citations.length > ROOM_DRAFT_LIMITS.citations) {
    throw new PlanError("DRAFT_TOO_LARGE", `a draft allows ${ROOM_DRAFT_LIMITS.citations} citations`);
  }
  const questions = arrayOf(raw.questions, "questions").map((question, index) =>
    plainString(question, `questions[${index}]`, ROOM_DRAFT_LIMITS.questionChars),
  );
  if (questions.length > ROOM_DRAFT_LIMITS.questions) {
    throw new PlanError("DRAFT_TOO_LARGE", `a draft allows ${ROOM_DRAFT_LIMITS.questions} questions`);
  }
  // The plan contract has no connector label (ADR-142). A branch condition is a small
  // text object placed beside the line, so the draft still says "yes" and "no" without
  // widening the shared plan schema.
  const labels = connectors
    .map((connector) => ({
      from: String(connector?.from ?? ""),
      to: String(connector?.to ?? ""),
      text: plainString(connector?.label ?? connector?.text, "connector label", 80),
    }))
    .filter((label) => label.from && label.to && label.text);
  const plainConnectors = connectors.map((connector) => {
    const { label, text, ...rest } = connector ?? {};
    return rest;
  });
  return {
    title,
    objects,
    connectors: plainConnectors,
    labels,
    citations: citations
      .map((citation) => ({
        tempId: String(citation?.tempId ?? ""),
        sourceId: String(citation?.sourceId ?? ""),
      }))
      .filter((citation) => citation.tempId && citation.sourceId),
    questions: questions.filter(Boolean),
  };
}

/**
 * Validate the draft as a plan and prove the one rule the shared contract does not
 * carry: a draft is one frame, and everything it creates lives inside it.
 */
export function roomDraftPlan(reply, { origin, existingWidgets, existingConnectors }) {
  const plan = validatePlan(
    {
      version: 1,
      template: null,
      origin,
      objects: reply.objects,
      connectors: reply.connectors,
      warnings: [],
    },
    { existingWidgets, existingConnectors },
  );
  const frames = plan.objects.filter((object) => object.type === "frame");
  if (frames.length !== 1) {
    throw new PlanError("DRAFT_FRAME", "a draft has exactly one frame");
  }
  const frame = frames[0];
  for (const object of plan.objects) {
    if (object === frame) continue;
    if (object.parentRef !== frame.tempId) {
      throw new PlanError(
        "DRAFT_OUTSIDE_FRAME",
        `"${object.tempId}" must be a child of the draft frame`,
      );
    }
  }
  const planned = new Set(plan.objects.map((object) => object.tempId));
  for (const connector of plan.connectors) {
    if (!planned.has(connector.from) || !planned.has(connector.to)) {
      throw new PlanError(
        "DRAFT_CONNECTOR",
        "a draft connector must join two objects of this draft",
      );
    }
  }
  return { plan, frame };
}

function draftWidget(object, id, parentId, author, provenance, createdAt) {
  return {
    id,
    type: object.type,
    parentId,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    ...(object.shapeKind ? { shapeKind: object.shapeKind } : {}),
    ...(object.title ? { title: object.title } : {}),
    ...(object.text ? { content: object.text } : {}),
    ...(object.style ? { style: { ...object.style } } : {}),
    ...(author ? { createdBy: author } : {}),
    createdAt,
    ...(provenance ? { agent: { ...provenance } } : {}),
  };
}

/**
 * Write the draft into the live document as one transaction.
 *
 * `placed` is the free top-left the caller found for the whole bounds; every object is
 * shifted by the same delta, so internal geometry is preserved.
 */
export function applyRoomDraft(
  ydoc,
  plan,
  { placed, title, agent, taskId, citations = [], labels = [], sourceIds = [], now = Date.now() },
) {
  const dx = placed.x - plan.bounds.x;
  const dy = placed.y - plan.bounds.y;
  const widgets = ydoc.getMap("widgets");
  const texts = ydoc.getMap("texts");
  const provenance = { id: agent.id, name: agent.name, taskId, skill: ROOM_DRAFT_SKILL.slug };
  const author = `${agent.name} · AI`;
  const sourceSet = new Set(sourceIds.map(String));
  const byCitation = new Map(
    citations
      .filter((citation) => sourceSet.has(String(citation.sourceId)))
      .map((citation) => [citation.tempId, String(citation.sourceId)]),
  );

  const ids = new Map();
  for (const object of plan.objects) {
    const prefix = ID_PREFIX[object.type] ?? "obj";
    let id = makeId(prefix);
    while (widgets.has(id)) id = makeId(prefix);
    ids.set(object.tempId, id);
  }

  const frame = plan.objects.find((object) => object.type === "frame");
  if (!frame) throw new PlanError("DRAFT_FRAME", "a draft has exactly one frame");
  const frameId = ids.get(frame.tempId);
  const created = [];

  ydoc.transact(() => {
    for (const object of plan.objects) {
      const id = ids.get(object.tempId);
      const parentId =
        object.type === "frame" ? null : (ids.get(object.parentRef ?? "") ?? frameId);
      const widget = draftWidget(
        { ...object, x: object.x + dx, y: object.y + dy },
        id,
        parentId,
        author,
        provenance,
        now,
      );
      if (object === frame) widget.title = title;
      const sourceId = byCitation.get(object.tempId);
      if (sourceId) widget.link = { kind: "widget", widgetId: sourceId };
      widgets.set(id, widget);
      if (TEXT_TYPES.has(object.type)) {
        const shared = new Y.Text();
        shared.insert(0, object.text ?? object.title ?? "");
        texts.set(id, shared);
      }
      created.push(id);
    }

    const createdSet = new Set(created);
    for (const connector of plan.connectors) {
      const from = ids.get(connector.from);
      const to = ids.get(connector.to);
      if (!from || !to || !createdSet.has(from) || !createdSet.has(to)) continue;
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
        arrow: connector.arrow ?? (source.type === "shape" || target.type === "shape" ? "end" : "none"),
        routing: connector.routing ?? "elbow",
        style: {
          strokeColor: connector.style?.strokeColor ?? "#58534e",
          strokeWidth: connector.style?.strokeWidth ?? 2,
          ...(connector.style?.strokeStyle ? { strokeStyle: connector.style.strokeStyle } : {}),
        },
        ...(connector.label
          ? { content: connector.label }
          : {}),
        createdBy: author,
        createdAt: now,
        agent: { ...provenance },
      });
      created.push(id);
    }

    // A branch condition sits beside the middle of its line: a plain text object, a
    // child of the draft frame, so moving the frame moves it too.
    for (const label of labels) {
      const from = ids.get(label.from);
      const to = ids.get(label.to);
      if (!from || !to) continue;
      const source = widgets.get(from);
      const target = widgets.get(to);
      const id = makeId("text");
      const midX = (source.x + target.x + source.width / 2 + target.width / 2) / 2;
      const midY = (source.y + target.y + source.height / 2 + target.height / 2) / 2;
      const widget = {
        id,
        type: "text",
        parentId: frameId,
        x: midX - 40,
        y: midY - 12,
        width: 120,
        height: 28,
        content: label.text,
        style: { fontSize: 14, textAlign: "center" },
        createdBy: author,
        createdAt: now,
        agent: { ...provenance },
      };
      widgets.set(id, widget);
      const shared = new Y.Text();
      shared.insert(0, label.text);
      texts.set(id, shared);
      created.push(id);
    }
  });

  return { frameId, createdIds: created, title };
}

/** A retry after a lost flush finds the frame the first attempt already wrote. */
export function findDraftFrame(ydoc, taskId) {
  for (const [id, widget] of ydoc.getMap("widgets").entries()) {
    if (widget?.type === "frame" && widget?.agent?.taskId === taskId) return id;
  }
  return null;
}

export function draftOrigin(ydoc, plan, origin) {
  const existing = [...ydoc.getMap("widgets").values()];
  return freeOrigin(origin, plan.bounds, existing);
}
