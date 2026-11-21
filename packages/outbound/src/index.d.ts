/**
 * Types for the outbound client (ADR-251 §11).
 *
 * The runtime is `index.mjs`; sync and the gateway import it without a build step.
 */

/** The answer cap in bytes; a larger body is refused instead of buffered. */
export declare const MAX_BODY: number;

/** A refused request, identified by code rather than by a provider message. */
export declare class OutboundError extends Error {
  constructor(code: string, message: string);
  code: string;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export declare function isPrivateHost(hostname: string): boolean;

export declare function resolvePublicAddress(
  hostname: string,
  options?: { allowPrivate?: boolean },
): Promise<ResolvedAddress>;

export declare function assertNotRedirect(status: number): void;

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal | null;
  allowPrivate?: boolean;
  /** A PEM certificate (string or bytes) to trust instead of the system roots. */
  ca?: string | Uint8Array;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  /** The answer headers: lowercase names, one string per name. */
  headers: Record<string, string>;
}

export type RequestImpl = (
  config: Record<string, unknown>,
  onResponse: (response: unknown) => void,
) => unknown;

export declare function safeFetchWith(
  requestImpl: RequestImpl,
  rawUrl: string,
  options?: SafeFetchOptions,
): Promise<SafeFetchResponse>;

export declare function safeFetch(
  rawUrl: string,
  options?: SafeFetchOptions,
): Promise<SafeFetchResponse>;
