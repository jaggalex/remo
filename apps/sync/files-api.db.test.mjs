/**
 * The image HTTP surface against a real database and a real disk store (ADR-249,
 * `spec/images.md` §4.1, §4.3, §5.1–5.2).
 *
 * What the unit tests cannot prove: the upload writes a `files` row and one command
 * creates the image object, the projection carries `fileId` so the read check and the GC
 * can see it, deduplication inside an organisation reuses the row, a room that does not
 * use the file gets `404`, a missing variant falls back to the nearest smaller one, the
 * organisation lookup answers before a room is known, and a copy into another
 * organisation produces a new id with its own bytes.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFilesApi } from "./files-api.mjs";
import { createFileStore } from "./files-store.mjs";
import { Metrics } from "./metrics.mjs";
import { handleBilling } from "./billing-catalog-api.mjs";
import { handleCommands } from "./commands-api.mjs";
import { accessForBoard, handleIam, linkUnlockToken, sessionFromRequest } from "./iam-api.mjs";
import { testDatabaseStore } from "./test-db.mjs";
import { withoutTenant } from "./tenant.mjs";

const opened = await testDatabaseStore("files API");
const store = opened?.store ?? null;
const suite = store ? describe : describe.skip;

let server = null;
let base = "";
let files = null;
let filesApi = null;
let directory = "";
/** §8 counters: this suite is the only place the real upload path runs. */
const metrics = new Metrics();

/** A real PNG: 1200×800 is wider than `w1024`, narrower than `w2048`. */
const PNG = await sharp({
  create: { width: 1200, height: 800, channels: 3, background: "#336699" },
})
  .png()
  .toBuffer();

/** A portrait picture for the replacement case: same object, a new proportion. */
const PNG_PORTRAIT = await sharp({
  create: { width: 600, height: 900, channels: 3, background: "#993366" },
})
  .png()
  .toBuffer();

const stamp = Date.now();
const email = (tag) => `files-${tag}-${stamp}@example.com`;
const password = "correct horse battery";

beforeAll(async () => {
  if (!store) return;
  directory = await mkdtemp(join(tmpdir(), "remo-files-api-"));
  files = await createFileStore({ REMO_FILES_DRIVER: "disk", REMO_FILES_DIR: directory });
  filesApi = createFilesApi({
    store,
    files,
    metrics,
    getDocument: (boardId) => store.roomDocument(boardId),
    sessionFromRequest,
    accessForBoard,
    linkUnlockToken,
    log: console,
  });

  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const handle = async () => {
      if (await filesApi.handleFilesRoutes({ request, response, url })) return;
      // Storage lives in the billing family; the test installation turns billing on so
      // the route is reachable, exactly as a hosted installation would.
      if (await handleBilling({ request, response, url, store, env: { REMO_BILLING: "on" } })) {
        return;
      }
      if (await handleIam({ request, response, url, store })) return;
      if (
        await handleCommands({
          request,
          response,
          url,
          store,
          getDocument: (boardId) => store.roomDocument(boardId),
          resolveAccess: (boardId) => resolveAccess(request, boardId),
        })
      ) {
        return;
      }
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not handled" }));
    };
    // `server.mjs` resolves the organisation of every `/boards/...` request before the
    // route runs (ADR-178); the suite reproduces that wiring for the two write routes.
    const board = /^\/boards\/([^/]+)/.exec(url.pathname);
    const org = board ? null : /^\/orgs\/([^/]+)\/storage$/.exec(url.pathname);
    const orgId = board
      ? await store.boardOrg(decodeURIComponent(board[1]))
      : org
        ? decodeURIComponent(org[1])
        : null;
    if (orgId) await store.withTenant(orgId, handle);
    else await handle();
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
  if (store) await store.close();
});

