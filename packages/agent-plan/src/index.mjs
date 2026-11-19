/**
 * Agent authoring plan: the one contract the server validates and the client applies
 * (ADR-142).
 *
 * Pure data in, pure data out: no Yjs, no React, no database. The server adds board
 * facts and estimates; the client resolves tempIds and writes the plan in one
 * transaction.
 */
export {
  PLAN_LIMITS,
  SELECTION_LIMITS,
  PLANNED_TYPES,
  CONNECTABLE_TYPES,
  PlanError,
  isRecord,
} from "./limits.mjs";
export { USER_STORY_MAP, buildStructurePlan, planBounds } from "./layout.mjs";
export { planFromOperations, validatePlan } from "./plan.mjs";
export { estimatePlan } from "./estimate.mjs";
export {
  TIDY_STRATEGIES,
  TIDY_TYPE_LABELS,
  TIDY_GAP,
  TIDY_PADDING,
  TIDY_TITLE,
  TIDY_MAX_COLUMNS,
  naturalCompare,
  prefixOf,
  classifyByPrefix,
  classifyByType,
  classifyByMeaning,
  resolveStrategy,
  blocksFor,
  buildTidyLayout,
  tidyBounds,
} from "./tidy.mjs";
