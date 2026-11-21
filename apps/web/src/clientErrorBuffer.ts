/**
 * The last client errors, kept for one support request (ADR-250, `spec/support.md` §2.4).
 *
 * A bug report without the error is "it broke". The person cannot reproduce what the
 * console saw, and asking them to open the console is not a product. So the app keeps a
 * small ring of the most recent failures and offers to attach it — only when the person
 * ticks the box, and only into the operator's frame, never to `/api/support/*`.
 *
 * What a record is: the message and when it happened. Not the objects an error carried —
 * a thrown `Request` or a React props object can hold room content, and the buffer exists
 * for a support chat, not for a dump of the document.
 */

export interface ClientError {
  /** One line, trimmed and bounded; an error without a message is named, not serialised. */
  message: string;
  /** Epoch milliseconds: the operator needs the order, not a formatted date. */
  at: number;
}

/** §2.4 names twenty; the number is part of the contract with the widget page. */
export const CLIENT_ERROR_LIMIT = 20;
const MAX_MESSAGE = 300;

let entries: readonly ClientError[] = [];
const listeners = new Set<() => void>();
let installed = false;

/**
 * A message safe to send, from anything a handler may have caught.
 *
 * `event.error` is usually an `Error`; `event.message` is a string. A rejected promise
 * may carry a string, an `Error`, or a value with a `message`. Everything else becomes a
 * name — `[object Object]` tells the operator nothing and serialising the object would
 * defeat the point.
 */
export function clientErrorMessage(raw: unknown): string {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw instanceof Error) text = raw.message || raw.name;
  else if (raw && typeof raw === "object") {
    const message = (raw as { message?: unknown }).message;
    text = typeof message === "string" && message ? message : "unknown error";
  } else if (raw === undefined || raw === null) text = "unknown error";
  else text = String(raw);

  // One line: a React component stack in the middle of an error message would push the
  // twenty records off the operator's screen.
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "unknown error";
  return oneLine.length > MAX_MESSAGE ? `${oneLine.slice(0, MAX_MESSAGE - 1)}…` : oneLine;
}

/** Append one failure; the oldest record leaves when the ring is full. */
export function recordClientError(raw: unknown, at: number = Date.now()): void {
  const next: ClientError = { message: clientErrorMessage(raw), at };
  entries = [...entries, next].slice(-CLIENT_ERROR_LIMIT);
  for (const listener of listeners) listener();
}

/** Newest last, at most `CLIENT_ERROR_LIMIT` records. */
export function recentClientErrors(): readonly ClientError[] {
  return entries;
}

export function subscribeClientErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Used by the sign-out path: one person's errors do not follow the next one. */
export function clearClientErrors(): void {
  if (entries.length === 0) return;
  entries = [];
  for (const listener of listeners) listener();
}

/** The part of a window the buffer needs; a test supplies its own. */
export interface ErrorTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

/**
 * Capture what React never sees: an error in an event handler, a paint, a timer, or a
 * promise nobody awaited. `Contained` calls this once when the module loads, so the ring
 * already has a history by the time the person opens the panel.
 *
 * Installing twice is a no-op: two global handlers would record every error twice.
 */
export function installClientErrors(target: ErrorTarget): () => void {
  if (installed) return () => {};
  installed = true;

  const onError = (event: Event) => {
    // `error` first: `message` is the same text without the stack, and a cross-origin
    // script error has only "Script error." in both.
    const failure = event as ErrorEvent;
    recordClientError(failure.error ?? failure.message);
  };
  const onRejection = (event: Event) => {
    recordClientError((event as PromiseRejectionEvent).reason);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    installed = false;
  };
}
