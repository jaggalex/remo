import type { AgentPlan, PlannedObject } from "@remo/doc";
import type { Widget } from "@remo/model";
import { useI18n } from "./i18n";

/**
 * "Before and after" on one miniature (ADR-143).
 *
 * The after boxes are the plan's placements applied to the live sizes: the plan moves
 * objects, it never resizes them, so the size comes from the board. Before boxes are
 * dashed and muted, after boxes use the plan colours, and the frame outlines show the
 * blocks that will appear.
 */

interface Box {
  key: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxesFor(widgets: readonly Widget[], ids: readonly string[]): Box[] {
  const wanted = new Set(ids);
  return widgets
    .filter((widget) => wanted.has(widget.id) && widget.type !== "connector")
    .map((widget) => ({
      key: widget.id,
      type: widget.type,
      x: widget.x - widget.width / 2,
      y: widget.y - widget.height / 2,
      width: widget.width,
      height: widget.height,
    }));
}

function afterBoxes(
  widgets: readonly Widget[],
  plan: AgentPlan,
): Box[] {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const moved: Box[] = [];
  for (const placement of plan.placements ?? []) {
    const widget = byId.get(placement.id);
    if (!widget) continue;
    moved.push({
      key: `after-${placement.id}`,
      type: widget.type,
      x: placement.x - widget.width / 2,
      y: placement.y - widget.height / 2,
      width: widget.width,
      height: widget.height,
    });
  }
  const created = plan.objects.map((object: PlannedObject) => ({
    key: `new-${object.tempId}`,
    type: object.type,
    x: object.x - object.width / 2,
    y: object.y - object.height / 2,
    width: object.width,
    height: object.height,
  }));
  // Frames are containers: paint them under the leaves so a block never hides a note.
  return [...created, ...moved];
}

function union(boxes: Box[]): { x: number; y: number; width: number; height: number } {
  if (!boxes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function Glyph({ box, ghost }: { box: Box; ghost: boolean }) {
  const className = ghost
    ? "tidy-map-ghost"
    : box.type === "frame"
      ? "agent-plan-map-frame-box"
      : box.type === "sticky_note"
        ? "agent-plan-map-sticky"
        : box.type === "text"
          ? "agent-plan-map-text"
          : "agent-plan-map-other";
  if (box.type === "text" && !ghost) {
    const height = Math.max(2, Math.min(box.height, box.height * 0.18));
    return (
      <rect
        className={className}
        x={box.x}
        y={box.y + (box.height - height) / 2}
        width={box.width}
        height={height}
        rx={height / 2}
      />
    );
  }
  return (
    <rect
      className={className}
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      rx={Math.min(box.width, box.height) * 0.06}
    />
  );
}

export function TidyPlanMap({
  before,
  after,
  plan,
  description,
}: {
  before: Widget[];
  after: Widget[];
  plan: AgentPlan;
  description: string;
}) {
  const { t } = useI18n();
  const beforeBoxes = boxesFor(before, plan.placements?.map((item) => item.id) ?? []);
  const nextBoxes = afterBoxes(after, plan);
  const bounds = union([...beforeBoxes, ...nextBoxes]);
  const pad = Math.max(Math.max(bounds.width, bounds.height) * 0.06, 10);
  const viewBox = [
    Math.round((bounds.x - pad) * 100) / 100,
    Math.round((bounds.y - pad) * 100) / 100,
    Math.round((bounds.width + pad * 2) * 100) / 100,
    Math.round((bounds.height + pad * 2) * 100) / 100,
  ].join(" ");

  return (
    <figure className="agent-plan-map tidy-plan-map">
      <svg
        className="agent-plan-map-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={description}
      >
        {beforeBoxes.map((box) => (
          <Glyph key={`before-${box.key}`} box={box} ghost />
        ))}
        {nextBoxes.map((box) => (
          <Glyph key={box.key} box={box} ghost={false} />
        ))}
      </svg>
      <figcaption className="agent-plan-map-caption">{description}</figcaption>
      <div className="tidy-map-legend" aria-hidden="true">
        <span className="tidy-map-legend-before">{t("tidy.plan.before")}</span>
        <span className="tidy-map-legend-after">{t("tidy.plan.after")}</span>
      </div>
    </figure>
  );
}