/** What both `/boards/...` modules expect from the request. */
async function resolveAccess(request, boardId) {
  const session = await sessionFromRequest(request, store);
  const resolved = await accessForBoard({
    store,
    boardId,
    userId: session?.user?.id ?? null,
    unlockToken: linkUnlockToken(request),
  });
  if (!resolved?.access?.allowed) return null;
  return { session, resolved, board: resolved.facts.board };
}

function client() {
  let cookie = "";
  return async (method, path, { json, form, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: json ? JSON.stringify(json) : form,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const type = response.headers.get("content-type") ?? "";
    const body = type.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, body };
  };
}

async function account(tag) {
  const api = client();
  const registered = await api("POST", "/auth/register", {
    json: { email: email(tag), password, name: tag },
  });
  expect(registered.status).toBe(201);
  return { api, orgId: registered.body.org.id, userId: registered.body.user.id };
}

async function boardOf(api, orgId, title) {
  const created = await api("POST", `/orgs/${orgId}/boards`, { json: { title } });
  expect(created.status).toBe(201);
  return created.body.board.id;
}

function upload(api, boardId, { bytes = PNG, name = "shot.png", alt = null, replace = null } = {}) {
  const form = new FormData();
  if (alt !== null) form.append("alt", alt);
  if (replace !== null) form.append("replace", replace);
  form.append("file", new Blob([bytes], { type: "image/png" }), name);
  return api("POST", `/boards/${boardId}/files`, { form });
}

/** The room's image widgets, as the projection has them after `project()`. */
async function images(boardId) {
  const { rows } = await store.pool.query(
    "select id, width, height, props from widgets where board_id = $1 and type = 'image' order by id",
    [boardId],
  );
  return rows;
}

async function fileRow(id) {
  const { rows } = await store.pool.query("select * from files where id = $1", [id]);
  return rows[0] ?? null;
}

/** The projection is written on a timer; a test asks for the pass explicitly. */
async function project(boardId) {
  const room = store.rooms.get(boardId);
  expect(room).toBeTruthy();
  await store.refreshProjection(room);
}

