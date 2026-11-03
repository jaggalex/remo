import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AgentPlan, AppliedAgentPlan, PlanWarning, TidyStrategy } from "@remo/doc";
import type { Widget } from "@remo/model";
import { Badge, Banner, Button, Dialog } from "@remo/ui";
import { AgentPlanMap } from "./AgentPlanMap";
import { AgentPlanObjects } from "./AgentPlanObjects";
import { TidyPlanMap } from "./TidyPlanMap";
import { AgentPlanWarnings } from "./AgentPlanWarnings";
import { agentPlanApi, type AgentTaskPlan } from "./agentPlanApi";
import {
  isCriticalWarning,
  planFailureText,
  planStatusName,
  uniqueWarnings,
} from "./agentPlanText";
import { HelpLink } from "./help/HelpLink";
import { useI18n, type TranslationKey } from "./i18n";

type ApplyPhase = "approve" | "write" | "record";

const PHASE_KEYS: Record<ApplyPhase, TranslationKey> = {
  approve: "agents.plan.phase.approve",
  write: "agents.plan.phase.write",
  record: "agents.plan.phase.record",
};

/**
 * The plan preview: what the agent proposes, before anything reaches the board.
 *
 * Approval, the local transaction and the server's `applied` record happen in this
 * order. The document apply is the only writer; the route call only records that it
 * happened (ADR-142). The person sees the whole shape, every object and every warning,
 * because a plan is read, not trusted. A critical warning keeps the apply disabled;
 * after a successful apply the dialog stays open with the undo hint and a way back to
 * the board, and the Apply button never returns.
 */
const TIDY_STRATEGIES: TidyStrategy[] = ["auto", "grid", "prefix", "type", "meaning"];

