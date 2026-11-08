import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AgentThreadDetail, AgentThreadSummary, RoomAgentState } from "./roomAgentApi";
import { formatMoment } from "./format";
import { useI18n, type TranslationKey } from "./i18n";

/**
 * The room agent panel (ADR-189).
 *
 * One assigned agent, its task threads and one composer. The agent writes the draft
 * itself; this panel only asks, shows the status and links to the frame. The room stays
 * the place where the team edits and discusses the result.
 */
const STATUS_KEY: Record<string, TranslationKey> = {
  queued: "roomAgent.status.queued",
  running: "roomAgent.status.running",
  ready: "roomAgent.status.ready",
  stopped: "roomAgent.status.stopped",
  error: "roomAgent.status.error",
};

export function RoomAgentPanel({
  open,
  boardId,
  boardTitle,
  selectedIds,
  origin,
  canEdit,
  onClose,
  onShowFrame,
  onUndoFrame,
  onChanged,
}: {
  open: boolean;
  boardId: string;
  boardTitle: string;
  selectedIds: string[];
  origin: { x: number; y: number };
  canEdit: boolean;
  onClose: () => void;
  onShowFrame: (frameId: string) => void;
  onUndoFrame: (frameId: string) => void;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<RoomAgentState | null>(null);
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentThreadDetail | null>(null);
  const [intent, setIntent] = useState("");
  const [kind, setKind] = useState<"process" | "delivery-plan" | "problem-map">("process");
  const [assignId, setAssignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seenFrames = useRef(new Set<string>());

  const load = useCallback(async () => {
    const [next, list] = await Promise.all([
      api.roomAgent(boardId),
      api.roomAgentThreads(boardId).catch(() => ({ threads: [] as AgentThreadSummary[] })),
    ]);
    setState(next);
    setAssignId((current) => current || next.assigned?.agentId || next.agents[0]?.id || "");
    setThreads(list.threads);
    setThreadId((current) => {
      if (current && list.threads.some((thread) => thread.id === current)) return current;
      return list.threads[0]?.id ?? null;
    });
  }, [boardId]);

  const loadDetail = useCallback(async (id: string) => {
    const next = await api.roomAgentThread(id);
    setDetail(next);
    for (const message of next.messages) {
      if (message.role !== "agent" || !message.frame_ids.length) continue;
      const key = message.frame_ids[0];
      if (!key || seenFrames.current.has(key)) continue;
      seenFrames.current.add(key);
      onChanged();
    }
  }, [onChanged]);

  useEffect(() => {
    if (!open) return;
    void load().catch((failure) => setError(failure?.message ?? t("roomAgent.failed")));
  }, [open, load, t]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      void load().catch(() => {});
      if (threadId) void loadDetail(threadId).catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [open, load, loadDetail, threadId]);

  useEffect(() => {
    if (!open || !threadId) {
      setDetail(null);
      return;
    }
    void loadDetail(threadId).catch((failure) =>
      setError(failure?.message ?? t("roomAgent.failed")),
    );
  }, [open, threadId, loadDetail, t]);

  const run = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (message) setNotice(message);
      await load();
      if (threadId) await loadDetail(threadId);
      onChanged();
    } catch (failure) {
      setError((failure as Error)?.message ?? t("roomAgent.failed"));
    } finally {
      setBusy(false);
    }
  };

  const submit = (asClarification: boolean) => {
    const text = intent.trim();
    if (text.length < 3) return;
    const body = {
      intent: text,
      kind,
      sourceIds: selectedIds,
      origin,
      lang: lang === "en" ? ("en" as const) : ("ru" as const),
    };
    void run(async () => {
      if (asClarification && threadId) {
        await api.sendRoomAgentMessage(threadId, body);
      } else {
        const created = await api.createRoomAgentThread(boardId, body);
        setThreadId(created.thread.id);
      }
      setIntent("");
      setNotice(null);
    });
  };

  const stop = () => {
    if (!detail) return;
    const active = [...detail.messages]
      .reverse()
      .find(
        (message) =>
          message.task_id && (message.status === "queued" || message.status === "running"),
      );
    if (!active?.task_id) return;
    void run(() => api.cancelAgentTask(active.task_id!));
  };

  const latestFrame = detail
    ? [...detail.messages].reverse().find((message) => message.frame_ids.length > 0)
    : null;
  const active = detail?.messages.some(
    (message) => message.status === "queued" || message.status === "running",
  );
  const canAsk = Boolean(state?.owner && state.assigned && !state.publicLink && canEdit);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="agent-dialog room-agent"
        role="dialog"
        aria-modal="true"
        aria-label={t("roomAgent.title")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="org-head">
          <div>
            <h2>
              {t("roomAgent.title")}
              {state?.assigned && (
                <span className="room-agent-badge" title={t("roomAgent.ai")}>
                  {state.assigned.name} · {t("roomAgent.ai")}
                </span>
              )}
            </h2>
            <p className="muted">{boardTitle}</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label={t("presentation.close")}>
            ×
          </button>
        </header>

        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="muted agent-notice">{notice}</p>}
        {state?.publicLink && <p className="agent-error">{t("roomAgent.publicLink")}</p>}
        {!state?.orgEnabled && <p className="muted">{t("agents.orgOff")}</p>}

        {state && !state.assigned && (
          <div className="agent-enable">
            {state.canAssign ? (
              <div className="agent-form">
                <label className="agent-field">
                  <span>{t("roomAgent.choose")}</span>
                  <select
                    value={assignId}
                    onChange={(event) => setAssignId(event.target.value)}
                    disabled={!state.agents.length || busy}
                  >
                    {state.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="agent-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!assignId || busy}
                    onClick={() => void run(() => api.assignRoomAgent(boardId, assignId))}
                  >
                    {t("roomAgent.assign")}
                  </button>
                </div>
                {!state.agents.length && <p className="muted">{t("roomAgent.noAgents")}</p>}
              </div>
            ) : (
              <p className="muted">{t("roomAgent.ownerOnly")}</p>
            )}
          </div>
        )}

        {state?.assigned && (
          <div className="room-agent-assignment">
            <span>{t("roomAgent.assigned", { name: state.assigned.name })}</span>
            {state.canAssign && (
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => void run(() => api.assignRoomAgent(boardId, null))}
              >
                {t("roomAgent.unassign")}
              </button>
            )}
          </div>
        )}

        <div className="agent-history">
          <h3 className="muted">{t("roomAgent.threads")}</h3>
          {threads.length === 0 && <p className="muted">{t("roomAgent.empty")}</p>}
          <ul className="room-agent-threads">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className={`room-agent-thread${thread.id === threadId ? " active" : ""}`}
                  onClick={() => setThreadId(thread.id)}
                >
                  <span className="room-agent-thread-title">{thread.title}</span>
                  <span className={`agent-status ${thread.last_status ?? ""}`}>
                    {thread.last_status
                      ? t(STATUS_KEY[thread.last_status] ?? "roomAgent.status.queued")
                      : t("roomAgent.status.queued")}
                  </span>
                  <span className="muted">{formatMoment(thread.updated_at, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {detail && (
          <div className="room-agent-thread-body">
            {detail.messages.map((message) => (
              <div key={message.id} className={`room-agent-message ${message.role}`}>
                <div className="room-agent-message-meta">
                  <strong>
                    {message.role === "agent"
                      ? t("roomAgent.byAgent", { name: message.agent_name ?? state?.assigned?.name ?? t("roomAgent.ai") })
                      : message.role === "user"
                        ? message.author_name || t("roomAgent.title")
                        : t("roomAgent.title")}
                  </strong>
                  {message.status && (
                    <span className={`agent-status ${message.status}`}>
                      {t(STATUS_KEY[message.status] ?? "roomAgent.status.queued")}
                    </span>
                  )}
                  <span className="muted">{formatMoment(message.created_at, lang)}</span>
                </div>
                {message.text && <p>{message.text}</p>}
                {message.frame_ids.length > 0 && (
                  <div className="agent-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onShowFrame(message.frame_ids[0]!)}
                    >
                      {t("roomAgent.show")}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {active && (
              <div className="agent-actions">
                <button type="button" className="link-button danger" onClick={stop} disabled={busy}>
                  {t("roomAgent.stop")}
                </button>
              </div>
            )}
            {!active && latestFrame?.frame_ids[0] && (
              <div className="agent-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onUndoFrame(latestFrame.frame_ids[0]!)}
                >
                  {t("roomAgent.undo")}
                </button>
              </div>
            )}
          </div>
        )}

        {canAsk && (
          <form
            className="agent-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit(Boolean(threadId));
            }}
          >
            <label className="agent-field agent-intent">
              <span>{threadId ? t("roomAgent.clarifyPlaceholder") : t("roomAgent.newTask")}</span>
              <textarea
                value={intent}
                placeholder={t("roomAgent.placeholder")}
                onChange={(event) => setIntent(event.target.value)}
                rows={3}
                maxLength={2000}
                disabled={busy}
              />
            </label>
            <div className="agent-actions">
              {!threadId && (
                <label className="agent-field">
                  <span>{t("roomAgent.newTask")}</span>
                  <select
                    value={kind}
                    onChange={(event) =>
                      setKind(event.target.value as "process" | "delivery-plan" | "problem-map")
                    }
                    disabled={busy}
                  >
                    <option value="process">{t("roomAgent.process")}</option>
                    <option value="delivery-plan">{t("roomAgent.deliveryPlan")}</option>
                    <option value="problem-map">{t("roomAgent.problemMap")}</option>
                  </select>
                </label>
              )}
              <span className="muted">
                {t("roomAgent.sources", { count: selectedIds.length })}
              </span>
              <button
                type="submit"
                className="primary-button"
                disabled={busy || intent.trim().length < 3}
              >
                {threadId ? t("roomAgent.send") : t("roomAgent.create")}
              </button>
            </div>
            {!state?.owner && <p className="muted">{t("roomAgent.readOnly")}</p>}
          </form>
        )}
      </section>
    </div>
  );
}
