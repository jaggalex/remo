import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AgentThreadDetail, AgentThreadSummary, RoomAgentState, RoomTaskKind } from "./roomAgentApi";
import { formatMoment } from "./format";
import { Button, Dialog, Select, Switch, Textarea } from "@remo/ui";
import { HelpLink } from "./help/HelpLink";
import { useI18n, type TranslationKey } from "./i18n";
import { agentErrorKey } from "./agentError";

/**
 * The room agent panel (ADR-189).
 *
 * One assigned agent, its task threads and one composer. The agent writes the draft
 * itself; this panel only asks, shows the status and links to the frame. The room stays
 * the place where the team edits and discusses the result.
 */
function errorKey(code: string): TranslationKey {
  const gateway = agentErrorKey(code);
  if (gateway) return gateway;
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
  const [kind, setKind] = useState<RoomTaskKind>("process");
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
  /** A thread teaches its kind once; later polling must not overwrite a new choice. */
  const kindThread = useRef<string | null>(null);

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
    // A clarification continues the thread's task, so its kind must survive a reload.
    if (kindThread.current !== id && next.thread.kind) {
      kindThread.current = id;
      setKind(next.thread.kind);
    }
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
    const target = asClarification ? threadId : null;
    // A clarification continues the open conversation, so its kind is the thread's,
    // not whatever the new-task selector happened to show before coming back.
    const threadKind = target
      ? detail?.thread.kind ?? threads.find((thread) => thread.id === target)?.kind ?? kind
      : kind;
    const body = {
      intent: text,
      kind: threadKind,
      sourceIds: selectedIds,
      origin,
      lang: lang === "en" ? ("en" as const) : ("ru" as const),
    };
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
    <Dialog
      title={t("roomAgent.title")}
      description={boardTitle}
      help={<HelpLink topicId="agents.room" />}
      size="md"
      onClose={onClose}
    >
      <section className="agent-dialog room-agent">
        {state?.assigned && (
          <p className="room-agent-assigned">
            <span className="room-agent-badge" title={t("roomAgent.ai")}>
              {state.assigned.name} · {t("roomAgent.ai")}
            </span>
          </p>
        )}

        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="muted agent-notice">{notice}</p>}
        {state?.demo && <p className="muted agent-notice">{t("roomAgent.demo")}</p>}
        {state?.publicLink && <p className="agent-error">{t("roomAgent.publicLink")}</p>}
        {!state?.orgEnabled && <p className="muted">{t("agents.orgOff")}</p>}

        {state && !state.assigned && (
          <div className="agent-enable">
            {state.canAssign ? (
              <div className="agent-form">
                <Select
                  label={t("roomAgent.choose")}
                  options={[
                    ...state.agents.map((agent) => ({ value: agent.id, label: agent.name })),
                  ]}
                  value={assignId}
                  onChange={(event) => setAssignId(event.target.value)}
                  disabled={!state.agents.length || busy}
                />
                <div className="agent-actions">
                  <Button variant="primary"
                    disabled={!assignId || busy}
                    onClick={() => void run(() => api.assignRoomAgent(boardId, assignId))}>
                    {t("roomAgent.assign")}
                  </Button>
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
              <Button variant="ghost" size="compact" onClick={onOpenSettings}>
                {t("roomAgent.settings")}
              </Button>
              {state.owner && (
                <Button variant="ghost" size="compact"
                  disabled={busy}
                  onClick={() => void run(() => api.assignRoomAgent(boardId, null))}>
                  {t("roomAgent.unassign")}
                </Button>
              )}
            </span>
          </div>
        )}

        {state?.delegates.length ? (
          <fieldset className="agent-delegates">
            <legend>{t("roomAgent.delegates")}</legend>
            {state.delegates.map((member) => (
              <Switch
                key={member.id}
                label={member.name}
                checked={member.enabled}
                disabled={busy}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  void run(() => api.setRoomAgentDelegate(boardId, member.id, enabled));
                }}
              />
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
              <Button variant="ghost" size="compact" onClick={() => {
                setIntent("");
                setNewTask(true);
              }}>
                {t("roomAgent.newTask")}
              </Button>
            )}
            {state?.owner && threads.length > 0 && (
              <Button variant="ghost" size="compact"
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
                }}>
                {confirmClear ? t("roomAgent.confirmClear") : t("roomAgent.clearHistory")}
              </Button>
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
                    // Returning to a conversation restores the kind its next task will use.
                    if (thread.kind) {
                      kindThread.current = thread.id;
                      setKind(thread.kind);
                    }
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
                    <Button variant="ghost" size="compact"
                      onClick={() => onShowFrame(message.frame_ids[0]!)}>
                      {t("roomAgent.show")}
                    </Button>
                    {canEdit && <Button variant="ghost" size="compact"
                      onClick={() => onFitFrame(message.frame_ids[0]!)}>
                      {t("roomAgent.fitFrame")}
                    </Button>}
                  </div>
                )}
              </div>
            ))}

            {active && canStop && (
              <div className="agent-actions">
                <Button variant="ghost" size="compact" onClick={stop} disabled={busy}>
                  {t("roomAgent.stop")}
                </Button>
              </div>
            )}
            {!active && latestFrame?.frame_ids[0] && canUndoFrame(latestFrame.frame_ids[0]) && (
              <div className="agent-actions">
                <Button variant="ghost" size="compact"
                  onClick={() => onUndoFrame(latestFrame.frame_ids[0]!)}>
                  {t("roomAgent.undo")}
                </Button>
              </div>
            )}
            {state?.owner && threadId && (
              <div className="agent-actions">
                <Button variant="ghost" size="compact"
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
                  }}>
                  {confirmDelete === threadId
                    ? t("roomAgent.confirmDelete")
                    : t("roomAgent.deleteThread")}
                </Button>
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
            <Textarea
              className="agent-intent"
              label={clarify ? t("roomAgent.clarifyPlaceholder") : t("roomAgent.newTask")}
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
            <div className="agent-actions">
              {!clarify && (
                <Select
                  label={t("roomAgent.newTask")}
                  options={[
                    { value: "process", label: t("roomAgent.process") },
                    { value: "delivery-plan", label: t("roomAgent.deliveryPlan") },
                    { value: "requirements", label: t("roomAgent.requirements") },
                    { value: "mvp-scoping", label: t("roomAgent.mvp") },
                    { value: "retrospective", label: t("roomAgent.retrospective") },
                    { value: "decision", label: t("roomAgent.decision") },
                    { value: "meeting-actions", label: t("roomAgent.meetingActions") },
                    { value: "prioritization", label: t("roomAgent.prioritization") },
                    { value: "competitors", label: t("roomAgent.competitors") },
                    { value: "architecture-decision", label: t("roomAgent.architectureDecision") },
                    { value: "idea-generation", label: t("roomAgent.ideas") },
                    { value: "dependency-mapping", label: t("roomAgent.dependencies") },
                    { value: "user-flow-design", label: t("roomAgent.userFlow") },
                    { value: "architecture-mapping", label: t("roomAgent.architecture") },
                    { value: "problem-map", label: t("roomAgent.problemMap") },
                  ]}
                  value={kind}
                  onChange={(event) => setKind(event.target.value as typeof kind)}
                  disabled={busy}
                />
              )}
              <span className="muted">
                {t("roomAgent.sources", { count: selectedIds.length })}
              </span>
              <Button variant="primary"
                type="submit"
                disabled={busy || intent.trim().length < 3}>
                {clarify ? t("roomAgent.send") : t("roomAgent.create")}
              </Button>
            </div>
          </form>
        )}
      </section>
    </Dialog>
  );
}
