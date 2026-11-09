import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import {
  DRAFT_PADDING,
  ROOM_DRAFT_LIMITS,
  applyRoomDraft,
  draftOrigin,
  fitDraftFrame,
  findDraftFrame,
  parseRoomDraftReply,
  roomDraftPlan,
  roomDraftPrompt,
  sourceExcerpts,
  widgetText,
} from "./agent-room-draft.mjs";
import { PlanError } from "@remo/agent-plan";

function boardWith(notes) {
  const doc = new Y.Doc();
  const widgets = doc.getMap("widgets");
  const texts = doc.getMap("texts");
  for (const note of notes) {
    widgets.set(note.id, {
      id: note.id,
      type: "sticky_note",
      parentId: null,
      x: note.x ?? 0,
      y: note.y ?? 0,
      width: 160,
      height: 120,
    });
    const text = new Y.Text();
    text.insert(0, note.text);
    texts.set(note.id, text);
  }
  return doc;
}

const reply = {
  title: "Возврат",
  objects: [
    {
      tempId: "frame",
      type: "frame",
      x: 0,
      y: 0,
      width: 900,
      height: 600,
      title: "Возврат",
    },
    {
      tempId: "step",
      type: "shape",
      parentRef: "frame",
      x: 40,
      y: 60,
      width: 200,
      height: 80,
      title: "Запрос",
      shapeKind: "round_rectangle",
    },
    {
      tempId: "decision",
      type: "shape",
      parentRef: "frame",
      x: 300,
      y: 60,
      width: 160,
      height: 120,
      title: "Условия?",
      shapeKind: "diamond",
    },
  ],
  connectors: [
    { from: "step", to: "decision", arrow: "end", routing: "elbow", label: "да" },
  ],
  citations: [{ tempId: "step", sourceId: "note-1" }],
  questions: ["Кто согласует отказ?"],
};

