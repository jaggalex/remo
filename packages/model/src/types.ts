/**
 * Domain model. Kept free of React and of another product's API shape (see ADR-017).
 */
import { kindOf } from "./kinds";
import type { Tag } from "./tags";
import type { CellPlacement, TableLayout } from "./table";

export type WidgetType =
  | "frame"
  | "sticky_note"
  | "text"
  | "card"
  | "kanban"
  | "connector"
  | "shape"
  | "image"
  | "stamp"
  | "timer"
  | "group"
  | "unsupported";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetStyle {
  fillColor?: string;
  cardTheme?: string;
  strokeColor?: string;
  /** Connector/line stroke: solid, dashed or dotted. */
  strokeStyle?: "normal" | "dashed" | "dotted";
  /** Connector stroke width in canvas units. */
  strokeWidth?: number;
  /**
   * Explicit text size in canvas units.
   *
   * Absent means Auto: the painter fits the text to the box (ADR-027). An explicit
   * size is a deliberate override, so the text may overflow rather than shrink.
   */
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  textAlign?: "left" | "center" | "right";
  textVAlign?: "top" | "middle" | "bottom";
  /** Sticky-note preset; absent is `M`. Changing it resizes the note (ADR-027). */
  stickySize?: StickySize;
  /**
   * Explicit text colour.
   *
   * Absent means "decide from the fill": pale notes get dark text, deep notes get
   * white, so a note can never be painted in a colour that hides its own text
   * (ADR-038). A colour set here is a decision, so it is kept as it is.
   */
  textColor?: string;
}

/** Preset sizes a sticky note can be set to from the toolbar. */
export type StickySize = "S" | "M" | "L";

/** The three states a card can carry (ADR-106 amendment). */
export type CardStatus = "todo" | "in_progress" | "done";

/** A link target: a URL or a widget on the same board (ADR-103). */
export type WidgetLink =
  | { kind: "url"; url: string }
  | { kind: "widget"; widgetId: string };

/** The mutable part of a card record, used by the inspector and the command API. */
export interface CardFields {
  status?: CardStatus;
  assigneeId?: string;
  assigneeName?: string;
  startAt?: string;
  dueAt?: string;
  tagIds?: string[];
}

/** Inline marks a note can carry. Formatting is per character, not per note. */
export interface TextMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

/** A piece of text with one set of marks — what the painter draws. */
export interface TextRun extends TextMarks {
  text: string;
}

/** One operation of a rich-text delta, as Y.XmlText stores it. */
export interface TextDeltaOp {
  insert: string;
  attributes?: TextMarks;
}

/**
 * All coordinates are ABSOLUTE canvas coordinates, centre-anchored.
 * The parent-relative form used by the source board is normalized on import
 * (see spec/templates.json and ADR-001).
 */
export interface Widget extends Rect {
  id: string;
  type: WidgetType;
  parentId: string | null;
  /**
   * Membership in a group.
   *
   * A group is a property of its members, not a container with a box: it has no
   * geometry of its own, so moving or deleting it is moving or deleting the
   * members. One level only — regrouping a selection assigns one new id, it does
   * not nest (ADR-022).
   */
  groupId?: string;
  /**
   * The table layout of a section (ADR-196, ADR-199).
   *
   * Absent means the free layout. Only a frame carries it; the painter, hit-testing,
   * export and backup read it through the same type.
   */
  layout?: TableLayout;
  /**
   * The cell this ordinary object belongs to when its parent frame is a table.
   *
   * World coordinates remain the source of truth; the cell is membership, not a second
   * coordinate system (ADR-199).
   */
  cell?: CellPlacement;
  rotation?: number;
  /**
   * The object's text.
   *
   * A connector's label lives here too: it is the text of the line, edited and
   * stored exactly like the text of a note (ADR-041).
   */
  content?: string;
  title?: string;
  /**
   * Human-readable name for lists, search and presentation (ADR-165).
   *
   * Metadata, not canvas text: the board does not paint it. Optional and deliberately
   * not unique; the id stays the identity.
   */
  name?: string;
  /**
   * Card status (ADR-106 amendment, R1). A field of the card, not the kanban column:
   * a card outside a kanban can still be `todo`, and moving it between columns does
   * not rewrite this value in v1.
   */
  status?: CardStatus;
  /** The person a card is assigned to; the name snapshot keeps the card readable. */
  assigneeId?: string;
  assigneeName?: string;
  /** Calendar dates (`YYYY-MM-DD`), not instants; a card may carry a range. */
  startAt?: string;
  dueAt?: string;
  /** Tags are board-level records (ADR-102); the widget stores ids, not text. */
  tagIds?: string[];
  /** One link on the object: an external URL or another widget on this board. */
  link?: WidgetLink;
  style?: WidgetStyle;
  /**
   * Formatted text, materialized from the shared `Y.XmlText` for painting.
   *
   * Absent when the note has no marks at all, so an ordinary note takes the plain
   * path and its layout is exactly what it was before rich text existed.
   */
  runs?: TextRun[];

