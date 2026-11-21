/**
 * The model provider, behind one small interface.
 *
 * v1 speaks the OpenAI-compatible chat-completions shape, which is what OpenRouter and
 * Cerebras expose; the base URL and model come from the environment, so switching
 * provider is configuration, not code. The client never decides what an agent may do —
 * it only turns a prompt into JSON and reports what it cost.
 *
 * When `REMO_AI_GATEWAY_URL` is set the same call goes to the AI gateway (ADR-251 §3):
 * one private address, the only one this client is allowed to reach, and a gateway that
 * cannot be reached fails closed instead of calling a provider directly.
 */

import { randomUUID } from "node:crypto";
import { safeFetch } from "@remo/outbound";

const DEFAULT_TIMEOUT_MS = 60_000;
/** The gateway waits for the provider itself, so its deadline is the provider's plus slack. */
const GATEWAY_TIMEOUT_SLACK_MS = 5_000;

export class AiError extends Error {
  constructor(code, message, status = 0, details = {}) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

/**
 * Gateway mode and its transport settings, read once from the environment.
 *
 * A URL without a token is still gateway mode: `configured` is false and agents report
 * AI unavailable, never a direct call (ADR-251 §3.3).
 */
export function gatewaySettings(env = process.env) {
  const direct = Number(env.REMO_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const directTimeout = Number.isFinite(direct) && direct > 0 ? direct : DEFAULT_TIMEOUT_MS;
  const configured = Number(env.REMO_AI_GATEWAY_TIMEOUT_MS ?? 0);
  return {
    url: String(env.REMO_AI_GATEWAY_URL ?? "")
      .trim()
      .replace(/\/+$/, ""),
    token: String(env.REMO_AI_GATEWAY_TOKEN ?? ""),
    timeoutMs:
      Number.isFinite(configured) && configured > 0
        ? configured
        : directTimeout + GATEWAY_TIMEOUT_SLACK_MS,
    region: String(env.REMO_AI_REGION ?? "").trim(),
  };
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

/** The gateway's refusal, with the code the UI and the journal already speak. */
function gatewayError(response, body) {
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const error = parsed?.error;
  const code = typeof error?.code === "string" ? error.code : "";
  if (code) {
    const details = {};
    if (error.upstreamStatus !== undefined) details.upstreamStatus = error.upstreamStatus;
    if (error.scope !== undefined) details.scope = error.scope;
    if (error.retryAfter !== undefined) details.retryAfter = error.retryAfter;
    return new AiError(code, String(error.message ?? code), response.status, details);
  }
  return new AiError(
    `AI_HTTP_${response.status}`,
    `gateway request failed (${response.status}): ${body.slice(0, 300)}`,
    response.status,
  );
}

/**
 * The provider that answered, from the gateway's answer header.
 *
 * The shared outbound client exposes status but not headers; when a transport has none,
 * the upstream we sent is the honest record of where the call went.
 */
function gatewayProviderOf(response, upstream) {
  const headers = response?.headers;
  const header =
    typeof headers?.get === "function"
      ? headers.get("x-remo-gateway-provider")
      : headers?.["x-remo-gateway-provider"];
  if (header) return String(header);
  return upstream ? String(upstream) : null;
}

export class AiClient {
  constructor({
    apiKey = process.env.REMO_AI_API_KEY ?? "",
    baseUrl = process.env.REMO_AI_BASE_URL ?? "https://openrouter.ai/api/v1",
    model = process.env.REMO_AI_MODEL ?? "",
    timeoutMs = Number(process.env.REMO_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    priceIn = Number(process.env.REMO_AI_PRICE_INPUT_PER_MTOK ?? 0),
    priceOut = Number(process.env.REMO_AI_PRICE_OUTPUT_PER_MTOK ?? 0),
    fetchImpl = safeFetch,
    /**
     * Development escape hatch for VPNs that answer every public host with a fake
     * reserved address (198.18.0.0/15). Never enable it in production: it disables the
     * SSRF guard for the provider request (ADR-109). It has no effect in gateway mode,
     * where the gateway address is the one private host allowed.
     */
    allowPrivate = process.env.REMO_AI_ALLOW_PRIVATE === "1",
    gateway = gatewaySettings(),
    /** Explicit overrides; tests and callers that already parsed the environment use these. */
    gatewayUrl = null,
    gatewayToken = null,
    gatewayTimeoutMs = null,
    region = null,
    log = console,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs =
      Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
        ? Number(timeoutMs)
        : DEFAULT_TIMEOUT_MS;
    this.priceIn = priceIn;
    this.priceOut = priceOut;
    this.fetchImpl = fetchImpl;
    this.allowPrivate = allowPrivate;
    this.gatewayUrl = String(gatewayUrl ?? gateway?.url ?? "")
      .trim()
      .replace(/\/+$/, "");
    this.gatewayToken = String(gatewayToken ?? gateway?.token ?? "");
    const gatewayDeadline = Number(gatewayTimeoutMs ?? gateway?.timeoutMs);
    this.gatewayTimeoutMs =
      Number.isFinite(gatewayDeadline) && gatewayDeadline > 0
        ? gatewayDeadline
        : this.timeoutMs + GATEWAY_TIMEOUT_SLACK_MS;
    this.region = String(region ?? gateway?.region ?? "").trim();
    this.log = log;
  }

  /** Gateway mode is a switch, not a fallback: the URL alone selects it. */
  get gatewayMode() {
    return Boolean(this.gatewayUrl);
  }

  get configured() {
    if (this.gatewayMode) {
      // The provider key may live in the gateway (`keyEnv`); the token is what sync needs.
      return Boolean(this.gatewayUrl && this.gatewayToken && this.model);
    }
    return Boolean(this.apiKey && this.model);
  }

  /** The §3.1 headers; the provider key never leaves the tunnel or reaches a log. */
  gatewayHeaders({ upstream, upstreamKey, orgId, userId, taskId, requestId }) {
    const key = upstreamKey ?? this.apiKey;
    return {
      Authorization: `Bearer ${this.gatewayToken}`,
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      ...(upstream ? { "X-Remo-Upstream": String(upstream) } : {}),
      ...(key ? { "X-Remo-Upstream-Key": String(key) } : {}),
      ...(orgId ? { "X-Remo-Org": String(orgId) } : {}),
      ...(userId ? { "X-Remo-User": String(userId) } : {}),
      ...(taskId ? { "X-Remo-Task": String(taskId) } : {}),
      ...(this.region ? { "X-Remo-Region": this.region } : {}),
    };
  }

  /**
   * One completion, asking for a JSON object.
   *
   * Some gateways reject `response_format` or `usage`; a 400 triggers one retry
   * without those fields rather than failing a task for a provider quirk. Through the
   * gateway that retry happens only when the gateway says `UPSTREAM_ERROR` with
   * `upstreamStatus: 400`.
   */
  async chatJson({
    system,
    user,
    maxTokens,
    temperature = 0.2,
    gateway = null,
  }) {
    if (!this.configured) {
      throw new AiError(
        "AI_NOT_CONFIGURED",
        this.gatewayMode
          ? "set REMO_AI_GATEWAY_TOKEN and REMO_AI_MODEL to let agents call the AI gateway"
          : "set REMO_AI_API_KEY and REMO_AI_MODEL to let agents call a model",
      );
    }

    const messages = [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: user },
    ];
    const viaGateway = this.gatewayMode;

    const attempt = async (extras) => {
      const requestId = randomUUID();
      const timeoutMs = viaGateway ? this.gatewayTimeoutMs : this.timeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchImpl(
          viaGateway
            ? `${this.gatewayUrl}/v1/chat/completions`
            : `${this.baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: viaGateway
              ? this.gatewayHeaders({ ...gateway, requestId })
              : {
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
            // The gateway lives inside the tunnel, so its private address is allowed for
            // this call and this call only (ADR-251 §3.3). A user key or custom URL
            // never gets this flag.
            ...(viaGateway || this.allowPrivate ? { allowPrivate: true } : {}),
          },
        );

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          if (viaGateway) throw gatewayError(response, body);
          throw new AiError(
            `AI_HTTP_${response.status}`,
            `model request failed (${response.status}): ${body.slice(0, 300)}`,
            response.status,
          );
        }
        return { payload: await response.json(), response, requestId };
      } catch (error) {
        if (error instanceof AiError) throw error;
        if (viaGateway) {
          const timedOut =
            controller.signal.aborted ||
            error?.name === "AbortError" ||
            error?.code === "TIMEOUT" ||
            error?.code === "ABORTED";
          throw new AiError(
            "AI_GATEWAY_UNAVAILABLE",
            timedOut
              ? `the AI gateway did not answer within ${timeoutMs} ms`
              : `the AI gateway is unreachable: ${error?.message ?? error}`,
          );
        }
        if (error?.name === "AbortError") {
          throw new AiError("AI_TIMEOUT", `model did not answer within ${this.timeoutMs} ms`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };

    let answer;
    try {
      answer = await attempt({
        response_format: { type: "json_object" },
        usage: { include: true },
      });
    } catch (error) {
      const directRetry = !viaGateway && error instanceof AiError && error.status === 400;
      const gatewayRetry =
        viaGateway &&
        error instanceof AiError &&
        error.code === "UPSTREAM_ERROR" &&
        Number(error.upstreamStatus) === 400;
      if (directRetry || gatewayRetry) {
        answer = await attempt({});
      } else {
        throw error;
      }
    }

    const payload = answer.payload;
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
      requestId: payload?.id ?? (viaGateway ? answer.requestId : null),
      gatewayProvider: viaGateway
        ? gatewayProviderOf(answer.response, gateway?.upstream)
        : null,
      usage: { promptTokens, completionTokens, costUsd, tokens: promptTokens + completionTokens },
    };
  }
}
