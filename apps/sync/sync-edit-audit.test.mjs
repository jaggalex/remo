import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import { createEditAudit } from "./sync-edit-audit.mjs";

const WINDOW_MS = 60_000;

function makeAudit({ recordAudit } = {}) {
  const rows = [];
  const store = {
    recordAudit: recordAudit ?? (async (row) => rows.push(row)),
  };
  const audit = createEditAudit({ store, windowMs: WINDOW_MS, maxIds: 3, maxFields: 3 });
  const doc = new Y.Doc();
  const authBySocket = new WeakMap();
  const socket = {};
  authBySocket.set(socket, {
    boardId: "b1",
    orgId: "o1",
    access: { capabilities: ["board.edit"] },
    session: { sessionId: "s1", user: { id: "u1" } },
  });
  audit.attach(doc, authBySocket);
  return { rows, audit, doc, socket, authBySocket };
}

function put(doc, origin, id, value) {
  doc.transact(() => doc.getMap("widgets").set(id, value), origin);
}

const note = (x = 0) => ({
  id: "w1",
  type: "sticky_note",
  parentId: null,
  x,
  y: 0,
  width: 100,
  height: 100,
});

describe("socket edit audit (ADR-175)", () => {
  it("writes one row for a session and window, with counts and ids", async () => {
    const { rows, audit, doc, socket } = makeAudit();
    put(doc, socket, "w1", note(1));
    put(doc, socket, "w2", { ...note(2), id: "w2" });
    expect(audit.openWindows()).toBe(1);

    await audit.flush();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "board.document.edited",
      actorId: "u1",
      sessionId: "s1",
      boardId: "b1",
      orgId: "o1",
      subject: "2 objects",
    });
    expect(rows[0].after.updates).toBe(2);
    expect(rows[0].after.bytes).toBeGreaterThan(0);
    expect(rows[0].after.objects.sort()).toEqual(["w1", "w2"]);
    expect(rows[0].after.fields).toContain("*");
    expect(audit.openWindows()).toBe(0);
  });

  it("reports the fields that changed after the first touch", async () => {
    const { rows, audit, doc, socket } = makeAudit();
    put(doc, socket, "w1", note(1));
    put(doc, socket, "w1", note(2));
    await audit.flush();
    expect(rows[0].after.fields).toContain("x");
  });

  it("keeps two sessions apart", async () => {
    const { rows, audit, doc, socket, authBySocket } = makeAudit();
    const other = {};
    authBySocket.set(other, {
      boardId: "b1",
      orgId: "o1",
      access: { capabilities: ["board.edit"] },
      session: { sessionId: "s2", user: { id: "u2" } },
    });
    put(doc, socket, "w1", note(1));
    put(doc, other, "w2", { ...note(2), id: "w2" });

    await audit.flush();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sessionId).sort()).toEqual(["s1", "s2"]);
    expect(rows.map((row) => row.after.objects)).toEqual([["w1"], ["w2"]]);
  });

  it("writes nothing for a read-only socket or a local transaction", async () => {
    const { rows, audit, doc, authBySocket } = makeAudit();
    const viewer = {};
    authBySocket.set(viewer, {
      boardId: "b1",
      orgId: "o1",
      access: { capabilities: ["board.read"] },
      session: { sessionId: "s3", user: { id: "u3" } },
    });
    put(doc, viewer, "w1", note(1));
    put(doc, "local", "w2", { ...note(2), id: "w2" });

    await audit.flush();
    expect(rows).toEqual([]);
  });

  it("caps the id list and does not grow the row with a large selection", async () => {
    const { rows, audit, doc, socket } = makeAudit();
    for (let index = 0; index < 10; index += 1) {
      put(doc, socket, `w${index}`, { ...note(index), id: `w${index}` });
    }
    await audit.flush();
    expect(rows[0].after.objects).toHaveLength(3);
    expect(rows[0].subject).toBe("3 objects");
  });

  it("never lets an audit failure end the room", async () => {
    const { audit, doc, socket } = makeAudit({
      recordAudit: async () => {
        throw new Error("audit table is down");
      },
    });
    put(doc, socket, "w1", note(1));
    await expect(audit.flush()).resolves.toBeUndefined();
    expect(audit.openWindows()).toBe(0);
  });
});