  /** Short caption under a sticker, or the title of a vertical lane label. */
  label?: string;

  /** Shape kind, for `type: "shape"`. */
  shapeKind?: ShapeKind;

  /**
   * Connector endpoints: the two objects it joins.
   *
   * Only the references are stored; the line itself is derived from their boxes at
   * render time, exactly like a kanban card's position comes from its cell
   * (ADR-006). A connector whose endpoint disappears is removed with it.
   */
  start?: ConnectorEnd;
  end?: ConnectorEnd;
  /** Which ends carry an arrow head. */
  arrow?: "none" | "end" | "both" | "start";
  /**
   * How the line gets from one end to the other (ADR-077).
   *
   * `straight`, `elbow` and `curved`; rigid waypoints are points along the route,
   * automatic ones are geometry and are never stored.
   */
  routing?: ConnectorRouting;
  /**
   * Rigid waypoints the person placed, in order from start to end.
   *
   * At most `MAX_WAYPOINTS`; an entry with `rigid: false` is a preview/geometry
   * point and is not serialised as user intent.
   */
  waypoints?: ConnectorWaypoint[];
  /**
   * Legacy shape of a connector (ADR-029), read for one release as a fallback.
   *
   * New code writes `routing`; this field is removed after the migration window
   * (ADR-077).
   */
  connectorShape?: ConnectorShape;

  /**
   * Explicit position in the stacking order (ADR-039).
   *
   * Absent means "wherever this type usually goes" (`layerKey` in layers.ts). Set by
   * bring-to-front and friends, and it is what makes the order a decision rather
   * than a side effect of the object's type.
   */
  z?: number;

  /**
   * Locked against moving, resizing, editing and deleting (ADR-040).
   *
   * The object can still be selected — that is how you unlock it — but every
   * gesture that would change it checks this flag first.
   */
  locked?: boolean;
  /**
   * Who locked it (ADR-107). A legacy lock has `locked` and no author: any editor may
   * release it, once, because the document predates the author rule.
   */
  lockedBy?: string;
  /** The author's name at the time, so a refusal can name them without a lookup. */
  lockedByName?: string;
  /** Epoch milliseconds, like `createdAt`. */
  lockedAt?: number;

  /**
   * The shared facilitation timer (ADR-075).
   *
   * Only a `timer` widget carries it. `endsAt` is server UTC and is the single source
   * of truth for every client, including somebody who joined late; `remainingMs` is
   * the paused value. "Expired" is derived, never stored, so a countdown cannot get
   * stuck saying it is still running.
   */
  timer?: TimerState;

  /** Who created the object, and when. Shown in its Info panel (ADR-046). */
  createdBy?: string;
  createdAt?: number;

  /**
   * The AI agent that created or changed this object, and under which task.
   *
   * Provenance is part of the object, not a side table: the person reading the board
   * sees that a machine made this, for whom, and with which skill
   * (spec/AI-agents-v1.md §9).
   */
  agent?: { id: string; name: string; taskId: string | null; skill: string };

  /**
   * Where a connector's label sits on its line (ADR-043).
   *
   * `t` runs from 0 at the start to 1 at the end; `offset` is a perpendicular nudge
   * in canvas units. Absent means the middle of the line. The pair is stored instead
   * of a point, so the label keeps its place when either end moves.
   */
  labelAt?: { t?: number; offset?: number };

