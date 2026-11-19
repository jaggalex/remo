import type { Rect, Widget } from "@remo/model";
import { edgePoint } from "./connectors";
import type { CanvasPalette } from "./palette";

/**
 * A plan under review, drawn over the live room (ADR-188).
 *
 * The plan is read, not trusted: it comes from a model, so every number is checked before
 * it reaches the canvas, and a broken or partial plan yields fewer boxes, never a throw.
 * Objects in a plan are centre-anchored like widgets; the layout returns top-left boxes in
 * board coordinates. A created frame is the proposal's hull; a created leaf and a moved
 * object are ghosts; a planned connector is a line between two planned objects only — an
 * endpoint that already lives on the board has no coordinates in the plan.
 *
 * The plan type is structural on purpose: `@remo/canvas` does not depend on `@remo/doc`.
 */
export interface ProposalPlan {
  objects?: unknown;
  connectors?: unknown;
  placements?: unknown;
}

export interface ProposalBox {
  key: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProposalLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ProposalLayout {
  /** Objects the plan creates, frames first so a hull never covers a note. */
  blocks: ProposalBox[];
  /** Objects the plan moves, at their target positions with their live sizes. */
  moves: ProposalBox[];
  lines: ProposalLine[];
  /** Everything the person should see: blocks, targets and where moved objects are now. */
  bounds: Rect | null;
  /** Nothing in the plan can be drawn. */
  empty: boolean;
}

/** The hull of ADR-181: a softly rounded dashed outline, in screen pixels. */
export const PROPOSAL_HULL = { corner: 0.18, leafCorner: 0.06, dash: [6, 5], width: 1.5 } as const;

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

interface Centred {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function readObject(value: unknown, index: number): Centred | null {
  const item = record(value);
  if (!item) return null;
  const x = finite(item.x);
  const y = finite(item.y);
  const width = finite(item.width);
  const height = finite(item.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    id: String(item.tempId ?? "") || `object_${index + 1}`,
    type: String(item.type ?? "unsupported"),
    x,
    y,
    width,
    height,
  };
}

function box(object: Centred, key: string): ProposalBox {
  return {
    key,
    type: object.type,
    x: object.x - object.width / 2,
    y: object.y - object.height / 2,
    width: object.width,
    height: object.height,
  };
}

function union(boxes: readonly ProposalBox[]): Rect | null {
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((item) => item.x));
  const minY = Math.min(...boxes.map((item) => item.y));
  const maxX = Math.max(...boxes.map((item) => item.x + item.width));
  const maxY = Math.max(...boxes.map((item) => item.y + item.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function proposalLayout(
  plan: ProposalPlan | null | undefined,
  resolve: (id: string) => Widget | undefined,
): ProposalLayout {
  const objects: Centred[] = [];
  (Array.isArray(plan?.objects) ? plan.objects : []).forEach((value, index) => {
    const object = readObject(value, index);
    if (object) objects.push(object);
  });
  const blocks = objects.map((object) => box(object, `new-${object.id}`));
  const rank = (type: string) => (type === "frame" ? 0 : 1);
  blocks.sort((first, second) => rank(first.type) - rank(second.type));

  const moves: ProposalBox[] = [];
  const sources: ProposalBox[] = [];
  for (const value of Array.isArray(plan?.placements) ? plan.placements : []) {
    const item = record(value);
    const id = item ? String(item.id ?? "") : "";
    const x = finite(item?.x);
    const y = finite(item?.y);
    const widget = id ? resolve(id) : undefined;
    if (!widget || x === null || y === null || widget.type === "connector") continue;
    const sized = { id, type: widget.type, width: widget.width, height: widget.height };
    moves.push(box({ ...sized, x, y }, `move-${id}`));
    sources.push(box({ ...sized, x: widget.x, y: widget.y }, `from-${id}`));
  }

  const byId = new Map(objects.map((object) => [object.id, object]));
  const lines: ProposalLine[] = [];
  (Array.isArray(plan?.connectors) ? plan.connectors : []).forEach((value, index) => {
    const item = record(value);
    const from = byId.get(String(item?.from ?? ""));
    const to = byId.get(String(item?.to ?? ""));
    if (!from || !to) return;
    // From edge to edge, like a real connector: a line through the ghosts' centres would
    // read as a third object.
    const start = edgePoint(box(from, ""), to);
    const end = edgePoint(box(to, ""), from);
    lines.push({
      key: String(item?.tempId ?? "") || `connector_${index + 1}`,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
    });
  });

  const bounds = union([...blocks, ...moves, ...sources]);
  return { blocks, moves, lines, bounds, empty: blocks.length === 0 && moves.length === 0 };
}

function roundedRect(ctx: CanvasRenderingContext2D, item: ProposalBox, corner: number): void {
  const radius = Math.min(item.width, item.height) * corner;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(item.x, item.y, item.width, item.height, radius);
  } else {
    ctx.rect(item.x, item.y, item.width, item.height);
  }
}

/** A ghost's faint fill; alpha, not a mixed colour, so any token format works. */
function tint(ctx: CanvasRenderingContext2D, ink: string): void {
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.restore();
}

/**
 * Paint the proposal in board coordinates; the caller has applied the camera. Line widths
 * and dashes are divided by `zoom`, so the hull reads the same at every scale, like a
 * selection outline rather than like an object.
 */
export function drawProposal(
  ctx: CanvasRenderingContext2D,
  layout: ProposalLayout,
  zoom: number,
  palette: CanvasPalette,
): void {
  if (layout.empty && !layout.lines.length) return;
  const ink = palette.agentProposal;
  const px = 1 / zoom;
  ctx.save();
  ctx.lineWidth = PROPOSAL_HULL.width * px;
  ctx.setLineDash(PROPOSAL_HULL.dash.map((step) => step * px));
  ctx.strokeStyle = ink;

  for (const item of layout.moves) {
    roundedRect(ctx, item, PROPOSAL_HULL.leafCorner);
    tint(ctx, ink);
    ctx.stroke();
  }
  for (const item of layout.blocks) {
    const hull = item.type === "frame";
    roundedRect(ctx, item, hull ? PROPOSAL_HULL.corner : PROPOSAL_HULL.leafCorner);
    if (!hull) tint(ctx, ink);
    ctx.stroke();
  }
  for (const line of layout.lines) {
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }
  ctx.restore();
}
