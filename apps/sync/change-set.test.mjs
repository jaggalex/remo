import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import { ChangeSetError, estimateChangeSet, executeChangeSet, validateOperations } from "./change-set.mjs";

function boardWithNotes(count) {
  const ydoc = new Y.Doc();
  const widgets = ydoc.getMap("widgets");
  const texts = ydoc.getMap("texts");
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const id = `note_${index}`;
    ids.push(id);
    widgets.set(id, {
      id,
      type: "sticky_note",
      parentId: null,
      x: 0,
      y: 0,
      width: 160,
      height: 180,
    });
    const text = new Y.Text();
    text.insert(0, `Note ${index}\nbody`);
    texts.set(id, text);
  }
  return { ydoc, ids };
}

const budget = { maxActions: 500 };

describe("validateOperations", () => {
  it("accepts a cards operation and refuses the rest", () => {
    expect(
      validateOperations([{ op: "create_cards", selectionIds: ["a", "b"] }]),
    ).toEqual({ operations: 1, sources: 2, changes: 2 });
    expect(() => validateOperations([])).toThrow(ChangeSetError);
    expect(() => validateOperations([{ op: "delete_board", selectionIds: ["a"] }])).toThrow(
      /supported operations/,
    );
    expect(() => validateOperations([{ op: "create_cards", selectionIds: [] }])).toThrow(
      /needs a selection/,
    );
  });

  it("accepts connector operations and names a self-loop", () => {
    expect(
      validateOperations([{ op: "create_connector", from: "a", to: "b", routing: "elbow" }]),
    ).toMatchObject({ operations: 1, changes: 1 });
    expect(() =>
      validateOperations([{ op: "create_connector", from: "a", to: "a" }]),
    ).toThrow(expect.objectContaining({ code: "connector_self_loop" }));
    expect(() =>
      validateOperations([{ op: "set_connector_routing", connectorId: "c", routing: "wavy" }]),
    ).toThrow(/routing must/);
    expect(() =>
      validateOperations([{ op: "set_connector_waypoints", connectorId: "c", waypoints: new Array(33).fill({ x: 1, y: 2 }) }]),
    ).toThrow(/at most 32/);
  });

  it("limits the total source count", () => {
    const ids = Array.from({ length: 501 }, (_, index) => `n${index}`);
    expect(() => validateOperations([{ op: "create_cards", selectionIds: ids }])).toThrow(
      /limited to 500/,
    );
  });
});

describe("estimateChangeSet", () => {
  it("counts cards without writing", () => {
    const { ydoc, ids } = boardWithNotes(3);
    const estimate = estimateChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      budget,
    });
    expect(estimate.cards).toBe(3);
    expect(ydoc.getMap("widgets").size).toBe(3);
  });

  it("refuses when the budget is too small", () => {
    const { ydoc, ids } = boardWithNotes(3);
    expect(() =>
      estimateChangeSet({
        ydoc,
        operations: [{ op: "create_cards", selectionIds: ids }],
        budget: { maxActions: 2 },
      }),
    ).toThrow(/2 changes/);
  });
});

