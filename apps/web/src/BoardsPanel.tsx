import { useCallback, useEffect, useRef, useState } from "react";
import { currentRoom, syncUrl } from "./identity";
import { useI18n } from "./i18n";
import { formatMoment } from "./format";
import { Select } from "@remo/ui";
import { api, type OrgSummary } from "./api";
import { BoardDeleteDialog } from "./BoardDeleteDialog";
import { NewBoardDialog } from "./NewBoardDialog";

export interface BoardSummary {
  id: string;
  /** The organisation that owns the board; null only for a legacy unclaimed room. */
  orgId: string | null;
  title: string | null;
  updated_at: string;
  widgets: number;
  pending_updates: number;
  grants: number;
  visibility: string;
  archivedAt: string | null;
  canDelete: boolean;
  canDuplicate: boolean;
}

export interface SearchHit {
  board_id: string;
  orgId: string | null;
  id: string;
  type: string;
  title: string | null;
  snippet: string | null;
}

/**
 * The read API is served by the sync service; the dev server proxies `/api` to it,
 * so requests stay same-origin and CORS never applies. In production the same path
 * is expected to be proxied (or served from one origin).
 */
function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured) return `${configured}${path}`;
  void syncUrl;
  return `/api${path}`;
}

/**
 * Board list and text search over the Postgres projection.
 *
 * Everything here comes from projected tables, so opening the panel never touches a
 * room and never disturbs the document being edited.
 */
