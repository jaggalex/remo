import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "./server.mjs";

const GATEWAY_TOKEN = "gateway-secret";
const ADMIN_TOKEN = "admin-secret";
const KEY = "sk-admin-key-123456";
const cleanup = [];

function config({ byok = true } = {}) {
  return {
    region: "eu",
    listen: "127.0.0.1:0",
    admin: "127.0.0.1:0",
    limits: {
      concurrency: 4,
      perOrg: { rpm: 100, tokensPerDay: 1_000_000 },
      perUser: { rpm: 100, tokensPerDay: 1_000_000 },
      global: { rpm: 1000 },
    },
    providers: [
      {
        id: "fake",
        baseUrl: "https://provider.test/v1",
        models: ["*"],
        regions: ["eu"],
        timeoutMs: 1000,
        rpm: 100,
        byok,
        ...(byok ? {} : { keyEnv: "INSTALLATION_KEY" }),
      },
    ],
  };
}

async function fakeProvider() {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ id: "answer", usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${port}`, seen };
}

function through(target, calls) {
  return async (url, options) => {
    calls.push({ url, headers: options.headers });
    return fetch(target.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    });
  };
}

async function startAdminGateway({ env = {}, byok = true, fetchImpl } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "remo-gw-admin-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const gateway = await createGateway({
    config: config({ byok }),
    stateDir: dir,
    token: GATEWAY_TOKEN,
    adminToken: ADMIN_TOKEN,
    env,
    fetchImpl,
    busyWaitMs: 50,
    adminEnabled: true,
  });
  await gateway.start();
  cleanup.push(() => gateway.close());
  return {
    gateway,
    dir,
    url: `http://127.0.0.1:${gateway.address().port}`,
    adminUrl: `http://127.0.0.1:${gateway.adminServer.address().port}`,
  };
}

function admin(base, path, { method = "GET", body = null, token = ADMIN_TOKEN } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function chat(base, headers = {}) {
  return fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${GATEWAY_TOKEN}`,
      "content-type": "application/json",
      "x-remo-upstream": "fake",
      "x-remo-upstream-key": KEY,
      "x-remo-org": "org-1",
      "x-remo-user": "user-1",
      ...headers,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
}

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});

describe("the admin API", () => {
  it("requires its own token and reports status without the gateway token", async () => {
    const { adminUrl } = await startAdminGateway();
    const denied = await admin(adminUrl, "/status", { token: "wrong" });
    expect(denied.status).toBe(401);

    const status = await admin(adminUrl, "/status");
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.region).toBe("eu");
    expect(body.providers).toBe(1);
    expect(body.kills).toMatchObject({ global: { on: false } });
    expect(JSON.stringify(body)).not.toContain(GATEWAY_TOKEN);
  });

  it("kills and unkills a scope without a restart, and writes the operator journal", async () => {
    const provider = await fakeProvider();
    const { adminUrl, url, dir } = await startAdminGateway({
      fetchImpl: through(provider, []),
    });

    const killed = await admin(adminUrl, "/kill", {
      method: "POST",
      body: { scope: "global", reason: "maintenance" },
    });
    expect(killed.status).toBe(200);
    expect((await killed.json()).kill).toMatchObject({ on: true, reason: "maintenance" });

    const refused = await chat(url);
    expect(refused.status).toBe(423);
    expect(await refused.json()).toMatchObject({
      error: { code: "KILLED", scope: "global", reason: "maintenance" },
    });

    const unkilled = await admin(adminUrl, "/unkill", {
      method: "POST",
      body: { scope: "global" },
    });
    expect(unkilled.status).toBe(200);
    expect((await chat(url)).status).toBe(200);

    const journal = await readFile(join(dir, "admin.log"), "utf8");
    expect(journal).toContain('"action":"kill"');
    expect(journal).toContain('"action":"unkill"');
    expect(journal).not.toContain(ADMIN_TOKEN);
  });

  it("sets an organisation override and reports usage and tail records", async () => {
    const provider = await fakeProvider();
    const calls = [];
    const dir = await mkdtemp(join(tmpdir(), "remo-gw-admin2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const gateway = await createGateway({
      config: config(),
      stateDir: dir,
      token: GATEWAY_TOKEN,
      adminToken: ADMIN_TOKEN,
      fetchImpl: through(provider, calls),
      busyWaitMs: 50,
      adminEnabled: true,
    });
    await gateway.start();
    cleanup.push(() => gateway.close());
    const url = `http://127.0.0.1:${gateway.address().port}`;
    const adminUrl = `http://127.0.0.1:${gateway.adminServer.address().port}`;

    expect((await chat(url)).status).toBe(200);
    await gateway.state.flush();

    const usage = await admin(adminUrl, "/usage?org=org-1");
    expect(await usage.json()).toMatchObject({ day: expect.any(String), org: "org-1", tokens: 15 });

    const tail = await admin(adminUrl, "/tail?org=org-1");
    const records = await tail.json();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ org: "org-1", provider: "fake", status: 200 });
    expect(JSON.stringify(records)).not.toContain(KEY);

    const set = await admin(adminUrl, "/limits", {
      method: "POST",
      body: { scope: "org", id: "org-1", tokensPerDay: 5_000_000, rpm: 60 },
    });
    expect(set.status).toBe(200);
    const limits = await (await admin(adminUrl, "/limits")).json();
    expect(limits.overrides["org-1"]).toEqual({ tokensPerDay: 5_000_000, rpm: 60 });
  });

  it("runs a provider test with the installation key", async () => {
    const provider = await fakeProvider();
    const dir = await mkdtemp(join(tmpdir(), "remo-gw-admin3-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const gateway = await createGateway({
      config: config({ byok: false }),
      stateDir: dir,
      token: GATEWAY_TOKEN,
      adminToken: ADMIN_TOKEN,
      env: { INSTALLATION_KEY: KEY },
      fetchImpl: through(provider, []),
      busyWaitMs: 50,
      adminEnabled: true,
    });
    await gateway.start();
    cleanup.push(() => gateway.close());
    const adminUrl = `http://127.0.0.1:${gateway.adminServer.address().port}`;

    const result = await admin(adminUrl, "/providers/fake/test", {
      method: "POST",
      body: { model: "gpt-4o" },
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, status: 200 });
    expect(provider.seen[0].headers.authorization).toBe(`Bearer ${KEY}`);
  });
});
