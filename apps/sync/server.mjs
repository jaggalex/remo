/**
 * Realtime sync service (ADR-016).
 *
 * One Yjs room per board, transported over plain WebSocket, presence relayed by the
 * same library. Durable state lives in Postgres when `DATABASE_URL` is configured
 * (append-only update log + snapshot + a queryable projection, see ./postgres.mjs);
 * otherwise rooms are mirrored to disk so local development needs no database.
 *
 * This file is the composition root: it wires the store, the connection registry, the
 * save acknowledgements, exports, the socket layer and the agent loop together, and
 * serves the read API. The pieces themselves live in `sync-*.mjs`.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { METRICS_CONTENT_TYPE, Metrics, processMetrics, watchEventLoop } from "./metrics.mjs";
import { PostgresStore, connectWithRetry, resolveDatabaseUrl } from "./postgres.mjs";
import { MetricsStore } from "./metrics-store.mjs";
import { configureMetrics, emitMetric } from "./metrics-events.mjs";
import { accessForBoard, handleIam, linkUnlockToken, sessionFromRequest } from "./iam-api.mjs";
import { readBoard } from "./sync-read-api.mjs";
import { discoverableBoardIds, discoverableBoards } from "./discovery.mjs";
import { handleAgents } from "./agent-api.mjs";
import { handleVotes } from "./vote-api.mjs";
import { handleCommands } from "./commands-api.mjs";
import { AiClient } from "./ai.mjs";
import { fakeModelEnabled, fakePlanClient } from "./ai-fake.mjs";
import { createDiskStore } from "./sync-disk-store.mjs";
import { createConnections } from "./sync-connections.mjs";
import { createSaveAcks } from "./sync-save-ack.mjs";
import { createExportRoutes } from "./sync-export.mjs";
import { attachWebSocket } from "./sync-websocket.mjs";
import { FATAL_FLUSH_MS, guardPersistence, installProcessGuards } from "./failure-boundary.mjs";
import { encodeCommentsChanged } from "./comment-signal.mjs";
import { encodeVotesChanged } from "./vote-signal.mjs";
import { appendSetCookie, cookies, failRequest } from "./http-boundary.mjs";
import { routeLabel } from "./http-route.mjs";
import { CSRF_COOKIE, csrfCookie, csrfProblem } from "./csrf.mjs";
import { newToken } from "./iam.mjs";
import { createAgentLoops } from "./sync-agents.mjs";
import { createEventDrain, createWebhookConsumer } from "./sync-events.mjs";
import { buildInfo } from "./build-info.mjs";

import { websocketUtils } from "./y.mjs";

const { docs, getYDoc, setPersistence } = websocketUtils;

// A local `.env` is a convenience for development; production passes the same values
// through the process environment. Loading it here means `pnpm sync` sees REMO_KEK and
// the other REMO_* settings without a wrapper script.
try {
  // `pnpm --filter @remo/sync start` runs with cwd apps/sync; the one `.env` lives at
  // the repository root. Load that file explicitly, then fall back to the ambient env.
  process.loadEnvFile?.(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"),
  );
} catch {
  /* no .env: the process environment is the source of truth */
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.REMO_DATA_DIR ?? join(HERE, ".data");
const PORT = Number(process.env.PORT ?? 1234);
const STARTED_AT = Date.now();
const BUILD = buildInfo();

await mkdir(DATA_DIR, { recursive: true });

/* --------------------------------------------------------------- metrics --- */

