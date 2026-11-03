import { describe, expect, it } from "vitest";
import { AiClient, AiError, extractJson } from "./ai.mjs";

function reply(content, { status = 200, usage = { prompt_tokens: 10, completion_tokens: 5 } } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ model: "test/model", choices: [{ message: { content } }], usage }),
    text: async () => JSON.stringify({ error: "nope" }),
  };
}

describe("extractJson", () => {
  it("accepts plain, fenced and chatty replies", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":1} — done')).toEqual({ a: 1 });
  });

  it("refuses a reply without an object", () => {
    expect(() => extractJson("no json here")).toThrow(AiError);
  });
});

describe("AiClient", () => {
  it("is not configured without a key and a model", () => {
    expect(new AiClient({ apiKey: "", model: "" }).configured).toBe(false);
    expect(new AiClient({ apiKey: "k", model: "m" }).configured).toBe(true);
  });

  it("returns JSON, tokens and a computed cost", async () => {
    const seen = [];
    const client = new AiClient({
      apiKey: "k",
      model: "m",
      priceIn: 1,
      priceOut: 2,
      fetchImpl: async (url, init) => {
        seen.push({ url, body: JSON.parse(init.body) });
        return reply('{"nodes":[]}');
      },
    });
    const result = await client.chatJson({ system: "s", user: "u", maxTokens: 100 });
    expect(result.json).toEqual({ nodes: [] });
    expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 5 });
    // 10/1e6 * $1 + 5/1e6 * $2
    expect(result.usage.costUsd).toBeCloseTo(0.00002, 8);
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(seen[0].body.messages).toHaveLength(2);
    expect(seen[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("retries once without gateway extras on 400", async () => {
    let calls = 0;
    const client = new AiClient({
      apiKey: "k",
      model: "m",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return reply("bad", { status: 400 });
        return reply('{"ok":true}');
      },
    });
    const result = await client.chatJson({ user: "u", maxTokens: 10 });
    expect(calls).toBe(2);
    expect(result.json).toEqual({ ok: true });
  });

  it("reports provider errors instead of swallowing them", async () => {
    const client = new AiClient({
      apiKey: "k",
      model: "m",
      fetchImpl: async () => reply("no", { status: 401 }),
    });
    await expect(client.chatJson({ user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "AI_HTTP_401",
    });
  });

  it("refuses to call without configuration", async () => {
    await expect(
      new AiClient({ apiKey: "", model: "" }).chatJson({ user: "u", maxTokens: 10 }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });
});