suite("files API (ADR-249)", () => {
  it("uploads, stores variants and creates the image object with one command", async () => {
    const { api, orgId, userId } = await account("upload");
    const boardId = await boardOf(api, orgId, "Uploads");

    const uploaded = await upload(api, boardId, { alt: "A screenshot" });
    expect(uploaded.status).toBe(201);
    const file = uploaded.body.file;
    expect(file.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(file.width).toBe(1200);
    expect(file.height).toBe(800);
    expect(file.dominantColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(file.variants).sort()).toEqual(["w1024", "w2048", "w256"]);

    const row = await fileRow(file.id);
    expect(row).toMatchObject({
      org_id: orgId,
      board_id: boardId,
      uploaded_by: userId,
      mime: "image/png",
      status: "ready",
      width: 1200,
      height: 800,
      original_name: "shot.png",
    });
    expect(Number(row.bytes)).toBe(PNG.length);
    expect(Number(row.stored_bytes)).toBeGreaterThan(Number(row.bytes));

    // The projection is the read path the access check and the GC use (§3.2).
    await project(boardId);
    const { rows: widgets } = await store.pool.query(
      "select type, width, height, props from widgets where board_id = $1",
      [boardId],
    );
    expect(widgets).toHaveLength(1);
    expect(widgets[0].type).toBe("image");
    expect(widgets[0].props).toMatchObject({
      fileId: file.id,
      naturalWidth: 1200,
      naturalHeight: 800,
      alt: "A screenshot",
    });
    // §3.2: the long side is at most 480 units and the aspect ratio is kept.
    expect(widgets[0].width).toBe(480);
    expect(widgets[0].height).toBe(320);

    const variant = await api("GET", `/files/${file.id}/w256?board=${boardId}`);
    expect(variant.status).toBe(200);
    expect(variant.headers.get("content-type")).toBe("image/webp");
    expect(variant.headers.get("x-content-type-options")).toBe("nosniff");
    expect(variant.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(variant.headers.get("cache-control")).toContain("immutable");
    expect(variant.headers.get("etag")).toBe(`"${file.variants.w256.sha256}"`);
    expect(variant.body.length).toBe(file.variants.w256.bytes);

    // The original is the user's bytes, only available to export (§1.4–5).
    const original = await api("GET", `/files/${file.id}/original?board=${boardId}`);
    expect(original.status).toBe(200);
    expect(original.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(String(original.headers.get("content-disposition"))).toContain("filename*=UTF-8''");
    expect(original.headers.get("cache-control")).toContain("no-store");
    expect(original.body.equals(PNG)).toBe(true);

    // §8: one accepted upload, counted once, with the original bytes and no file name.
    const exposition = metrics.render();
    expect(exposition).toContain('remo_files_uploads_total{result="ok"} 1');
    expect(exposition).toContain(`remo_files_upload_bytes_total ${PNG.length}`);
    expect(exposition).not.toContain("shot.png");
  });

  it("deduplicates the same bytes inside one organisation", async () => {
    const { api, orgId } = await account("dedup");
    const boardId = await boardOf(api, orgId, "Dedup");

    const first = await upload(api, boardId);
    const second = await upload(api, boardId);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.file.id).toBe(first.body.file.id);

    const { rows } = await store.pool.query(
      "select count(*)::int as count from files where org_id = $1 and sha256 = $2 and status = 'ready'",
      [orgId, (await fileRow(first.body.file.id)).sha256],
    );
    expect(rows[0].count).toBe(1);
  });

  it("answers 404 for a room that does not use the file, and for a stranger", async () => {
    const owner = await account("room-a");
    const boardA = await boardOf(owner.api, owner.orgId, "Room A");
    const uploaded = await upload(owner.api, boardA);
    const fileId = uploaded.body.file.id;

    // The same organisation, another room: the file exists but this room never shows it.
    const boardB = await boardOf(owner.api, owner.orgId, "Room B");
    const otherRoom = await owner.api("GET", `/files/${fileId}/w256?board=${boardB}`);
    expect(otherRoom.status).toBe(404);

    // Another organisation, the room that does use it: no access, no confirmation.
    const stranger = await account("stranger");
    const foreign = await stranger.api("GET", `/files/${fileId}/w256?board=${boardA}`);
    expect(foreign.status).toBe(404);

    // A request without a room context cannot prove anything either.
    const unnamed = await owner.api("GET", `/files/${fileId}/w256`);
    expect(unnamed.status).toBe(404);

    // A malformed id is an unknown file, not a database error.
    const malformed = await owner.api("GET", `/files/not-a-uuid/w256?board=${boardA}`);
    expect(malformed.status).toBe(404);
  });

  it("learns a file's organisation without a room, and only for a ready row", async () => {
    const { api, orgId } = await account("file-org");
    const boardId = await boardOf(api, orgId, "File org");
    const uploaded = await upload(api, boardId);
    const fileId = uploaded.body.file.id;

    // `/files/:id/...` is answered before any tenant exists, so the read runs with no
    // `app.org_id`. Only the definer lookup may answer it; a plain select answers
    // nothing once `FORCE ROW LEVEL SECURITY` is on (schema 25).
    expect(await withoutTenant(() => store.fileOrgId(fileId))).toBe(orgId);

    const { rows } = await store.pool.query(
      "select prosecdef, proconfig from pg_proc where proname = 'remo_file_org'",
    );
    expect(rows).toHaveLength(1);
    // The two properties that make the read work under RLS, pinned so an edit that
    // drops one fails here instead of in production.
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain("search_path=public");

    // An unknown id and a deleted row both answer nothing: there is no guess to make.
    expect(await withoutTenant(() => store.fileOrgId(randomUUID()))).toBeNull();
    await store.pool.query("update files set status = 'deleted' where id = $1", [fileId]);
    expect(await withoutTenant(() => store.fileOrgId(fileId))).toBeNull();
  });

  it("serves the nearest smaller variant when one is missing", async () => {
    const { api, orgId } = await account("fallback");
    const boardId = await boardOf(api, orgId, "Fallback");
    const uploaded = await upload(api, boardId);
    const file = uploaded.body.file;

    await store.pool.query("update files set variants = variants - 'w2048' where id = $1", [
      file.id,
    ]);
    const variant = await api("GET", `/files/${file.id}/w2048?board=${boardId}`);
    expect(variant.status).toBe(200);
    // The source is 1200 px wide, so `w1024` is its largest honest variant.
    expect(variant.headers.get("etag")).toBe(`"${file.variants.w1024.sha256}"`);
    expect(variant.body.length).toBe(file.variants.w1024.bytes);
  });

  it("refuses to legalise a guessed fileId through the command route", async () => {
    const owner = await account("command");
    const boardA = await boardOf(owner.api, owner.orgId, "Command source");
    const uploaded = await upload(owner.api, boardA);
    const fileId = uploaded.body.file.id;

    // The same organisation, a room the file was not uploaded to and does not use.
    const boardB = await boardOf(owner.api, owner.orgId, "Command target");
    const denied = await owner.api(
      "POST",
      `/boards/${boardB}/commands`,
      {
        json: {
          command: "board.image.create",
          input: {
            fileId,
            x: 0,
            y: 0,
            width: 480,
            height: 320,
            naturalWidth: 1200,
            naturalHeight: 800,
          },
        },
        headers: { "Idempotency-Key": `image-denied-${stamp}` },
      },
    );
    expect(denied.status).toBe(404);
    expect(denied.body.error).toBe("FILE_NOT_FOUND");

    // Another organisation: the same answer, and no hint that the id exists.
    const stranger = await account("command-stranger");
    const foreign = await stranger.api(
      "POST",
      `/boards/${await boardOf(stranger.api, stranger.orgId, "Foreign")}/commands`,
      {
        json: {
          command: "board.image.create",
          input: {
            fileId,
            x: 0,
            y: 0,
            width: 480,
            height: 320,
            naturalWidth: 1200,
            naturalHeight: 800,
          },
        },
        headers: { "Idempotency-Key": `image-foreign-${stamp}` },
      },
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("FILE_NOT_FOUND");
  });

  it("replaces the file behind a picture without a second object or audit row", async () => {
    const { api, orgId } = await account("replace");
    const boardId = await boardOf(api, orgId, "Replace");
    const first = await upload(api, boardId);
    expect(first.status).toBe(201);
    await project(boardId);
    const [before] = await images(boardId);
    expect(before).toBeTruthy();

    // One upload that ends in `board.image.replace`: no stray object to adopt (§5.3).
    const second = await upload(api, boardId, {
      bytes: PNG_PORTRAIT,
      name: "portrait.png",
      replace: before.id,
    });
    expect(second.status).toBe(201);
    expect(second.body.file.id).not.toBe(first.body.file.id);

    await project(boardId);
    const after = await images(boardId);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].props).toMatchObject({
      fileId: second.body.file.id,
      naturalWidth: 600,
      naturalHeight: 900,
    });
    // The width was the person's decision and stays; the height follows the new picture.
    expect(after[0].width).toBe(480);
    expect(after[0].height).toBe(720);

    // One accepted command, one audit row: the upload does not also report a create.
    const { rows: audit } = await store.pool.query(
      `select action from audit_events
        where board_id = $1 and action = 'board.command' and subject = 'board.image.replace'`,
      [boardId],
    );
    expect(audit).toHaveLength(1);
    const { rows: uploads } = await store.pool.query(
      "select count(*)::int as count from audit_events where board_id = $1 and action = 'file.uploaded'",
      [boardId],
    );
    expect(uploads[0].count).toBe(2);
  });

  it("refuses board.image.replace with a file from another room", async () => {
    const owner = await account("replace-foreign");
    const source = await boardOf(owner.api, owner.orgId, "File source");
    const target = await boardOf(owner.api, owner.orgId, "File target");
    const foreign = await upload(owner.api, source);
    const own = await upload(owner.api, target, { bytes: PNG_PORTRAIT, name: "own.png" });
    await project(target);
    const [widget] = await images(target);

    // The same organisation, a room the file was never uploaded to and does not use:
    // pointing an old object at that id would legalise a guessed file (§4.3).
    const denied = await owner.api("POST", `/boards/${target}/commands`, {
      json: {
        command: "board.image.replace",
        input: { widgetId: widget.id, fileId: foreign.body.file.id },
      },
      headers: { "Idempotency-Key": `replace-foreign-${stamp}` },
    });
    expect(denied.status).toBe(404);
    expect(denied.body.error).toBe("FILE_NOT_FOUND");

    await project(target);
    const [unchanged] = await images(target);
    expect(unchanged.props.fileId).toBe(own.body.file.id);
  });

  it("answers the storage ranking to an admin", async () => {
    const { api, orgId } = await account("storage");
    const heavy = await boardOf(api, orgId, "Heavy room");
    const light = await boardOf(api, orgId, "Light room");
    await upload(api, heavy);
    await upload(api, light, { bytes: PNG_PORTRAIT, name: "small.png" });
    // The shared test database has no forced RLS (`rls.test.mjs` proves the policy on its
    // own database), so the ranking is made unambiguous by size instead of by tenant.
    await store.pool.query("update files set stored_bytes = 9000000 where board_id = $1", [
      heavy,
    ]);
    await store.pool.query("update files set stored_bytes = 4000000 where board_id = $1", [
      light,
    ]);

    const storage = await api("GET", `/orgs/${orgId}/storage`);
    expect(storage.status).toBe(200);
    expect(storage.body.usedBytes).toBeGreaterThan(0);
    // `null` is "no limit" — the free plan has no storage ceiling until the owner sets one.
    expect(storage.body.limitBytes === null || storage.body.limitBytes > 0).toBe(true);
    // The five heaviest rooms, by the same `stored_bytes` the quota sums (§9.8).
    expect(storage.body.rooms.slice(0, 2)).toEqual([
      { boardId: heavy, title: "Heavy room", bytes: 9000000 },
      { boardId: light, title: "Light room", bytes: 4000000 },
    ]);

    // A stranger is not a member: the answer is the missing-organisation one.
    const stranger = await account("storage-stranger");
    const foreign = await stranger.api("GET", `/orgs/${orgId}/storage`);
    expect(foreign.status).toBe(404);
  });

  it("copies a file into another organisation under a new id", async () => {
    const { api, orgId } = await account("copy");
    const boardA = await boardOf(api, orgId, "Copy source");
    const uploaded = await upload(api, boardA, { name: "logo.png" });
    const original = uploaded.body.file.id;

    const shared = await api("POST", "/orgs", { json: { name: "Copy target" } });
    expect(shared.status).toBe(201);
    const targetOrg = shared.body.org.id;
    const boardB = await boardOf(api, targetOrg, "Copy target room");

    const copied = await api("POST", `/boards/${boardB}/files/${original}/copy`);
    expect(copied.status).toBe(201);
    expect(copied.body.file.id).not.toBe(original);

    const row = await fileRow(copied.body.file.id);
    expect(row).toMatchObject({ org_id: targetOrg, board_id: boardB, status: "ready" });
    expect(row.sha256).toBe((await fileRow(original)).sha256);
    // The lookup follows the row, not the caller: the copy answers the target tenant
    // while the source still answers its own.
    expect(await withoutTenant(() => store.fileOrgId(copied.body.file.id))).toBe(targetOrg);
    expect(await withoutTenant(() => store.fileOrgId(original))).toBe(orgId);

    // The bytes moved too: the target room can serve its own copy.
    const variant = await api("GET", `/files/${copied.body.file.id}/w256?board=${boardB}`);
    expect(variant.status).toBe(200);
    expect(variant.body.length).toBeGreaterThan(0);
  });
});