const metrics = new Metrics();
metrics.describe("remo_build_info", "Build identity: version, build, commit and schema", "gauge");
metrics.set("remo_build_info", 1, {
  version: BUILD.version,
  build: BUILD.build,
  commit: BUILD.commit,
  schema: String(BUILD.schema),
});
metrics.describe("remo_http_requests_total", "HTTP requests served, by route");
metrics.describe("remo_ws_connections_total", "WebSocket connections accepted");
metrics.describe("remo_ws_disconnections_total", "WebSocket connections closed");
metrics.describe("remo_ws_rejected_total", "WebSocket upgrades refused by access control");
metrics.describe(
  "remo_ws_readonly_write_attempt",
  "Frames a read-only connection tried to write",
);
metrics.describe("remo_ws_protocol_errors_total", "WebSocket frames the protocol refused");
metrics.describe(
  "remo_ws_quota_closed_total",
  "Sockets closed for a write budget, by reason (rate, room-full); ADR-173",
);
metrics.describe("remo_ws_edit_audit_rows_total", "Socket edit windows written to audit; ADR-175");
metrics.describe("remo_ws_edit_audit_dropped_total", "Socket edit windows whose audit write failed");
metrics.describe(
  "remo_background_failures_total",
  "Failures no caller handled; any non-zero rate is a bug (ADR-160)",
);
metrics.describe("remo_ws_connections_active", "WebSocket connections open right now", "gauge");
metrics.describe("remo_rooms_active", "Yjs rooms held in memory", "gauge");
metrics.describe("remo_boards_total", "Boards known to the store", "gauge");
metrics.describe("remo_store_writes_total", "Room writes handed to the store");
metrics.describe("remo_store_write_errors_total", "Room writes that failed");
metrics.describe("remo_store_compactions_total", "Update logs compacted into a snapshot");
metrics.describe("remo_store_projection_writes_total", "Queryable projection refreshes");

// Lag only means something while the process is doing work, so it is sampled on a
// timer that does not itself count as work.
watchEventLoop();

/* --------------------------------------------------------------- storage -- */

const diskStore = createDiskStore({
  dataDir: DATA_DIR,
  metrics,
  roomCount: () => docs.size,
});

const databaseUrl = await resolveDatabaseUrl();
let store = diskStore;
// Browser acceptance substitutes a deterministic provider; the guard lives in
// `ai-fake.mjs`, so production can never take this branch.
const ai = fakeModelEnabled() ? fakePlanClient() : new AiClient();

if (databaseUrl) {
  // The app role is subject to RLS; migrations and the legacy repair need the owner
  // (ADR-178 stage 2). Without a second URL the old single-role behaviour stays.
  const postgres = new PostgresStore({
    connectionString: databaseUrl,
    migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? databaseUrl,
    metrics,
  });
  try {
    await connectWithRetry({ connect: () => postgres.connect() });
    store = postgres;
    console.log("[sync] storage: postgres");
    // A build that named the room from the raw request path left a percent-encoded twin
    // of every non-ASCII board. Repair them once, before the port opens, so a user never
    // sees the empty shell while the widgets sit under the encoded id (ADR-148). The
    // repair is idempotent, moves rows before deleting and logs what it left alone.
    try {
      // The repair moves rows in RLS-protected tables and no single tenant covers it;
      // the owner connection is the only role allowed to see all of them (ADR-178).
      const { merged, skipped } = await postgres.withOwnerClient((client) =>
        postgres.mergeLegacyRoomIds({ client }),
      );
      if (merged.length || skipped.length) {
        console.log(
          `[sync] duplicate rooms: ${merged.length} merged, ${skipped.length} left alone`,
        );
      }
    } catch (error) {
      // A failed repair must not stop the service: the duplicates stay as they were.
      console.error("[sync] duplicate room merge failed:", error.message);
    }
  } catch (error) {
    // A configured database that cannot be reached is a failure, not a downgrade.
    // Serving from disk would accept writes that the database never sees, and the
    // next start would silently drop them (ADR-087).
    console.error(
      `[sync] postgres unavailable (${error.message || error.code}); refusing to start on disk while DATABASE_URL is set`,
    );
    process.exit(1);
  }
} else {
  console.log("[sync] storage: disk (set DATABASE_URL or .env for postgres)");
}

/* ----------------------------------------------------------- connections -- */

const connections = createConnections({ store, accessForBoard, log: console });

