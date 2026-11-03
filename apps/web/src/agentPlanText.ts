import type { PlanWarning } from "@remo/doc";
import type { TranslationKey } from "./i18n";

/**
 * The plan preview speaks the same codes the server promises.
 *
 * A warning or a refusal is data from an untrusted answer: the interface never shows
 * the model's English message verbatim, it maps the code to one sentence in the
 * person's language. An unknown code keeps the code visible instead of hiding it.
 */

export const PLAN_STATUSES = ["proposed", "approved", "applied", "rejected"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

const STATUS_KEYS: Record<PlanStatus, TranslationKey> = {
  proposed: "agents.planStatus.proposed",
  approved: "agents.planStatus.approved",
  applied: "agents.planStatus.applied",
  rejected: "agents.planStatus.rejected",
};

export function planStatusKey(status: string): TranslationKey {
  return STATUS_KEYS[status as PlanStatus] ?? "agents.planStatus.proposed";
}

export function planStatusName(
  status: string,
  t: (key: TranslationKey) => string,
): string {
  return t(planStatusKey(status));
}

/**
 * A warning that stops the apply instead of asking the person to look (ADR-142, M3).
 *
 * A box outside the allowed coordinates cannot be applied as one gesture; the dialog
 * names the reason and keeps the button disabled. Overlap, an extended lane and a
 * large plan stay readable warnings — a label on a shape is a decision a person may
 * make. `PLAN_TOO_LARGE` is not here on purpose: it is a refusal at validation time,
 * so a plan that big is never stored and never reaches the preview.
 */
export const CRITICAL_WARNING_CODES = Object.freeze(["PLAN_OUT_OF_BOUNDS"]);

export function isCriticalWarning(warning: PlanWarning): boolean {
  return CRITICAL_WARNING_CODES.includes(warning.code);
}

/** One row per finding: the dry run can repeat a warning it received with the plan. */
export function uniqueWarnings(warnings: PlanWarning[]): PlanWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = [
      warning.code,
      warning.tempId ?? "",
      (warning.tempIds ?? []).join(","),
      warning.column ?? "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Warnings are sentences about what a person will see, not about the planner. */
export function warningText(
  warning: PlanWarning,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  switch (warning.code) {
    case "PLAN_LARGE":
      return t("agents.plan.warn.large");
    case "OVERLAP":
      return t("agents.plan.warn.overlap", {
        ids: (warning.tempIds ?? []).join(", ") || warning.tempId || "?",
      });
    case "PLAN_OUT_OF_BOUNDS":
      return t("agents.plan.warn.outOfBounds", { id: warning.tempId ?? "?" });
    case "STORIES_EXCEED_LANES":
      return t("agents.plan.warn.lanes");
    case "EMPTY_COLUMN":
      return t("agents.plan.warn.emptyColumn", { column: warning.column ?? "?" });
    case "WARNINGS_TRUNCATED":
      return t("agents.plan.warn.truncated");
    case "TIDY_LOCKED_SKIPPED":
      return t("tidy.plan.warn.locked", { n: warning.tempIds?.length ?? 1 });
    case "TIDY_CLASSIFICATION_IGNORED":
      return t("tidy.plan.warn.fallback");
    case "TIDY_NOT_SELECTED_FRAME":
      return t("tidy.plan.warn.notSelectedFrame", { n: warning.tempIds?.length ?? 1 });
    case "TIDY_GROUP_EMPTY":
      return t("tidy.plan.warn.groupEmpty");
    case "TIDY_DOES_NOT_FIT":
      return t("tidy.plan.warn.doesNotFit");
    case "TIDY_BLOCKED":
      return t("tidy.plan.warn.blocked");
    case "TIDY_TOO_LARGE":
      return t("tidy.plan.err.tooLarge");
    case "PLAN_TOO_LARGE":
      return t("agents.plan.err.tooLarge");
    default:
      return t("agents.plan.warn.unknown", { code: warning.code });
  }
}

const FAILURE_KEYS: Record<string, TranslationKey> = {
  PLAN_NOT_READY: "agents.plan.err.notReady",
  PLAN_REJECTED: "agents.plan.err.rejected",
  PLAN_ALREADY_APPROVED: "agents.plan.err.alreadyApproved",
  PLAN_NOT_APPROVED: "agents.plan.err.notApproved",
  NOT_APPROVED: "agents.plan.err.notApproved",
  PARENT_NOT_FOUND: "agents.plan.err.parentMissing",
  PARENT_NOT_FRAME: "agents.plan.err.parentNotFrame",
  PARENT_LOCKED: "agents.plan.err.parentLocked",
  CONNECTOR_TARGET_MISSING: "agents.plan.err.connectorMissing",
  CONNECTOR_TARGET_INVALID: "agents.plan.err.connectorInvalid",
  CONNECTOR_TARGET_LOCKED: "agents.plan.err.connectorLocked",
  CONNECTOR_EXISTS: "agents.plan.err.connectorExists",
  PLAN_TOO_LARGE: "agents.plan.err.tooLarge",
  TIDY_TOO_LARGE: "tidy.plan.err.tooLarge",
  TIDY_ONLY: "tidy.plan.err.tidyOnly",
  OBJECT_NOT_ALLOWED: "tidy.plan.err.notAllowed",
  FRAME_NOT_PLACED: "tidy.plan.err.frame",
  CONNECTOR_NOT_PLACED: "tidy.plan.err.connector",
  CARD_NOT_PLACED: "tidy.plan.err.card",
  PLACE_PLANNED: "tidy.plan.err.duplicate",
  DUPLICATE_PLACEMENT: "tidy.plan.err.duplicate",
  TIDY_DOES_NOT_FIT: "tidy.plan.warn.doesNotFit",
  TIDY_BLOCKED: "tidy.plan.warn.blocked",
};

function codeOf(failure: unknown): string {
  return typeof failure === "object" && failure && "code" in failure
    ? String((failure as { code?: unknown }).code ?? "")
    : "";
}

/**
 * A refusal from approve/apply/applied in one sentence.
 *
 * `PLAN_STALE` is the document's own preflight: the plan is valid but the board moved
 * under it while the person was reading. Asking for a new plan is the only honest fix.
 */
export function planFailureText(
  failure: unknown,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const code = codeOf(failure);
  if (code === "PLAN_STALE") return t("agents.plan.err.stale");
  const key = FAILURE_KEYS[code];
  if (key) return t(key);
  const message =
    typeof failure === "object" && failure && "message" in failure
      ? String((failure as { message?: unknown }).message ?? "")
      : "";
  return message || t("agents.plan.err.generic", { code: code || "PLAN_FAILED" });
}
