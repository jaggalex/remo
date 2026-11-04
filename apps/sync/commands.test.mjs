import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import { CommandError, commandObjectId, docVersion, runCommand } from "./commands.mjs";

const actor = { type: "user", id: "u1", name: "Alex" };

function docWithNote() {
  const ydoc = new Y.Doc();
  const created = runCommand({
    ydoc,
    name: "board.item.create",
    input: { type: "sticky_note", x: 10, y: 20, content: "Hello" },
    actor,
    boardId: "b1",
  });
  return { ydoc, id: created.result.id, version: created.version };
}

describe("command registry (ADR-092)", () => {
  it("creates one object and its text in one transaction", () => {
    const { ydoc, id } = docWithNote();
    const widget = ydoc.getMap("widgets").get(id);
    expect(widget).toMatchObject({
      id,
      type: "sticky_note",
      x: 10,
      y: 20,
      createdBy: "Alex",
    });
    expect(ydoc.getMap("texts").get(id).toString()).toBe("Hello");
  });

  it("refuses to create over an existing object", () => {
    const { ydoc, id } = docWithNote();
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { type: "sticky_note", x: 0, y: 0 },
        actor,
        boardId: "b1",
        objectId: id,
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_EXISTS", status: 409 }));
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { id, type: "sticky_note", x: 0, y: 0 },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
  });

  it("changes a version on every write and refuses a stale caller", () => {
    const { ydoc, id, version } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { x: 99 } },
      actor,
      boardId: "b1",
    });
    expect(docVersion(ydoc)).not.toBe(version);
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { x: 1 } },
        actor,
        boardId: "b1",
        ifVersion: version,
      }),
    ).toThrow(expect.objectContaining({ code: "STALE", status: 409 }));
  });

  it("updates fields and the materialized text together", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { content: "Changed", width: 200 } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id)).toMatchObject({ content: "Changed", width: 200 });
    expect(ydoc.getMap("texts").get(id).toString()).toBe("Changed");
  });

  it("sets text without touching geometry", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.text.set",
      input: { id, text: "Body" },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("texts").get(id).toString()).toBe("Body");
    expect(ydoc.getMap("widgets").get(id).x).toBe(10);
  });

  it("connects two objects and refuses a self-loop or a container", () => {
    const { ydoc, id } = docWithNote();
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 300, y: 20, content: "B" },
      actor,
      boardId: "b1",
    });
    const link = runCommand({
      ydoc,
      name: "board.connector.create",
      input: { from: id, to: second.result.id },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(link.result.id)).toMatchObject({
      type: "connector",
      start: { item: id },
      end: { item: second.result.id },
    });

    expect(() =>
      runCommand({
        ydoc,
        name: "board.connector.create",
        input: { from: id, to: id },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "SELF_LOOP" }));

    // A frame is a container: it exists in the document but cannot be an endpoint.
    ydoc.getMap("widgets").set("frame-1", {
      id: "frame-1",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    expect(() =>
      runCommand({
        ydoc,
        name: "board.connector.create",
        input: { from: id, to: "frame-1" },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "NOT_CONNECTABLE" }));
  });

  it("deletes an object and the connectors that pointed at it", () => {
    const { ydoc, id } = docWithNote();
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 300, y: 20 },
      actor,
      boardId: "b1",
    });
    const link = runCommand({
      ydoc,
      name: "board.connector.create",
      input: { from: id, to: second.result.id },
      actor,
      boardId: "b1",
    });
    const removed = runCommand({
      ydoc,
      name: "board.item.delete",
      input: { id },
      actor,
      boardId: "b1",
    });
    expect(removed.result.connectors).toBe(1);
    expect(ydoc.getMap("widgets").has(id)).toBe(false);
    expect(ydoc.getMap("widgets").has(link.result.id)).toBe(false);
  });

  it("derives a stable id from an idempotency key and refuses a second apply", () => {
    const first = docWithNote();
    const created = runCommand({
      ydoc: first.ydoc,
      name: "board.item.create",
      input: { type: "text", x: 0, y: 0 },
      actor,
      boardId: "b1",
      idempotencyKey: "key-1",
    });
    expect(created.result.id).toBe(
      commandObjectId({
        boardId: "b1",
        actorId: actor.id,
        key: "board.item.create:key-1",
        prefix: "item",
      }),
    );
    // The HTTP layer replays the recorded result before apply; a second apply must not
    // silently overwrite the object (it could be locked).
    expect(() =>
      runCommand({
        ydoc: first.ydoc,
        name: "board.item.create",
        input: { type: "text", x: 0, y: 0 },
        actor,
        boardId: "b1",
        idempotencyKey: "key-1",
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_EXISTS", status: 409 }));

    const one = runCommand({
      ydoc: first.ydoc,
      name: "board.item.create",
      input: { type: "text", x: 0, y: 0 },
      actor,
      boardId: "b1",
    });
    const two = runCommand({
      ydoc: first.ydoc,
      name: "board.item.create",
      input: { type: "text", x: 0, y: 0 },
      actor,
      boardId: "b1",
    });
    expect(one.result.id).not.toBe(two.result.id);
  });

  it("keeps waypoints, style and agent provenance, and refuses a duplicate pair", () => {
    const { ydoc, id } = docWithNote();
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 300, y: 20 },
      actor,
      boardId: "b1",
    });
    const created = runCommand({
      ydoc,
      name: "board.connector.create",
      input: {
        from: id,
        to: second.result.id,
        routing: "curved",
        waypoints: [{ id: "w1", x: 200, y: 100 }],
        style: { strokeColor: "#123456", strokeWidth: 3 },
      },
      actor: { type: "agent", id: "a1", name: "Scout" },
      agent: { id: "a1", name: "Scout", taskId: "t1", skill: "change-set" },
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(created.result.id)).toMatchObject({
      routing: "curved",
      createdBy: "Scout",
      agent: { id: "a1", skill: "change-set" },
      waypoints: [{ id: "w1", x: 200, y: 100, rigid: true }],
      style: { strokeColor: "#123456", strokeWidth: 3 },
    });
    expect(() =>
      runCommand({
        ydoc,
        name: "board.connector.create",
        input: { from: id, to: second.result.id },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "CONNECTOR_EXISTS", status: 409 }));
  });

  it("changes routing and waypoints through the update command", () => {
    const { ydoc, id } = docWithNote();
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 300, y: 20 },
      actor,
      boardId: "b1",
    });
    const link = runCommand({
      ydoc,
      name: "board.connector.create",
      input: { from: id, to: second.result.id },
      actor,
      boardId: "b1",
    });
    runCommand({
      ydoc,
      name: "board.connector.update",
      input: {
        id: link.result.id,
        routing: "straight",
        waypoints: [{ id: "w2", x: 220, y: 40 }],
      },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(link.result.id)).toMatchObject({
      routing: "straight",
      waypoints: [{ id: "w2", x: 220, y: 40, rigid: true }],
    });
  });

  it("names bad input and unknown commands", () => {
    const ydoc = new Y.Doc();
    expect(() =>
      runCommand({ ydoc, name: "board.nope", input: {}, actor, boardId: "b1" }),
    ).toThrow(expect.objectContaining({ code: "UNKNOWN_COMMAND", status: 404 }));
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { type: "kanban", x: 0, y: 0 },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id: "missing", patch: { x: 1 } },
        actor,
        boardId: "b1",
      }),
    ).toThrow(CommandError);
  });
});

describe("author lock in commands (ADR-107)", () => {
  it("records the author and refuses another editor's unlock", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: true } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id)).toMatchObject({
      locked: true,
      lockedBy: "u1",
      lockedByName: "Alex",
    });

    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { locked: false } },
        actor: { type: "user", id: "u2", name: "Bob" },
        capabilities: ["board.edit"],
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "LOCKED_BY_OTHER", status: 409 }));

    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: false } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id).locked).toBeUndefined();
    expect(ydoc.getMap("widgets").get(id).lockedBy).toBeUndefined();
  });

  it("lets a board manager unlock, and refuses edits while locked", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: true } },
      actor,
      boardId: "b1",
    });

    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { x: 5 } },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_LOCKED" }));

    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.delete",
        input: { id },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_LOCKED" }));

    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: false } },
      actor: { type: "user", id: "u2", name: "Bob" },
      capabilities: ["board.edit", "board.manage"],
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id).locked).toBeUndefined();
  });
});
