/**
 * Types for the agent authoring plan (ADR-142).
 *
 * The runtime is `index.mjs`: sync has no build step, so one plain module serves both
 * the server validator and the browser apply path.
 */

export type PlannedObjectType = "sticky_note" | "text" | "shape" | "frame";

/**
 * The style fields a plan may carry. Mirrors `WidgetStyle` in `@remo/model`; the runtime
 * refuses any other key, so this list is the contract rather than a copy of the type.
 */
export interface PlannedStyle {
  fillColor?: string;
  cardTheme?: string;
  strokeColor?: string;
  strokeStyle?: "normal" | "dashed" | "dotted";
  strokeWidth?: number;
  fontSize?: number;
  color?: string;
  textAlign?: "left" | "center" | "right";
  textVAlign?: "top" | "middle" | "bottom";
  stickySize?: "S" | "M" | "L";
  textColor?: string;
}

export interface PlannedObject {
  /** Plan-local id; unique in the plan and never an existing board id. */
  tempId: string;
  type: PlannedObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A tempId or an existing frame id. Frames themselves never have a parent. */
  parentRef?: string;
  title?: string;
  text?: string;
  shapeKind?: "rectangle" | "round_rectangle" | "ellipse" | "diamond" | "triangle";
  style?: PlannedStyle;
}

export interface PlannedConnector {
  tempId?: string;
  /** A tempId or an existing object id. */
  from: string;
  to: string;
  arrow?: "none" | "end" | "both" | "start";
  routing?: "straight" | "elbow" | "curved";
  style?: Pick<PlannedStyle, "strokeColor" | "strokeStyle" | "strokeWidth">;
}

/**
 * Move an existing object to an absolute centre (ADR-143).
 *
 * It carries no style, text or size: a tidy plan never rewrites content. `parentRef`
 * names a frame — one created by the same plan or one already on the board.
 */
export interface PlannedPlacement {
  id: string;
  x: number;
  y: number;
  parentRef?: string;
}

export interface PlanWarning {
  code: string;
  message: string;
  tempId?: string;
  tempIds?: string[];
  column?: number;
  /** A section's title, for a warning that names it (ADR-201). */
  title?: string;
}

export interface PlanCounts {
  objects: number;
  connectors: number;
  /** Existing objects a tidy plan moves. Zero for a creating plan. */
  placements: number;
  actions: number;
  byType: Record<string, number>;
}

export interface PlanBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentPlan {
  version: 1;
  template: string | null;
  origin: { x: number; y: number };
  objects: PlannedObject[];
  connectors: PlannedConnector[];
  /** Existing objects that move; absent or empty in a creating plan (ADR-143). */
  placements?: PlannedPlacement[];
  counts: PlanCounts;
  bounds: PlanBounds;
  warnings: PlanWarning[];
}

export interface PlanEstimate extends PlanCounts {
  bounds: PlanBounds;
  width: number;
  height: number;
  warnings: PlanWarning[];
}

