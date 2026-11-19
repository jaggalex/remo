/**
 * Smoke test for the sync service: two independent clients, one room.
 *
 *   node apps/sync/server.mjs &
 *   node apps/sync/smoke.mjs
 *
 * Every wait is bounded, so a broken server fails the test instead of hanging it.
 */
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const URL = process.env.REMO_SYNC_URL ?? "ws://localhost:1234";
const ROOM = `smoke-${Date.now()}`;
const STEP = 4000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, label, ms = STEP) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const untilSynced = (provider, label) =>
  withTimeout(
    new Promise((resolve) => provider.on("sync", (state) => state && resolve())),
    label,
  );

const cleanup = [];

try {
  const docA = new Y.Doc();
  const a = new WebsocketProvider(URL, ROOM, docA, { disableBc: true });
  cleanup.push(() => a.destroy(), () => docA.destroy());
  await untilSynced(a, "client A sync");

  docA.getMap("widgets").set("w1", { id: "w1", type: "text", x: 1, y: 2 });
  a.awareness.setLocalStateField("user", { name: "Alice", color: "#2d9bf0" });
  await wait(400);

  const docB = new Y.Doc();
  const b = new WebsocketProvider(URL, ROOM, docB, { disableBc: true });
  cleanup.push(() => b.destroy(), () => docB.destroy());
  b.awareness.setLocalStateField("user", { name: "Bob", color: "#8fd14f" });
  await untilSynced(b, "client B sync");
  await wait(600);

  const received = docB.getMap("widgets").get("w1");

  // Edit from B; A must see it without any explicit merge code.
  docB.getMap("widgets").set("w2", { id: "w2", type: "sticky_note", x: 5, y: 6 });
  await wait(600);
  const echoed = docA.getMap("widgets").get("w2");

  const peersOnA = a.awareness.getStates().size;
  const names = [...a.awareness.getStates().values()]
    .map((state) => state.user?.name)
    .sort();

  const report = { received, echoed, peersOnA, names };
  console.log(JSON.stringify(report, null, 1));

  const ok =
    received?.id === "w1" &&
    echoed?.id === "w2" &&
    peersOnA === 2 &&
    names.join(",") === "Alice,Bob";

  console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(`SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const dispose of cleanup.reverse()) dispose();
}
