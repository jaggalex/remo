/**
 * Postgres store for board rooms (ADR-016).
 *
 * The class keeps the lifecycle (connect, migrate, health, close) and the two hooks the
 * sync service calls (`bindState` / `writeState`). Everything else lives in `pg/*` and is
 * mixed into the prototype, so the public API is unchanged while each module owns one
 * reason to change (ADR-053/Q4).
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "./schema-version.mjs";
import { currentTenantClient, withTenant, withoutTenant } from "./tenant.mjs";
import { boardMethods } from "./pg/boards.mjs";
import { roomMethods } from "./pg/rooms.mjs";
import { iamUserMethods } from "./pg/iam-users.mjs";
import { iamBoardMethods } from "./pg/iam-boards.mjs";
import { agentMethods } from "./pg/agents.mjs";
import { roomAgentMethods } from "./pg/room-agent.mjs";
import { aiMethods } from "./pg/ai.mjs";
import { changeSetMethods } from "./pg/change-sets.mjs";
import { commandMethods } from "./pg/commands.mjs";
import { eventMethods } from "./pg/events.mjs";
import { webhookMethods } from "./pg/webhooks.mjs";
import { integrationMethods } from "./pg/integrations.mjs";
import { appMethods } from "./pg/apps.mjs";
import { voteMethods } from "./pg/votes.mjs";
import { commentMethods } from "./pg/comments.mjs";
import { roomMergeMethods } from "./pg/room-merge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export class PostgresStore {
  /** Named in logs and operator metrics; the public health probe says only `ok`. */
  kind = "postgres";

  constructor({
    connectionString,
    migrationConnectionString = null,
    poolSize = 8,
    log = console,
    metrics = null,
  }) {
    this.connectionString = connectionString;
    // The app role is subject to RLS; migrations and the legacy repair run as the
    // owner, which is the only role allowed to bypass a policy (ADR-178 stage 2).
    this.migrationConnectionString = migrationConnectionString ?? connectionString;
    this.poolSize = poolSize;
    this.log = log;
    /** Optional Prometheus registry; the store works without one (tests). */
    this.metrics = metrics;
    this.pool = null;
    this.rooms = new Map();
    /** docName → organisation, so a room's timers run with a tenant setting (ADR-178). */
    this.roomTenants = new Map();
    /** Set by the sync service to acknowledge clients after a successful flush. */
    this.onPersisted = null;
  }

  get roomCount() {
    return this.rooms.size;
  }

  hasPendingWrites(docName) {
    const room = this.rooms.get(docName);
    return Boolean(
      room && (room.pendingUpdates.length > 0 || room.writing || room.logWriting),
    );
  }

  async connect() {
    const { default: pg } = await import("pg");
    this.pool = new pg.Pool({
      connectionString: this.connectionString,
      max: this.poolSize,
      connectionTimeoutMillis: 5000,
    });
    // An idle client that loses its server emits here; with no listener a Postgres
    // restart ended the process. The pool has already discarded the client (ADR-160).
    this.pool.on("error", (error) => {
      this.log.error("[sync] idle database connection lost:", error.message);
    });
    // Every existing `this.pool.query` and `this.pool.connect` in pg/*.mjs goes through
    // the request's tenant connection when there is one (ADR-178). The shim is the one
    // place that knows about row-level security; the 200 call sites stay unchanged.
    const poolQuery = this.pool.query.bind(this.pool);
    const poolConnect = this.pool.connect.bind(this.pool);
    this.pool.query = (...args) => {
      const client = currentTenantClient();
      return client ? client.query(...args) : poolQuery(...args);
    };
    this.pool.connect = (callback) => {
      const client = currentTenantClient();
      if (!client) return poolConnect(callback);
      const lease = {
        query: client.query.bind(client),
        // The request owns the connection; a method that "releases" it is returning a
        // lease, not the client, to the pool.
        release: () => {},
      };
      if (typeof callback === "function") {
        callback(null, lease, () => {});
        return undefined;
      }
      return Promise.resolve(lease);
    };
    this.pg = pg.default ?? pg;
    const orphans = await this.migrate();
    // An unowned room is closed (ADR-174). Say how many are waiting for the operator
    // script instead of leaving the first visitor to discover it through a 403.
    if (orphans) {
      this.log.log(
        `[sync] ${orphans} unowned room(s) are closed; run \`pnpm db:orphans --archive --yes\` after checking the list`,
      );
    }
  }

  /** Run `fn` with `app.org_id` set on its own connection (ADR-178). */
  async withTenant(orgId, fn) {
    return withTenant(this.pool, orgId, fn);
  }

  /**
   * The organisation and owner of a board, resolved before a tenant context exists.
   *
   * The security-definer function is the only way to read `boards` once it is protected
   * (ADR-178 stage 3). Before the function is installed the plain columns are the same
   * answer; the fallback keeps an older database working.
   */
  async boardLookup(boardId) {
    try {
      const { rows } = await this.pool.query(
        "select org_id, owner_id from remo_board_lookup($1)",
        [boardId],
      );
      return rows[0] ?? null;
    } catch {
      const { rows } = await this.pool.query(
        "select org_id, owner_id from boards where id = $1",
        [boardId],
      );
      return rows[0] ?? null;
    }
  }

  async boardOrg(boardId) {
    return (await this.boardLookup(boardId))?.org_id ?? null;
  }

  /** The scheduler's three cross-tenant reads (ADR-178 stage 4). */
  async agentTaskOrg(taskId) {
    try {
      const { rows } = await this.pool.query("select remo_agent_task_org($1) as org_id", [
        taskId,
      ]);
      return rows[0]?.org_id ?? null;
    } catch {
      return null;
    }
  }

  async nextAgentTask() {
    try {
      const { rows } = await this.pool.query("select * from remo_next_agent_task()");
      return rows[0] ?? null;
    } catch {
      return this.nextQueuedAgentTask ? this.nextQueuedAgentTask() : null;
    }
  }

  async dueAgentSchedulesAcrossTenants(limit = 10) {
    try {
      const { rows } = await this.pool.query("select * from remo_due_agent_schedules($1)", [
        limit,
      ]);
      return rows;
    } catch {
      return this.dueAgentSchedules ? this.dueAgentSchedules(limit) : [];
    }
  }

  /**
   * Run `fn` with a connection that may bypass RLS: the owner URL when it differs,
   * otherwise the app pool. Used only by maintenance that spans organisations.
   */
  async withOwnerClient(fn) {
    if (this.migrationConnectionString === this.connectionString) {
      const client = await this.pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    }
    const client = new this.pg.Client({
      connectionString: this.migrationConnectionString,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  /** Remember which organisation owns a room, for work that runs outside a request. */
  noteRoomTenant(docName, orgId) {
    if (orgId) this.roomTenants.set(docName, orgId);
    else this.roomTenants.delete(docName);
  }

  /**
   * A room's timers have no request context; give them the room's organisation.
   *
   * Detached even when a request is in flight: a projection or log flush outlives the
   * response, and reusing the request's connection would run on a released client.
   */
  async withRoomTenant(docName, fn) {
    const orgId = this.roomTenants.get(docName);
    return withoutTenant(() => withTenant(this.pool, orgId ?? null, fn));
  }

  async migrate() {
    const schema = await readFile(join(HERE, "schema.sql"), "utf8");
    // Several processes may start at once (a dev server, a test suite, a second sync
    // instance). Unlocked, their DDL blocks on the same tables and the slowest one
    // looks like a hang. One advisory lock makes migration a queue instead of a race.
    const separate =
      this.migrationConnectionString !== this.connectionString;
    const client = separate
      ? new this.pg.Client({
          connectionString: this.migrationConnectionString,
          connectionTimeoutMillis: 5000,
        })
      : await this.pool.connect();
    if (separate) await client.connect();
    try {
      await client.query("select pg_advisory_lock($1)", [721_472_1]);
      // A second instance, or a test suite running beside another, must not run DDL on
      // every start: `alter table` takes locks that deadlock with live inserts. The
      // version row turns migration into "check, then apply once" (ADR-089).
      await client.query(
        `create table if not exists schema_meta (
           id integer primary key,
           version integer not null,
           updated_at timestamptz not null default now()
         )`,
      );
      const { rows: meta } = await client.query("select version from schema_meta where id = 1");
      if ((meta[0]?.version ?? 0) < SCHEMA_VERSION) {
        await client.query(schema);
      }
      // The built-in skills are part of the product, not of a tenant: one global
      // published row each makes the catalog uniform with organisation skills. The
      // inserts are idempotent, so they also repair a database whose schema was
      // applied by `db:check` before this release and never went through migrate.
      await client.query(
        `insert into agent_skills
           (org_id, slug, version, name, description, input_schema, output_schema,
            required_capabilities, tools, risk, handler, state, published_at)
         values (null, 'diagram', 1,
           'Diagram from a description',
           'Turn a short description into shapes and connectors on the board.',
           '{"type":"object","properties":{"intent":{"type":"string"},"origin":{"type":"object"},"selection":{"type":"array"}}}'::jsonb,
           '{"type":"object","properties":{"nodes":{"type":"integer"},"edges":{"type":"integer"},"objects":{"type":"array"}}}'::jsonb,
           array['board.read', 'board.edit'],
           array['read_board', 'write_diagram'],
           'write', 'builtin:diagram', 'published', now())
         on conflict do nothing`,
      );
      await client.query(
        `insert into agent_skills
           (org_id, slug, version, name, description, input_schema, output_schema,
            required_capabilities, tools, risk, handler, state, published_at)
         values (null, 'cards', 1,
           'Cards from a selection',
           'Turn selected notes and text into cards, optionally in a kanban column.',
           '{"type":"object","properties":{"selectionIds":{"type":"array"},"target":{"type":"object"},"mode":{"enum":["copy","move"]}}}'::jsonb,
           '{"type":"object","properties":{"count":{"type":"integer"},"created":{"type":"array"}}}'::jsonb,
           array['board.read', 'board.edit'],
           array['read_selection', 'write_cards'],
           'write', 'builtin:cards', 'published', now())
         on conflict do nothing`,
      );
      await client.query(
        `insert into agent_skills
           (org_id, slug, version, name, description, input_schema, output_schema,
            required_capabilities, tools, risk, handler, state, published_at)
         values (null, 'brief-to-board', 1,
           'Brief to board',
           'Turn a brief, a note or a .md/.txt/.csv file into a proposed plan: a user story map with sticker stories, a header and swimlane frames, and column titles as text.',
           '{"type":"object","properties":{"intent":{"type":"string"},"text":{"type":"string"},"file":{"type":"object"},"origin":{"type":"object"}}}'::jsonb,
           '{"type":"object","properties":{"operations":{"type":"array"},"objects":{"type":"integer"},"connectors":{"type":"integer"}}}'::jsonb,
           array['board.read', 'board.edit'],
           array['read_board', 'propose_plan'],
           'write', 'builtin:brief', 'published', now())
         on conflict do nothing`,
      );
      await client.query(
        `insert into agent_skills
           (org_id, slug, version, name, description, input_schema, output_schema,
            required_capabilities, tools, risk, handler, state, published_at)
         values (null, 'tidy-selection', 1,
           'Tidy up selection',
           'Arrange the selected objects into even columns, optionally framing each block by prefix, type or a meaning the model named. Sizes, texts and lines are never changed.',
           '{"type":"object","properties":{"selectionIds":{"type":"array"},"strategy":{"enum":["auto","grid","prefix","type","meaning"]},"origin":{"type":"object"}}}'::jsonb,
           '{"type":"object","properties":{"placements":{"type":"integer"},"objects":{"type":"integer"},"strategy":{"type":"string"}}}'::jsonb,
           array['board.read', 'board.edit'],
           array['read_selection', 'propose_plan'],
           'write', 'builtin:tidy', 'published', now())
         on conflict do nothing`,
      );
      await client.query(
        `insert into agent_skills
           (org_id, slug, version, name, description, input_schema, output_schema,
            required_capabilities, tools, risk, handler, state, published_at)
         values (null, 'room-draft', 1,
           'Room draft',
           'Turn the selected material into a first draft in a new frame: a process with labelled branches, or a problem map with citations to the sources. The draft is written to the room immediately.',
           '{"type":"object","properties":{"kind":{"enum":["process","problem-map"]},"sourceIds":{"type":"array"},"origin":{"type":"object"},"lang":{"enum":["ru","en"]}}}'::jsonb,
           '{"type":"object","properties":{"frameId":{"type":"string"},"createdIds":{"type":"array"},"questions":{"type":"array"}}}'::jsonb,
           array['board.read', 'board.edit'],
           array['read_sources', 'write_draft'],
           'write', 'builtin:room-draft', 'published', now())
         on conflict do nothing`,
      );
      this.log.log("[sync] schema ready");
      const { rows: orphans } = await client.query(
        "select count(*)::int as n from boards where owner_id is null",
      );
      return orphans[0]?.n ?? 0;
    } finally {
      await client.query("select pg_advisory_unlock($1)", [721_472_1]).catch(() => {});
      if (separate) await client.end().catch(() => {});
      else client.release();
    }
  }

  async health() {
    try {
      const { rows } = await this.pool.query("select now() as now, version() as version");
      const { rows: counts } = await this.pool.query(
        "select count(*)::int as boards from boards",
      );
      return {
        ok: true,
        serverTime: rows[0].now.toISOString(),
        version: String(rows[0].version).split(",")[0],
        boards: counts[0].boards,
        rooms: this.rooms.size,
      };
    } catch (error) {
      return { ok: false, error: error.message || error.code || String(error) };
    }
  }

  async roomDocument(docName) {
    const room = this.rooms.get(docName);
    if (room) return room.ydoc;
    // A board can be opened from two places at once: the socket of the browser and an
    // HTTP command or agent task. Both go through `loadRoom`, which serializes the load
    // per board id, so this caller waits for the socket's room and receives *that*
    // document instead of building a rival one (ADR-148).
    return this.loadRoom(docName);
  }

  async close() {
    for (const room of [...this.rooms.values()]) {
      await this.writeState(room.docName, room.ydoc);
    }
    await this.pool.end();
  }}

Object.assign(
  PostgresStore.prototype,
  boardMethods,
  roomMethods,
  iamUserMethods,
  iamBoardMethods,
  agentMethods,
  roomAgentMethods,
  aiMethods,
  changeSetMethods,
  commandMethods,
  eventMethods,
  webhookMethods,
  integrationMethods,
  appMethods,
  voteMethods,
  commentMethods,
  roomMergeMethods,
);

export async function connectWithRetry({
  connect,
  attempts = 5,
  delayMs = 1000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await connect();
      return attempt;
    } catch (error) {
      lastError = error;
      log.error?.(
        `[sync] database is not ready (attempt ${attempt}/${attempts}): ${error.message || error.code}`,
      );
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

/** Pull DATABASE_URL from the environment or the repo .env file. */
export async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = await readFile(join(HERE, "..", "..", ".env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env */
  }
  return null;
}
