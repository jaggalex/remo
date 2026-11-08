import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBoard, testDatabaseStore } from "./test-db.mjs";
import { Y } from "./y.mjs";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../scripts/repaint-paper.mjs", import.meta.url));

const opened = await testDatabaseStore("paper repaint");
const store = opened?.store;
const room = `repaint-${Date.now().toString(36)}`;

async function repaint(...args) {
  const env = { ...process.env, REMO_MIGRATION_DATABASE_URL: opened.url, DATABASE_URL: opened.url };
  const { stdout } = await run(process.execPath, [SCRIPT, "--room", room, ...args], { env });
  return stdout;
}

async function documentOf() {
  const doc = new Y.Doc();
  const { rows } = await store.pool.query(
    "select update from board_updates where board_id = $1 order by id asc",
    [room],
  );
  for (const row of rows) Y.applyUpdate(doc, new Uint8Array(row.update));
  return doc;
}

describe.skipIf(!store)("db:repaint (ADR-183)", () => {
  beforeAll(async () => {
    await ensureBoard(store, room);
    const doc = new Y.Doc();
    doc.getMap("widgets").set("n1", { id: "n1", type: "sticky_note", style: { fillColor: "#ffe07a" } });
    doc.getMap("widgets").set("n2", { id: "n2", type: "sticky_note", style: { fillColor: "#f8d3af" } });
    await store.pool.query("insert into board_updates (board_id, update) values ($1, $2)", [
      room,
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    ]);
    await store.pool.query(
      "insert into widgets (board_id, id, type, fill_color) values ($1, 'n1', 'sticky_note', '#ffe07a')",
      [room],
    );
  });

  afterAll(async () => {
    await store?.pool.query("delete from boards where id = $1", [room]).catch(() => {});
    await store?.close?.();
  });

  it("lists without writing, then repaints once with an audit row", async () => {
    expect(await repaint()).toMatch(/1 object\(s\).*\n.*would change/);
    expect((await documentOf()).getMap("widgets").get("n1").style.fillColor).toBe("#ffe07a");

    await expect(run(process.execPath, [SCRIPT, "--room", room, "--apply"])).rejects.toThrow();

    expect(await repaint("--apply", "--yes")).toMatch(/Repainted 1 object/);
    const widgets = (await documentOf()).getMap("widgets");
    expect(widgets.get("n1").style.fillColor).toBe("#ece2c8");
    // The 22 colours of ADR-120 are not the command's to change.
    expect(widgets.get("n2").style.fillColor).toBe("#f8d3af");

    const { rows: projected } = await store.pool.query(
      "select fill_color from widgets where board_id = $1 and id = 'n1'",
      [room],
    );
    expect(projected[0].fill_color).toBe("#ece2c8");
    const { rows: audit } = await store.pool.query(
      "select action, actor_type, after from audit_events where board_id = $1",
      [room],
    );
    expect(audit).toEqual([
      { action: "board.palette.repainted", actor_type: "system", after: { widgets: 1, columns: 0, adr: "ADR-183" } },
    ]);

    expect(await repaint("--apply", "--yes")).toMatch(/No room uses the previous palette/);
  });
});
