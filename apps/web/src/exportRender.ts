import {
  drawKanban,
  drawWidget,
  layoutKanban,
  type KanbanLayout,
  type PaintTheme,
} from "@remo/canvas";
import {
  paintOrder,
  type KanbanState,
  type Rect,
  type Widget,
} from "@remo/model";
import { internalConnectors, placementOfCard } from "./canvasGeometry";
import type { BoardSettings } from "./settings";

/**
 * Export scope and rendering (ADR-071).
 *
 * The canvas on screen paints selection, drag ghosts and a grid, all of which are
 * chrome: an exported picture must contain only the board. This module reuses the same
 * `drawWidget`/`drawKanban` painters as the product, so an export cannot drift away
 * from what the person sees, and adds the one thing the screen does not have — a
 * camera and a canvas sized to the chosen scope.
 */
export type ExportScope = "selection" | "frame" | "board";

/**
 * The comment shape an export needs (ADR-114). Kept structural so the renderer does not
 * depend on the comments client; the dialog passes the server DTO as-is.
 */
export interface ExportCommentThread {
  id: string;
  anchor:
    | { kind: "widget"; widgetId: string }
    | { kind: "point"; x: number; y: number };
  resolvedAt: string | null;
  comments: Array<{
    authorName: string;
    body: string;
    deletedAt?: string | null;
  }>;
}

export interface ExportRenderInput {
  widgets: Widget[];
  kanbanStates: Record<string, KanbanState>;
  selectedIds: readonly string[];
  scope: ExportScope;
  settings: BoardSettings;
  theme: PaintTheme;
  /** Device pixels per world unit. Two is enough for a sharp PNG and a readable PDF. */
  scale?: number;
  /** Unresolved threads to print as numbered pins and a legend (ADR-114). */
  comments?: ExportCommentThread[];
  /** Off leaves the picture exactly as before. */
  includeComments?: boolean;
  commentsTitle?: string;
  commentPointLabel?: string;
}

export interface ExportRenderResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** World box that was painted, useful for the dialog's object count copy. */
  box: Rect;
  objects: number;
}

