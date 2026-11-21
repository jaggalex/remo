import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "./server.mjs";

const GATEWAY_TOKEN = "gateway-secret";
const ADMIN_TOKEN = "admin-secret";
const METRICS_TOKEN = "metrics-secret";
const MARKER = "MARKER_NEVER_IN_LOG_7f3a";
const KEY = "sk-live-key-123456789";

const cleanup = [];

function baseConfig(overrides = {}) {
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
        match: ["https://provider.test/v1"],
        models: ["*"],
        regions: ["eu"],
        timeoutMs: 1000,
        rpm: 100,
        byok: true,
        price: { inPerMTok: 1, outPerMTok: 2 },
        enabled: true,
      },
    ],
    ...overrides,
  };
}

async function fakeProvider(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
  };
}

/** A fetch-shaped transport that records what the gateway would send and forwards locally. */
function through(target, calls) {
  return async (url, options) => {
    calls.push({ url, headers: options.headers, body: options.body });
    return fetch(target.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    });
  };
}

async function startGateway({
  config = baseConfig(),
  configPath = null,
  env = {},
  fetchImpl,
  busyWaitMs = 50,
  adminEnabled = false,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "remo-gw-server-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const gateway = await createGateway({
    config,
    configPath,
    stateDir: dir,
    token: GATEWAY_TOKEN,
    adminToken: ADMIN_TOKEN,
    metricsToken: METRICS_TOKEN,
    env,
    fetchImpl,
    busyWaitMs,
    adminEnabled,
  });
  await gateway.start();
  const { port } = gateway.address();
  cleanup.push(() => gateway.close());
  return {
    gateway,
    dir,
    url: `http://127.0.0.1:${port}`,
    close: () => gateway.close(),
  };
}

