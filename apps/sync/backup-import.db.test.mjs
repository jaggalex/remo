/**
 * A version 3 backup round trip through another organisation (ADR-249 §5.3).
 *
 * The unit tests prove the format and the document rebuild; this one proves the part
 * that needs a tenant: the pictures are re-processed into the target organisation, every
 * `fileId` is new, the bytes are readable through the target room, the storage counts
 * against that organisation once, and an asset without `data` becomes a placeholder.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExportRoutes } from "./sync-export.mjs";
import { createFilesApi } from "./files-api.mjs";
import { createFileStore } from "./files-store.mjs";
import { Metrics } from "./metrics.mjs";
import { handleBilling } from "./billing-catalog-api.mjs";
import { handleCommands } from "./commands-api.mjs";
import { accessForBoard, handleIam, linkUnlockToken, sessionFromRequest } from "./iam-api.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("backup import");
const store = opened?.store ?? null;
const suite = store ? describe : describe.skip;

let server = null;
let base = "";
let files = null;
let directory = "";
const metrics = new Metrics();

const PNG = await sharp({
  create: { width: 900, height: 600, channels: 3, background: "#2f6f4e" },
})
  .png()
  .toBuffer();

const stamp = Date.now();
const email = (tag) => `import-${tag}-${stamp}@example.com`;
const password = "correct horse battery";

beforeAll(async () => {
  if (!store) return;
  directory = await mkdtemp(join(tmpdir(), "remo-backup-import-"));
  files = await createFileStore({ REMO_FILES_DRIVER: "disk", REMO_FILES_DIR: directory });

  const resolveAccess = async (request, boardId) => {
    const session = await sessionFromRequest(request, store);
    const resolved = await accessForBoard({
      store,
      boardId,
      userId: session?.user?.id ?? null,
      unlockToken: linkUnlockToken(request),
    });
    if (!resolved?.access?.allowed) return null;
    return { session, resolved, board: resolved.facts.board };
  };

  const filesApi = createFilesApi({
    store,
    files,
    metrics,
    getDocument: (boardId) => store.roomDocument(boardId),
    sessionFromRequest,
    accessForBoard,
    linkUnlockToken,
    log: console,
  });
  const exports = createExportRoutes({
    store,
    docs: new Map(),
    files,
    getDocument: (boardId) => store.roomDocument(boardId),
    ingestImage: filesApi.ingestImage,
    sessionFromRequest,
    accessForBoard,
    linkUnlockToken,
    emitMetric: () => {},
  });

  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const handle = async () => {
      if (await filesApi.handleFilesRoutes({ request, response, url })) return;
      if (await handleBilling({ request, response, url, store, env: { REMO_BILLING: "on" } })) {
        return;
      }
      if (await handleIam({ request, response, url, store })) return;
      if (await exports.handleExportRoutes({ request, response, url })) return;
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
    const board = /^\/boards\/([^/]+)/.exec(url.pathname);
    const org = /^\/orgs\/([^/]+)/.exec(url.pathname);
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

function client() {
  let cookie = "";
  return async (method, path, { json, form } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
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
  return { api, orgId: registered.body.org.id };
}

async function boardOf(api, orgId, title) {
  const created = await api("POST", `/orgs/${orgId}/boards`, { json: { title } });
  expect(created.status).toBe(201);
  return created.body.board.id;
}

function upload(api, boardId) {
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "map.png");
  return api("POST", `/boards/${boardId}/files`, { form });
}

async function imageWidgets(boardId) {
  const room = store.rooms.get(boardId);
  expect(room).toBeTruthy();
  const doc = room.ydoc;
  return Object.values(doc.getMap("widgets").toJSON()).filter((widget) => widget.type === "image");
}

suite("backup import with images (ADR-249 §5.3)", () => {
  it("restores pictures into another organisation with new ids and readable bytes", async () => {
    const source = await account("source");
    const sourceBoard = await boardOf(source.api, source.orgId, "Source");
    const uploaded = await upload(source.api, sourceBoard);
    expect(uploaded.status).toBe(201);
    const oldId = uploaded.body.file.id;

    const exported = await source.api("GET", `/boards/${sourceBoard}/backup`);
    expect(exported.status).toBe(200);
    const bundle = exported.body;
    expect(bundle.manifest.version).toBe(3);
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets[0].data).toBeTruthy();

    const target = await account("target");
    const targetBoard = await boardOf(target.api, target.orgId, "Target");
    const imported = await target.api("POST", `/boards/${targetBoard}/backup/import`, { json: bundle });
    expect(imported.status).toBe(200);
    expect(imported.body.imported).toMatchObject({ assets: 1, placeholders: 0 });

    const images = await imageWidgets(targetBoard);
    expect(images).toHaveLength(1);
    const newId = images[0].fileId;
    expect(newId).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId).not.toBe(oldId);

    // The bytes are in the target organisation and readable through the target room.
    const variant = await target.api("GET", `/files/${newId}/w256?board=${targetBoard}`);
    expect(variant.status).toBe(200);
    expect(variant.body.length).toBeGreaterThan(0);
    const original = await target.api("GET", `/files/${newId}/original?board=${targetBoard}`);
    expect(original.status).toBe(200);
    expect(original.body.equals(PNG)).toBe(true);

    // The source room no longer shows the picture by its old id from the target room.
    const foreign = await target.api("GET", `/files/${oldId}/w256?board=${targetBoard}`);
    expect(foreign.status).toBe(404);

    // Quota: the target organisation holds exactly one copy of these bytes, and the
    // second import of the same bundle deduplicates instead of doubling the count.
    const orgStored = async () => {
      const { rows } = await store.pool.query(
        "select coalesce(sum(stored_bytes), 0)::bigint as bytes from files where org_id = $1 and status = 'ready'",
        [target.orgId],
      );
      return Number(rows[0].bytes);
    };
    const stored = await orgStored();
    const { rows } = await store.pool.query(
      "select stored_bytes from files where id = $1",
      [newId],
    );
    expect(stored).toBe(Number(rows[0].stored_bytes));
    const again = await target.api("POST", `/boards/${targetBoard}/backup/import`, { json: bundle });
    expect(again.status).toBe(200);
    expect((await imageWidgets(targetBoard))[0].fileId).toBe(newId);
    expect(await orgStored()).toBe(stored);
  });

  it("restores a backup without bytes as placeholders", async () => {
    const source = await account("plain-source");
    const sourceBoard = await boardOf(source.api, source.orgId, "Plain source");
    const uploaded = await upload(source.api, sourceBoard);
    const oldId = uploaded.body.file.id;

    const exported = await source.api("GET", `/boards/${sourceBoard}/backup?assets=none`);
    expect(exported.status).toBe(200);
    const bundle = exported.body;
    expect(bundle.assets[0]).not.toHaveProperty("data");
    expect(bundle.assets[0].fileId).toBe(oldId);

    const target = await account("plain-target");
    const targetBoard = await boardOf(target.api, target.orgId, "Plain target");
    const imported = await target.api("POST", `/boards/${targetBoard}/backup/import`, { json: bundle });
    expect(imported.status).toBe(200);
    expect(imported.body.imported).toMatchObject({ assets: 0, placeholders: 1 });

    // The object stays in the room under the id the target cannot resolve: that is the
    // "Image unavailable" placeholder, not a lost object.
    const images = await imageWidgets(targetBoard);
    expect(images).toHaveLength(1);
    expect(images[0].fileId).toBe(oldId);
    const { rows } = await store.withTenant(target.orgId, () =>
      store.pool.query("select count(*)::int as count from files where org_id = $1", [target.orgId]),
    );
    expect(rows[0].count).toBe(0);
  });

  it("refuses a backup whose checksum does not match", async () => {
    const owner = await account("tampered");
    const boardId = await boardOf(owner.api, owner.orgId, "Tampered");
    const body = {
      manifest: { format: "remo.board.backup", version: 3, checksum: "sha256:no" },
      format: "remo.board",
      version: 3,
      widgets: {},
      kanbans: {},
    };
    const response = await owner.api("POST", `/boards/${boardId}/backup/import`, { json: body });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("BAD_BACKUP");
  });
});
