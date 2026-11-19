import type { AgentPlan, PlanEstimate, TidyStrategy } from "@remo/doc";
import { call } from "./api";

/**
 * The plan routes of ADR-142, beside the task routes they belong to.
 *
 * Kept out of `api.ts` because that file is at the Q4 size ceiling; the rules are the
 * same (`call`, same-origin cookie, no token in JavaScript).
 */

export type AgentPlanStatus = "proposed" | "approved" | "applied" | "rejected";

export interface AgentPlanFile {
  name: string;
  kind: "md" | "txt" | "csv";
  chars: number;
  truncated: boolean;
  truncationCode?: string;
}

export interface AgentPlanSelection {
  /** The selection the plan was built from: the only ids a tidy may move. */
  ids: string[];
  counts: {
    selected: number;
    expanded: number;
    included: number;
    texts: number;
    connectors: number;
    chars: number;
    empty: number;
    duplicates: number;
    frames: number;
    groups: number;
  } | null;
  truncated: boolean;
}

export interface TidyClassification {
  strategy: string | null;
  blocks: Array<{ label: string; ids: string[] }>;
}

export interface AgentTaskPlan {
  task: { id: string; status: string; intent: string; skillSlug: string | null };
  plan: AgentPlan;
  estimate: PlanEstimate;
  status: AgentPlanStatus;
  planId: string;
  proposedAt: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  file: AgentPlanFile | null;
  /** What was read as the source; absent for a task created without a selection. */
  selection?: AgentPlanSelection | null;
  /** Tidy only: the layout the preview is showing and the model's reading. */
  strategy?: TidyStrategy | string | null;
  requestedStrategy?: TidyStrategy | string | null;
  classification?: TidyClassification | null;
  /** Agent identity for provenance; the plan route resolves it from the task. */
  agent: { id: string; name: string };
}

export const agentPlanApi = {
  taskPlan: (taskId: string) =>
    call<AgentTaskPlan>(`/agent-tasks/${encodeURIComponent(taskId)}/plan`),
  approve: (taskId: string) =>
    call<{
      status: AgentPlanStatus;
      planId: string;
      approvedAt?: string | null;
      appliedAt?: string | null;
      replayed?: boolean;
    }>(`/agent-tasks/${encodeURIComponent(taskId)}/plan/approve`, { method: "POST" }),
  reject: (taskId: string, reason?: string) =>
    call<{ status: "rejected"; planId: string; replayed?: boolean }>(
      `/agent-tasks/${encodeURIComponent(taskId)}/plan/reject`,
      { method: "POST", body: reason ? { reason } : {} },
    ),
  applied: (
    taskId: string,
    counts: { objects: number; connectors: number; placements?: number },
  ) =>
    call<{ status: "applied"; planId: string; replayed?: boolean }>(
      `/agent-tasks/${encodeURIComponent(taskId)}/plan/applied`,
      { method: "POST", body: counts },
    ),
  /** Tidy only: recompute the geometry for another strategy, keeping the labels. */
  relayout: (taskId: string, strategy: TidyStrategy) =>
    call<{
      plan: AgentPlan;
      estimate: PlanEstimate;
      status: AgentPlanStatus;
      planId: string;
      strategy: string;
      requestedStrategy: string;
    }>(`/agent-tasks/${encodeURIComponent(taskId)}/plan/relayout`, {
      method: "POST",
      body: { strategy },
    }),
};