// Save acknowledgements are sent only after the store has the bytes. Both stores
// expose this hook; the socket layer decides which client is waiting.
const saveAcks = createSaveAcks({
  store,
  getYDoc,
  authBySocket: connections.authBySocket,
  emitMetric,
});
store.onPersisted = saveAcks.flushSaveAcks;

const exports = createExportRoutes({
  store,
  docs,
  sessionFromRequest,
  accessForBoard,
  linkUnlockToken,
  emitMetric,
});

const agents = createAgentLoops({ store, ai, log: console });

// Domain events produced by commands wait in the outbox until this drain takes them
// (ADR-094). Its consumer is the organisation's signed webhook (ADR-095); without an
// endpoint configured the event is simply marked published.
const events = createEventDrain({
  store,
  log: console,
  handle: createWebhookConsumer({
    store,
    log: console,
    allowPrivate: process.env.REMO_WEBHOOK_ALLOW_PRIVATE === "1",
  }),
});

// Product metrics live in their own database (ADR-082). Their absence is normal:
// instrumentation is a no-op until an operator points this at a separate DB.
const metricsUrl = process.env.REMO_METRICS_DATABASE_URL;
let metricsStore = null;
if (metricsUrl && process.env.REMO_METRICS !== "off") {
  metricsStore = new MetricsStore({ connectionString: metricsUrl });
  try {
    await metricsStore.connect();
    configureMetrics((event) => metricsStore.record(event), {
      enabled: true,
      version: BUILD.version,
    });
    console.log("[metrics] product metrics enabled");
  } catch (error) {
    console.error(`[metrics] unavailable (${error.message || error.code}); events are dropped`);
  }
}

setPersistence(guardPersistence(store, { metrics }));

/** Constant-time comparison for the one shared secret the service accepts. */
function safeEqual(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The disk fallback has no query layer; say so instead of returning an empty list. */
function notSupported(response, store) {
  response.writeHead(501, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      error: "the read API needs the postgres store",
      store: store.kind,
      hint: "set DATABASE_URL (or .env) and restart",
    }),
  );
}

/**
 * Read API responses carry CORS headers so the service can also be queried directly
 * from another origin (a deployed app, a script). Reads only — the endpoints never
 * mutate a board.
 */
const CORS_ORIGIN = process.env.REMO_CORS_ORIGIN ?? "*";
const corsHeaders =
  CORS_ORIGIN === "*"
    ? {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, If-Match, Idempotency-Key, Authorization, X-CSRF-Token",
      }
    : {
        // Sessions travel in a cookie, so a named origin is required for credentials.
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, If-Match, Idempotency-Key, Authorization, X-CSRF-Token",
      };

/**
 * The organisation a request belongs to, resolved before any tenant query (ADR-178).
 *
 * Board routes need one bootstrap read of `boards` to learn the org; that read happens
 * outside the tenant context and is the only query allowed to do so. When policies are
 * switched on it moves behind a `security definer` lookup, not into the app role.
 */
async function tenantOrgForRequest(store, url) {
  const board = /^\/boards\/([^/]+)/.exec(url.pathname);
  if (board) {
    if (!store.getIamBoard) return null;
    let id;
    try {
      id = decodeURIComponent(board[1]);
    } catch {
      return null;
    }
    // A security-definer lookup: `boards` is protected once stage 3 is on, and this is
    // the one read that must happen before the tenant is known.
    if (store.boardOrg) {
      const orgId = await store.boardOrg(id).catch(() => null);
      if (orgId) return orgId;
    }
    const iam = await store.getIamBoard(id).catch(() => null);
    return iam?.org_id ?? null;
  }
  if (
    (url.pathname === "/boards" || url.pathname === "/search") &&
    url.searchParams.get("org") &&
    store.getOrgBySlug
  ) {
    const org = await store.getOrgBySlug(url.searchParams.get("org")).catch(() => null);
    return org?.id ?? null;
  }
  const org = /^\/orgs\/([^/]+)/.exec(url.pathname);
  if (org) {
    try {
      return decodeURIComponent(org[1]);
    } catch {
      return null;
    }
  }
  return null;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://localhost");
  const orgId = await tenantOrgForRequest(store, url);
  if (orgId && store.withTenant) {
    return store.withTenant(orgId, () => routeRequest(request, response, url));
  }
  return routeRequest(request, response, url);
}