describe("room draft prompt (ADR-189)", () => {
  it("carries the request, the sources and the thread", () => {
    const prompt = roomDraftPrompt({
      kind: "process",
      lang: "ru",
      intent: "Собери процесс возврата",
      sources: [{ id: "note-1", type: "sticky_note", title: "", text: "Клиент просит возврат" }],
      thread: "person: добавь отказ",
    });
    expect(prompt.user).toContain("Собери процесс возврата");
    expect(prompt.user).toContain("Клиент просит возврат");
    expect(prompt.user).toContain("добавь отказ");
    expect(prompt.system).toContain("Exactly one object has type \"frame\"");
  });

  it("carries the requirements contract", () => {
    const prompt = roomDraftPrompt({
      kind: "requirements",
      lang: "ru",
      intent: "Собери требования к возврату",
      sources: [],
      thread: "",
    });
    expect(prompt.system).toContain('"key": "context"');
    expect(prompt.system).toContain('"key": "questions"');
    expect(prompt.system).toContain("six zone keys");
  });

  it("carries the MVP story map contract", () => {
    const prompt = roomDraftPrompt({
      kind: "mvp-scoping",
      lang: "ru",
      intent: "Определи MVP возврата",
      sources: [],
      thread: "",
    });
    expect(prompt.system).toContain('"key": "mvp"');
    expect(prompt.system).toContain("story map");
    expect(prompt.system).toContain('"cells"');
  });

  it("carries the retrospective, decision and meeting contracts", () => {
    for (const [kind, key] of [
      ["retrospective", '"key": "helped"'],
      ["decision", '"key": "question"'],
      ["meeting-actions", '"key": "decisions"'],
    ]) {
      const prompt = roomDraftPrompt({
        kind,
        lang: "ru",
        intent: "Собери итоги",
        sources: [],
        thread: "",
      });
      expect(prompt.system).toContain(key);
    }
  });

  it("carries the four comparison contracts", () => {
    for (const [kind, phrase] of [
      ["prioritization", "mandatory work"],
      ["competitors", "same scenario"],
      ["architecture-decision", "ADR"],
      ["idea-generation", "hypotheses"],
    ]) {
      const prompt = roomDraftPrompt({ kind, lang: "ru", intent: "Сравни", sources: [], thread: "" });
      expect(prompt.system).toContain(phrase);
      expect(prompt.system).toContain('"recommendation"');
    }
  });

  it("carries the three graph contracts", () => {
    for (const [kind, phrase] of [
      ["dependency-mapping", "must happen before"],
      ["user-flow-design", "every edge a trigger"],
      ["architecture-mapping", "boundary and the level of detail"],
    ]) {
      const prompt = roomDraftPrompt({ kind, lang: "ru", intent: "Собери граф", sources: [], thread: "" });
      expect(prompt.system).toContain(phrase);
      expect(prompt.system).toContain('"nodes"');
    }
  });

  it("carries the delivery-plan procedure and the card fields", () => {
    const prompt = roomDraftPrompt({
      kind: "delivery-plan",
      lang: "ru",
      intent: "Спланируй спринт",
      sources: [],
      thread: "",
    });
    expect(prompt.system).toContain("mandatory scope");
    expect(prompt.system).toContain("never invent numbers");
    expect(prompt.system).toContain("risks/assumptions/open questions");
  });

  it("reads the live text of a chosen object", () => {
    const ydoc = boardWith([{ id: "note-1", text: "клиент ждёт неделю" }]);
    expect(widgetText(ydoc, "note-1")).toBe("клиент ждёт неделю");
    expect(sourceExcerpts(ydoc, ["note-1", "missing"])).toEqual([
      { id: "note-1", type: "sticky_note", title: "", text: "клиент ждёт неделю" },
    ]);
  });

  it("includes the card fields a plan depends on", () => {
    const ydoc = boardWith([{ id: "card-1", text: "Экспорт отчёта" }]);
    ydoc.getMap("widgets").set("card-1", {
      ...ydoc.getMap("widgets").get("card-1"),
      type: "card",
      status: "todo",
      assigneeName: "Ольга",
      dueAt: "2026-11-20",
    });
    expect(sourceExcerpts(ydoc, ["card-1"])[0]).toMatchObject({
      type: "card",
      status: "todo",
      assignee: "Ольга",
      due: "2026-11-20",
    });
  });

  it("expands a selected frame to the material inside it", () => {
    const ydoc = boardWith([]);
    const widgets = ydoc.getMap("widgets");
    const texts = ydoc.getMap("texts");
    widgets.set("frame-1", {
      id: "frame-1",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      title: "Раздел про возврат",
    });
    widgets.set("text-1", {
      id: "text-1",
      type: "text",
      parentId: "frame-1",
      x: 20,
      y: 20,
      width: 240,
      height: 80,
    });
    const text = new Y.Text();
    text.insert(0, "Клиент ждёт возврат неделю");
    texts.set("text-1", text);

    expect(sourceExcerpts(ydoc, ["frame-1"]).map((source) => source.id)).toEqual([
      "frame-1",
      "text-1",
    ]);
    expect(sourceExcerpts(ydoc, ["frame-1"])[1].text).toContain("ждёт возврат");
  });

  it("stops at the source budget", () => {
    const long = "x".repeat(ROOM_DRAFT_LIMITS.perSourceChars + 100);
    const ydoc = boardWith([{ id: "note-1", text: long }]);
    expect(sourceExcerpts(ydoc, ["note-1"])[0].text.length).toBe(
      ROOM_DRAFT_LIMITS.perSourceChars,
    );
  });
});

describe("room draft reply", () => {
  it("keeps branch labels out of the plan contract", () => {
    const parsed = parseRoomDraftReply(reply);
    expect(parsed.labels).toEqual([{ from: "step", to: "decision", text: "да" }]);
    expect(parsed.connectors).toEqual([
      { from: "step", to: "decision", arrow: "end", routing: "elbow" },
    ]);
  });

  it("refuses a reply without a title or objects", () => {
    expect(() => parseRoomDraftReply({ objects: reply.objects })).toThrow(PlanError);
    expect(() => parseRoomDraftReply({ title: "x", objects: [] })).toThrow(PlanError);
  });
});

describe("room draft plan", () => {
  const facts = { existingWidgets: [], existingConnectors: [] };

  it("accepts one frame with its children", () => {
    const { plan, frame } = roomDraftPlan(parseRoomDraftReply(reply), facts);
    expect(frame.tempId).toBe("frame");
    expect(plan.counts.objects).toBe(3);
    expect(plan.counts.connectors).toBe(1);
  });

  it("refuses an object outside the frame", () => {
    const parsed = parseRoomDraftReply({
      ...reply,
      objects: [...reply.objects, {
        tempId: "loose",
        type: "text",
        x: 10,
        y: 10,
        width: 100,
        height: 80,
        text: "вне фрейма",
      }],
    });
    expect(() => roomDraftPlan(parsed, facts)).toThrow(/child of the draft frame/);
  });

  it("refuses a second frame", () => {
    const parsed = parseRoomDraftReply({
      ...reply,
      objects: [...reply.objects, {
        tempId: "frame2",
        type: "frame",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      }],
    });
    expect(() => roomDraftPlan(parsed, facts)).toThrow(/exactly one frame/);
  });

  it("refuses a connector to an object outside the draft", () => {
    const parsed = parseRoomDraftReply({
      ...reply,
      connectors: [{ from: "step", to: "note-1", arrow: "end" }],
    });
    expect(() => roomDraftPlan(parsed, facts)).toThrow();
  });
});