function chat(base, { headers = {}, body } = {}) {
  const payload = body ?? {
    model: "gpt-4o",
    messages: [{ role: "user", content: `hello ${MARKER}` }],
  };
  return fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${GATEWAY_TOKEN}`,
      "content-type": "application/json",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function successProvider(status = 200, usage = { prompt_tokens: 10, completion_tokens: 5 }) {
  return (req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "answer", usage }));
  };
}

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});

describe("gateway authentication and routing", () => {
  it("requires the gateway bearer token with a constant-time comparison", async () => {
    const gateway = await startGateway();
    const missing = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: "POST",
      body: "{}",
    });
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe("GATEWAY_AUTH");

    const wrong = await chat(gateway.url, { headers: { authorization: "Bearer wrong" } });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe("GATEWAY_AUTH");
    await gateway.close();
  });

  it("parses the body and refuses a request without model or messages", async () => {
    const gateway = await startGateway();
    const answer = await chat(gateway.url, { body: { messages: [] } });
    expect(answer.status).toBe(400);
    expect((await answer.json()).error.code).toBe("INVALID_REQUEST");
    await gateway.close();
  });

  it("refuses a body over two MiB", async () => {
    const gateway = await startGateway();
    const answer = await chat(gateway.url, { body: "x".repeat(2 * 1024 * 1024 + 1) });
    expect(answer.status).toBe(413);
    expect((await answer.json()).error.code).toBe("REQUEST_TOO_LARGE");
    await gateway.close();
  });

  it("answers health without details and hides metrics behind their token", async () => {
    const gateway = await startGateway();
    const health = await fetch(`${gateway.url}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    expect((await fetch(`${gateway.url}/metrics`)).status).toBe(404);
    expect(
      (await fetch(`${gateway.url}/metrics`, { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(404);
    const metrics = await fetch(`${gateway.url}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain("remo_gw_inflight");
    await gateway.close();
  });

  it("checks a BYOK base URL with the same token", async () => {
    const gateway = await startGateway();
    const unauthorised = await fetch(
      `${gateway.url}/v1/upstreams/check?baseUrl=${encodeURIComponent("https://provider.test/v1")}`,
    );
    expect(unauthorised.status).toBe(401);

    const known = await fetch(
      `${gateway.url}/v1/upstreams/check?baseUrl=${encodeURIComponent("https://PROVIDER.test/v1/")}`,
      { headers: { authorization: `Bearer ${GATEWAY_TOKEN}` } },
    );
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual({ allowed: true, provider: "fake" });

    const unknown = await fetch(
      `${gateway.url}/v1/upstreams/check?baseUrl=${encodeURIComponent("https://other.test/v1")}`,
      { headers: { authorization: `Bearer ${GATEWAY_TOKEN}` } },
    );
    expect(unknown.status).toBe(403);
    expect((await unknown.json()).error.code).toBe("PROVIDER_NOT_ALLOWED");
    await gateway.close();
  });
});

describe("calling a provider", () => {
  it("proxies a 200 as-is, adds metadata headers and logs no body or key", async () => {
    const provider = await fakeProvider(successProvider());
    const calls = [];
    const gateway = await startGateway({ fetchImpl: through(provider, calls) });
    const answer = await chat(gateway.url, {
      headers: {
        "x-remo-upstream": "fake",
        "x-remo-upstream-key": KEY,
        "x-remo-org": "org-1",
        "x-remo-user": "user-1",
        "x-remo-task": "task-1",
        "x-remo-region": "eu",
        "x-request-id": "rid-42",
      },
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      id: "answer",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    expect(answer.headers.get("x-remo-gateway-provider")).toBe("fake");
    expect(answer.headers.get("x-remo-gateway-usage")).toBe("in=10,out=5");
    expect(Number(answer.headers.get("x-remo-gateway-latency-ms"))).toBeGreaterThanOrEqual(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://provider.test/v1/chat/completions");
    expect(Object.keys(calls[0].headers).sort()).toEqual([
      "authorization",
      "content-type",
      "x-title",
    ]);
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(calls[0].headers)).not.toContain("x-remo");

    const text = await readFile(join(gateway.dir, "requests.log"), "utf8");
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("Bearer");
    const record = JSON.parse(text.trim());
    expect(record).toMatchObject({
      rid: "rid-42",
      org: "org-1",
      user: "user-1",
      task: "task-1",
      provider: "fake",
      model: "gpt-4o",
      status: 200,
      code: null,
      in: 10,
      out: 5,
    });
    expect(record.cost).toBeCloseTo((10 / 1_000_000) * 1 + (5 / 1_000_000) * 2);
    await gateway.close();
  });

  it("maps provider 400, 429 and 500 to 502 with upstreamStatus", async () => {
    let status = 400;
    const provider = await fakeProvider((req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "provider detail must not leak" } }));
    });
    const gateway = await startGateway({ fetchImpl: through(provider, []) });
    for (const value of [400, 429, 500]) {
      status = value;
      const answer = await chat(gateway.url, {
        headers: { "x-remo-upstream": "fake", "x-remo-upstream-key": KEY },
      });
      expect(answer.status).toBe(502);
      const body = await answer.json();
      expect(body.error.code).toBe("UPSTREAM_ERROR");
      expect(body.error.upstreamStatus).toBe(value);
    }
    await gateway.close();
  });

  it("maps a provider timeout to 504 and a refusal to 502", async () => {
    const timedOut = await startGateway({
      fetchImpl: async () => {
        throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
      },
    });
    const timeout = await chat(timedOut.url, {
      headers: { "x-remo-upstream": "fake", "x-remo-upstream-key": KEY },
    });
    expect(timeout.status).toBe(504);
    expect((await timeout.json()).error.code).toBe("UPSTREAM_TIMEOUT");
    await timedOut.close();

    const redirect = await startGateway({
      fetchImpl: async () => {
        throw Object.assign(new Error("redirect refused"), { code: "REDIRECT_REFUSED" });
      },
    });
    const refused = await chat(redirect.url, {
      headers: { "x-remo-upstream": "fake", "x-remo-upstream-key": KEY },
    });
    expect(refused.status).toBe(502);
    expect((await refused.json()).error.code).toBe("UPSTREAM_ERROR");
    await redirect.close();
  });

  it("refuses a provider that resolves to a private address before connecting", async () => {
    const config = baseConfig({
      providers: [
        {
          id: "private",
          baseUrl: "https://127.0.0.1/v1",
          match: ["https://127.0.0.1/v1"],
          models: ["*"],
          regions: ["eu"],
          timeoutMs: 1000,
          rpm: 10,
          byok: true,
        },
      ],
    });
    const gateway = await startGateway({ config });
    const answer = await chat(gateway.url, {
      headers: { "x-remo-upstream": "private", "x-remo-upstream-key": KEY },
    });
    expect(answer.status).toBe(502);
    expect((await answer.json()).error.code).toBe("UPSTREAM_ERROR");
    await gateway.close();
  });

  it("refuses a provider id or a model not in the registry", async () => {
    const gateway = await startGateway();
    const unknown = await chat(gateway.url, {
      headers: { "x-remo-upstream": "missing", "x-remo-upstream-key": KEY },
    });
    expect(unknown.status).toBe(403);
    expect((await unknown.json()).error.code).toBe("PROVIDER_NOT_ALLOWED");

    const config = baseConfig({
      providers: [
        {
          id: "fake",
          baseUrl: "https://provider.test/v1",
          models: ["only-this"],
          regions: ["eu"],
          byok: true,
        },
      ],
    });
    const restricted = await startGateway({ config });
    const model = await chat(restricted.url, {
      headers: { "x-remo-upstream": "fake", "x-remo-upstream-key": KEY },
    });
    expect(model.status).toBe(403);
    expect((await model.json()).error.code).toBe("PROVIDER_NOT_ALLOWED");
    await restricted.close();
    await gateway.close();
  });
});

describe("kill switches", () => {
  it("checks global, provider, org and user, and a disabled provider is killed", async () => {
    const provider = await fakeProvider(successProvider());
    const gateway = await startGateway({ fetchImpl: through(provider, []) });
    const headers = {
      "x-remo-upstream": "fake",
      "x-remo-upstream-key": KEY,
      "x-remo-org": "org-1",
      "x-remo-user": "user-1",
    };

    gateway.gateway.state.setKill("global", null, { reason: "maintenance" });
    let answer = await chat(gateway.url, { headers });
    expect(answer.status).toBe(423);
    expect(await answer.json()).toMatchObject({
      error: { code: "KILLED", scope: "global", reason: "maintenance" },
    });
    gateway.gateway.state.unsetKill("global");

    for (const [scope, id, header] of [
      ["provider", "fake", {}],
      ["org", "org-1", { "x-remo-org": "org-1" }],
      ["user", "user-1", { "x-remo-user": "user-1" }],
    ]) {
      gateway.gateway.state.setKill(scope, id, { reason: `${scope} incident` });
      answer = await chat(gateway.url, { headers: { ...headers, ...header } });
      expect(answer.status).toBe(423);
      expect(await answer.json()).toMatchObject({ error: { code: "KILLED", scope } });
      gateway.gateway.state.unsetKill(scope, id);
    }
    await gateway.close();

    const disabled = await startGateway({
      config: baseConfig({
        providers: [
          {
            id: "fake",
            baseUrl: "https://provider.test/v1",
            models: ["*"],
            regions: ["eu"],
            byok: true,
            enabled: false,
          },
        ],
      }),
      fetchImpl: through(provider, []),
    });
    answer = await chat(disabled.url, { headers });
    expect(answer.status).toBe(423);
    expect(await answer.json()).toMatchObject({ error: { code: "KILLED", scope: "provider" } });
    await disabled.close();
  });

  it("returns to service when a timed kill expires", async () => {
    const provider = await fakeProvider(successProvider());
    const gateway = await startGateway({ fetchImpl: through(provider, []) });
    gateway.gateway.state.setKill("provider", "fake", {
      until: new Date(Date.now() - 1000).toISOString(),
    });
    const answer = await chat(gateway.url, {
      headers: { "x-remo-upstream": "fake", "x-remo-upstream-key": KEY },
    });
    expect(answer.status).toBe(200);
    await gateway.close();
  });
});

describe("limits", () => {
  it("answers 429 with Retry-After when the organisation rpm is spent", async () => {
    const provider = await fakeProvider(successProvider());
    const config = baseConfig({
      limits: {
        concurrency: 4,
        perOrg: { rpm: 1, tokensPerDay: 1_000_000 },
        perUser: { rpm: 100, tokensPerDay: 1_000_000 },
        global: { rpm: 1000 },
      },
    });
    const gateway = await startGateway({ config, fetchImpl: through(provider, []) });
    const headers = {
      "x-remo-upstream": "fake",
      "x-remo-upstream-key": KEY,
      "x-remo-org": "org-1",
      "x-remo-user": "user-1",
    };
    expect((await chat(gateway.url, { headers })).status).toBe(200);
    const limited = await chat(gateway.url, { headers });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({
      error: { code: "RATE_LIMITED", scope: "org" },
    });
    await gateway.close();
  });

  it("answers 429 when the daily tokens are spent", async () => {
    const provider = await fakeProvider(successProvider());
    const config = baseConfig({
      limits: {
        concurrency: 4,
        perOrg: { rpm: 100, tokensPerDay: 10 },
        perUser: { rpm: 100, tokensPerDay: 1000 },
        global: { rpm: 1000 },
      },
    });
    const gateway = await startGateway({ config, fetchImpl: through(provider, []) });
    const headers = {
      "x-remo-upstream": "fake",
      "x-remo-upstream-key": KEY,
      "x-remo-org": "org-1",
      "x-remo-user": "user-1",
    };
    expect((await chat(gateway.url, { headers })).status).toBe(200);
    const limited = await chat(gateway.url, { headers });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: { code: "RATE_LIMITED", scope: "org" },
    });
    await gateway.close();
  });

  it("answers 503 when the concurrency semaphore waits too long", async () => {
    const provider = await fakeProvider(successProvider());
    const real = through(provider, []);
    let started;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    let release;
    const fetchImpl = (url, options) => {
      started();
      return new Promise((resolve) => {
        release = () => resolve(real(url, options));
      });
    };
    const config = baseConfig({
      limits: {
        concurrency: 1,
        perOrg: { rpm: 100, tokensPerDay: 1_000_000 },
        perUser: { rpm: 100, tokensPerDay: 1_000_000 },
        global: { rpm: 1000 },
      },
    });
    const gateway = await startGateway({ config, fetchImpl, busyWaitMs: 20 });
    const headers = {
      "x-remo-upstream": "fake",
      "x-remo-upstream-key": KEY,
      "x-remo-org": "org-1",
      "x-remo-user": "user-1",
    };
    const first = chat(gateway.url, { headers });
    await entered;
    const busy = await chat(gateway.url, { headers });
    expect(busy.status).toBe(503);
    expect((await busy.json()).error.code).toBe("GATEWAY_BUSY");
    release();
    expect((await first).status).toBe(200);
    await gateway.close();
  });
});

describe("configuration reload", () => {
  it("keeps the previous registry when the file is broken", async () => {
    const dir = await mkdtemp(join(tmpdir(), "remo-gw-reload-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify(baseConfig()), "utf8");
    const gateway = await createGateway({
      configPath,
      stateDir: dir,
      token: GATEWAY_TOKEN,
      adminToken: ADMIN_TOKEN,
      adminEnabled: false,
    });
    expect(gateway.config.providers[0].id).toBe("fake");
    await writeFile(configPath, "{ broken", "utf8");
    const result = gateway.reload();
    expect(result.ok).toBe(false);
    expect(gateway.config.providers[0].id).toBe("fake");
    await gateway.close();
  });
});