export interface ExistingWidget {
  id: string;
  type: string;
  locked?: boolean;
  parentId?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ExistingConnector {
  from: string;
  to: string;
}

export interface PlanContext {
  origin?: { x: number; y: number };
  existingWidgets?: ExistingWidget[];
  existingConnectors?: ExistingConnector[];
  /** Tidy: the only objects a placement may name (ADR-143). */
  allowedIds?: string[];
  /** A create-only skill passes false; `place_widgets` is then refused (ADR-143). */
  allowPlacements?: boolean;
}

export interface StoryMapColumn {
  title: string;
  stories: string[];
}

export interface StoryMapSwimlane {
  title: string;
  rows?: number;
}

export interface StoryMapContent {
  title?: string;
  columns: StoryMapColumn[];
  swimlanes?: StoryMapSwimlane[];
}

/* ------------------------------------------------------------------ tidy --- */

export type TidyStrategy = "auto" | "grid" | "prefix" | "type" | "meaning";

export interface TidyItem {
  id: string;
  type: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string | null;
  /** The selected frame this item belongs to; no block frame is created inside it. */
  containerId?: string | null;
}

export interface TidyBlockLabel {
  label: string;
  ids: string[];
}

export interface TidyBlock {
  key: string;
  label: string;
  items: TidyItem[];
}

export interface TidyLayoutInput {
  items: TidyItem[];
  strategy?: TidyStrategy;
  labels?: TidyBlockLabel[] | null;
  /** Inner area of the selected frame; contents stay inside it. */
  area?: PlanBounds | null;
  /** Boxes that must stay free: a foreign object is never moved (ADR-143). */
  foreign?: Array<{ x: number; y: number; width: number; height: number }>;
  createBlocks?: boolean;
  origin?: { x: number; y: number };
}

export interface TidyLayout {
  strategy: Exclude<TidyStrategy, "auto">;
  placements: PlannedPlacement[];
  frames: PlannedObject[];
  blocks: TidyBlock[];
  warnings: PlanWarning[];
  bounds: PlanBounds | null;
}

export declare const TIDY_STRATEGIES: readonly TidyStrategy[];
export declare const TIDY_TYPE_LABELS: Readonly<Record<string, string>>;
export declare const TIDY_GAP: number;
export declare const TIDY_PADDING: number;
export declare const TIDY_TITLE: number;
export declare const TIDY_MAX_COLUMNS: number;

export declare function naturalCompare(a: string, b: string): number;
export declare function prefixOf(text: string): { label: string; number: number } | null;
export declare function classifyByPrefix(items: TidyItem[]): TidyBlock[];
export declare function classifyByType(items: TidyItem[]): TidyBlock[];
export declare function classifyByMeaning(
  items: TidyItem[],
  labels: TidyBlockLabel[] | null,
): TidyBlock[];
export declare function resolveStrategy(
  items: TidyItem[],
  strategy?: TidyStrategy,
  labels?: TidyBlockLabel[] | null,
): Exclude<TidyStrategy, "auto">;
export declare function blocksFor(
  items: TidyItem[],
  strategy: Exclude<TidyStrategy, "auto">,
  labels?: TidyBlockLabel[] | null,
): TidyBlock[];
export declare function buildTidyLayout(input: TidyLayoutInput): TidyLayout;
export declare function tidyBounds(
  placements: PlannedPlacement[],
  frames: PlannedObject[],
  sizes: Map<string, { width: number; height: number }>,
): PlanBounds;

export type PlanOperation =
  | { op: "create_widgets"; objects: PlannedObject[] }
  | { op: "place_widgets"; items: PlannedPlacement[] }
  | {
      op: "create_connector";
      tempId?: string;
      from: string;
      to: string;
      arrow?: PlannedConnector["arrow"];
      routing?: PlannedConnector["routing"];
      style?: PlannedConnector["style"];
    }
  | {
      op: "create_structure";
      template: "user-story-map";
      title?: string;
      columns: StoryMapColumn[];
      swimlanes?: StoryMapSwimlane[];
    };

export declare const PLAN_LIMITS: Readonly<{
  operations: number;
  objects: number;
  connectors: number;
  columns: number;
  storiesPerColumn: number;
  swimlanes: number;
  rowsPerSwimlane: number;
  tempIdLength: number;
  idLength: number;
  coordinate: number;
  minSize: number;
  minHeight: number;
  maxSize: number;
  warnObjects: number;
  titleLength: number;
  textLength: number;
}>;

export declare const PLANNED_TYPES: readonly PlannedObjectType[];
export declare const CONNECTABLE_TYPES: readonly string[];

export declare const USER_STORY_MAP: Readonly<{
  pitchX: number;
  pitchY: number;
  stickyWidth: number;
  stickyHeight: number;
  labelBand: number;
  laneRowHeight: number;
  laneGap: number;
  headerHeight: number;
  titleWidth: number;
  titleHeight: number;
  titleGap: number;
  titleFontSize: number;
  columnFontSize: number;
  columnHeaderHeight: number;
  labelWidth: number;
  labelLineHeight: number;
  labelPad: number;
}>;

export declare class PlanError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export declare function planBounds(
  objects: ReadonlyArray<Pick<PlannedObject, "x" | "y" | "width" | "height">>,
): PlanBounds;

export declare function buildStructurePlan(
  templateKey: string,
  content: StoryMapContent,
  origin?: { x: number; y: number },
): AgentPlan;

export declare function planFromOperations(
  operations: PlanOperation[],
  context?: PlanContext,
): AgentPlan;

export declare function validatePlan(plan: unknown, context?: PlanContext): AgentPlan;

export declare function estimatePlan(
  plan: Pick<AgentPlan, "objects" | "connectors" | "warnings">,
): PlanEstimate;
