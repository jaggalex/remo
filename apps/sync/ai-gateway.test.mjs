import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { handleAiCredentials } from "./agent-api-ai.mjs";
import { callAgentModel } from "./agent-call.mjs";
import { AiClient, AiError, gatewaySettings } from "./ai.mjs";
import { encryptSecret } from "./secrets.mjs";

/**
 * The sync half of ADR-251 (spec/ai-gateway.md §3).
 *
 * The gateway itself is tested in `apps/ai-gateway`; here the contract is the request
 * headers, the error codes a person sees, and the rule that a configured gateway has no
 * direct path around it.
 */

const gateway = {
  url: "https://10.77.0.2:8080",
  token: "gateway-token",
  timeoutMs: 12_000,
  region: "ru",
};

function answer(content, { status = 200, id = "req-1", provider = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: provider ? { "x-remo-gateway-provider": provider } : null,
    json: async () => ({
      id,
      model: "provider/model",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    text: async () => JSON.stringify({ error: { code: "unexpected" } }),
  };
}

function refusal(status, code, extra = {}) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => JSON.stringify({ error: { code, message: `${code} happened`, ...extra } }),
  };
}

function client(fetchImpl, overrides = {}) {
  return new AiClient({ model: "m", gateway, fetchImpl, ...overrides });
}