async function routeRequest(request, response, url) {
  // A fixed label per route family: a label per path would let an anonymous client
  // grow the in-memory registry without bound (the protected /metrics endpoint does
  // not stop the accumulation).
  metrics.inc("remo_http_requests_total", { path: routeLabel(url.pathname) });

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }
  for (const [name, value] of Object.entries(corsHeaders)) response.setHeader(name, value);
  // The service answers with data, never with a page: nothing it returns may be sniffed
  // into HTML or framed. The proxies add the full policy for the app (ADR-172); these
  // two hold even when the service is reached directly.
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");

  // Every browser gets a CSRF cookie before it mutates anything; `/auth/me` hands the
  // same value to the app so it can echo it back in `X-CSRF-Token` (ADR-062).
  if (!cookies(request)[CSRF_COOKIE]) {
    appendSetCookie(
      response,
      csrfCookie(newToken(), process.env.NODE_ENV === "production"),
    );
  }
  const csrf = csrfProblem(request);
  if (csrf) {
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: csrf,
        message: "this request did not come from the app",
      }),
    );
    return;
  }

  /**
   * Everything an operator asks first: is it up, where is the data, how much of it,
   * and since when. Always 200 with `ok`, so a probe never has to parse the body;
   * the status code still reflects the store, so a shallow probe can use it.
   */
  // Accounts, organisations and sharing (spec/IAM-v1.md). The module reads its own
  // body and answers its own errors; `true` means this request was one of its routes.
  if (
    await handleIam({
      request,
      response,
      url,
      store,
      onAclChanged: connections.refreshBoardAccess,
      onUserSuspended: connections.closeUserConnections,
      onCommentsChanged: (boardId) =>
        connections.notifyBoard(boardId, encodeCommentsChanged()),
    })
  ) {
    return;
  }

  if (await exports.handleExportRoutes({ request, response, url })) return;

  if (
    await handleCommands({
      request,
      response,
      url,
      store,
      // The Postgres store resolves the current room under the load lock; `docs.get`
      // can hand a command a document that is still loading or already retired. The
      // disk store has no room lock, so it keeps its in-memory map.
      getDocument: async (boardId) =>
        typeof store.roomDocument === "function"
          ? store.roomDocument(boardId)
          : docs.get(boardId),
      resolveAccess: (boardId, caller) => exports.boardAccessForRequest(request, boardId, caller),
      log: console,
    })
  ) {
    return;
  }

  if (
    await handleVotes({
      request,
      response,
      url,
      store,
      resolveAccess: (boardId) => exports.boardAccessForRequest(request, boardId),
      onVotesChanged: (boardId) => connections.notifyBoard(boardId, encodeVotesChanged()),
      log: console,
    })
  ) {
    return;
  }

  if (
    await handleAgents({
      request,
      response,
      url,
      store,
      log: console,
      onTaskQueued: agents.tick,
    })
  ) {
    return;
  }

  if (url.pathname === "/health") {
    // A probe answers one bit, plus which build answered it. The store version, board
    // and room counts and a raw driver error stay in metrics, not on the internet.
    const storage = await store.health();
    response.writeHead(storage.ok ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: storage.ok, ...BUILD }));
    return;
  }

  if (url.pathname === "/metrics") {
    // Metrics name boards, rooms and rejections; the internet has no business seeing
    // them. A token is required in production; development keeps the convenience.
    const expected = process.env.REMO_METRICS_TOKEN;
    const header = String(request.headers.authorization ?? "");
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    const allowed = expected ? safeEqual(provided, expected) : process.env.NODE_ENV !== "production";
    if (!allowed) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "RESOURCE_NOT_AVAILABLE" }));
      return;
    }
    const storage = await store.health();
    metrics.set("remo_ws_connections_active", wss.clients.size);
    metrics.set("remo_rooms_active", store.roomCount ?? storage.rooms ?? docs.size);
    if (typeof storage.boards === "number") metrics.set("remo_boards_total", storage.boards);
    response.writeHead(200, { "Content-Type": METRICS_CONTENT_TYPE });
    response.end(`${metrics.render()}\n${processMetrics(STARTED_AT)}\n`);
    return;
  }

  if (url.pathname === "/boards") {
    const orgSlug = url.searchParams.get("org");
    if (orgSlug) {
      if (!store.listBoardDirectory) return notSupported(response, store);
      const session = await sessionFromRequest(request, store);
      if (!session) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "AUTH_REQUIRED" }));
        return;
      }
      const page = await store.listBoardDirectory(session.user.id, {
        orgSlug,
        q: url.searchParams.get("q"),
        sort: url.searchParams.get("sort") ?? "updated",
        dir: url.searchParams.get("dir") ?? "desc",
        page: Number(url.searchParams.get("page") ?? 1),
        limit: Number(url.searchParams.get("limit") ?? 24),
        trash: url.searchParams.get("trash") === "1",
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ store: store.kind, ...page }));
      return;
    }
    if (!store.listReadableBoards) return notSupported(response, store);
    const session = await sessionFromRequest(request, store);
    const boards = await discoverableBoards(store, {
      userId: session?.user.id ?? null,
      room: url.searchParams.get("room"),
    });
    if (!session && boards.length === 0) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "AUTH_REQUIRED" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ store: store.kind, boards }));
    return;
  }

  /**
   * Read path over the projection: board list, one board, its widgets, and text
   * search. These are plain SQL queries against the projected tables — the same
   * data the editor writes, without touching a room.
   */
  if (url.pathname === "/search") {
    if (!store.search) return notSupported(response, store);
    const session = await sessionFromRequest(request, store);
    const boardIds = await discoverableBoardIds(store, {
      userId: session?.user.id ?? null,
      room: url.searchParams.get("room"),
    });
    if (!session && boardIds.length === 0) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "AUTH_REQUIRED" }));
      return;
    }
    const hits = await store.search(url.searchParams.get("q") ?? "", {
      type: url.searchParams.get("type") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
      boardIds,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ query: url.searchParams.get("q") ?? "", hits }));
    return;
  }

  const boardMatch = url.pathname.match(/^\/boards\/(.+)$/);
  if (boardMatch) {
    if (!store.getBoard) return notSupported(response, store);
    const boardId = decodeURIComponent(boardMatch[1]).replace(/\/widgets$/, "");
    await readBoard({ store, request, response, url, boardId });
    return;
  }
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("remo sync service\n");
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => failRequest(response, error));
});

const { wss } = attachWebSocket({
  server,
  store,
  metrics,
  sessionFromRequest,
  accessForBoard,
  linkUnlockToken,
  connections,
  saveAcks,
});

server.listen(PORT, () => {
  console.log(
    `[sync] listening on ws://localhost:${PORT} (store: ${store.kind}, remo ${BUILD.version} build ${BUILD.build} schema ${BUILD.schema})`,
  );
  agents.start();
  events.start();
});

let shuttingDown = false;
const shutdown = async (signal, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[sync] ${signal} received, flushing rooms`);
  agents.stop();
  events.stop();
  connections.stopSweep();
  try {
    await store.close();
  } catch (error) {
    console.error("[sync] flush on shutdown failed:", error.message);
  }
  server.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 3000).unref();
};

installProcessGuards({
  metrics,
  onFatal() {
    // The flush below may be what is broken, so its deadline starts before it does.
    setTimeout(() => process.exit(1), FATAL_FLUSH_MS).unref();
    void shutdown("uncaughtException", 1);
  },
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
