import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Icon, IconButton, Input, Popover, Select } from "@remo/ui";
import { api, type OrgSummary, type SessionUser } from "./api";
import {
  boardDirectory,
  setBoardIcon,
  type BoardDirectoryPage,
  type BoardTile,
} from "./boardDirectory";
import { AuthDialog } from "./AuthDialog";
import { BoardDeleteDialog } from "./BoardDeleteDialog";
import { InviteDialog } from "./InviteDialog";
import { NewBoardDialog } from "./NewBoardDialog";
import { OrganisationDialog } from "./OrganisationDialog";
import { SessionsDialog } from "./SessionsDialog";
import { AccountMenu } from "./topbar/AccountMenu";
import { formatDate, formatDateTime } from "./format";
import { loadIdentity, type Identity } from "./identity";
import { useBoardAccess } from "./useBoardAccess";
import { useCursorIdentity } from "./useCursorIdentity";
import { useI18n } from "./i18n";
import { useTheme } from "./useTheme";
import { HelpLink } from "./help/HelpLink";

type Sort = "updated" | "created" | "name" | "author";
const PAGE_SIZE = 24;

const EMOJI = [
  "📋",
  "📌",
  "🎯",
  "🚀",
  "🧭",
  "🗂️",
  "💡",
  "🧩",
  "📊",
  "🛠️",
  "🎨",
  "🧪",
  "📝",
  "🗓️",
  "✅",
  "🔖",
  "🌱",
  "🔥",
  "⚙️",
  "🧠",
];

function readSort(value: string | null): Sort {
  return value === "created" || value === "name" || value === "author" ? value : "updated";
}

/** Page numbers with gaps keep every page reachable without a wall of buttons. */
function pageNumbers(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (const page of pages) {
    const previous = out[out.length - 1];
    if (typeof previous === "number" && page - previous > 1) out.push(null);
    out.push(page);
  }
  return out;
}

/**
 * The organisation home (ADR-168).
 *
 * A board lives in an organisation; without a board in the address this screen is the
 * context: organisation switcher, board tiles, name search, sorting and pagination.
 * Every action is a server decision; the screen only offers what the read model says
 * the person may do.
 */
