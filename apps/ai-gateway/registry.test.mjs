import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  PolicyError,
  Registry,
  modelMatches,
  normalizeBaseUrl,
  parseHostPort,
  validateConfig,
} from "./registry.mjs";

function rawConfig(overrides = {}) {
  return {
    region: "eu",
    listen: "10.77.0.2:8080",
    admin: "127.0.0.1:8081",
    limits: {
      concurrency: 8,
      perOrg: { rpm: 30, tokensPerDay: 2_000_000 },
      perUser: { rpm: 15, tokensPerDay: 500_000 },
      global: { rpm: 600 },
    },
    providers: [
      {
        id: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        match: ["https://openrouter.ai/api/v1"],
        models: ["*"],
        regions: ["eu"],
        timeoutMs: 60_000,
        rpm: 300,
        byok: true,
        price: { inPerMTok: 1, outPerMTok: 2 },
      },
      {
        id: "yandex",
        baseUrl: "https://llm.api.cloud.yandex.net/v1",
        match: ["https://llm.api.cloud.yandex.net/v1"],
        models: ["yandexgpt*"],
        regions: ["ru"],
        rpm: 60,
        byok: true,
      },
    ],
    ...overrides,
  };
}

function codeOf(work) {
  try {
    work();
    return null;
  } catch (error) {
    return error.code ?? error.name;
  }
}

describe("the provider registry", () => {
  it("normalises a base URL: lower-case host and no trailing slash", () => {
    expect(normalizeBaseUrl("https://API.OpenRouter.AI/api/v1/")).toBe(
      "https://api.openrouter.ai/api/v1",
    );
    expect(() => normalizeBaseUrl("http://openrouter.ai/api/v1")).toThrow(ConfigError);
    expect(() => normalizeBaseUrl("https://user:pass@openrouter.ai/api/v1")).toThrow(ConfigError);
    expect(() => normalizeBaseUrl("https://openrouter.ai/api/v1?x=1")).toThrow(ConfigError);
  });

  it("matches models by exact name and a trailing star", () => {
    expect(modelMatches(["yandexgpt*"], "yandexgpt-lite")).toBe(true);
    expect(modelMatches(["yandexgpt*"], "gpt-4o")).toBe(false);
    expect(modelMatches(["gpt-4o"], "gpt-4o")).toBe(true);
    expect(modelMatches(["gpt-4o"], "gpt-4o-mini")).toBe(false);
    expect(modelMatches(["*"], "anything")).toBe(true);
  });

  it("resolves an upstream by registry id and by normalised base URL", () => {
    const registry = new Registry({ config: rawConfig() });
    const byId = registry.resolve("openrouter", { model: "gpt-4o", region: "eu" });
    expect(byId.id).toBe("openrouter");

    const byUrl = registry.resolve("https://OPENROUTER.ai/api/v1/", {
      model: "gpt-4o",
      region: "eu",
    });
    expect(byUrl.id).toBe("openrouter");
    expect(registry.checkBaseUrl("https://openrouter.ai/api/v1/").id).toBe("openrouter");
  });

  it("refuses an unknown provider, a forbidden model, a region and a BYOK key", () => {
    const registry = new Registry({ config: rawConfig() });
    expect(
      codeOf(() =>
        registry.resolve("https://unknown.example/v1", { model: "gpt-4o", region: "eu" }),
      ),
    ).toBe("PROVIDER_NOT_ALLOWED");
    expect(codeOf(() => registry.resolve("openrouter", { model: "gpt-4o", region: "eu" }))).toBe(
      null,
    );
    expect(codeOf(() => registry.resolve("yandex", { model: "gpt-4o", region: "ru" }))).toBe(
      "PROVIDER_NOT_ALLOWED",
    );
    expect(codeOf(() => registry.resolve("openrouter", { model: "gpt-4o", region: "ru" }))).toBe(
      "REGION_NOT_ALLOWED",
    );

    const noByok = new Registry({
      config: rawConfig({
        providers: [
          {
            id: "installation",
            baseUrl: "https://provider.example/v1",
            models: ["*"],
            regions: ["eu"],
            byok: false,
            keyEnv: "INSTALLATION_KEY",
          },
        ],
      }),
    });
    expect(
      codeOf(() =>
        noByok.resolve("installation", { model: "x", region: "eu", hasHeaderKey: true }),
      ),
    ).toBe("PROVIDER_NOT_ALLOWED");
    expect(
      codeOf(() =>
        noByok.resolve("installation", { model: "x", region: "eu", hasHeaderKey: false }),
      ),
    ).toBe(null);
    expect(noByok.installationKey(noByok.provider("installation"))).toBe("");
  });

  it("keeps the previous configuration when a reload is broken", async () => {
    const dir = await mkdtemp(join(tmpdir(), "remo-gw-registry-"));
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify(rawConfig()), "utf8");
    const errors = [];
    const registry = new Registry({
      path,
      logger: { error: (message) => errors.push(message) },
    });
    registry.load();
    expect(registry.config.providers).toHaveLength(2);

    await writeFile(path, '{"region": "eu", "providers": [}', "utf8");
    const result = registry.reload();
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(ConfigError);
    expect(registry.config.providers.map((provider) => provider.id)).toEqual([
      "openrouter",
      "yandex",
    ]);
    expect(errors[0]).toContain("config reload failed");
  });

  it("validates the shape: region, loopback admin, unique providers and host:port", () => {
    expect(() => validateConfig(rawConfig({ region: "us" }))).toThrow(ConfigError);
    expect(() => validateConfig(rawConfig({ admin: "0.0.0.0:8081" }))).toThrow(ConfigError);
    expect(parseHostPort("[::1]:8081")).toEqual({ host: "::1", port: 8081 });
    expect(() =>
      validateConfig({
        ...rawConfig(),
        providers: [rawConfig().providers[0], rawConfig().providers[0]],
      }),
    ).toThrow(ConfigError);
    expect(() => new Registry({ config: rawConfig() }).resolve(undefined, { model: "x", region: "eu" })).toThrow(
      PolicyError,
    );
  });
});
