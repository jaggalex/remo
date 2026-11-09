import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AgentThreadDetail, AgentThreadSummary, RoomAgentState } from "./roomAgentApi";
import { formatMoment } from "./format";
import { HelpLink } from "./help/HelpLink";
import { useI18n, type TranslationKey } from "./i18n";

/**
 * The room agent panel (ADR-189).
 *
 * One assigned agent, its task threads and one composer. The agent writes the draft
 * itself; this panel only asks, shows the status and links to the frame. The room stays
 * the place where the team edits and discusses the result.
 */
function errorKey(code: string): TranslationKey {
  if (code === "AI_NOT_CONFIGURED") return "agents.aiNotConfigured";
  if (code.startsWith("AI_")) return "roomAgent.error.provider";
  if (code.startsWith("BUDGET_")) return "roomAgent.error.budget";
  if (code.startsWith("DRAFT_") || code.startsWith("PLAN_")) return "roomAgent.error.invalid";
  if (code === "AGENT_DENIED") return "roomAgent.error.denied";
  return "roomAgent.error.generic";
}

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
  linkedThread,
  selectedIds,
  origin,
  canEdit,
  onClose,
  onShowFrame,
  onUndoFrame,
  onChanged,
  onOpenSettings,
  onFitFrame,
  onTaskQueued,
  hasFrame,
  canUndoFrame,
  userId,
}: {
  open: boolean;
  boardId: string;
  boardTitle: string;
  linkedThread: { frameId: string; thread: AgentThreadSummary } | null;
  selectedIds: string[];
  origin: { x: number; y: number };
  canEdit: boolean;
  onClose: () => void;
  onShowFrame: (frameId: string) => void;
  onUndoFrame: (frameId: string) => void;
  onChanged: () => void;
  onOpenSettings: () => void;
  onFitFrame: (frameId: string) => void;
  onTaskQueued: (taskId: string) => void;
  hasFrame: (frameId: string) => boolean;
  canUndoFrame: (frameId: string) => boolean;
  userId: string | null;
}) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<RoomAgentState | null>(null);
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentThreadDetail | null>(null);
  const [intent, setIntent] = useState("");
  const [kind, setKind] = useState<
    | "process"
    | "delivery-plan"
    | "problem-map"
    | "requirements"
    | "mvp-scoping"
    | "retrospective"
    | "decision"
    | "meeting-actions"
    | "prioritization"
    | "competitors"
    | "architecture-decision"
    | "idea-generation"
  >("process");
  const [assignId, setAssignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const selectedThread = useRef<string | null>(null);
  selectedThread.current = threadId;
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const sending = useRef(false);
  const seenFrames = useRef(new Set<string>());

  const load = useCallback(async () => {
    const [next, list] = await Promise.all([
      api.roomAgent(boardId),
      api.roomAgentThreads(boardId).catch(() => ({ threads: [] as AgentThreadSummary[] })),
    ]);
    setState(next);
    setAssignId((current) => current || next.assigned?.agentId || next.agents[0]?.id || "");
    const visibleThreads = [...list.threads];
    if (linkedThread && !visibleThreads.some((thread) => thread.id === linkedThread.thread.id)) {
      const current = await api.roomAgentThreads(boardId, linkedThread.frameId).catch(() => null);
      if (current?.threads[0]) visibleThreads.push(current.threads[0]);
    }
    setThreads(visibleThreads);
    setThreadId((current) => {
      if (current && visibleThreads.some((thread) => thread.id === current)) return current;
      return visibleThreads[0]?.id ?? null;
    });
  }, [boardId, linkedThread]);

  useEffect(() => {
    if (!linkedThread) return;
    setNewTask(false);
    setIntent("");
    setThreadId(linkedThread.thread.id);
  }, [linkedThread]);

  const loadDetail = useCallback(async (id: string) => {
    const next = await api.roomAgentThread(id);
    if (selectedThread.current !== id) return;
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
      // A delete may remove the selected thread; a missing detail is not a failure.
      if (threadId) await loadDetail(threadId).catch(() => {});
      onChanged();
    } catch (failure) {
      setError((failure as Error)?.message ?? t("roomAgent.failed"));
    } finally {
      setBusy(false);
    }
  };

  const submit = (asClarification: boolean) => {
    const text = intent.trim();
    if (text.length < 3 || sending.current) return;
    const body = {
      intent: text,
      kind,
      sourceIds: selectedIds,
      origin,
      lang: lang === "en" ? ("en" as const) : ("ru" as const),
    };
    const target = asClarification ? threadId : null;
    const fingerprint = JSON.stringify({ target, ...body });
    if (requestKey.current?.fingerprint !== fingerprint) {
      requestKey.current = { fingerprint, key: crypto.randomUUID() };
    }
    const key = requestKey.current.key;
    sending.current = true;
    void run(async () => {
      const created = target
        ? await api.sendRoomAgentMessage(target, body, key)
        : await api.createRoomAgentThread(boardId, body, key);
      onTaskQueued(created.task.id);
      requestKey.current = null;
      setThreadId(created.thread.id);
      setNewTask(false);
      setIntent("");
      setNotice(null);
    }).finally(() => { sending.current = false; });
  };

  const stop = () => {
    if (!currentDetail) return;
    const active = [...currentDetail.messages]
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
  const currentDetail = detail?.thread.id === threadId ? detail : null;
  const canAsk = Boolean(state?.canRequest && canEdit);
  const canClarify = Boolean(canAsk && currentDetail
    && (state?.owner || currentDetail.thread.created_by === userId));
  const canStop = Boolean(state?.owner || (canAsk && currentDetail?.thread.created_by === userId));
  const compose = canAsk && (newTask || !threadId || canClarify);
  const clarify = !newTask && Boolean(threadId);

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
              {t("roomAgent.title")} <HelpLink topicId="agents.room" />
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
        {state?.demo && <p className="muted agent-notice">{t("roomAgent.demo")}</p>}
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
            <span className="room-agent-assignment-actions">
              <button type="button" className="link-button" onClick={onOpenSettings}>
                {t("roomAgent.settings")}
              </button>
              {state.owner && (
                <button
                  type="button"
                  className="link-button"
                  disabled={busy}
                  onClick={() => void run(() => api.assignRoomAgent(boardId, null))}
                >
                  {t("roomAgent.unassign")}
                </button>
              )}
            </span>
          </div>
        )}

        {state?.delegates.length ? (
          <fieldset className="agent-field">
            <legend>{t("roomAgent.delegates")}</legend>
            {state.delegates.map((member) => (
              <label key={member.id}>
                <input
                  type="checkbox"
                  checked={member.enabled}
                  disabled={busy}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void run(() => api.setRoomAgentDelegate(boardId, member.id, enabled));
                  }}
                />
                {member.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        {state?.assigned && !canAsk && !state.publicLink && (
          <p className="muted">{t("roomAgent.readOnly")}</p>
        )}

        <div className="agent-history">
          <div className="room-agent-threads-head">
            <h3 className="muted">{t("roomAgent.threads")}</h3>
            {canAsk && threadId && (
              <button type="button" className="link-button" onClick={() => {
                setIntent("");
                setNewTask(true);
              }}>
                {t("roomAgent.newTask")}
              </button>
            )}
            {state?.owner && threads.length > 0 && (
              <button
                type="button"
                className="link-button danger"
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    return;
                  }
                  setConfirmClear(false);
                  void run(async () => {
                    await api.clearRoomAgentThreads(boardId);
                    setThreadId(null);
                    setDetail(null);
                  });
                }}
              >
                {confirmClear ? t("roomAgent.confirmClear") : t("roomAgent.clearHistory")}
              </button>
            )}
          </div>
          {threads.length === 0 && <p className="muted">{t("roomAgent.empty")}</p>}
          <ul className="room-agent-threads">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className={`room-agent-thread${thread.id === threadId ? " active" : ""}`}
                  onClick={() => {
                    if (thread.id !== threadId || newTask) setIntent("");
                    setNewTask(false);
                    setThreadId(thread.id);
                  }}
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

        {!newTask && currentDetail && (
          <div className="room-agent-thread-body">
            {currentDetail.messages.map((message) => (
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
                {message.status === "error"
                  ? <p>{t(errorKey(message.text))}</p>
                  : message.text && <p>{message.text}</p>}
                {message.frame_ids[0] && !hasFrame(message.frame_ids[0]) && (
                  <p className="muted">{t("roomAgent.frameMissing")}</p>
                )}
                {message.frame_ids[0] && hasFrame(message.frame_ids[0]) && (
                  <div className="agent-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onShowFrame(message.frame_ids[0]!)}
                    >
                      {t("roomAgent.show")}
                    </button>
                    {canEdit && <button
                      type="button"
                      className="link-button"
                      onClick={() => onFitFrame(message.frame_ids[0]!)}
                    >
                      {t("roomAgent.fitFrame")}
                    </button>}
                  </div>
                )}
              </div>
            ))}

            {active && canStop && (
              <div className="agent-actions">
                <button type="button" className="link-button danger" onClick={stop} disabled={busy}>
                  {t("roomAgent.stop")}
                </button>
              </div>
            )}
            {!active && latestFrame?.frame_ids[0] && canUndoFrame(latestFrame.frame_ids[0]) && (
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
            {state?.owner && threadId && (
              <div className="agent-actions">
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => {
                    if (confirmDelete !== threadId) {
                      setConfirmDelete(threadId);
                      return;
                    }
                    setConfirmDelete(null);
                    void run(async () => {
                      await api.deleteRoomAgentThread(threadId);
                      setThreadId(null);
                      setDetail(null);
                    });
                  }}
                >
                  {confirmDelete === threadId
                    ? t("roomAgent.confirmDelete")
                    : t("roomAgent.deleteThread")}
                </button>
              </div>
            )}
          </div>
        )}

        {compose && (
          <form
            className="agent-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit(clarify);
            }}
          >
            <label className="agent-field agent-intent">
              <span>{clarify ? t("roomAgent.clarifyPlaceholder") : t("roomAgent.newTask")}</span>
              <textarea
                value={intent}
                placeholder={t("roomAgent.placeholder")}
                onChange={(event) => {
                  if (!threadId) setNewTask(true);
                  setIntent(event.target.value);
                }}
                rows={3}
                maxLength={2000}
                disabled={busy}
              />
            </label>
            <div className="agent-actions">
              {!clarify && (
                <label className="agent-field">
                  <span>{t("roomAgent.newTask")}</span>
                  <select
                    value={kind}
                    onChange={(event) =>
                      setKind(
                      event.target.value as
                        | "process"
                        | "delivery-plan"
                        | "problem-map"
                        | "requirements"
                        | "mvp-scoping"
                        | "retrospective"
                        | "decision"
                        | "meeting-actions"
                        | "prioritization"
                        | "competitors"
                        | "architecture-decision"
                        | "idea-generation",
                    )
                    }
                    disabled={busy}
                  >
                    <option value="process">{t("roomAgent.process")}</option>
                    <option value="delivery-plan">{t("roomAgent.deliveryPlan")}</option>
                    <option value="requirements">{t("roomAgent.requirements")}</option>
                    <option value="mvp-scoping">{t("roomAgent.mvp")}</option>
                    <option value="retrospective">{t("roomAgent.retrospective")}</option>
                    <option value="decision">{t("roomAgent.decision")}</option>
                    <option value="meeting-actions">{t("roomAgent.meetingActions")}</option>
                    <option value="prioritization">{t("roomAgent.prioritization")}</option>
                    <option value="competitors">{t("roomAgent.competitors")}</option>
                    <option value="architecture-decision">{t("roomAgent.architectureDecision")}</option>
                    <option value="idea-generation">{t("roomAgent.ideas")}</option>
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
                {clarify ? t("roomAgent.send") : t("roomAgent.create")}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
