#!/usr/bin/env node
/**
 * Repaint rooms from the previous tonal rows to the paper tones (ADR-183).
 *
 *   node scripts/repaint-paper.mjs            # list: what would change, changes nothing
 *   node scripts/repaint-paper.mjs --apply --yes
 *   node scripts/repaint-paper.mjs --room <id> [--apply --yes]   # one room only
 *
 * Run it with the service stopped and after `pnpm db:backup`: a room open in memory does
 * not see the update this appends and could compact over it. Each repainted room gets one
 * ordinary Yjs update in `board_updates`, its `widgets.fill_color` projection follows in
 * the same transaction, and one `board.palette.repainted` audit row records the counts. A
 * second run finds nothing to do.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repaintDocument } from "../apps/sync/paper-repaint.mjs";
import { Y } from "../apps/sync/y.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function databaseUrl() {
  // The owner URL sees every organisation; the app role is limited by row-level security.
  if (process.env.REMO_MIGRATION_DATABASE_URL) return process.env.REMO_MIGRATION_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(HERE, "..", ".env"), "utf8");
    const match = env.match(/^(?:REMO_MIGRATION_)?DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env — fall through to the compose defaults */
  }
  return "postgres://remo:remo@localhost:5432/remo";
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const yes = args.includes("--yes");
const roomAt = args.indexOf("--room");
const roomId = roomAt === -1 ? null : args[roomAt + 1];
if (roomAt !== -1 && !roomId) {
  console.error("--room needs a room id.");
  process.exit(2);
}
if (apply && !yes) {
  console.error(
    "--apply rewrites colours in every listed room. Stop the service, back up, then re-run with --apply --yes.",
  );
  process.exit(2);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5000 });

async function loadDocument(boardId, snapshot, through) {
  const doc = new Y.Doc();
  if (snapshot?.length) Y.applyUpdate(doc, new Uint8Array(snapshot));
  const { rows } = await client.query(
    "select update from board_updates where board_id = $1 and id > $2 order by id asc",
    [boardId, through ?? 0],
  );
  for (const row of rows) Y.applyUpdate(doc, new Uint8Array(row.update));
  return doc;
}

async function repaintRoom(board) {
  const doc = await loadDocument(board.id, board.snapshot, board.snapshot_through);
  try {
    const plan = repaintDocument(doc);
    if (!plan.widgets && !plan.columns) return null;
    if (!apply) return plan;

    const before = Y.encodeStateVector(doc);
    const done = repaintDocument(doc, { apply: true });
    const update = Buffer.from(Y.encodeStateAsUpdate(doc, before));
    await client.query("begin");
    try {
      await client.query("insert into board_updates (board_id, update) values ($1, $2)", [board.id, update]);
      for (const fill of done.fills) {
        await client.query(
          "update widgets set fill_color = $3, updated_at = now() where board_id = $1 and id = $2",
          [board.id, fill.id, fill.to],
        );
      }
      await client.query("update boards set updated_at = now() where id = $1", [board.id]);
      await client.query(
        `insert into audit_events (actor_id, org_id, board_id, action, subject, after, actor_type)
         values (null, $2, $1, 'board.palette.repainted', $3, $4, 'system')`,
        [
          board.id,
          board.org_id ?? null,
          board.title ?? null,
          JSON.stringify({ widgets: done.widgets, columns: done.columns, adr: "ADR-183" }),
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
    return done;
  } finally {
    doc.destroy();
  }
}

try {
  await client.connect();
  const { rows: boards } = await client.query(
    `select id, title, org_id, snapshot, snapshot_through, archived_at
       from boards
      where $1::text is null or id = $1
      order by updated_at desc`,
    [roomId],
  );
  let rooms = 0;
  let objects = 0;
  for (const board of boards) {
    const result = await repaintRoom(board);
    if (!result) continue;
    rooms += 1;
    objects += result.widgets + result.columns;
    console.log(
      [
        board.id,
        `${result.widgets} object(s)`,
        `${result.columns} kanban column(s)`,
        board.archived_at ? "archived" : "open",
        board.title ? `"${board.title}"` : "(untitled)",
      ].join(" · "),
    );
  }
  if (!rooms) console.log("No room uses the previous palette.");
  else if (apply) console.log(`Repainted ${objects} object(s) in ${rooms} room(s).`);
  else console.log(`${rooms} room(s), ${objects} object(s) would change. Nothing was written; use --apply --yes.`);
} catch (error) {
  console.error(`PAPER REPAINT FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