export function AgentPlanDialog({
  taskId,
  canEdit,
  widgets,
  onClose,
  onApplied,
  onShowOnBoard,
  onApply,
}: {
  taskId: string;
  canEdit: boolean;
  /** The live board, for the "before" half of a tidy preview. */
  widgets: Widget[];
  onClose: () => void;
  /** The plan changed state; the agents dialog reloads its history. */
  onApplied: () => void;
  /** Leave the preview and the agents dialog, with the created frames selected. */
  onShowOnBoard: () => void;
  onApply: (
    plan: AgentPlan,
    provenance: Widget["agent"],
    options?: { allowedIds?: string[] },
  ) => AppliedAgentPlan;
}) {
  const { t, count } = useI18n();
  const [data, setData] = useState<AgentTaskPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ApplyPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<TidyStrategy>("auto");
  const [relayouting, setRelayouting] = useState(false);
  /** Another tab applied this plan: this dialog shows the result, not a second write. */
  const [appliedElsewhere, setAppliedElsewhere] = useState(false);
  const blockedId = useId();
  const showOnBoardId = useId();
  /** Set once the local transaction succeeded, so a retry never writes twice. */
  const applied = useRef<AppliedAgentPlan | null>(null);
  /** A ref, because two clicks in one tick both read the state before it updates. */
  const running = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await agentPlanApi.taskPlan(taskId));
      setError(null);
    } catch (failure) {
      setError(planFailureText(failure, t));
    } finally {
      setLoading(false);
    }
  }, [taskId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = data?.status ?? "proposed";
  const open = status === "proposed" || status === "approved";
  const isTidy = data?.task.skillSlug === "tidy-selection";
  const objects = data?.plan?.objects ?? [];
  const connectors = data?.plan?.connectors ?? [];
  const estimate = data?.estimate;
  const bounds = estimate?.bounds ?? data?.plan?.bounds ?? null;
  const warnings: PlanWarning[] = useMemo(
    () => uniqueWarnings(estimate?.warnings ?? data?.plan?.warnings ?? []),
    [estimate?.warnings, data?.plan?.warnings],
  );
  const counts = data?.plan?.counts;
  const critical = warnings.filter(isCriticalWarning);
  const emptyPlan =
    objects.length === 0 && connectors.length === 0 && (counts?.placements ?? 0) === 0;
  const beforeWidgets = useMemo(() => {
    const ids = new Set(data?.selection?.ids ?? []);
    return widgets.filter((widget) => ids.has(widget.id));
  }, [data?.selection?.ids, widgets]);

  useEffect(() => {
    if (data?.strategy) setStrategy(data.strategy as TidyStrategy);
  }, [data?.strategy]);

  const changeStrategy = async (next: TidyStrategy) => {
    if (!data || next === strategy || status !== "proposed" || relayouting) return;
    setRelayouting(true);
    setError(null);
    try {
      const laidOut = await agentPlanApi.relayout(taskId, next);
      setStrategy(next);
      setData((current) =>
        current
          ? {
              ...current,
              plan: laidOut.plan,
              estimate: laidOut.estimate,
              strategy: laidOut.strategy,
            }
          : current,
      );
    } catch (failure) {
      setError(planFailureText(failure, t));
    } finally {
      setRelayouting(false);
    }
  };

  const blockedReason = !open
    ? null
    : critical.length
      ? t("agents.plan.blocked")
      : emptyPlan
        ? t("agents.plan.emptyBlocked")
        : !canEdit
          ? t("agents.plan.readOnly")
          : null;

  const mapDescription = isTidy
    ? t("tidy.plan.mapDescription", {
        moves: counts?.placements ?? 0,
        blocks: objects.length,
      })
    : objects.length === 0 && connectors.length === 0
      ? t("agents.plan.map.empty")
      : t("agents.plan.map.description", {
          objects: count("objects", objects.length),
          connectors: count("connectors", connectors.length),
          width: Math.round(bounds?.width ?? 0),
          height: Math.round(bounds?.height ?? 0),
        });

  const apply = async () => {
    if (!data || !open || !canEdit || blockedReason || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setPhase("approve");
    try {
      if (!applied.current) {
        // The server records the person's approval before the document changes, so a
        // crash between the two leaves "approved", not an untraceable write. A plan
        // reopened after approval skips the replay.
        if (status === "proposed") {
          const approval = await agentPlanApi.approve(taskId);
          // Two tabs can hold the same preview. When the other tab has already applied
          // the plan, the server answers `applied`; writing here would duplicate it.
          // The result is shown instead, and this tab offers no undo of a write it
          // never made.
          if (approval.status === "applied") {
            setData((current) =>
              current
                ? {
                    ...current,
                    status: "applied",
                    appliedAt: approval.appliedAt ?? new Date().toISOString(),
                  }
                : current,
            );
            setAppliedElsewhere(true);
            onApplied();
            window.requestAnimationFrame(() => {
              document.getElementById(showOnBoardId)?.focus();
            });
            return;
          }
        }
        setPhase("write");
        applied.current = onApply(
          data.plan,
          {
            id: data.agent.id,
            name: data.agent.name,
            taskId,
            skill: data.task.skillSlug ?? "brief-to-board",
          },
          data.selection?.ids?.length ? { allowedIds: data.selection.ids } : undefined,
        );
      }
      setPhase("record");
      await agentPlanApi.applied(taskId, {
        objects: applied.current.objectIds.length,
        connectors: applied.current.connectorIds.length,
        placements: applied.current.movedIds.length,
      });
      // Stay on the result: the Apply button is gone, and "Show on board" is the
      // next gesture. The parent only reloads its history.
      setData((current) =>
        current
          ? { ...current, status: "applied", appliedAt: new Date().toISOString() }
          : current,
      );
      onApplied();
      // The Apply button is gone; without this the focus falls to the page behind the
      // dialog. "Show on board" is the next action, so it takes the focus.
      window.requestAnimationFrame(() => {
        document.getElementById(showOnBoardId)?.focus();
      });
    } catch (failure) {
      setError(planFailureText(failure, t));
    } finally {
      running.current = false;
      setBusy(false);
      setPhase(null);
    }
  };

  const reject = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await agentPlanApi.reject(taskId);
      onApplied();
      onClose();
    } catch (failure) {
      setError(planFailureText(failure, t));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const footer = !data ? (
    <Button variant="secondary" onClick={onClose} disabled={busy}>
      {t("agents.plan.close")}
    </Button>
  ) : status === "applied" ? (
    <>
      {!appliedElsewhere && (
        <span className="rm-foot-start agent-plan-undo-hint">
          {isTidy ? t("tidy.undoHint") : t("agents.plan.undoHint")}
        </span>
      )}
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        {t("agents.plan.close")}
      </Button>
      <Button variant="primary" id={showOnBoardId} onClick={onShowOnBoard}>
        {t("agents.plan.showOnBoard")}
      </Button>
    </>
  ) : open ? (
    <>
      {phase && (
        <span className="rm-foot-start agent-plan-phase" role="status" aria-live="polite">
          {t(PHASE_KEYS[phase])}
        </span>
      )}
      {canEdit ? (
        <>
          <Button variant="secondary" onClick={() => void reject()} disabled={busy}>
            {t("agents.plan.reject")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            loading={busy}
            disabled={busy || Boolean(blockedReason)}
            aria-describedby={blockedReason ? blockedId : undefined}
          >
            {t("agents.plan.apply")}
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("agents.plan.close")}
        </Button>
      )}
    </>
  ) : (
    <Button variant="secondary" onClick={onClose} disabled={busy}>
      {t("agents.plan.close")}
    </Button>
  );

  return (
    <Dialog
      title={t("agents.plan.title")}
      description={data?.task.intent}
      size="lg"
      dismissable={!busy}
      onClose={busy ? undefined : onClose}
      footer={footer}
    >
      {loading && <p className="muted">{t("agents.plan.loading")}</p>}
      {error && (
        <Banner tone="danger" title={t("agents.plan.failedTitle")}>
          {error}
        </Banner>
      )}

      {data && (
        <div className="agent-plan">
          <div className="agent-plan-summary">
            <Badge tone={status === "rejected" ? "danger" : status === "applied" ? "success" : "accent"}>
              {planStatusName(status, t)}
            </Badge>
            <p className="muted">
              {isTidy
                ? t("tidy.plan.counts", {
                    placements: counts?.placements ?? 0,
                    objects: counts?.objects ?? objects.length,
                    actions: counts?.actions ?? 0,
                  })
                : t("agents.plan.counts", {
                    objects: counts?.objects ?? objects.length,
                    connectors: counts?.connectors ?? connectors.length,
                    actions: counts?.actions ?? objects.length + connectors.length,
                  })}
            </p>
            {bounds && (
              <p className="muted">
                {t("agents.plan.bounds", {
                  width: Math.round(bounds.width),
                  height: Math.round(bounds.height),
                })}
              </p>
            )}
            {isTidy && objects.some((object) => object.title) && (
              <p className="muted">
                {t("tidy.plan.blocks", {
                  labels: objects
                    .map((object) => object.title)
                    .filter(Boolean)
                    .join(", "),
                })}
              </p>
            )}
            <p className="muted">
              <HelpLink topicId={isTidy ? "agents.tidy" : "agents.task"} />
            </p>
          </div>

          {status === "applied" && (
            <Banner
              tone="success"
              title={t(
                appliedElsewhere
                  ? "agents.plan.appliedElsewhereTitle"
                  : isTidy
                    ? "tidy.plan.appliedTitle"
                    : "agents.plan.appliedTitle",
              )}
            >
              {t(
                appliedElsewhere
                  ? "agents.plan.appliedElsewhere"
                  : isTidy
                    ? "tidy.plan.applied"
                    : "agents.plan.applied",
              )}
            </Banner>
          )}
          {status === "rejected" && (
            <Banner tone="warning" title={t("agents.plan.rejectedTitle")}>
              {data.rejectionReason || t("agents.plan.rejected")}
            </Banner>
          )}

          {data.file && (
            <p className="muted agent-plan-file">
              {t("agents.plan.file", {
                name: data.file.name,
                kind: data.file.kind,
                chars: data.file.chars,
              })}
            </p>
          )}
          {data.file?.truncated && (
            <Banner tone="warning" title={t("agents.plan.truncatedTitle")}>
              {t("agents.plan.truncated")}
            </Banner>
          )}
          {data.selection?.truncated && (
            <Banner tone="warning" title={t("agents.plan.selectionTruncatedTitle")}>
              {t("agents.plan.selectionTruncated")}
            </Banner>
          )}

          {isTidy && (
            <section className="agent-plan-section" aria-label={t("tidy.strategy")}>
              <strong>{t("tidy.strategy")}</strong>
              <div className="tidy-strategy" role="group" aria-label={t("tidy.strategy")}>
                {TIDY_STRATEGIES.map((option) => (
                  <Button
                    key={option}
                    variant={strategy === option ? "primary" : "secondary"}
                    size="compact"
                    disabled={!open || !canEdit || relayouting || status !== "proposed"}
                    aria-pressed={strategy === option}
                    onClick={() => void changeStrategy(option)}
                  >
                    {t(`tidy.strategy.${option}` as "tidy.strategy.auto")}
                  </Button>
                ))}
              </div>
              <p className="muted">{t("tidy.strategyHint")}</p>
              {relayouting && (
                <p className="muted" role="status" aria-live="polite">
                  {t("tidy.loading")}
                </p>
              )}
            </section>
          )}

          <section className="agent-plan-section" aria-label={t("agents.plan.map")}>
            <strong>{isTidy ? t("tidy.plan.map") : t("agents.plan.map")}</strong>
            {isTidy ? (
              <TidyPlanMap
                before={beforeWidgets}
                after={widgets}
                plan={data.plan}
                description={mapDescription}
              />
            ) : (
              <AgentPlanMap plan={data.plan} bounds={bounds} description={mapDescription} />
            )}
          </section>

          {open && canEdit && (
            <p className="muted agent-plan-confirm">
              {isTidy
                ? t("tidy.body")
                : t("agents.plan.applyConfirm", {
                    objects: count("objects", objects.length),
                    connectors: count("connectors", connectors.length),
                  })}
            </p>
          )}

          <AgentPlanWarnings warnings={warnings} />

          {blockedReason && open && (
            <p className="agent-plan-blocked" id={blockedId} role="alert">
              {blockedReason}
            </p>
          )}

          <AgentPlanObjects objects={objects} />

          {warnings.length === 0 && (
            <p className="muted agent-plan-ok">{t("agents.plan.noWarnings")}</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