describe("connector change sets", () => {
  function boardWithTwoNotes() {
    const { ydoc, ids } = boardWithNotes(2);
    return { ydoc, ids };
  }

  it("creates a connector and reports it without touching card progress", async () => {
    const { ydoc, ids } = boardWithTwoNotes();
    const estimate = estimateChangeSet({
      ydoc,
      operations: [{ op: "create_connector", from: ids[0], to: ids[1] }],
      budget,
    });
    expect(estimate).toMatchObject({ cards: 0, changes: 1 });
    const result = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_connector", from: ids[0], to: ids[1] }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
    });
    expect(result.count).toBe(1);
    expect(result.connectors).toHaveLength(1);
    const connector = [...ydoc.getMap("widgets").values()].find((w) => w.type === "connector");
    expect(connector).toMatchObject({
      start: { item: ids[0] },
      end: { item: ids[1] },
      routing: "elbow",
      // The line Plain preset, not a hex no swatch offers (ADR-129).
      style: { strokeColor: "#58534e", strokeWidth: 2 },
      createdBy: "Scout",
      agent: { id: "a1", name: "Scout", taskId: "t1", skill: "change-set" },
    });
  });

  it("refuses a self-loop before writing", async () => {
    const { ydoc, ids } = boardWithTwoNotes();
    expect(() =>
      estimateChangeSet({
        ydoc,
        operations: [{ op: "create_connector", from: ids[0], to: ids[0] }],
        budget,
      }),
    ).toThrow(expect.objectContaining({ code: "connector_self_loop" }));
    expect([...ydoc.getMap("widgets").values()].some((w) => w.type === "connector")).toBe(false);
  });

  it("changes routing and replaces rigid waypoints", async () => {
    const { ydoc, ids } = boardWithTwoNotes();
    await executeChangeSet({
      ydoc,
      operations: [{ op: "create_connector", from: ids[0], to: ids[1] }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
    });
    const connector = [...ydoc.getMap("widgets").values()].find((w) => w.type === "connector");
    const result = await executeChangeSet({
      ydoc,
      operations: [
        {
          op: "set_connector_waypoints",
          connectorId: connector.id,
          routing: "curved",
          waypoints: [{ id: "w1", x: 100, y: 40 }],
        },
        { op: "set_connector_routing", connectorId: connector.id, routing: "straight" },
      ],
      agent: { id: "a1", name: "Scout" },
      taskId: "t2",
      budget,
    });
    expect(result.count).toBe(2);
    const updated = ydoc.getMap("widgets").get(connector.id);
    expect(updated.routing).toBe("straight");
    expect(updated.waypoints).toEqual([{ id: "w1", x: 100, y: 40, rigid: true }]);
  });
});

describe("executeChangeSet", () => {
  it("runs in chunks and reports progress", async () => {
    const { ydoc, ids } = boardWithNotes(120);
    const events = [];
    const result = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
      onProgress: (progress) => events.push(progress),
    });
    expect(result.count).toBe(120);
    expect(result.chunks).toBe(3);
    expect(events.at(-1)).toMatchObject({ done: 120, total: 120, chunks: 3 });
    expect([...ydoc.getMap("widgets").values()].filter((w) => w.type === "card")).toHaveLength(120);
  });

  it("resumes from processed sources instead of duplicating them", async () => {
    const { ydoc, ids } = boardWithNotes(6);
    const first = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids.slice(0, 3) }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
    });
    expect(first.count).toBe(3);

    const resumed = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t2",
      budget,
      progress: { processed: first.processed },
    });
    expect(resumed.count).toBe(3);
    expect([...ydoc.getMap("widgets").values()].filter((w) => w.type === "card")).toHaveLength(6);
  });

  it("stops between chunks when the task is cancelled", async () => {
    const { ydoc, ids } = boardWithNotes(120);
    let calls = 0;
    const result = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
      shouldContinue: async () => {
        calls += 1;
        return calls <= 1;
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.count).toBe(50);
  });
});

