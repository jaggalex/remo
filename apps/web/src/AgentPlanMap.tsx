import type { AgentPlan, PlanBounds } from "@remo/doc";
import { planMapLayout, type PlanMapRect } from "./agentPlanGeometry";
import { useI18n } from "./i18n";

/**
 * No text, no icons, no titles: a plan is checked by its shape (ADR-142, M3).
 *
 * Frames are outlines, sticky notes are filled squares, text is a thin bar, a shape
 * is a dot and a connector is a line. The SVG scales to the dialog width; the world
 * box keeps its aspect ratio, so a tall story map stays tall.
 */

function Leaf({ rect }: { rect: PlanMapRect }) {
  if (rect.type === "frame") {
    return (
      <rect
        className="agent-plan-map-frame-box"
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={Math.min(rect.width, rect.height) * 0.02}
      />
    );
  }
  if (rect.type === "sticky_note") {
    return (
      <rect
        className="agent-plan-map-sticky"
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={Math.min(rect.width, rect.height) * 0.12}
      />
    );
  }
  if (rect.type === "text") {
    const height = Math.max(2, Math.min(rect.height, rect.height * 0.18));
    return (
      <rect
        className="agent-plan-map-text"
        x={rect.x}
        y={rect.y + (rect.height - height) / 2}
        width={rect.width}
        height={height}
        rx={height / 2}
      />
    );
  }
  if (rect.type === "shape") {
    return (
      <circle
        className="agent-plan-map-shape"
        cx={rect.x + rect.width / 2}
        cy={rect.y + rect.height / 2}
        r={Math.min(rect.width, rect.height) * 0.36}
      />
    );
  }
  return (
    <rect
      className="agent-plan-map-other"
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      rx={Math.min(rect.width, rect.height) * 0.12}
    />
  );
}

export function AgentPlanMap({
  plan,
  bounds,
  description,
}: {
  plan: Partial<Pick<AgentPlan, "objects" | "connectors">> | null | undefined;
  bounds?: PlanBounds | null;
  /** The same sentence the caption shows: "10 objects, 0 connectors, bounds …". */
  description: string;
}) {
  const { t } = useI18n();
  const layout = planMapLayout(plan, bounds);

  if (layout.empty) {
    return (
      <div className="agent-plan-map-empty" role="img" aria-label={t("agents.plan.map.empty")}>
        {t("agents.plan.map.empty")}
      </div>
    );
  }

  return (
    <figure className="agent-plan-map">
      <svg
        className="agent-plan-map-svg"
        viewBox={layout.viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={description}
      >
        {layout.rects.map((rect) => (
          <Leaf key={rect.key} rect={rect} />
        ))}
        {layout.lines.map((line) => (
          <line
            key={line.key}
            className="agent-plan-map-line"
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
          />
        ))}
      </svg>
      <figcaption className="agent-plan-map-caption">{description}</figcaption>
    </figure>
  );
}