export function WorkspaceHome({ inviteToken }: { inviteToken: string | null }) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { me, setMe, orgs, refreshOrgs, sessionReady } = useBoardAccess(null);
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const { renameSelf, forgetAccountName } = useCursorIdentity({
    accountName: me?.name,
    setIdentity,
  });

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [sort, setSort] = useState<Sort>(() => readSort(params.get("sort")));
  const [dir, setDir] = useState<"asc" | "desc">(() =>
    params.get("dir") === "asc" ? "asc" : "desc",
  );
  const [page, setPage] = useState(() => Math.max(Number(params.get("page") ?? 1), 1));
  const [trash, setTrash] = useState(() => params.get("trash") === "1");
  const [data, setData] = useState<BoardDirectoryPage | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [accountOpen, setAccountOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BoardTile | null>(null);
  const [emojiBoard, setEmojiBoard] = useState<string | null>(null);

  const requestedSlug = params.get("org");
  const activeOrg: OrgSummary | null =
    orgs.find((org) => org.slug === requestedSlug) ??
    orgs.find((org) => org.kind === "personal") ??
    orgs[0] ??
    null;

  // The address always names the organisation on screen. A missing or stale `org` is
  // replaced without a history entry: it is a repair, not a navigation step.
  useEffect(() => {
    if (!activeOrg || requestedSlug === activeOrg.slug) return;
    const next = new URLSearchParams(window.location.search);
    next.set("org", activeOrg.slug);
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
  }, [activeOrg, requestedSlug]);

  const load = useCallback(async () => {
    if (!me || !activeOrg) {
      setData(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const result = await boardDirectory({
        org: activeOrg.slug,
        q: query.trim() || undefined,
        sort,
        dir,
        page,
        limit: PAGE_SIZE,
        trash,
      });
      setData(result);
      setStatus("idle");
      const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > totalPages) setPage(totalPages);
    } catch (failure) {
      setStatus("error");
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  }, [activeOrg, dir, me, page, query, sort, t, trash]);

  useEffect(() => {
    if (!me || !activeOrg) return;
    const timer = window.setTimeout(() => void load(), query.trim() ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [load, me, activeOrg, query, reloadKey]);

  // Search, sort and page are shareable: the address is the state (ADR-168).
  useEffect(() => {
    if (!activeOrg) return;
    const next = new URLSearchParams(window.location.search);
    next.delete("room");
    next.set("org", activeOrg.slug);
    if (query.trim()) next.set("q", query.trim());
    else next.delete("q");
    if (sort === "updated") next.delete("sort");
    else next.set("sort", sort);
    if (dir === "asc") next.set("dir", "asc");
    else next.delete("dir");
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    if (trash) next.set("trash", "1");
    else next.delete("trash");
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
  }, [activeOrg, dir, page, query, sort, trash]);

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const switchOrg = (slug: string) => {
    // A different organisation is a different context: no board, no stale filters.
    window.location.assign(`${window.location.pathname}?org=${encodeURIComponent(slug)}`);
  };

  const openBoard = (boardId: string) => {
    window.location.assign(`${window.location.pathname}?room=${encodeURIComponent(boardId)}`);
  };

  const openInvitationTarget = async ({ orgId, boardId }: { orgId: string; boardId: string | null }) => {
    const next = new URLSearchParams();
    if (boardId) {
      next.set("room", boardId);
    } else {
      const result = await api.orgs().catch(() => null);
      const org = result?.orgs.find((item) => item.id === orgId);
      if (org) next.set("org", org.slug);
    }
    if (params.has("lang")) next.set("lang", lang);
    window.location.replace(next.size ? `/?${next}` : "/");
  };

  const createdBoard = (boardId: string, template: string, title: string) => {
    const next = new URLSearchParams({ room: boardId });
    if (template) next.set("template", template);
    if (title) next.set("name", title);
    window.location.assign(`${window.location.pathname}?${next.toString()}`);
  };

  const setIcon = async (board: BoardTile, icon: string) => {
    setEmojiBoard(null);
    try {
      const result = await setBoardIcon(board.id, icon);
      setData((current) =>
        current
          ? {
              ...current,
              boards: current.boards.map((row) =>
                row.id === board.id ? { ...row, icon: result.board.icon } : row,
              ),
            }
          : current,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  };

  const restoreBoard = async (board: BoardTile) => {
    try {
      await api.restoreBoard(board.id);
      setReloadKey((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  };

  const removeBoard = async (board: BoardTile) => {
    try {
      await api.deleteBoard(board.id);
      setPendingDelete(null);
      setReloadKey((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  };

  const duplicateBoard = async (board: BoardTile) => {
    try {
      const copy = await api.duplicateBoard(board.id);
      openBoard(copy.board.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  };

  const signOut = async () => {
    try {
      await api.logout();
    } catch {
      // The local state is still dropped: a failed request must not keep the face.
    }
    setMe(null);
    forgetAccountName();
    setAccountOpen(false);
    setOrgOpen(false);
    await refreshOrgs();
    setData(null);
    setStatus("idle");
  };

  const authorOf = (board: BoardTile) => {
    if (!board.createdByName) return t("home.unknownAuthor");
    return board.createdByHandle
      ? `${board.createdByName} @${board.createdByHandle}`
      : board.createdByName;
  };

  const boardTitle = (board: BoardTile) => board.title || t("board.untitled");

  return (
    <div className="home">
      <header className="home-topbar">
        <div className="home-brand">
          <span className="home-mark" aria-hidden="true">
            <img src="/remo-logo.svg" alt="" />
          </span>
          <b>{t("boards.title")}</b>
        </div>

        <div className="home-context">
          {orgs.length > 0 && activeOrg && (
            <>
              <Select
                size="compact"
                label={t("boards.org")}
                value={activeOrg.slug}
                options={orgs.map((org) => ({
                  value: org.slug,
                  label: `${org.kind === "personal" ? `${t("org.personal")} · ` : ""}${org.name}`,
                }))}
                onChange={(event) => switchOrg(event.currentTarget.value)}
              />
              {activeOrg.kind === "personal" && (
                <span className="org-badge personal">{t("org.personal")}</span>
              )}
            </>
          )}
        </div>

        <div className="home-account">
          <AccountMenu
            open={accountOpen}
            onOpen={setAccountOpen}
            name={me?.name ?? identity.name}
            handle={me?.handle ?? ""}
            self={undefined}
            color={identity.color}
            signedIn={Boolean(me)}
            roleLine={null}
            identityName={identity.name}
            onRenameSelf={renameSelf}
            onAccountRenamed={(user: SessionUser) => setMe(user)}
            theme={theme}
            onTheme={setTheme}
            lang={lang}
            onLang={setLang}
            orgName={activeOrg?.name ?? null}
            onOrg={() => {
              setAccountOpen(false);
              setOrgOpen(true);
            }}
            onSessions={() => {
              setAccountOpen(false);
              setSessionsOpen(true);
            }}
            onSignIn={() => {
              setAccountOpen(false);
              setAuthOpen(true);
            }}
            onSignOut={() => void signOut()}
          />
        </div>
      </header>

      {!sessionReady ? (
        <p className="home-state">{t("home.loading")}</p>
      ) : !me ? (
        <section className="home-empty" role="region" aria-label={t("home.signInTitle")}>
          <Icon name="boards" size={36} />
          <h1>{t("home.signInTitle")}</h1>
          <p className="muted">{t("home.signInBody")}</p>
          <Button variant="primary" onClick={() => setAuthOpen(true)}>
            {t("home.signInAction")}
          </Button>
        </section>
      ) : !activeOrg ? (
        <section className="home-empty">
          <Icon name="building" size={36} />
          <h1>{t("org.noOrg")}</h1>
          <p className="muted">{t("home.noOrg")}</p>
          <Button variant="primary" onClick={() => setOrgOpen(true)}>
            {t("org.newOrg")}
          </Button>
        </section>
      ) : (
        <main className="home-content">
          <div className="home-heading">
            <div>
              <h1>
                {activeOrg.name}
                {activeOrg.kind === "personal" && (
                  <span className="org-badge personal">{t("org.personal")}</span>
                )}
                <HelpLink topicId="rooms.home" />
              </h1>
              <p className="muted">
                {total > 0 ? t("home.count", { from, to, total }) : null}
              </p>
              <div className="home-views" role="group" aria-label={t("boards.title")}>
                <Button
                  size="compact"
                  variant="ghost"
                  selected={!trash}
                  onClick={() => {
                    setTrash(false);
                    setPage(1);
                  }}
                >
                  {t("home.boards")}
                </Button>
                <Button
                  size="compact"
                  variant="ghost"
                  selected={trash}
                  onClick={() => {
                    setTrash(true);
                    setPage(1);
                    setQuery("");
                  }}
                >
                  {t("home.trash")}
                </Button>
              </div>
            </div>
            {!trash && (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => setCreating(true)}
                disabled={!activeOrg.capabilities?.includes("board.create")}
              >
                {t("boards.new")}
              </Button>
            )}
          </div>

          <div className="home-toolbar">
            <Input
              type="search"
              className="home-search"
              label={t("home.search")}
              placeholder={t("home.searchPlaceholder")}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setPage(1);
              }}
            />
            <Select
              label={t("home.sort")}
              value={sort}
              options={[
                { value: "updated", label: t("home.updated") },
                { value: "created", label: t("home.created") },
                { value: "name", label: t("home.name") },
                { value: "author", label: t("home.author") },
              ]}
              onChange={(event) => {
                setSort(readSort(event.currentTarget.value));
                setPage(1);
              }}
            />
            <Button
              variant="secondary"
              aria-label={dir === "asc" ? t("home.asc") : t("home.desc")}
              title={dir === "asc" ? t("home.asc") : t("home.desc")}
              onClick={() => {
                setDir((value) => (value === "asc" ? "desc" : "asc"));
                setPage(1);
              }}
            >
              {dir === "asc" ? "↑" : "↓"}
            </Button>
          </div>

          {error && (
            <div className="home-error" role="alert">
              <span>{error}</span>
              <Button size="compact" variant="secondary" onClick={() => setReloadKey((v) => v + 1)}>
                {t("home.retry")}
              </Button>
            </div>
          )}

          {status === "loading" && !data ? (
            <p className="home-state">{t("home.loading")}</p>
          ) : data && data.boards.length === 0 ? (
            <section className="home-empty">
              <Icon name="boards" size={32} />
              <h2>
                {query.trim()
                  ? t("home.noResults", { query: query.trim() })
                  : trash
                    ? t("home.emptyTrash")
                    : t("home.empty")}
              </h2>
              {!query.trim() && !trash && (
                <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                  {t("boards.new")}
                </Button>
              )}
            </section>
          ) : data ? (
            <>
              <ul className="home-tiles">
                {data.boards.map((board) => (
                  <li key={board.id} className="home-tile">
                    <button
                      type="button"
                      className="home-tile-main"
                      onClick={() => openBoard(board.id)}
                      aria-label={`${t("home.open")}: ${boardTitle(board)}`}
                    >
                      <span className="home-tile-icon" aria-hidden="true">
                        {board.icon || <Icon name="boards" size={22} />}
                      </span>
                      <span className="home-tile-title">{boardTitle(board)}</span>
                      <span className="home-tile-team muted">
                        {board.teamName ?? activeOrg.name}
                      </span>
                      <span className="home-tile-author muted">
                        {t("home.by", { name: authorOf(board) })}
                      </span>
                      <span className="home-tile-dates muted">
                        <span>{t("home.createdOn", { date: formatDate(board.createdAt, lang) })}</span>
                        <span>{t("home.updatedOn", { date: formatDateTime(board.updatedAt, lang) })}</span>
                      </span>
                    </button>
                    <div className="home-tile-menu">
                      {trash ? (
                        <Button size="compact" variant="secondary" onClick={() => void restoreBoard(board)}>
                          {t("home.restore")}
                        </Button>
                      ) : (
                        <>
                      <span className="home-emoji-anchor">
                        <IconButton
                          icon="agent"
                          label={t("home.emoji")}
                          size="compact"
                          variant="ghost"
                          onClick={() => setEmojiBoard(emojiBoard === board.id ? null : board.id)}
                        />
                        {emojiBoard === board.id && (
                          <Popover
                            label={t("home.emoji")}
                            width={256}
                            onClose={() => setEmojiBoard(null)}
                          >
                            <div className="home-emoji-grid">
                              <button
                                type="button"
                                className="home-emoji-none"
                                onClick={() => void setIcon(board, "")}
                              >
                                {t("home.noEmoji")}
                              </button>
                              {EMOJI.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  className="home-emoji"
                                  aria-label={emoji}
                                  onClick={() => void setIcon(board, emoji)}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </Popover>
                        )}
                      </span>
                      {board.canDuplicate && (
                        <IconButton
                          icon="copy"
                          label={t("boards.duplicate")}
                          size="compact"
                          variant="ghost"
                          onClick={() => void duplicateBoard(board)}
                        />
                      )}
                      {board.canDelete && (
                        <IconButton
                          icon="trash"
                          label={t("boards.delete")}
                          size="compact"
                          variant="ghost-danger"
                          onClick={() => setPendingDelete(board)}
                        />
                      )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {totalPages > 1 && (
                <nav className="home-pages" aria-label={t("home.page", { page })}>
                  <Button
                    size="compact"
                    variant="secondary"
                    disabled={page <= 1}
                    aria-label={t("home.previousPage")}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    ‹
                  </Button>
                  {pageNumbers(page, totalPages).map((number, index) =>
                    number === null ? (
                      <span key={`gap-${index}`} className="home-page-gap" aria-hidden="true">
                        …
                      </span>
                    ) : (
                      <Button
                        key={number}
                        size="compact"
                        variant={number === page ? "primary" : "secondary"}
                        aria-current={number === page ? "page" : undefined}
                        aria-label={t("home.page", { page: number })}
                        onClick={() => setPage(number)}
                      >
                        {number}
                      </Button>
                    ),
                  )}
                  <Button
                    size="compact"
                    variant="secondary"
                    disabled={page >= totalPages}
                    aria-label={t("home.nextPage")}
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  >
                    ›
                  </Button>
                </nav>
              )}
            </>
          ) : null}
        </main>
      )}

      <NewBoardDialog
        open={creating}
        orgs={orgs}
        defaultOrgId={activeOrg?.id ?? null}
        onClose={() => setCreating(false)}
        onCreated={createdBoard}
      />

      {pendingDelete && (
        <BoardDeleteDialog
          title={boardTitle(pendingDelete)}
          objects={pendingDelete.widgets}
          linkEnabled={pendingDelete.visibility === "link"}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void removeBoard(pendingDelete)}
        />
      )}

      {me && (
        <OrganisationDialog
          open={orgOpen}
          me={me}
          initialOrgId={activeOrg?.id ?? null}
          onOrgsChanged={refreshOrgs}
          onClose={() => setOrgOpen(false)}
          onSignedOut={() => void signOut()}
        />
      )}

      <SessionsDialog
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onCurrentRevoked={() => void signOut()}
      />

      {inviteToken && sessionReady && !authOpen && (
        <InviteDialog
          token={inviteToken}
          signedIn={Boolean(me)}
          onSignIn={() => setAuthOpen(true)}
          onDone={openInvitationTarget}
        />
      )}
      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignedIn={(user) => {
          setMe(user);
          void refreshOrgs();
        }}
      />
    </div>
  );
}
