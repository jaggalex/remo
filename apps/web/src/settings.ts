import {
  DEFAULT_LINE_PRESET,
  DEFAULT_SHAPE_PRESET,
  type ConnectorShape,
} from "@remo/model";

/**
 * Tunable behaviour of the board.
 *
 * These are the numbers that decide how the board *feels*: how far a chained note
 * lands, how coarsely the grid is drawn, how eagerly objects snap, what a new line
 * looks like. They live here, in one object with defaults and clamps, so they can be
 * tuned from one dialog (and pasted as JSON) instead of being recompiled — a constant
 * buried in a painter is a decision nobody can try (ADR-032).
 *
 * They are a per-browser preference: the grid and the snap radius are how *you* read
 * the board, and the gap is what *your* new notes land with. Nothing here is written
 * to the shared document, so two people may legitimately disagree.
 */
export interface BoardSettings {
  grid: {
    /** Size of one grid cell in canvas units. */
    size: number;
    /** Lines, dots or nothing. */
    style: "off" | "lines" | "dots";
  };
  snapping: {
    /** How close, in screen pixels, an object must be before it snaps. */
    thresholdPx: number;
    /** Draw the dashed alignment lines while dragging. */
    guides: boolean;
  };
  notes: {
    /** Gap between a note and the one created next to it, as a share of the note. */
    gapRatio: number;
    /** The gap never goes below this many canvas units. */
    minGap: number;
    /** Largest text size Auto will use, per size preset. */
    fontCap: { S: number; M: number; L: number };
  };
  connectors: {
    /** What a new connector looks like before anyone changes it. */
    shape: ConnectorShape;
    arrow: "none" | "end" | "both" | "start";
    width: number;
    colour: string;
    dash: "normal" | "dashed" | "dotted";
    /** Longest straight run an elbow leaves an object with. */
    stubMax: number;
    /** Stub length as a share of the distance between the two ends. */
    stubRatio: number;
  };
  shapes: {
    /** Fill of a freshly created shape. */
    fill: string;
    /** Outline of a freshly created shape. */
    stroke: string;
    strokeWidth: number;
  };
  text: {
    /** Font every note, shape and text block is drawn with. */
    fontFamily: string;
  };
}

