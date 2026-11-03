/**
 * Does a silent client stay in the roster?
 *
 * Emulates a hidden, timer-throttled tab by stopping the awareness renewal of
 * client A, then waits longer than the 30 s awareness timeout before a second
 * client joins. Without the server-side keepalive, B sees nobody.
 *
 *   node apps/sync/server.mjs &
 *   node apps/sync/keepalive-test.mjs
 */
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const URL = process.env.REMO_SYNC_URL ?? "ws://localhost:1234";
const ROOM = `keepalive-${Date.now()}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const untilSynced = (provider, label, ms = 8000) =>
  Promise.race([
    new Promise((resolve) => provider.on("sync", (state) => state && resolve())),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);

const docA = new Y.Doc();
const a = new WebsocketProvider(URL, ROOM, docA, { disableBc: true });
await untilSynced(a, "A sync");
a.awareness.setLocalStateField("user", { name: "Idle", color: "#2d9bf0" });

// Freeze A: no renewals, exactly like a throttled background tab.
clearInterval(a.awareness._checkInterval);
console.log("A connected and frozen; waiting 40s (awareness timeout is 30s)…");
await wait(40_000);

const docB = new Y.Doc();
const b = new WebsocketProvider(URL, ROOM, docB, { disableBc: true });
b.awareness.setLocalStateField("user", { name: "Watcher", color: "#8fd14f" });
await untilSynced(b, "B sync");
await wait(1500);

const names = [...b.awareness.getStates().values()]
  .map((state) => state.user?.name)
  .filter(Boolean)
  .sort();

const ok = names.includes("Idle") && names.includes("Watcher");
console.log(`B sees: ${JSON.stringify(names)}`);
console.log(ok ? "KEEPALIVE OK" : "KEEPALIVE FAILED");

a.destroy();
b.destroy();
docA.destroy();
docB.destroy();
process.exitCode = ok ? 0 : 1;