export function BoardsPanel({
  open,
  onClose,
  orgs,
  activeOrgId,
  fallbackOrgId,
  onActiveOrg,
  onOpenBoard,
}: {
  open: boolean;
  onClose: () => void;
  orgs: OrgSummary[];
  /** The directory filter (ADR-166); null means every organisation. */
  activeOrgId: string | null;
  /** The open board's organisation, used when the filter shows every organisation. */
  fallbackOrgId: string | null;
  onActiveOrg: (orgId: string | null) => void;
  onOpenBoard: (boardId: string, widgetId?: string, template?: string, name?: string) => void;
}) {
  const { t, count, lang } = useI18n();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [note, setNote] = useState("");
  const [unreachable, setUnreachable] = useState(false);
  /** The directory needs a session; an anonymous legacy room still opens. */
  const [signedOut, setSignedOut] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BoardSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = currentRoom();

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch(apiUrl(`/boards?room=${encodeURIComponent(active)}`));
      const data = (await response.json()) as { boards?: BoardSummary[]; error?: string };
      if (response.status === 401) {
        setBoards([]);
        setSignedOut(true);
        setStatus("idle");
        return;
      }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setBoards(data.boards ?? []);
      setSignedOut(false);
      setStatus("idle");
      setUnreachable(false);
    } catch (error) {
      setStatus("error");
      setUnreachable(error instanceof Error && /Failed to fetch|NetworkError/.test(error.message));
      setNote(String(error));
    }
  }, [active]);

  useEffect(() => {
    if (!open) return;
    void load();
    // Open ready to type: the panel is reached by a shortcut or one button, and the
    // first thing people do with it is search.
    searchRef.current?.focus();
  }, [load, open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    // Debounced so typing in the search box does not fire a request per keystroke.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          apiUrl(`/search?q=${encodeURIComponent(query.trim())}&room=${encodeURIComponent(active)}`),
        );
        const data = (await response.json()) as { hits?: SearchHit[] };
        setHits(data.hits ?? []);
      } catch {
        setHits([]);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, query, active]);

  const inOrg = (orgId: string | null) => !activeOrgId || orgId === activeOrgId;
  const visibleBoards = boards.filter((board) => inOrg(board.orgId));
  const visibleHits = activeOrgId ? hits.filter((hit) => inOrg(hit.orgId)) : hits;
  const activeBoards = visibleBoards.filter((board) => !board.archivedAt);
  const trashedBoards = visibleBoards.filter((board) => board.archivedAt);
  const titleMatches =
    query.trim().length < 2
      ? []
      : activeBoards.filter((board) => {
          const needle = query.trim().toLowerCase();
          return (board.title ?? board.id).toLowerCase().includes(needle) ||
            board.id.toLowerCase().includes(needle);
        });

  const lifecycle = async (action: () => Promise<unknown>, reload = true) => {
    setBusy(true);
    try {
      await action();
      if (reload) await load();
    } catch (failure) {
      setStatus("error");
      setNote(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <aside className="boards-panel" aria-label={t("boards.title")}>
      <header>
        <b>{t("boards.title")}</b>
        <div className="boards-head-actions">
          {orgs.some((org) => org.capabilities?.includes("board.create")) && (
            <button
              type="button"
              className="boards-new"
              onClick={() => setCreating(true)}
            >
              {t("boards.new")}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={t("boards.close")}>
            ✕
          </button>
        </div>
      </header>

      {orgs.length > 1 && (
        <div className="boards-org">
          <Select
            size="compact"
            label={t("boards.org")}
            value={activeOrgId ?? ""}
            options={[
              { value: "", label: t("boards.allOrgs") },
              ...orgs.map((org) => ({ value: org.id, label: org.name })),
            ]}
            onChange={(event) => {
              onActiveOrg(event.currentTarget.value || null);
              setQuery("");
            }}
          />
        </div>
      )}

      <input
        ref={searchRef}
        className="boards-search"
        value={query}
        placeholder={t("boards.searchPlaceholder")}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t("boards.searchLabel")}
      />

      {query.trim().length < 2 && (
        <p className="muted">{t("boards.searchHint")}</p>
      )}

      {signedOut && <p className="muted">{t("boards.signIn")}</p>}

      {!signedOut && query.trim().length >= 2 && titleMatches.length > 0 && (
        <div className="boards-section">
          <div className="boards-label">
            {t("boards.byTitle", { count: titleMatches.length })}
          </div>
          <ul className="boards-list">
            {titleMatches.map((board) => (
              <li key={board.id}>
                <button type="button" onClick={() => onOpenBoard(board.id)}>
                  <b>{board.title || board.id}</b>
                  <span className="muted">{board.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!signedOut && query.trim().length >= 2 && (
        <div className="boards-section">
          <div className="boards-label">{count("matches", visibleHits.length)}</div>
          <ul className="boards-list">
            {visibleHits.map((hit) => (
              <li key={`${hit.board_id}:${hit.id}`}>
                <button type="button" onClick={() => onOpenBoard(hit.board_id, hit.id)}>
                  <b>{hit.snippet || hit.title || hit.id}</b>
                  <span className="muted">
                    {hit.board_id} · {hit.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!signedOut && (
        <div className="boards-section">
          <div className="boards-label">
            {status === "error"
              ? unreachable
                ? t("boards.unreachable")
                : note
              : t("boards.inStore", { count: activeBoards.length })}
          </div>
          <ul className="boards-list">
            {activeBoards.map((board) => (
              <li key={board.id}>
                <div className="board-row">
                  <button
                    type="button"
                    className={board.id === active ? "active" : undefined}
                    onClick={() => onOpenBoard(board.id)}
                  >
                    <b>{board.title || board.id}</b>
                    <span className="muted">
                      {board.id} · {count("widgets", board.widgets)}
                      {board.grants > 0 ? ` · ${count("grants", board.grants)}` : ""}
                      {board.pending_updates
                        ? ` · ${t("boards.pending", { count: board.pending_updates })}`
                        : ""}
                    </span>
                  </button>
                  <div className="board-actions">
                    {board.canDuplicate && (
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        title={t("boards.duplicateHint")}
                        onClick={() =>
                          void lifecycle(async () => {
                            const copy = await api.duplicateBoard(board.id);
                            onOpenBoard(copy.board.id);
                          })
                        }
                      >
                        {t("boards.duplicate")}
                      </button>
                    )}
                    {board.canDelete && (
                      <button
                        type="button"
                        className="link-button danger"
                        disabled={busy}
                        title={t("boards.delete")}
                        onClick={() => setPendingDelete(board)}
                      >
                        {t("boards.delete")}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!signedOut && trashedBoards.length > 0 && (
        <div className="boards-section">
          <div className="boards-label">{t("boards.trash")}</div>
          <ul className="boards-list">
            {trashedBoards.map((board) => (
              <li key={board.id}>
                <div className="board-row">
                  <span className="board-trash-item">
                    <b>{board.title || board.id}</b>
                    <span className="muted">
                      {t("boards.inTrashUntil", {
                        date: formatMoment(
                          new Date(
                            new Date(board.archivedAt!).getTime() + 90 * 24 * 60 * 60 * 1000,
                          ).toISOString(),
                          lang,
                        ),
                        count: count("objects", board.widgets),
                      })}
                    </span>
                  </span>
                  {board.canDelete && (
                    <div className="board-actions">
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() => void lifecycle(() => api.restoreBoard(board.id))}
                      >
                        {t("boards.restore")}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <NewBoardDialog
        open={creating}
        orgs={orgs}
        defaultOrgId={activeOrgId ?? fallbackOrgId}
        onClose={() => setCreating(false)}
        onCreated={(boardId, template, title) => {
          setCreating(false);
          onOpenBoard(boardId, undefined, template, title);
        }}
      />

      {pendingDelete && (
        <BoardDeleteDialog
          title={pendingDelete.title || pendingDelete.id}
          objects={pendingDelete.widgets}
          linkEnabled={pendingDelete.visibility === "link"}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() =>
            void lifecycle(async () => {
              await api.deleteBoard(pendingDelete.id);
              setPendingDelete(null);
              if (pendingDelete.id === active) window.location.reload();
            })
          }
        />
      )}
    </aside>
  );
}