/** A frame selected directly, or the frame that contains the selected object. */
export function frameForSelection(
  widgets: readonly Widget[],
  selectedIds: readonly string[],
): Widget | null {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  for (const id of selectedIds) {
    let current = byId.get(id);
    while (current) {
      if (current.type === "frame") return current;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return null;
}

/**
 * Everything the scope covers.
 *
 * A frame and a kanban are containers: selecting one exports its members too, which is
 * what a person means by "this frame". A card is a member of a kanban and has no
 * coordinates of its own, so it only travels with its container.
 *
 * A connector joins the scope when both of its ends do (ADR-138). A line that leaves the
 * frame is left out rather than drawn cut at the edge: a half line says the two objects
 * belong to one picture, and they do not. A line the person selected on its own is still
 * exported — the selection is a statement, not a hint.
 */
export function scopeWidgets(
  widgets: readonly Widget[],
  selectedIds: readonly string[],
  scope: ExportScope,
): Widget[] {
  if (scope === "board") return [...widgets];
  if (scope === "frame") {
    const frame = frameForSelection(widgets, selectedIds);
    if (!frame) return [];
    return withConnectors(widgets, [frame, ...descendants(widgets, frame.id)]);
  }

  const selected = new Set(selectedIds);
  if (!selected.size) return [];
  for (const id of selectedIds) {
    for (const child of descendants(widgets, id)) selected.add(child.id);
  }
  return withConnectors(
    widgets,
    widgets.filter((widget) => selected.has(widget.id)),
  );
}

/** The members plus the lines that stay inside them, once each. */
function withConnectors(widgets: readonly Widget[], members: readonly Widget[]): Widget[] {
  const included = new Set(members.map((widget) => widget.id));
  const lines = internalConnectors(widgets, included).filter(
    (connector) => !included.has(connector.id),
  );
  return [...members, ...lines];
}

function descendants(widgets: readonly Widget[], parentId: string): Widget[] {
  const byParent = new Map<string, Widget[]>();
  for (const widget of widgets) {
    if (!widget.parentId) continue;
    const list = byParent.get(widget.parentId) ?? [];
    list.push(widget);
    byParent.set(widget.parentId, list);
  }
  const out: Widget[] = [];
  const walk = (id: string) => {
    for (const child of byParent.get(id) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(parentId);
  return out;
}

/** One layout per kanban, shared by bounds, painting and connector endpoints. */
export function layoutsFor(
  widgets: readonly Widget[],
  kanbanStates: Record<string, KanbanState>,
): Map<string, KanbanLayout> {
  const map = new Map<string, KanbanLayout>();
  for (const widget of widgets) {
    if (widget.type !== "kanban") continue;
    const state = kanbanStates[widget.id];
    if (!state) continue;
    map.set(
      widget.id,
      layoutKanban(
        widget,
        widgets.filter((candidate) => candidate.parentId === widget.id),
        state,
      ),
    );
  }
  return map;
}

/**
 * The world box the picture must cover.
 *
 * Cards are placed by their kanban matrix, so a card has no usable `x`/`y` of its own;
 * reading the placement keeps a selected card from exporting as a dot at the origin.
 *
 * A connector contributes no box of its own: its stored rectangle is the bounding box
 * captured at creation, stale as soon as an end moves, while the line itself lies
 * between its two ends — and an included line always has both ends in scope (ADR-138).
 * The stored box is the fallback only for a picture that is a line and nothing else.
 */
export function scopeBounds(
  widgets: readonly Widget[],
  layouts: Map<string, KanbanLayout>,
): Rect | null {
  if (!widgets.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let lineX = Infinity;
  let lineY = Infinity;
  let lineRight = -Infinity;
  let lineBottom = -Infinity;
  const pad = 24;
  for (const widget of widgets) {
    const placement = placementOfCard(layouts, widget.id);
    const x = placement ? placement.x - placement.width / 2 : widget.x - widget.width / 2;
    const y = placement ? placement.y - placement.height / 2 : widget.y - widget.height / 2;
    const width = placement ? placement.width : widget.width;
    const height = placement ? placement.height : widget.height;
    if (widget.type === "connector") {
      lineX = Math.min(lineX, x);
      lineY = Math.min(lineY, y);
      lineRight = Math.max(lineRight, x + width);
      lineBottom = Math.max(lineBottom, y + height);
      continue;
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  if (minX === Infinity) {
    if (lineX === Infinity) return null;
    [minX, minY, maxX, maxY] = [lineX, lineY, lineRight, lineBottom];
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
  };
}

/** The world point a thread pin sits on, or null when the anchor is outside. */
function commentPoint(
  thread: ExportCommentThread,
  byId: Map<string, Widget>,
  layouts: Map<string, KanbanLayout>,
): { x: number; y: number } | null {
  if (thread.anchor.kind === "point") {
    return { x: thread.anchor.x, y: thread.anchor.y };
  }
  const widget = byId.get(thread.anchor.widgetId);
  if (!widget) return null;
  const placement = placementOfCard(layouts, widget.id);
  const x = placement ? placement.x : widget.x;
  const y = placement ? placement.y : widget.y;
  const height = placement ? placement.height : widget.height;
  return { x, y: y - height / 2 };
}

/** Unresolved threads whose anchor falls inside the exported scope. */
export function commentsInScope(
  comments: readonly ExportCommentThread[],
  scoped: readonly Widget[],
  box: Rect,
  layouts: Map<string, KanbanLayout>,
): ExportCommentThread[] {
  const byId = new Map(scoped.map((widget) => [widget.id, widget]));
  const allById = new Map(scoped.map((widget) => [widget.id, widget]));
  const inScope = (widgetId: string) => {
    if (byId.has(widgetId)) return true;
    // A card selected on its own is in scope; its anchor is the card id.
    return allById.has(widgetId);
  };
  return comments.filter((thread) => {
    if (thread.resolvedAt) return false;
    if (thread.anchor.kind === "widget") return inScope(thread.anchor.widgetId);
    const point = thread.anchor;
    return (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    );
  });
}

function commentLabel(
  thread: ExportCommentThread,
  byId: Map<string, Widget>,
  pointLabel: string,
): string {
  if (thread.anchor.kind === "point") return pointLabel;
  const widget = byId.get(thread.anchor.widgetId);
  return widget?.title || widget?.content || widget?.type || pointLabel;
}

function wrapText(
  text: string,
  maxChars: number,
  maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && text.length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

function legendHeight(threads: readonly ExportCommentThread[]): number {
  if (!threads.length) return 0;
  return 58 + threads.reduce((sum, thread) => {
    const messages = Math.min(3, thread.comments.length);
    return sum + 26 + messages * 20;
  }, 0);
}

const MAX_PIXELS = 16_000_000;

/**
 * Paint the scope on a fresh canvas.
 *
 * A huge board is capped by total pixels rather than by refusing the export: the
 * person gets a smaller but complete picture, not a failed job with no explanation.
 */
export function renderScope(input: ExportRenderInput): ExportRenderResult | null {
  const scoped = scopeWidgets(input.widgets, input.selectedIds, input.scope);
  if (!scoped.length) return null;

  const layouts = layoutsFor(input.widgets, input.kanbanStates);
  const box = scopeBounds(scoped, layouts);
  if (!box) return null;

  let scale = Math.max(0.5, input.scale ?? 2);
  while (box.width * scale * box.height * scale > MAX_PIXELS && scale > 0.5) {
    scale *= 0.8;
  }

  const byId = new Map(input.widgets.map((widget) => [widget.id, widget]));
  const threads = input.includeComments
    ? commentsInScope(input.comments ?? [], scoped, box, layouts)
    : [];
  const width = Math.max(1, Math.ceil(box.width * scale));
  const boardHeight = Math.max(1, Math.ceil(box.height * scale));
  const extra = legendHeight(threads);
  const height = boardHeight + extra;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { palette } = input.theme;
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, boardHeight);
  if (extra) {
    ctx.fillStyle = palette.panel;
    ctx.fillRect(0, boardHeight, width, extra);
    ctx.strokeStyle = palette.borderSubtle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, boardHeight + 0.5);
    ctx.lineTo(width, boardHeight + 0.5);
    ctx.stroke();
  }
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);

  const cardTitles = new Map<string, string>();
  const cards = new Map<string, Widget>();
  for (const widget of input.widgets) {
    if (widget.type === "card") {
      cards.set(widget.id, widget);
      cardTitles.set(widget.id, widget.title ?? widget.content ?? "");
    }
  }
  const resolve = (id: string) => {
    const widget = byId.get(id);
    if (!widget) return undefined;
    const placement = placementOfCard(layouts, id);
    return placement
      ? {
          ...widget,
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
        }
      : widget;
  };
  // A card whose kanban is in the scope is painted by the matrix; a card selected on
  // its own has no matrix to paint it, so it is drawn at its placement instead.
  const included = new Set(scoped.map((widget) => widget.id));
  const paintedByMatrix = (widget: Widget) =>
    widget.type === "card" &&
    !!widget.parentId &&
    included.has(widget.parentId) &&
    layouts.has(widget.parentId);

  for (const painted of paintOrder(scoped)) {
    if (paintedByMatrix(painted)) continue;
    const widget = painted.type === "card" ? (resolve(painted.id) ?? painted) : painted;
    drawWidget(ctx, widget, scale, {
      selectedIds: [],
      resolve,
      theme: input.theme,
    });
    const layout = layouts.get(painted.id);
    if (layout) {
      drawKanban(ctx, layout, scale, cardTitles, {
        selectedIds: [],
        placeholder: input.theme.cardPlaceholder,
        palette,
        fontFamily: input.theme.fontFamily,
        cards,
        cardStatus: input.theme.cardStatus,
      });
    }
  }

  // Numbered pins are part of the picture, but not of the board: they use the same
  // points as the rows in the legend below.
  const pointLabel = input.commentPointLabel ?? "Point";
  threads.forEach((thread, index) => {
    const point = commentPoint(thread, byId, layouts);
    if (!point) return;
    const radius = 13 / scale;
    ctx.fillStyle = palette.accent;
    ctx.strokeStyle = palette.panel;
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.textOnPresence;
    ctx.font = `600 ${11 / scale}px ${input.theme.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), point.x, point.y + 0.5 / scale);
  });
  ctx.restore();

  if (extra) {
    const pad = 20;
    let y = boardHeight + 30;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = palette.textPrimary;
    ctx.font = `600 14px ${input.theme.fontFamily}`;
    ctx.fillText(
      `${input.commentsTitle ?? "Comments"} (${threads.length})`,
      pad,
      y,
    );
    y += 24;
    const maxChars = Math.max(24, Math.floor((width - pad * 2) / 7.2));
    threads.forEach((thread, index) => {
      ctx.fillStyle = palette.textPrimary;
      ctx.font = `600 12.5px ${input.theme.fontFamily}`;
      ctx.fillText(
        `#${index + 1}  ${commentLabel(thread, byId, pointLabel).slice(0, maxChars)}`,
        pad,
        y,
      );
      y += 18;
      ctx.font = `12px ${input.theme.fontFamily}`;
      ctx.fillStyle = palette.textSecondary;
      for (const comment of thread.comments.slice(0, 3)) {
        const body = comment.deletedAt ? "—" : comment.body;
        for (const line of wrapText(`${comment.authorName}: ${body}`, maxChars, 2)) {
          ctx.fillText(line, pad + 12, y);
          y += 19;
        }
      }
      y += 6;
    });
  }

  return { canvas, width, height, box, objects: scoped.length };
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("CANVAS_EMPTY"))),
      type,
      quality,
    );
  });
}

/**
 * A minimal PDF around one JPEG.
 *
 * PDF has no dependency-free PNG embedding (it would need a Flate decoder), while a
 * JPEG can be an image XObject as-is. One page, the picture's aspect ratio, no fonts:
 * that is all an exported board needs, and it keeps the file readable by every viewer.
 */
export function buildPdfFromJpeg(jpeg: Uint8Array, width: number, height: number): Blob {
  const pageWidth = Math.max(1, width / 2);
  const pageHeight = Math.max(1, height / 2);
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const offsets: number[] = [];

  const push = (text: string) => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const object = (number: number, body: string) => {
    offsets[number] = offset;
    push(`${number} 0 obj\n${body}\nendobj\n`);
  };

  push("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = offset;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  pushBytes(jpeg);
  push("\nendstream\nendobj\n");
  const content = `q\n${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}endstream`);

  const xref = offset;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let number = 1; number <= 5; number += 1) {
    push(`${String(offsets[number] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