describe("room draft write", () => {
  it("writes the frame, its children, the label and the citation", () => {
    const ydoc = boardWith([{ id: "note-1", text: "возврат", x: 2000, y: 0 }]);
    const parsed = parseRoomDraftReply(reply);
    const { plan } = roomDraftPlan(parsed, {
      existingWidgets: [...ydoc.getMap("widgets").values()],
      existingConnectors: [],
    });
    const placed = draftOrigin(ydoc, plan, { x: 0, y: 0 });
    const applied = applyRoomDraft(ydoc, plan, {
      placed,
      title: "Черновик · Мира — Возврат",
      agent: { id: "agent-1", name: "Мира" },
      taskId: "task-1",
      citations: parsed.citations,
      labels: parsed.labels,
      sourceIds: ["note-1"],
    });

    const widgets = ydoc.getMap("widgets");
    const frame = widgets.get(applied.frameId);
    expect(frame.type).toBe("frame");
    expect(frame.title).toBe("Черновик · Мира — Возврат");
    expect(frame.agent).toEqual({
      id: "agent-1",
      name: "Мира",
      taskId: "task-1",
      skill: "room-draft",
    });

    const children = [...widgets.values()].filter(
      (widget) => widget.parentId === applied.frameId,
    );
    // two objects plus the branch label text
    expect(children).toHaveLength(3);
    const step = children.find((widget) => widget.title === "Запрос");
    expect(step.link).toEqual({ kind: "widget", widgetId: "note-1" });
    expect(applied.createdIds).toContain(applied.frameId);
    expect(findDraftFrame(ydoc, "task-1")).toBe(applied.frameId);
    expect(findDraftFrame(ydoc, "task-2")).toBeNull();
  });

  it("expands the frame to contain every object", () => {
    const ydoc = boardWith([]);
    const parsed = parseRoomDraftReply({
      ...reply,
      objects: [
        ...reply.objects,
        {
          tempId: "far",
          type: "text",
          parentRef: "frame",
          x: 1300,
          y: 700,
          width: 120,
          height: 60,
          text: "outside",
        },
      ],
    });
    const { plan } = roomDraftPlan(parsed, {
      existingWidgets: [...ydoc.getMap("widgets").values()],
      existingConnectors: [],
    });
    fitDraftFrame(plan);
    const frame = plan.objects.find((object) => object.type === "frame");
    expect(frame.x - frame.width / 2).toBeLessThanOrEqual(40 - DRAFT_PADDING);
    expect(frame.y - frame.height / 2).toBeLessThanOrEqual(60 - DRAFT_PADDING);
    expect(frame.x + frame.width / 2).toBeGreaterThanOrEqual(1300 + 120 + DRAFT_PADDING);
    expect(frame.y + frame.height / 2).toBeGreaterThanOrEqual(700 + 60 + DRAFT_PADDING);
    expect(plan.bounds).toEqual({
      x: frame.x - frame.width / 2,
      y: frame.y - frame.height / 2,
      width: frame.width,
      height: frame.height,
    });
  });

  it("clips an over-long model label instead of refusing the draft", () => {
    const parsed = parseRoomDraftReply({
      ...reply,
      objects: reply.objects.map((object) =>
        object.tempId === "step" ? { ...object, title: "x".repeat(300) } : object,
      ),
    });
    const { plan } = roomDraftPlan(parsed, { existingWidgets: [], existingConnectors: [] });
    const step = plan.objects.find((object) => object.tempId === "step");
    expect(step.title.length).toBeLessThanOrEqual(180);
    expect(step.title.endsWith("…")).toBe(true);
  });

  it("places a draft away from existing objects", () => {
    const ydoc = boardWith([{ id: "note-1", text: "занято", x: 0, y: 0 }]);
    const parsed = parseRoomDraftReply(reply);
    const { plan } = roomDraftPlan(parsed, {
      existingWidgets: [...ydoc.getMap("widgets").values()],
      existingConnectors: [],
    });
    const placed = draftOrigin(ydoc, plan, { x: 0, y: 0 });
    expect(placed.x).toBeGreaterThan(0);
  });
});
