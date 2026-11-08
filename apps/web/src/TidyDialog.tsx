import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentPlan, AppliedAgentPlan, TidyStrategy } from "@remo/doc";
import type { Widget } from "@remo/model";
import { Banner, Button, Dialog } from "@remo/ui";
import { AgentPlanPanel } from "./AgentPlanPanel";
import { api, type BoardAgents } from "./api";
import { cameraStore } from "./cameraStore";
import { agentFailureText } from "./agentError";
import { planFailureText } from "./agentPlanText";
import { HelpLink } from "./help/HelpLink";
import { newIdempotencyKey } from "./idempotency";
import { useI18n } from "./i18n";

const STRATEGIES: TidyStrategy[] = ["auto", "prefix", "type", "grid", "meaning"];

/**
 * "Tidy up" as one command (ADR-143).
 *
 * It creates a tidy task for the caller's agent, waits for the proposed plan and hands
 * it to the same preview every plan uses. The strategy is a reading of the selection,
 * not a second layout engine: changing it asks the server to recompute the geometry.
 * Without a provider the deterministic layout still arrives; the dialog never needs a
 * model key, only an agent as the principal that owns the task.
 */
export function TidyDialog({
  open,
  boardId,
  selectionIds,
  widgets,
  canEdit,
  onApplyPlan,
  onClose,
  onOpenAgents,
}: {
  open: boolean;
  boardId: string;
  selectionIds: string[];
  widgets: Widget[];
  canEdit: boolean;
  onApplyPlan: (
    plan: AgentPlan,
    provenance: Widget["agent"],
    options?: { allowedIds?: string[] },
  ) => AppliedAgentPlan;
  onClose: () => void;
  onOpenAgents: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<BoardAgents | null>(null);
  const [agentId, setAgentId] = useState("");
  const [strategy, setStrategy] = useState<TidyStrategy>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  /** A plan the person closed must not reopen on the next poll. */
  const opened = useRef(new Set<string>());
  /** One key per unchanged selection/strategy, reused after a failed request (ADR-155). */
  const pendingKey = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.boardAgents(boardId);
      setData(next);
      setAgentId((current) =>
        next.agents.some((agent) => agent.id === current) ? current : (next.agents[0]?.id ?? ""),
      );
      setError(null);
      return next;
    } catch (failure) {
      setError(agentFailureText(failure, t));
      return null;
    }
  }, [boardId, t]);

  useEffect(() => {
    if (!open) {
      setTaskId(null);
      setPlanTaskId(null);
      setBusy(false);
      setError(null);
      return;
    }
    void load();
  }, [open, load]);

  // The task becomes a plan; the plan becomes a preview. Polling stops as soon as the
  // task leaves queued/running.
  useEffect(() => {
    if (!open || !taskId || planTaskId) return;
    const check = async () => {
      const next = await load();
      const task = next?.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      if (task.status === "awaiting_approval" && !opened.current.has(task.id)) {
        opened.current.add(task.id);
        setPlanTaskId(task.id);
      } else if (task.status === "failed" || task.status === "cancelled") {
        setTaskId(null);
        setBusy(false);
        // The task error is "CODE: detail". The dialog speaks the person's language,
        // so the code is mapped to the same sentence the plan preview uses; the raw
        // English detail never becomes the message.
        const code = String(task.error ?? "").split(":")[0]?.trim() ?? "";
        setError(
          code
            ? planFailureText({ code }, t)
            : agentFailureText(task, t),
        );
      }
    };
    const timer = window.setInterval(() => void check(), 1200);
    void check();
    return () => window.clearInterval(timer);
  }, [open, taskId, planTaskId, load, t]);

  if (!open) return null;

  if (planTaskId) {
    return (
      <AgentPlanPanel
        taskId={planTaskId}
        canEdit={canEdit}
        onApply={onApplyPlan}
        onClose={() => {
          setPlanTaskId(null);
          setTaskId(null);
          onClose();
        }}
        onApplied={() => undefined}
        onShowOnBoard={() => {
          setPlanTaskId(null);
          setTaskId(null);
          onClose();
        }}
      />
    );
  }

  const ready = Boolean(data?.orgEnabled && data.enabled);
  const hasAgent = Boolean(data?.agents.length);
  const selectionCount = selectionIds.length;

  const run = async () => {
    if (!agentId || !selectionCount || busy) return;
    setBusy(true);
    setError(null);
    const camera = cameraStore.get();
    const origin = { x: camera.x, y: camera.y };
    const fingerprint = `${agentId}:${strategy}:${selectionIds.join(",")}:${origin.x}:${origin.y}`;
    if (pendingKey.current?.fingerprint !== fingerprint) {
      pendingKey.current = { fingerprint, key: newIdempotencyKey() };
    }
    const idempotencyKey = pendingKey.current.key;
    try {
      const created = await api.createAgentTask(boardId, {
        agentId,
        intent: t("tidy.intent"),
        skillSlug: "tidy-selection",
        strategy,
        selectionIds,
        origin,
        budget: {
          maxTokens: 4_000,
          maxActions: Math.max(20, selectionCount * 3),
          maxCostUsd: 0.5,
        },
      }, idempotencyKey);
      pendingKey.current = null;
      setTaskId(created.task.id);
    } catch (failure) {
      setError(agentFailureText(failure, t));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("tidy.title")}
      description={t("tidy.body")}
      size="md"
      dismissable={!busy}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("agents.plan.close")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void run()}
            loading={busy}
            disabled={!canEdit || busy || !ready || !hasAgent || selectionCount === 0}
          >
            {busy ? t("tidy.loading") : t("tidy.run")}
          </Button>
        </>
      }
    >
      {error && (
        <Banner tone="danger" title={t("tidy.title")}>
          {error}
        </Banner>
      )}

      <p className="muted">{t("tidy.selection", { objects: selectionCount })}</p>

      <section className="agent-plan-section" aria-label={t("tidy.strategy")}>
        <strong>{t("tidy.strategy")}</strong>
        <div className="tidy-strategy" role="group" aria-label={t("tidy.strategy")}>
          {STRATEGIES.map((option) => (
            <Button
              key={option}
              variant={strategy === option ? "primary" : "secondary"}
              size="compact"
              aria-pressed={strategy === option}
              disabled={busy || !canEdit}
              onClick={() => setStrategy(option)}
            >
              {t(`tidy.strategy.${option}` as "tidy.strategy.auto")}
            </Button>
          ))}
        </div>
        <p className="muted">{t("tidy.strategyHint")}</p>
        <p className="muted">
          <HelpLink topicId="agents.tidy" />
        </p>
      </section>

      {!data ? (
        <p className="muted">{t("agents.loading")}</p>
      ) : !ready ? (
        <Banner tone="warning" title={t("tidy.title")}>
          {t("tidy.agentsOff")}{" "}
          <button type="button" className="link-button" onClick={onOpenAgents}>
            {t("tidy.openAgents")}
          </button>
        </Banner>
      ) : !hasAgent ? (
        <Banner tone="warning" title={t("tidy.title")}>
          {t("tidy.needAgent")}{" "}
          <button type="button" className="link-button" onClick={onOpenAgents}>
            {t("tidy.openAgents")}
          </button>
        </Banner>
      ) : (
        <label className="agent-field">
          <span>{t("agents.choose")}</span>
          <select
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            disabled={busy || !canEdit}
          >
            {data.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </Dialog>
  );
}
