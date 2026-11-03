/**
 * The two network boundaries, and the rule that bad input is answered rather than fatal.
 *
 * An async HTTP handler that rejects becomes an unhandled promise and can end the
 * process; a `decodeURIComponent` outside a `try` can do the same on one malformed
 * percent sequence. Both boundaries therefore share these small helpers: classify the
 * error, answer 400 for caller input and 500 for everything else, never rethrow.
 */

/** True for an unparsable URL or a malformed percent sequence. */
export function isBadInput(error) {
  return (
    error instanceof URIError ||
    error?.code === "ERR_INVALID_URL" ||
    error?.code === "ERR_INVALID_CHAR"
  );
}

/** The room name in a socket path, or a URIError that the caller turns into 400. */
export function roomFromRequestUrl(rawUrl) {
  const url = new URL(rawUrl, "http://localhost");
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

/**
 * The path segments of a request URL, each percent-decoded exactly once.
 *
 * An id may be non-ASCII, so its wire form is percent-encoded: `%D0%B7…` is
 * `запуск…`. A router that split `url.pathname` and used a segment as an id looked up a
 * different board than the one the client named — the socket and the access check
 * disagreed about the room, and one board became two (ADR-148). Decoding happens here
 * and only here; a handler must not decode a segment a second time, or an id containing
 * `%` would change meaning.
 */
export function pathSegments(url) {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

/** Answer an HTTP failure without ever throwing out of the handler. */
export function failRequest(response, error, log = console) {
  const badInput = isBadInput(error);
  const status = badInput ? 400 : 500;
  log.error?.(`[sync] request failed (${status}):`, error?.message ?? error);
  try {
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: badInput ? "BAD_REQUEST" : "INTERNAL_ERROR",
        message: badInput ? "invalid request" : "request failed",
      }),
    );
  } catch {
    /* the socket is already gone; nothing left to answer */
  }
}

/** Refuse a malformed upgrade before a WebSocket exists. */
export function failUpgrade(socket, error, log = console) {
  if (isBadInput(error)) {
    try {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    } catch {
      /* the peer closed first */
    }
  } else {
    log.error?.("[sync] upgrade failed:", error?.message ?? error);
  }
  socket.destroy();
}
