/**
 * The model provider, behind one small interface.
 *
 * v1 speaks the OpenAI-compatible chat-completions shape, which is what OpenRouter and
 * Cerebras expose; the base URL and model come from the environment, so switching
 * provider is configuration, not code. The client never decides what an agent may do —
 * it only turns a prompt into JSON and reports what it cost.
 */

import { safeFetch } from "./outbound.mjs";

export class AiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
  }
}

/** Pull a JSON object out of a reply that may be fenced or chatty. */
export function extractJson(text) {
  if (typeof text !== "string") throw new AiError("AI_EMPTY", "the model returned no text");
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("AI_BAD_JSON", "the model did not return a JSON object");
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch (error) {
    throw new AiError("AI_BAD_JSON", `could not parse the model reply: ${error.message}`);
  }
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("");
  }
  return "";
}

export class AiClient {
  constructor({
    apiKey = process.env.REMO_AI_API_KEY ?? "",
    baseUrl = process.env.REMO_AI_BASE_URL ?? "https://openrouter.ai/api/v1",
    model = process.env.REMO_AI_MODEL ?? "",
    timeoutMs = Number(process.env.REMO_AI_TIMEOUT_MS ?? 60_000),
    priceIn = Number(process.env.REMO_AI_PRICE_INPUT_PER_MTOK ?? 0),
    priceOut = Number(process.env.REMO_AI_PRICE_OUTPUT_PER_MTOK ?? 0),
    fetchImpl = safeFetch,
    /**
     * Development escape hatch for VPNs that answer every public host with a fake
     * reserved address (198.18.0.0/15). Never enable it in production: it disables the
     * SSRF guard for the provider request (ADR-109).
     */
    allowPrivate = process.env.REMO_AI_ALLOW_PRIVATE === "1",
    log = console,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.priceIn = priceIn;
    this.priceOut = priceOut;
    this.fetchImpl = fetchImpl;
    this.allowPrivate = allowPrivate;
    this.log = log;
  }

  get configured() {
    return Boolean(this.apiKey && this.model);
  }

  /**
   * One completion, asking for a JSON object.
   *
   * Some gateways reject `response_format` or `usage`; a 400 triggers one retry
   * without those fields rather than failing a task for a provider quirk.
   */
  async chatJson({ system, user, maxTokens, temperature = 0.2 }) {
    if (!this.configured) {
      throw new AiError(
        "AI_NOT_CONFIGURED",
        "set REMO_AI_API_KEY and REMO_AI_MODEL to let agents call a model",
      );
    }

    const messages = [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: user },
    ];

    const attempt = async (extras) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "remo",
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_tokens: maxTokens,
            temperature,
            ...extras,
          }),
          signal: controller.signal,
          ...(this.allowPrivate ? { allowPrivate: true } : {}),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new AiError(
            `AI_HTTP_${response.status}`,
            `model request failed (${response.status}): ${body.slice(0, 300)}`,
            response.status,
          );
        }
        return await response.json();
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new AiError("AI_TIMEOUT", `model did not answer within ${this.timeoutMs} ms`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };

    let payload;
    try {
      payload = await attempt({
        response_format: { type: "json_object" },
        usage: { include: true },
      });
    } catch (error) {
      if (error instanceof AiError && error.status === 400) {
        payload = await attempt({});
      } else {
        throw error;
      }
    }

    const text = messageText(payload?.choices?.[0]?.message);
    const usage = payload?.usage ?? {};
    const promptTokens = Number(usage.prompt_tokens ?? 0);
    const completionTokens = Number(usage.completion_tokens ?? 0);
    const reportedCost = Number(usage.cost);
    const costUsd = Number.isFinite(reportedCost)
      ? reportedCost
      : (promptTokens / 1_000_000) * this.priceIn +
        (completionTokens / 1_000_000) * this.priceOut;

    return {
      json: extractJson(text),
      text,
      model: payload?.model ?? this.model,
      requestId: payload?.id ?? null,
      usage: { promptTokens, completionTokens, costUsd, tokens: promptTokens + completionTokens },
    };
  }
}
