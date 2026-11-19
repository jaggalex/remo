/**
 * The one fetch boundary between the app and the sync service.
 *
 * Same origin through the dev proxy (`/api` → sync service), cookies included because
 * the session lives in an httpOnly cookie and there is no token for JavaScript to hold
 * (ADR-062). Mutations echo the CSRF cookie; reads do not need to.
 */
import { csrfToken } from "./csrf";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The server's payload, so a refusal can carry the list it is about (409). */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const token = method === "GET" || method === "HEAD" ? null : csrfToken();
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "X-CSRF-Token": token } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiError(
      response.status,
      String(payload.error ?? "REQUEST_FAILED"),
      String(payload.message ?? "request failed"),
      payload,
    );
  }
  return payload as T;
}