describe("agent writes are domain events (ADR-097)", () => {
  it("announces each card it creates, with a dedupe key per change set", async () => {
    const { ydoc, ids } = boardWithNotes(3);
    const batches = [];
    const result = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      changeSetId: "cs-1",
      budget,
      onEvents: (batch) => batches.push(batch),
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(batches[0][0]).toMatchObject({
      type: "board.item.created",
      payload: { objectType: "card" },
      dedupeKey: `change-set:cs-1:0:card:${result.created[0].id}`,
    });
    expect(JSON.stringify(batches[0])).not.toContain("Note 0");
    // The return value is the same list, for a caller that writes after the run.
    expect(result.events).toEqual(batches.flat());
  });

  it("announces a connector through the same registry, and its routing change", async () => {
    const { ydoc, ids } = boardWithNotes(2);
    const batches = [];
    const created = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_connector", from: ids[0], to: ids[1], routing: "elbow" }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      changeSetId: "cs-2",
      budget,
      onEvents: (batch) => batches.push(batch),
    });

    const connectorId = created.connectors[0].id;
    expect(batches.flat()).toEqual([
      {
        type: "board.connector.created",
        subject: connectorId,
        payload: { from: ids[0], to: ids[1] },
        dedupeKey: `change-set:cs-2:0:connector:${connectorId}`,
      },
    ]);

    batches.length = 0;
    await executeChangeSet({
      ydoc,
      operations: [
        {
          op: "set_connector_routing",
          connectorId,
          routing: "curved",
          waypoints: [],
        },
      ],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      changeSetId: "cs-3",
      budget,
      onEvents: (batch) => batches.push(batch),
    });
    expect(batches.flat()[0]).toMatchObject({
      type: "board.connector.updated",
      subject: connectorId,
      payload: { routing: "curved" },
      dedupeKey: `change-set:cs-3:0:connector:${connectorId}`,
    });
  });

  it("resumes after a connector was created without a duplicate error", async () => {
    const { ydoc, ids } = boardWithNotes(2);
    const operations = [{ op: "create_connector", from: ids[0], to: ids[1] }];
    const first = await executeChangeSet({
      ydoc,
      operations,
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
    });
    expect(first.processed).toEqual(["connector:0"]);

    // The estimate used to validate every operation, including the connector that is
    // already in the document, and threw CONNECTOR_EXISTS forever.
    const resumed = await executeChangeSet({
      ydoc,
      operations,
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
      progress: { processed: first.processed },
    });
    expect(resumed.count).toBe(0);
  });

  it("stays quiet when a resume finds the work already done", async () => {
    const { ydoc, ids } = boardWithNotes(3);
    const first = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      changeSetId: "cs-4",
      budget,
    });

    const resumed = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      changeSetId: "cs-4",
      budget,
      progress: { processed: first.processed },
    });
    expect(resumed.count).toBe(0);
    expect(resumed.events).toEqual([]);
  });

  it("leaves the dedupe key empty when there is no change set (tests, local runs)", async () => {
    const { ydoc, ids } = boardWithNotes(1);
    const result = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
    });
    expect(result.events[0].dedupeKey).toBeNull();
  });
});

describe("locked objects are skipped, not forced (ADR-107)", () => {
  it("converts every unlocked note and reports the locked one", async () => {
    const { ydoc, ids } = boardWithNotes(3);
    const widgets = ydoc.getMap("widgets");
    widgets.set(ids[1], { ...widgets.get(ids[1]), locked: true, lockedBy: "u1" });

    const estimate = estimateChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      budget,
    });
    expect(estimate.cards).toBe(2);
    expect(estimate.skipped).toEqual([{ sourceId: ids[1], reason: "locked" }]);

    const result = await executeChangeSet({
      ydoc,
      operations: [{ op: "create_cards", selectionIds: ids }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
    });
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toEqual([{ sourceId: ids[1], reason: "locked" }]);
  });

  it("leaves a locked connector alone and says so", async () => {
    const { ydoc, ids } = boardWithNotes(2);
    await executeChangeSet({
      ydoc,
      operations: [{ op: "create_connector", from: ids[0], to: ids[1] }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      budget,
    });
    const connector = [...ydoc.getMap("widgets").values()].find((w) => w.type === "connector");
    const widgets = ydoc.getMap("widgets");
    widgets.set(connector.id, { ...widgets.get(connector.id), locked: true, lockedBy: "u1" });

    const result = await executeChangeSet({
      ydoc,
      operations: [{ op: "set_connector_routing", connectorId: connector.id, routing: "straight" }],
      agent: { id: "a1", name: "Scout" },
      taskId: "t2",
      budget,
    });
    expect(result.count).toBe(0);
    expect(result.skipped).toEqual([{ sourceId: String(connector.id), reason: "locked" }]);
    expect(ydoc.getMap("widgets").get(connector.id).routing).not.toBe("straight");
  });
});
