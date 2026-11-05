import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentPlan, AppliedAgentPlan } from "@remo/doc";
import type { Widget } from "@remo/model";
import { api, type BoardAgents, type ChangeSet } from "./api";
import { AgentFileField } from "./AgentFileField";
import { AgentPlanDialog } from "./AgentPlanDialog";
import type { TaskFile } from "./agentFile";
import { agentFailureText } from "./agentError";
import { selectionPreview } from "./agentPayload";
import { AgentSelectionSource } from "./AgentSelectionSource";
import { AUTO_SKILL, compatibleSkills } from "./agentSkills";
import { skillDescriptionKey } from "./skillText";
import { formatMoment } from "./format";
import { newIdempotencyKey } from "./idempotency";
import { HelpLink } from "./help/HelpLink";
import { useI18n } from "./i18n";

/**
 * Agents on one board: allow them, ask one for a diagram, see what happened.
 *
 * The dialog never talks to the model: it queues a task, the service runs it, and the
 * canvas updates through Yjs like any other edit. Writing is a board decision
 * (`board.manage`), running a task needs `board.edit`.
 */
export function AgentDialog({
  open,
  boardId,
  boardTitle,
  canManage,
  canEdit,
  origin,
  selectionIds,
  widgets,
  onApplyPlan,
  onClose,
  onOpenOrg,
}: {
  open: boolean;
  boardId: string;
  boardTitle: string;
  canManage: boolean;
  canEdit: boolean;
  /** World point at the middle of the current view. */
  origin: { x: number; y: number };
  /** Objects selected on the board: the source for the cards skill and context for diagrams. */
  selectionIds: string[];
  /** The board snapshot, so the dialog can show exactly which fragments leave for the model. */
  widgets: Widget[];
  /** Apply an approved plan to the live document; the app owns the board and selection. */
  onApplyPlan: (
    plan: AgentPlan,
    provenance: Widget["agent"],
    options?: { allowedIds?: string[] },
  ) => AppliedAgentPlan;
  onClose: () => void;
  onOpenOrg: () => void;
}) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<BoardAgents | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [intent, setIntent] = useState("");
  const [maxActions, setMaxActions] = useState(20);
  const [maxCostUsd, setMaxCostUsd] = useState(0.5);
  const [repeat, setRepeat] = useState<"once" | "hourly" | "daily" | "weekly">("once");
  const [skillSlug, setSkillSlug] = useState("");
  const [targetKind, setTargetKind] = useState<"standalone" | "kanban">("standalone");
  const [mode, setMode] = useState<"copy" | "move">("copy");
  const [notice, setNotice] = useState<string | null>(null);
  const [jobPreview, setJobPreview] = useState<{ id: string; cards: number } | null>(null);
  const [changeSets, setChangeSets] = useState<ChangeSet[]>([]);
  const [file, setFile] = useState<TaskFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  /** One key per unchanged draft, reused after a failed request (ADR-155). */
  const pendingKey = useRef<{ fingerprint: string; key: string } | null>(null);
  /**
   * The source the task will carry. The board selection is the default, but it can be
   * removed here without changing what is selected: a person may want the task alone
   * (ADR-143). "Only selection" fills the task from the selection and marks it.
   */
  const [sourceIds, setSourceIds] = useState<string[]>(() => [...selectionIds]);
  const [selectionOnly, setSelectionOnly] = useState(false);
  /** Plans already opened once: polling must not reopen a preview the person closed. */
  const openedPlans = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [next, sets] = await Promise.all([
        api.boardAgents(boardId),
        api.boardChangeSets(boardId).catch(() => ({ changeSets: [] as ChangeSet[] })),
      ]);
      setData(next);
      setChangeSets(sets.changeSets);
      setAgentId((current) =>
        next.agents.some((agent) => agent.id === current) ? current : (next.agents[0]?.id ?? ""),
      );
      setSkillSlug((current) => {
        if (next.skills.some((skill) => skill.slug === current)) return current;
        // The plan skill is the default because "arrange this brief" is the common
        // request and it writes nothing until the person approves. The diagram skill
        // stays in the list for an immediate draw.
        return (
          next.skills.find((skill) => skill.slug === "brief-to-board")?.slug ??
          next.skills.find((skill) => skill.slug === "diagram")?.slug ??
          next.skills[0]?.slug ??
          ""
        );
      });
      setError(null);
    } catch (failure) {
      setError(agentFailureText(failure, t));
    } finally {
      setLoading(false);
    }
  }, [boardId, t]);

  useEffect(() => {
    if (!open) {
      // The plan belongs to the open dialog: reopening must start from the task list,
      // not from a preview the person already left (an applied one would return).
      setPlanTaskId(null);
      return;
    }
    setNotice(null);
    setJobPreview(null);
    setFile(null);
    setFileError(null);
    setSelectionOnly(false);
    setSourceIds([...selectionIds]);
    void load();
  }, [open, load, selectionIds.join(",")]);

  // A finished brief becomes a preview by itself. The person still decides: no plan
  // reaches the board without the Apply button (ADR-142).
  useEffect(() => {
    if (!open || planTaskId) return;
    const ready = (data?.tasks ?? []).find(
      (task) => task.status === "awaiting_approval" && !openedPlans.current.has(task.id),
    );
    if (!ready) return;
    openedPlans.current.add(ready.id);
    setPlanTaskId(ready.id);
  }, [open, data, planTaskId]);

  useEffect(() => {
    setJobPreview(null);
  }, [agentId, skillSlug, targetKind, mode, intent, maxActions, maxCostUsd, sourceIds.join(",")]);

  // Poll while the service is working: the document itself arrives over the socket.
  useEffect(() => {
    if (!open || !data) return;
    const working =
      data.tasks.some((task) => task.status === "queued" || task.status === "running") ||
      changeSets.some((set) => set.status === "queued" || set.status === "running");
    if (!working) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [open, data, changeSets, load]);

  /**
   * Exactly what leaves for the model.
   *
   * The service reads the selection the same way: groups expand, a frame comes whole,
   * the order is top-down, empty and repeated texts are dropped, and the caps are
   * fifty objects and twenty thousand characters (ADR-143). Showing that list before
   * the run is the difference between "we may send something" and a person deciding.
   */
  const preview = useMemo(
    () => selectionPreview(widgets, sourceIds),
    [widgets, sourceIds],
  );

  const hasSelection = sourceIds.length > 0;
  const skills = useMemo(
    () => compatibleSkills(data?.skills ?? [], { hasSelection }),
    [data?.skills, hasSelection],
  );
  const selectedSkill = skills.find((s) => s.slug === skillSlug) ?? null, selectedDescriptionKey = selectedSkill && skillDescriptionKey(selectedSkill.slug);

  // A hidden skill cannot stay chosen: removing the selection must not leave the form
  // pointing at "cards" or "tidy" with nothing to act on.
  useEffect(() => {
    if (!skillSlug) return;
    if (!skills.some((skill) => skill.slug === skillSlug)) setSkillSlug(AUTO_SKILL);
  }, [skillSlug, skills]);

  const isBrief = skillSlug === "brief-to-board" || skillSlug === AUTO_SKILL;
  const snapshotTotal = widgets.length;
  const snapshotSent = Math.min(snapshotTotal, 200);

  // A budget is an agreement, not a default: with no limit there is nothing to agree on.
  const budgetReady = Number.isFinite(maxActions) && maxActions >= 1;

  if (!open) return null;

  if (planTaskId) {
    return (
      <AgentPlanDialog
        taskId={planTaskId}
        canEdit={canEdit}
        widgets={widgets}
        onApply={onApplyPlan}
        onClose={() => setPlanTaskId(null)}
        onShowOnBoard={() => {
          setPlanTaskId(null);
          onClose();
        }}
        onApplied={() => {
          void load();
        }}
      />
    );
  }

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(agentFailureText(failure, t));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!agentId || !intent.trim()) return;
    const budget = { maxActions, maxCostUsd };
    const fingerprint = JSON.stringify({
      agentId,
      intent: intent.trim(),
      skillSlug,
      repeat,
      targetKind,
      mode,
      sourceIds,
      file: file?.name ?? null,
      fileSize: file?.content.length ?? 0,
    });
    if (pendingKey.current?.fingerprint !== fingerprint) {
      pendingKey.current = { fingerprint, key: newIdempotencyKey() };
    }
    const idempotencyKey = pendingKey.current.key;
    void run(async () => {
      if (repeat === "once") {
        if (isCards) {
          if (jobPreview) {
            await api.executeChangeSet(jobPreview.id);
            setJobPreview(null);
            setNotice(t("agents.queued"));
            setIntent("");
          } else {
            const created = await api.createChangeSet(boardId, {
              agentId,
              intent: intent.trim(),
              origin,
              budget,
              preview: true,
              operations: [
                {
                  op: "create_cards",
                  selectionIds: sourceIds,
                  target: { kind: targetKind },
                  mode,
                },
              ],
            }, idempotencyKey);
            pendingKey.current = null;
            const cards = created.changeSet.estimate?.cards ?? 0;
            setJobPreview({ id: created.changeSet.id, cards });
            setNotice(t("agents.previewReady", { n: cards }));
          }
        } else {
          const created = await api.createAgentTask(boardId, {
            agentId,
            intent: intent.trim(),
            skillSlug: skillSlug || undefined,
            origin,
            budget,
            selectionIds: sourceIds,
            target: { kind: targetKind },
            mode,
            ...(isBrief && file
              ? { file: { name: file.name, content: file.content } }
              : {}),
          }, idempotencyKey);
          pendingKey.current = null;
          setNotice(
            created.task.input?.file?.truncated
              ? t("agents.file.truncatedNotice")
              : isBrief
                ? t("agents.queuedPlan")
                : t("agents.queued"),
          );
          setIntent("");
          setFile(null);
          setFileError(null);
        }
      } else {
        const hours = repeat === "hourly" ? 1 : repeat === "daily" ? 24 : 168;
        await api.createAgentSchedule(boardId, {
          agentId,
          intent: intent.trim(),
          intervalSeconds: hours * 3600,
          origin,
          budget,
        });
        pendingKey.current = null;
        setNotice(t("agents.scheduled"));
        setIntent("");
      }
    });
  };

  const ready = data?.orgEnabled && data.enabled;
  const isCards = skillSlug === "cards";
  const cardsBlocked = isCards && !hasSelection;
  const tasks = data?.tasks ?? [];

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="agent-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("agents.dialogTitle")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="org-head">
          <div>
            <h2>
              {t("agents.dialogTitle")} <HelpLink topicId="agents.task" />
            </h2>
            <p className="muted">{boardTitle}</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label={t("agents.close")}>
            ×
          </button>
        </header>

        {error && (
          <div className="agent-error">
            <p className="auth-error">{error}</p>
            <div className="agent-error-actions">
              <button type="button" onClick={() => void load()} disabled={loading}>
                {t("agents.retry")}
              </button>
              <button type="button" onClick={onOpenOrg}>
                {t("agents.configure")}
              </button>
            </div>
          </div>
        )}

        {data && (
          <>
            <div className="agent-enable">
              <label>
                <input
                  type="checkbox"
                  checked={data.enabled}
                  disabled={!canManage || busy}
                  onChange={(event) => {
                    const next = event.target.checked;
                    void run(() => api.setBoardAgents(boardId, next));
                  }}
                />
                {t("agents.boardSwitch")}
              </label>
              {!data.orgEnabled && (
                <p className="muted">
                  {t("agents.orgOff")}{" "}
                  <button type="button" className="link-button" onClick={onOpenOrg}>
                    {t("agents.openOrg")}
                  </button>
                </p>
              )}
            </div>

            {ready && (
              <>
                {data.agents.length === 0 ? (
                  <p className="muted">
                    {t("agents.noneYet")}{" "}
                    <button type="button" className="link-button" onClick={onOpenOrg}>
                      {t("agents.openOrg")}
                    </button>
                  </p>
                ) : (
                  <form
                    className="agent-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit();
                    }}
                  >
                    <label className="agent-field">
                      <span>{t("agents.choose")}</span>
                      <select
                        value={agentId}
                        onChange={(event) => setAgentId(event.target.value)}
                        disabled={!canEdit}
                      >
                        {data.agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <AgentSelectionSource
                      preview={preview}
                      hasSelection={hasSelection}
                      selectionOnly={selectionOnly}
                      onRemove={() => {
                        setSourceIds([]);
                        setSelectionOnly(false);
                      }}
                      onOnly={() => {
                        setIntent(t("agents.source.onlyIntent"));
                        setFile(null);
                        setFileError(null);
                        setSelectionOnly(true);
                      }}
                    />

                    <div className="agent-budget">
                      <div className="agent-field">
                        <span>{t("agents.skill")}</span>
                        <select
                          aria-label={t("agents.skill")}
                          value={skillSlug}
                          onChange={(event) => {
                            setSkillSlug(event.target.value);
                            if (event.target.value === "cards" && sourceIds.length > maxActions) {
                              setMaxActions(Math.min(500, Math.max(20, sourceIds.length)));
                            }
                          }}
                          disabled={!canEdit}
                        >
                          <option value={AUTO_SKILL}>{t("agents.skill.auto")}</option>
                          {skills.map((skill) => (
                            <option key={skill.id} value={skill.slug}>
                              {skill.name}
                            </option>
                          ))}
                        </select>
                        {selectedSkill && (
                          <span className="muted agent-field-hint">
                            {selectedDescriptionKey
                              ? t(selectedDescriptionKey)
                              : selectedSkill.description}
                          </span>
                        )}
                        {skillSlug === AUTO_SKILL && (
                          <span className="muted agent-field-hint">{t("agents.skill.autoHint")}</span>
                        )}
                      </div>
                      {isCards && (
                        <>
                          <label className="agent-field">
                            <span>{t("agents.cardTarget")}</span>
                            <select
                              value={targetKind}
                              onChange={(event) =>
                                setTargetKind(event.target.value as typeof targetKind)
                              }
                              disabled={!canEdit}
                            >
                              <option value="standalone">{t("agents.standalone")}</option>
                              <option value="kanban">{t("agents.kanban")}</option>
                            </select>
                          </label>
                          <label className="agent-field">
                            <span>{t("agents.mode")}</span>
                            <select
                              value={mode}
                              onChange={(event) => setMode(event.target.value as typeof mode)}
                              disabled={!canEdit}
                            >
                              <option value="copy">{t("agents.keep")}</option>
                              <option value="move">{t("agents.move")}</option>
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                    <label className="agent-field agent-intent">
                      <span>{t("agents.intent")}</span>
                      <textarea
                        value={intent}
                        rows={3}
                        maxLength={2000}
                        placeholder={t("agents.intentPlaceholder")}
                        onChange={(event) => {
                          setSelectionOnly(false);
                          setIntent(event.target.value);
                        }}
                        disabled={!canEdit}
                      />
                    </label>

                    {isBrief && (
                      <section className="agent-file-section" aria-label={t("agents.file.attach")}>
                        <strong>{t("agents.file.attach")}</strong>
                        <AgentFileField
                          file={file}
                          onFile={setFile}
                          error={fileError}
                          onError={setFileError}
                          disabled={!canEdit || busy}
                        />
                      </section>
                    )}

                    <section className="agent-payload" aria-label={t("agents.modelInput")}>
                      <strong>
                        {t("agents.modelInput")} <HelpLink topicId="agents.task" />
                      </strong>
                      <p className="muted">
                        {t("agents.modelIntent")}: {intent.trim() || "—"}
                      </p>
                      {hasSelection && (
                        <>
                          <p className="muted">
                            {t("agents.modelSelection", {
                              objects: preview.ids.length,
                              chars: preview.chars,
                            })}
                          </p>
                          {preview.texts.length > 0 ? (
                            <>
                              <ul>
                                {preview.objects
                                  .filter((item) => item.text)
                                  .slice(0, 5)
                                  .map((item) => (
                                    <li key={item.id}>
                                      <span className="muted">{item.type}</span> {item.text}
                                    </li>
                                  ))}
                              </ul>
                              <p className="muted">
                                {t("agents.modelSelectionTexts", { n: preview.texts.length })}
                              </p>
                            </>
                          ) : (
                            <p className="muted">{t("agents.modelSelectionEmpty")}</p>
                          )}
                          <p className="muted">{t("agents.source.untrusted")}</p>
                        </>
                      )}
                      {isCards ? (
                        <p className="muted">{t("agents.modelCards")}</p>
                      ) : isBrief ? (
                        <>
                          {file ? (
                            <p className="muted">
                              {t("agents.modelFile", {
                                name: file.name,
                                kind: file.kind,
                                bytes: file.bytes,
                              })}
                            </p>
                          ) : (
                            <p className="muted">{t("agents.modelNoFile")}</p>
                          )}
                          <p className="muted">
                            {snapshotTotal > snapshotSent
                              ? t("agents.modelSnapshotTruncated", {
                                  sent: snapshotSent,
                                  total: snapshotTotal,
                                })
                              : t("agents.modelSnapshot", { n: snapshotSent })}
                          </p>
                          <p className="muted">{t("agents.modelFileUntrusted")}</p>
                        </>
                      ) : !hasSelection ? (
                        <p className="muted">{t("agents.modelEmpty")}</p>
                      ) : null}
                    </section>

                    <div className="agent-budget">
                      <label className="agent-field">
                        <span>{t("agents.maxActions")}</span>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={maxActions}
                          onChange={(event) => setMaxActions(Number(event.target.value) || 1)}
                          disabled={!canEdit}
                        />
                      </label>
                      <label className="agent-field">
                        <span>{t("agents.maxCost")}</span>
                        <input
                          type="number"
                          min={0}
                          max={5}
                          step={0.01}
                          value={maxCostUsd}
                          onChange={(event) => setMaxCostUsd(Number(event.target.value) || 0)}
                          disabled={!canEdit}
                        />
                      </label>
                      <label className="agent-field">
                        <span>{t("agents.repeat")}</span>
                        <select
                          value={repeat}
                          onChange={(event) => setRepeat(event.target.value as typeof repeat)}
                          disabled={!canEdit}
                        >
                          <option value="once">{t("agents.once")}</option>
                          <option value="hourly">{t("agents.hourly")}</option>
                          <option value="daily">{t("agents.daily")}</option>
                          <option value="weekly">{t("agents.weekly")}</option>
                        </select>
                      </label>
                    </div>
                    {cardsBlocked && <p className="muted">{t("agents.selectForCards")}</p>}
                    {!canEdit && <p className="muted">{t("agents.readOnly")}</p>}
                    {!budgetReady && <p className="auth-error">{t("agents.budgetRequired")}</p>}
                    <div className="agent-actions">
                      <span className="muted">{t("agents.placeHint")}</span>
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={
                          !canEdit ||
                          busy ||
                          !agentId ||
                          !intent.trim() ||
                          cardsBlocked ||
                          !budgetReady ||
                          Boolean(fileError)
                        }
                      >
                        {repeat !== "once"
                          ? t("agents.schedule")
                          : isCards
                            ? jobPreview
                              ? t("agents.runJob")
                              : t("agents.preview")
                            : t("agents.run")}
                      </button>
                    </div>
                  </form>
                )}

                {notice && <p className="muted agent-notice">{notice}</p>}

                {tasks.length > 0 && (
                  <section className="agent-history">
                    <strong>{t("agents.history")}</strong>
                    <ul>
                      {tasks.slice(0, 6).map((task) => (
                        <li key={task.id}>
                          <div>
                            <span className={`agent-status ${task.status}`}>{t(`agents.status.${task.status}` as "agents.status.queued")}</span>
                            <span className="agent-task-intent">{task.intent}</span>
                          </div>
                          <div className="muted">
                            {task.agent_name} · {formatMoment(task.created_at, lang)}
                            {task.error ? ` · ${task.error}` : ""}
                            {task.status === "running" && task.progress?.total
                              ? ` · ${t("agents.progress", {
                                  done: task.progress.done ?? 0,
                                  total: task.progress.total,
                                })}`
                              : ""}
                            {task.status === "applied" && task.usage?.actions
                              ? ` · ${t("agents.changes", { n: task.usage.actions })}`
                              : ""}
                          </div>
                          {(task.skill_slug === "brief-to-board" ||
                            task.skill_slug === "tidy-selection") &&
                            (task.status === "awaiting_approval" || task.status === "applied") && (
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => setPlanTaskId(task.id)}
                              >
                                {t("agents.plan.open")}
                              </button>
                            )}
                          {(task.status === "queued" || task.status === "running") && (
                            <button
                              type="button"
                              className="link-button danger"
                              disabled={busy}
                              onClick={() => void run(() => api.cancelAgentTask(task.id))}
                            >
                              {t("agents.cancel")}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {changeSets.length > 0 && (
                  <section className="agent-history">
                    <strong>
                      {t("agents.changeSets")} <HelpLink topicId="agents.task" />
                    </strong>
                    <ul>
                      {changeSets.slice(0, 6).map((set) => (
                        <li key={set.id}>
                          <div>
                            <span className={`agent-status ${set.status}`}>
                              {t(`agents.changeSetStatus.${set.status}` as "agents.changeSetStatus.draft")}
                            </span>
                            <span className="agent-task-intent">
                              {t("agents.changeSetCards", { n: set.estimate?.cards ?? 0 })}
                            </span>
                          </div>
                          <div className="muted">
                            {set.agent_name ? `${set.agent_name} · ` : ""}
                            {formatMoment(set.created_at, lang)}
                            {set.progress?.total
                              ? ` · ${t("agents.progress", {
                                  done: set.progress.done ?? 0,
                                  total: set.progress.total,
                                })}`
                              : ""}
                            {set.error ? ` · ${set.error}` : ""}
                          </div>
                          {(set.status === "queued" || set.status === "running") && (
                            <button
                              type="button"
                              className="link-button danger"
                              disabled={busy}
                              onClick={() => void run(() => api.cancelChangeSet(set.id))}
                            >
                              {t("agents.stopJob")}
                            </button>
                          )}
                          {(set.status === "failed" || set.status === "cancelled") && (
                            <button
                              type="button"
                              className="link-button"
                              disabled={busy}
                              onClick={() => void run(() => api.resumeChangeSet(set.id))}
                            >
                              {t("agents.resume")}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {(data.schedules ?? []).length > 0 && (
                  <section className="agent-history">
                    <strong>{t("agents.schedules")}</strong>
                    <ul>
                      {data.schedules.map((schedule) => (
                        <li key={schedule.id}>
                          <div>
                            <span className="agent-status queued">{t("agents.scheduled")}</span>
                            <span className="agent-task-intent">{schedule.intent}</span>
                          </div>
                          <div className="muted">
                            {t("agents.nextRun", {
                              date: formatMoment(schedule.next_run_at, lang),
                              every: t("agents.interval", { n: Math.round(schedule.interval_seconds / 3600) }),
                            })}
                          </div>
                          <button
                            type="button"
                            className="link-button danger"
                            disabled={busy}
                            onClick={() => void run(() => api.deleteAgentSchedule(schedule.id))}
                          >
                            {t("agents.stopSchedule")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {loading && !data.tasks.length && <p className="muted">{t("agents.loading")}</p>}
          </>
        )}
      </section>
    </div>
  );
}
