#!/usr/bin/env node
/**
 * A local demo for the room agent (ADR-189).
 *
 *   pnpm db:up
 *   pnpm demo:seed
 *   REMO_DEMO=1 pnpm sync      # terminal 1
 *   pnpm dev                   # terminal 2
 *
 * The seed creates one account, one personal organisation, one agent and one room with
 * two sets of notes: one for a refund process, one for a sprint plan. The deterministic
 * model in `ai-fake.mjs` answers both, so no provider key and no network are needed.
 *
 * Run it before the sync service starts: the service keeps a loaded room in memory, and
 * a snapshot replaced underneath it would be ignored until the room is released.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresStore } from "../apps/sync/postgres.mjs";
import { hashPassword } from "../apps/sync/iam.mjs";
import { Y } from "../apps/sync/y.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EMAIL = "demo@remo.local";
const PASSWORD = "remo-demo-2026";
const BOARD = "demo-mvp";

function databaseUrl() {
  if (process.env.REMO_MIGRATION_DATABASE_URL) return process.env.REMO_MIGRATION_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(HERE, "..", ".env"), "utf8");
    const match = env.match(/^(?:REMO_MIGRATION_)?DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* fall through */
  }
  return "postgres://remo:remo@localhost:5432/remo";
}

function notes() {
  return [
    { text: "Клиент просит возврат в течение 14 дней", x: 0, y: 0 },
    { text: "Проверяем условия и историю платежей", x: 300, y: 0 },
    { text: "Кто согласует отказ?", x: 600, y: 0 },
    { text: "Экспорт отчёта — 5 SP, Ольга", x: 0, y: 200 },
    { text: "Права на экспорт — оценка неизвестна", x: 300, y: 200 },
    { text: "Ёмкость команды на спринт не указана", x: 600, y: 200 },
  ];
}

function demoDocument() {
  const doc = new Y.Doc();
  const widgets = doc.getMap("widgets");
  const texts = doc.getMap("texts");
  doc.getMap("meta").set("title", "MVP демо");
  for (const [index, note] of notes().entries()) {
    const id = `demo-note-${index + 1}`;
    widgets.set(id, {
      id,
      type: "sticky_note",
      parentId: null,
      x: note.x,
      y: note.y,
      width: 240,
      height: 140,
      createdBy: "Демо",
      createdAt: Date.now(),
    });
    const text = new Y.Text();
    text.insert(0, note.text);
    texts.set(id, text);
  }
  return doc;
}

const store = new PostgresStore({ connectionString: databaseUrl(), log: console });
try {
  await store.connect();
  await store.migrate();

  let user = await store.findUserByEmail(EMAIL);
  if (!user) {
    const handle = (await store.findUserByHandle("demo")) ? `demo-${Date.now().toString(36).slice(-4)}` : "demo";
    user = await store.createUser({
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      name: "Демо",
      handle,
    });
    console.log(`seed: created account ${EMAIL}`);
  } else {
    console.log(`seed: reusing account ${EMAIL}`);
  }

  const membership = (
    await store.pool.query("select org_id from org_memberships where user_id = $1 limit 1", [
      user.id,
    ])
  ).rows[0];
  let orgId = membership?.org_id;
  if (!orgId) {
    const { org } = await store.createOrgWithOwner({
      name: "Демо",
      slug: `demo-${Date.now().toString(36)}`,
      userId: user.id,
      kind: "personal",
    });
    orgId = org.id;
    console.log("seed: created a personal organisation");
  }
  await store.setOrgAgentsEnabled(orgId, true);

  const team = (
    await store.pool.query("select id from teams where org_id = $1 limit 1", [orgId])
  ).rows[0];
  const agents = await store.listAgents(orgId);
  let agent = agents.find((entry) => entry.name === "Мира" && entry.owner_id === user.id);
  if (!agent) {
    agent = await store.createAgent({
      orgId,
      ownerId: user.id,
      name: "Мира",
      createdBy: user.id,
    });
    console.log("seed: created agent Мира");
  }

  // A repeated seed is a clean demo: old tasks and threads belong to the previous run.
  await store.pool.query("delete from agent_tasks where board_id = $1", [BOARD]);
  await store.pool.query("delete from agent_threads where board_id = $1", [BOARD]);

  const snapshot = Buffer.from(Y.encodeStateAsUpdate(demoDocument()));
  await store.pool.query(
    `insert into boards
       (id, title, org_id, team_id, owner_id, created_by, visibility,
        snapshot, snapshot_through, agents_enabled)
     values ($1, 'MVP демо', $2, $3, $4, $4, 'private', $5, 0, true)
     on conflict (id) do update
       set title = excluded.title,
           org_id = excluded.org_id,
           team_id = excluded.team_id,
           owner_id = excluded.owner_id,
           created_by = excluded.created_by,
           visibility = 'private',
           snapshot = excluded.snapshot,
           snapshot_through = 0,
           agents_enabled = true,
           archived_at = null`,
    [BOARD, orgId, team?.id ?? null, user.id, snapshot],
  );
  // The snapshot is the whole document; an old log would be replayed on top of it.
  await store.pool.query("delete from board_updates where board_id = $1", [BOARD]);
  // The projection is derived; clear it so the database is clean even before the first
  // client opens the room and rewrites the mirror from the document.
  for (const table of ["widgets", "kanban_cards", "kanban_columns", "kanban_swimlanes"]) {
    await store.pool.query(`delete from ${table} where board_id = $1`, [BOARD]);
  }
  await store.setBoardAgent({
    boardId: BOARD,
    orgId,
    agentId: agent.id,
    assignedBy: user.id,
  });
  await store.setBoardAgentsEnabled(BOARD, true);
  console.log("seed: reset the room and assigned Мира\n");
  console.log("  url:      http://localhost:5173/?room=demo-mvp");
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
  console.log("  agent:    Мира");
  console.log("\nStart the services with the deterministic demo model:");
  console.log("  REMO_DEMO=1 pnpm sync    # terminal 1");
  console.log("  pnpm dev                 # terminal 2");
} catch (error) {
  console.error(`seed: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  await store.close().catch(() => {});
}