describe("AiClient in gateway mode", () => {
  it("sends the §3.1 headers and the same body as a direct call", async () => {
    const seen = [];
    const ai = client(async (url, init) => {
      seen.push({ url, init });
      return answer('{"nodes":[]}', { provider: "yandex" });
    });

    const result = await ai.chatJson({
      system: "s",
      user: "u",
      maxTokens: 100,
      gateway: {
        upstream: "openrouter",
        upstreamKey: "sk-user",
        orgId: "o1",
        userId: "u1",
        taskId: "t1",
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://10.77.0.2:8080/v1/chat/completions");
    const headers = seen[0].init.headers;
    expect(headers.Authorization).toBe("Bearer gateway-token");
    expect(headers["X-Remo-Upstream"]).toBe("openrouter");
    expect(headers["X-Remo-Upstream-Key"]).toBe("sk-user");
    expect(headers["X-Remo-Org"]).toBe("o1");
    expect(headers["X-Remo-User"]).toBe("u1");
    expect(headers["X-Remo-Task"]).toBe("t1");
    expect(headers["X-Remo-Region"]).toBe("ru");
    expect(headers["X-Request-Id"]).toBeTruthy();
    // The gateway is the one private address an outbound call may reach.
    expect(seen[0].init.allowPrivate).toBe(true);

    const body = JSON.parse(seen[0].init.body);
    expect(body).toMatchObject({
      model: "m",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      max_tokens: 100,
      response_format: { type: "json_object" },
    });
    expect(result.json).toEqual({ nodes: [] });
    // The header wins over the upstream we sent: it names the provider that answered.
    expect(result.gatewayProvider).toBe("yandex");
    expect(result.requestId).toBe("req-1");
    expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 5 });
  });

  it("omits the region and the key header when they are not set", async () => {
    const seen = [];
    const ai = new AiClient({
      model: "m",
      gateway: { ...gateway, region: "" },
      fetchImpl: async (url, init) => {
        seen.push(init);
        return answer('{"ok":true}');
      },
    });
    await ai.chatJson({ user: "u", maxTokens: 10, gateway: { upstream: "openrouter", upstreamKey: "" } });
    expect(seen[0].headers["X-Remo-Region"]).toBeUndefined();
    expect(seen[0].headers["X-Remo-Upstream-Key"]).toBeUndefined();
  });

  it("falls back to the sent upstream when the answer has no provider header", async () => {
    const ai = client(async () => answer('{"ok":true}'));
    const result = await ai.chatJson({
      user: "u",
      maxTokens: 10,
      gateway: { upstream: "openrouter" },
    });
    expect(result.gatewayProvider).toBe("openrouter");
  });

  it("pins the gateway certificate only when REMO_AI_GATEWAY_CA is set", async () => {
    const seen = [];
    const fetchImpl = async (_url, init) => {
      seen.push(init);
      return answer('{"ok":true}');
    };
    const withCa = new AiClient({
      model: "m",
      gateway: gatewaySettings({
        REMO_AI_GATEWAY_URL: gateway.url,
        REMO_AI_GATEWAY_TOKEN: gateway.token,
        REMO_AI_GATEWAY_CA: "-----BEGIN CERTIFICATE-----",
      }),
      fetchImpl,
    });
    await withCa.chatJson({ user: "u", maxTokens: 10 });
    expect(seen[0].ca).toBe("-----BEGIN CERTIFICATE-----");

    const withoutCa = client(fetchImpl);
    await withoutCa.chatJson({ user: "u", maxTokens: 10 });
    expect(seen[1].ca).toBeUndefined();
  });

  it("maps every gateway code to the same AiError code", async () => {
    const cases = [
      ["GATEWAY_AUTH", 401],
      ["PROVIDER_NOT_ALLOWED", 403],
      ["REGION_NOT_ALLOWED", 403],
      ["KILLED", 423],
      ["RATE_LIMITED", 429],
      ["UPSTREAM_ERROR", 502],
      ["UPSTREAM_TIMEOUT", 504],
      ["GATEWAY_BUSY", 503],
    ];
    for (const [code, status] of cases) {
      const ai = client(async () => refusal(status, code, { scope: "org", retryAfter: 60 }));
      await expect(ai.chatJson({ user: "u", maxTokens: 10 })).rejects.toMatchObject({
        name: "AiError",
        code,
        status,
      });
    }

    const killed = client(async () => refusal(423, "KILLED", { scope: "provider" }));
    await expect(killed.chatJson({ user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "KILLED",
      scope: "provider",
    });
    const limited = client(async () => refusal(429, "RATE_LIMITED", { retryAfter: 120 }));
    await expect(limited.chatJson({ user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfter: 120,
    });
  });

  it("retries once without response_format only for UPSTREAM_ERROR with upstreamStatus 400", async () => {
    const bodies = [];
    const ai = client(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        return refusal(502, "UPSTREAM_ERROR", { upstreamStatus: 400 });
      }
      return answer('{"ok":true}');
    });

    const result = await ai.chatJson({ user: "u", maxTokens: 10 });
    expect(result.json).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    expect(bodies[1].response_format).toBeUndefined();
  });

  it("does not retry another upstream error", async () => {
    let calls = 0;
    const ai = client(async () => {
      calls += 1;
      return refusal(502, "UPSTREAM_ERROR", { upstreamStatus: 500 });
    });
    await expect(ai.chatJson({ user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    expect(calls).toBe(1);
  });

  it("fails closed when the gateway is unreachable and never calls the provider directly", async () => {
    const urls = [];
    const ai = new AiClient({
      apiKey: "user-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "m",
      gateway,
      fetchImpl: async (url) => {
        urls.push(url);
        throw new Error("connect ECONNREFUSED 10.77.0.2:8080");
      },
    });

    await expect(ai.chatJson({ user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "AI_GATEWAY_UNAVAILABLE",
    });
    expect(urls).toEqual(["https://10.77.0.2:8080/v1/chat/completions"]);
    expect(urls.some((url) => url.includes("openrouter.ai"))).toBe(false);
  });

  it("reports a gateway that answers without a code as an HTTP error, still fail-closed", async () => {
    const ai = client(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "not json",
    }));
    await expect(ai.chatJson({ user: "u", maxTokens: 10 })).rejects.toBeInstanceOf(AiError);
  });

  it("is configured with a gateway URL and token but no provider key", () => {
    expect(new AiClient({ apiKey: "", model: "m", gateway }).configured).toBe(true);
    expect(
      new AiClient({ apiKey: "", model: "m", gatewayUrl: gateway.url, gatewayToken: "t" })
        .configured,
    ).toBe(true);
    expect(
      new AiClient({ apiKey: "", model: "m", gateway: { ...gateway, token: "" } }).configured,
    ).toBe(false);
    expect(
      new AiClient({ apiKey: "", model: "m", gateway: { ...gateway, url: "", token: "" } })
        .configured,
    ).toBe(false);
    expect(new AiClient({ apiKey: "", model: "", gateway: { ...gateway, url: "" } }).configured).toBe(
      false,
    );
  });

  it("reads the gateway timeout with REMO_AI_TIMEOUT_MS as its base", () => {
    expect(gatewaySettings({ REMO_AI_TIMEOUT_MS: "1000" }).timeoutMs).toBe(6_000);
    expect(
      gatewaySettings({ REMO_AI_TIMEOUT_MS: "1000", REMO_AI_GATEWAY_TIMEOUT_MS: "9000" }).timeoutMs,
    ).toBe(9_000);
    expect(gatewaySettings({}).timeoutMs).toBe(65_000);
  });
});

/* ------------------------------------------------------------------ agent -- */

function agentStore({ credential = null, journal = [] } = {}) {
  return {
    journal,
    getAiPolicy: async () => ({ keyMode: "either", providers: [], models: [] }),
    getAiCredential: async () => credential,
    getDefaultAiCredential: async () => credential,
    touchAiCredential: async () => {},
    appendAiRun: async (row) => journal.push(row),
  };
}

const agent = { owner_id: "u1", model: "m" };
const task = { id: "t1", org_id: "o1", agent_id: "a1", board_id: "b1" };
const skill = { slug: "diagram", version: 1, tools: ["write_diagram"] };
const prompt = { system: "draw", user: "a flow" };
const budget = { maxTokens: 4000 };

const env = {
  REMO_AI_GATEWAY_URL: gateway.url,
  REMO_AI_GATEWAY_TOKEN: gateway.token,
  REMO_AI_MODEL: "m",
  REMO_AI_BASE_URL: "https://openrouter.ai/api/v1",
};

describe("callAgentModel in gateway mode", () => {
  it("sends the task identity and journals the answering provider", async () => {
    const seen = [];
    const ai = client(async (url, init) => {
      seen.push({ url, init });
      return answer('{"nodes":[]}', { provider: "openrouter" });
    });
    const store = agentStore();

    const called = await callAgentModel({
      store,
      task,
      agent,
      skill,
      prompt,
      budget,
      ai,
      env,
    });

    expect(seen[0].url).toBe("https://10.77.0.2:8080/v1/chat/completions");
    expect(seen[0].init.headers["X-Remo-Org"]).toBe("o1");
    expect(seen[0].init.headers["X-Remo-User"]).toBe("u1");
    expect(seen[0].init.headers["X-Remo-Task"]).toBe("t1");
    expect(called.completion.gatewayProvider).toBe("openrouter");
    expect(store.journal).toHaveLength(1);
    expect(store.journal[0]).toMatchObject({
      gatewayProvider: "openrouter",
      orgId: "o1",
      taskId: "t1",
      status: "ok",
    });
  });

  it("passes a BYOK key as the upstream and the key's base URL for a custom provider", async () => {
    const kek = { key: Buffer.alloc(32, 7), id: "v1" };
    const secret = "sk-byok-value";
    const encrypted = encryptSecret(secret, {
      scope: "user",
      scopeId: "u1",
      provider: "custom",
      id: "c1",
      kek,
    });
    const credential = {
      id: "c1",
      scope: "user",
      scope_id: "u1",
      provider: "custom",
      base_url: "https://provider.example/v1",
      model: "m",
      fingerprint: "fp-c1",
      state: "active",
      ...encrypted,
    };
    const seen = [];
    const ai = client(async (_url, init) => {
      seen.push(init);
      return answer('{"nodes":[]}', { provider: "provider" });
    });
    const store = agentStore({ credential });

    const called = await callAgentModel({
      store,
      task,
      agent,
      skill,
      prompt,
      budget,
      ai,
      env: {
        ...env,
        REMO_KEK: kek.key.toString("base64"),
        REMO_KEK_ID: kek.id,
      },
    });

    expect(seen[0].headers["X-Remo-Upstream"]).toBe("https://provider.example/v1");
    expect(seen[0].headers["X-Remo-Upstream-Key"]).toBe(secret);
    expect(called.providerInfo).toMatchObject({ provider: "custom", credentialId: "c1" });
    expect(store.journal[0].gatewayProvider).toBe("provider");
  });

  it("fails the task when the gateway is down instead of falling back", async () => {
    const urls = [];
    const ai = client(async (url) => {
      urls.push(url);
      throw new Error("getaddrinfo ENOTFOUND 10.77.0.2");
    });
    const store = agentStore();

    await expect(
      callAgentModel({ store, task, agent, skill, prompt, budget, ai, env }),
    ).rejects.toMatchObject({ code: "AI_GATEWAY_UNAVAILABLE" });

    expect(urls).toEqual(["https://10.77.0.2:8080/v1/chat/completions"]);
    expect(store.journal).toHaveLength(1);
    expect(store.journal[0]).toMatchObject({
      status: "failed",
      errorCode: "AI_GATEWAY_UNAVAILABLE",
      gatewayProvider: null,
    });
  });
});

/* --------------------------------------------------------------- BYOK save -- */

const kek = { key: Buffer.alloc(32, 5), id: "v1" };
const saveEnv = {
  REMO_AI_GATEWAY_URL: gateway.url,
  REMO_AI_GATEWAY_TOKEN: gateway.token,
  REMO_KEK: kek.key.toString("base64"),
};

function response() {
  return {
    status: 0,
    body: null,
    headersSent: false,
    writeHead(status) {
      this.status = status;
      this.headersSent = true;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
    getHeader() {},
    setHeader() {},
  };
}

function saveContext({ body, fetchImpl, store = {} }) {
  return {
    request: Readable.from([Buffer.from(JSON.stringify(body))]),
    response: response(),
    url: new URL("http://localhost/orgs/o1/ai/credentials"),
    parts: ["orgs", "o1", "ai", "credentials"],
    method: "POST",
    store,
    me: { id: "u1" },
    audit: async () => {},
    isMember: async () => true,
    isOrgAdmin: async () => true,
    env: saveEnv,
    fetchImpl,
  };
}

describe("saving a BYOK key through the gateway", () => {
  it("refuses a provider the registry does not list with 422 PROVIDER_NOT_ALLOWED", async () => {
    const checked = [];
    const ctx = saveContext({
      body: {
        provider: "custom",
        baseUrl: "https://not-listed.example/v1",
        secret: "sk-test",
      },
      fetchImpl: async (url, init) => {
        checked.push({ url, init });
        return refusal(403, "PROVIDER_NOT_ALLOWED");
      },
      store: {
        getAiPolicy: async () => ({ keyMode: "either", providers: [], models: [] }),
        createAiCredential: async () => {
          throw new Error("must not be stored");
        },
      },
    });

    expect(await handleAiCredentials(ctx)).toBe(true);
    expect(ctx.response.status).toBe(422);
    expect(ctx.response.body.error).toBe("PROVIDER_NOT_ALLOWED");
    expect(ctx.response.body.message).toBe("Этот провайдер не подключён на сервере");
    expect(checked[0].url).toBe(
      "https://10.77.0.2:8080/v1/upstreams/check?baseUrl=https%3A%2F%2Fnot-listed.example%2Fv1",
    );
    expect(checked[0].init.headers.Authorization).toBe("Bearer gateway-token");
    expect(checked[0].init.allowPrivate).toBe(true);
    expect(checked.every(({ url }) => url.startsWith(gateway.url))).toBe(true);
  });

  it("stores the key when the registry knows the base URL", async () => {
    let stored = null;
    const ctx = saveContext({
      body: {
        provider: "custom",
        baseUrl: "https://listed.example/v1",
        secret: "sk-test",
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ allowed: true, provider: "listed" }),
        text: async () => JSON.stringify({ allowed: true, provider: "listed" }),
      }),
      store: {
        getAiPolicy: async () => ({ keyMode: "either", providers: [], models: [] }),
        createAiCredential: async (row) => {
          stored = row;
          return {
            ...row,
            state: "active",
            created_at: new Date().toISOString(),
            rotated_at: null,
            last_used_at: null,
          };
        },
      },
    });

    expect(await handleAiCredentials(ctx)).toBe(true);
    expect(ctx.response.status).toBe(201);
    expect(stored).toMatchObject({ provider: "custom", baseUrl: "https://listed.example/v1", model: null });
    expect(ctx.response.body.credential.provider).toBe("custom");
  });

  it("does not store a key when the gateway is unavailable", async () => {
    const ctx = saveContext({
      body: {
        provider: "custom",
        baseUrl: "https://listed.example/v1",
        secret: "sk-test",
      },
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      store: {
        getAiPolicy: async () => ({ keyMode: "either", providers: [], models: [] }),
        createAiCredential: async () => {
          throw new Error("must not be stored");
        },
      },
    });

    expect(await handleAiCredentials(ctx)).toBe(true);
    expect(ctx.response.status).toBe(503);
    expect(ctx.response.body.error).toBe("AI_GATEWAY_UNAVAILABLE");
  });
});