  /**
   * Where an elbow's middle run sits between the two stubs (0…1, default 0.5).
   *
   * Dragging the straight part of an elbow writes this, which is the cheap half of
   * "reshape the line": the route stays orthogonal, only its corner moves (ADR-044).
   */
  bend?: number;

  /**
   * Which corner an elbow turns on when its two ends leave on different axes.
   *
   * The two possible corners are equally valid; this is the one the person chose by
   * dragging the corner handle (ADR-044).
   */
  elbowFlip?: boolean;

  /**
   * Control-point lengths of a curved connector, measured out of each side.
   *
   * Absent means the default bulge (42% of the distance, at least 60). Dragging the
   * two blue handles writes these, so the curve can be made shallow or deep instead
   * of being whatever the endpoint distance happened to imply (ADR-044).
   */
  curve?: { from: number; to: number };
}

/** State of the shared timer (ADR-075). */
export interface TimerState {
  /** What the facilitator chose, kept so Reset returns to it and progress can be drawn. */
  durationMs: number;
  /** UTC end of the countdown; null while idle or paused. */
  endsAt: string | null;
  /** Milliseconds left when paused; null while running or idle. */
  remainingMs: number | null;
  /** Running and paused are stored; idle means nothing has been started; expired is derived. */
  state: "idle" | "running" | "paused";
  /** Who last started, paused, extended or reset it. */
  setBy: string;
  setById?: string;
}

/** Side of a widget a connector is attached to. */
export type ConnectorSide = "left" | "right" | "top" | "bottom";

/**
 * One end of a connector.
 *
 * `side` is the port the line leaves from; absent means "whichever edge faces the
 * other end", which is what a line drawn without an explicit port does. Ports are
 * side midpoints only (ADR-137). `offset` is a legacy read field from the eight-port
 * world: 0 and 1 were corners, resolved to the nearest side when the path is built,
 * and every other value is ignored. New writes never set it.
 */
export interface ConnectorEnd {
  item: string;
  side?: ConnectorSide;
  /** Legacy corner position (0 or 1); ignored on write, folded on read (ADR-137). */
  offset?: number;
}

/** Legacy connector shape. New code uses `ConnectorRouting`. */
export type ConnectorShape = "straight" | "elbowed" | "curved";

/** How a connector routes between its endpoints (ADR-077). */
export type ConnectorRouting = "straight" | "elbow" | "curved";

/** A point on a connector's route. Only `rigid` points are user state. */
export interface ConnectorWaypoint {
  id: string;
  x: number;
  y: number;
  /** True when the person placed it; false for a preview/geometry point. */
  rigid?: boolean;
}

/** ADR-077: a line with more points than this is a drawing, not a connector. */
export const MAX_WAYPOINTS = 32;

/**
 * The most text one object hands to layout (ADR-176). The document may hold more until
 * the server guard refuses the write; painting must not freeze on a hostile 10 MB note.
 */
export const MAX_TEXT_CHARS = 200_000;

export type ShapeKind = "rectangle" | "round_rectangle" | "ellipse" | "diamond" | "triangle";

export interface Board {
  id: string;
  title: string;
  widgets: Widget[];
  /**
   * Names of groups, keyed by group id (ADR-101).
   *
   * A group is membership, not a container; its name is a label beside the
   * membership, so it travels with a board/template but never becomes geometry.
   */
  groupNames?: Record<string, string>;
  /** Board-level tag vocabulary (ADR-102). */
  tags?: Record<string, Tag>;
  /** Ordered frame ids for presentation (ADR-108). */
  presentation?: string[];
}

/**
 * Whether an object may be an endpoint of a connector.
 *
 * Only leaves can be connected. Containers (frames, whole kanban boards) are
 * excluded because a line to them is meaningless and, since their boxes are large,
 * it draws as a stray line across the board.
 *
 * A card is a leaf even though its coordinates come from the kanban matrix: the
 * canvas resolves its box through the placement before drawing or hit-testing
 * (ADR-113). Stored `x/y` are never used for a card.
 */
export function canConnect(widget: Widget): boolean {
  return kindOf(widget.type).connectable;
}

