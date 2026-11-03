/**
 * Reading one board over the projection (ADR-016, ADR-064, ADR-096).
 *
 * A claimed board is a resource with an owner: reading it needs the same `board.read` the
 * socket needs. A person reads with a session; an integration reads with a token, and the
 * token narrows — never widens — its owner's access. An unclaimed board keeps the legacy
 * rule until somebody claims it.
 */
import { accessForBoard, linkUnlockToken } from "./iam-api.mjs";
import { callerFromRequest, hasScope } from "./integrations.mjs";

function reply(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function readBoard({ store, request, response, url, boardId }) {
  if (store.getIamBoard) {
    const iam = await store.getIamBoard(boardId);
    if (iam?.owner_id) {
      const caller = await callerFromRequest(request, store);
      if (caller?.kind === "refused") {
        reply(response, 401, { error: caller.reason });
        return;
      }
      if (caller?.kind === "integration" && !hasScope(caller, "board.read")) {
        reply(response, 403, { error: "SCOPE_REQUIRED", scope: "board.read" });
        return;
      }
      const resolved = await accessForBoard({
        store,
        boardId,
        userId: caller?.user?.id ?? null,
        unlockToken: linkUnlockToken(request),
      });
      if (!resolved?.access.allowed) {
        reply(response, resolved?.access.reason === "AUTH_REQUIRED" ? 401 : 404, {
          error: "RESOURCE_NOT_AVAILABLE",
          boardId,
        });
        return;
      }
    }
  }

  const board = await store.getBoard(boardId);
  if (!board) {
    reply(response, 404, { error: "board not found", boardId });
    return;
  }
  const widgets = url.pathname.endsWith("/widgets")
    ? await store.listWidgets(boardId, {
        type: url.searchParams.get("type") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 200),
      })
    : undefined;

  reply(response, 200, widgets ? { board, widgets } : { board });
}