export const DEFAULT_SETTINGS: BoardSettings = {
  grid: { size: 40, style: "lines" },
  snapping: { thresholdPx: 6, guides: true },
  notes: {
    // A whole note between chained notes: the owner tuned this by using the board,
    // and it became the default so a fresh browser starts where they left off.
    gapRatio: 1.2,
    minGap: 72,
    fontCap: { S: 13, M: 16, L: 20 },
  },
  connectors: {
    // The line Plain preset (ADR-129): a new line is already a chip in its window.
    shape: "curved",
    arrow: DEFAULT_LINE_PRESET.arrow,
    width: DEFAULT_LINE_PRESET.width,
    colour: DEFAULT_LINE_PRESET.color,
    dash: DEFAULT_LINE_PRESET.dash,
    stubMax: 28,
    stubRatio: 0.28,
  },
  /** The shape Plain preset (ADR-129): a new shape already matches a chip. */
  shapes: {
    fill: DEFAULT_SHAPE_PRESET.fill,
    stroke: DEFAULT_SHAPE_PRESET.stroke,
    strokeWidth: DEFAULT_SHAPE_PRESET.strokeWidth,
  },
  text: { fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif' },
};

const STORAGE_KEY = "remo.settings";

/** Bounds each numeric field is clamped to, so a typo cannot break the board. */
const LIMITS = {
  "grid.size": [8, 400],
  "snapping.thresholdPx": [0, 40],
  "notes.gapRatio": [0, 3],
  "notes.minGap": [0, 600],
  "notes.fontCap.S": [8, 40],
  "notes.fontCap.M": [8, 48],
  "notes.fontCap.L": [8, 64],
  "connectors.width": [1, 8],
  "connectors.stubMax": [0, 200],
  "connectors.stubRatio": [0, 1],
  "shapes.strokeWidth": [0, 12],
} as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number, key: keyof typeof LIMITS): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return fallback;
  const [min, max] = LIMITS[key];
  return clamp(parsed, min, max);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function colour(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

/**
 * Merge anything into valid settings.
 *
 * The JSON tab can receive a hand-edited object, so every field is validated and
 * clamped rather than trusted; an unknown key is dropped, a missing one falls back to
 * the default.
 */
export function normalizeSettings(input: unknown): BoardSettings {
  const raw = (input ?? {}) as Record<string, unknown>;
  const section = (name: string): Record<string, unknown> => {
    const value = raw[name];
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  };

  const grid = section("grid");
  const snapping = section("snapping");
  const notes = section("notes");
  const caps = notes.fontCap && typeof notes.fontCap === "object"
    ? (notes.fontCap as Record<string, unknown>)
    : {};
  const connectors = section("connectors");
  const shapes = section("shapes");
  const text = section("text");

  return {
    grid: {
      size: num(grid.size, DEFAULT_SETTINGS.grid.size, "grid.size"),
      style: oneOf(grid.style, ["off", "lines", "dots"] as const, DEFAULT_SETTINGS.grid.style),
    },
    snapping: {
      thresholdPx: num(
        snapping.thresholdPx,
        DEFAULT_SETTINGS.snapping.thresholdPx,
        "snapping.thresholdPx",
      ),
      guides: typeof snapping.guides === "boolean" ? snapping.guides : DEFAULT_SETTINGS.snapping.guides,
    },
    notes: {
      gapRatio: num(notes.gapRatio, DEFAULT_SETTINGS.notes.gapRatio, "notes.gapRatio"),
      minGap: num(notes.minGap, DEFAULT_SETTINGS.notes.minGap, "notes.minGap"),
      fontCap: {
        S: num(caps.S, DEFAULT_SETTINGS.notes.fontCap.S, "notes.fontCap.S"),
        M: num(caps.M, DEFAULT_SETTINGS.notes.fontCap.M, "notes.fontCap.M"),
        L: num(caps.L, DEFAULT_SETTINGS.notes.fontCap.L, "notes.fontCap.L"),
      },
    },
    connectors: {
      shape: oneOf(connectors.shape, ["straight", "elbowed", "curved"] as const, DEFAULT_SETTINGS.connectors.shape),
      arrow: oneOf(connectors.arrow, ["none", "end", "both", "start"] as const, DEFAULT_SETTINGS.connectors.arrow),
      width: num(connectors.width, DEFAULT_SETTINGS.connectors.width, "connectors.width"),
      colour: colour(connectors.colour, DEFAULT_SETTINGS.connectors.colour),
      dash: oneOf(connectors.dash, ["normal", "dashed", "dotted"] as const, DEFAULT_SETTINGS.connectors.dash),
      stubMax: num(connectors.stubMax, DEFAULT_SETTINGS.connectors.stubMax, "connectors.stubMax"),
      stubRatio: num(connectors.stubRatio, DEFAULT_SETTINGS.connectors.stubRatio, "connectors.stubRatio"),
    },
    shapes: {
      fill: colour(shapes.fill, DEFAULT_SETTINGS.shapes.fill),
      stroke: colour(shapes.stroke, DEFAULT_SETTINGS.shapes.stroke),
      strokeWidth: num(shapes.strokeWidth, DEFAULT_SETTINGS.shapes.strokeWidth, "shapes.strokeWidth"),
    },
    text: {
      // The old default stack is not a deliberate choice: move it to Inter once,
      // so the canvas and the design-system chrome use the same typeface.
      fontFamily:
        typeof text.fontFamily === "string" && text.fontFamily.trim()
          ? text.fontFamily.trim() === '"Helvetica Neue", Arial, sans-serif'
            ? DEFAULT_SETTINGS.text.fontFamily
            : text.fontFamily.trim()
          : DEFAULT_SETTINGS.text.fontFamily,
    },
  };
}

/**
 * Move a stored browser preference off a default this product no longer writes.
 *
 * Only a bundle that is exactly a default the product shipped is touched: (#1a1a1a, 1)
 * and (#595959, 2) for a shape border, (#333333, 1) for a line. Anything else is a choice
 * a person made, and stays — the same rule as ADR-127 for document content, applied to
 * the settings that only ever existed on this browser (ADR-129).
 */
export function migrateLegacyDefaults(settings: BoardSettings): BoardSettings {
  const shapes = settings.shapes;
  const stroke = shapes.stroke.toLowerCase();
  const untouchedShape =
    (stroke === "#1a1a1a" && shapes.strokeWidth === 1) ||
    (stroke === "#595959" && shapes.strokeWidth === 2);
  if (untouchedShape) {
    settings.shapes = {
      ...shapes,
      stroke: DEFAULT_SETTINGS.shapes.stroke,
      strokeWidth: DEFAULT_SETTINGS.shapes.strokeWidth,
    };
  }

  const connectors = settings.connectors;
  if (
    connectors.colour.toLowerCase() === "#333333" &&
    connectors.width === 1
  ) {
    settings.connectors = {
      ...connectors,
      colour: DEFAULT_SETTINGS.connectors.colour,
      width: DEFAULT_SETTINGS.connectors.width,
    };
  }
  return settings;
}

export function loadSettings(): BoardSettings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    return migrateLegacyDefaults(normalizeSettings(JSON.parse(stored)));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: BoardSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* the choice simply will not survive a reload */
  }
}
