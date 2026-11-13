import { Button, IconButton } from "@remo/ui";
import type { KanbanLayout } from "@remo/canvas";
import type { NoteDirection } from "@remo/doc";
import type { ConnectorSide, Widget } from "@remo/model";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  anchorSlotDecision,
  freeConnectedCenter,
  sideOfDirection,
  type AnchorSlotDecision,
  type ContinuePreview,
} from "./canvasGeometry";
import { edgeContinueTargets, type Frame } from "./floatingTargets";
import { useI18n } from "./i18n";
import type { BoardSettings } from "./settings";
import type { Gestures } from "./useGestures";

const DIRECTIONS: NoteDirection[] = ["left", "right", "up", "down"];

const TIP: Record<
  NoteDirection,
  "continue.tip.left" | "continue.tip.right" | "continue.tip.above" | "continue.tip.below"
> = {
  left: "continue.tip.left",
  right: "continue.tip.right",
  up: "continue.tip.above",
  down: "continue.tip.below",
};

/** Width the tip may take, so it can be clamped inside the viewport before it renders. */
const TIP_WIDTH = 260;

const LABEL: Record<NoteDirection, "continue.left" | "continue.right" | "continue.above" | "continue.below"> = {
  left: "continue.left",
  right: "continue.right",
  up: "continue.above",
  down: "continue.below",
};

/**
 * The quiet "+" on the edge of a selected note or shape (ADR-195, ADR-201).
 *
 * It is also the object's port: a click continues, a drag draws a line, so the selected
 * note carries one control per side instead of a "+" and a port circle 30 px apart.
 *
 * This is a real DOM button, not a painted circle: it is reachable with Tab and Enter,
 * it shows the preview on focus, and on touch the first tap arms the preview and the
 * second confirms. The object bar no longer carries the four continue buttons.
 */
export function EdgeContinueLayer({
  source,
  frame,
  widgets,
  layouts,
  settings,
  readOnly,
  editing,
  busy,
  presenting,
  onPreview,
  onCreate,
  onConnect,
  connectDrag,
}: {
  source: Widget | null;
  frame: Frame;
  widgets: readonly Widget[];
  layouts: Map<string, KanbanLayout>;
  settings: BoardSettings;
  readOnly: boolean;
  editing: boolean;
  busy: boolean;
  presenting: boolean;
  onPreview: (preview: ContinuePreview | null) => void;
  onCreate: (id: string, direction: NoteDirection, center?: { x: number; y: number }) => void;
  onConnect: (
    fromId: string,
    toId: string,
    sides: { startSide: ConnectorSide; endSide: ConnectorSide },
  ) => void;
  /**
   * The "+" is also the port (ADR-201): a drag from it hands over to the canvas line
   * gesture, which then receives the forwarded moves and the release.
   */
  connectDrag?: Pick<Gestures, "startConnect" | "onPointerMove" | "onPointerUp">;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState<{ direction: NoteDirection; armed: boolean } | null>(null);
  const armed = useRef(false);
  const pointer = useRef("mouse");
  /** A mouse press on a "+": where it began, and whether it became a line drag. */
  const press = useRef<{ direction: NoteDirection; x: number; y: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);

  const eligible =
    Boolean(source) &&
    !readOnly &&
    !editing &&
    !busy &&
    !presenting &&
    (source?.type === "sticky_note" || source?.type === "shape") &&
    !source?.locked;

  const targets = useMemo(
    () => (source && eligible ? edgeContinueTargets(source, frame) : []),
    [eligible, frame, source],
  );

  const entries = useMemo(() => {
    const map = new Map<
      NoteDirection,
      { decision: AnchorSlotDecision; freeCenter: { x: number; y: number } }
    >();
    if (!source || !eligible) return map;
    const gap = { ratio: settings.notes.gapRatio, min: settings.notes.minGap };
    for (const direction of DIRECTIONS) {
      const decision = anchorSlotDecision(source, direction, widgets, layouts, gap);
      const free = freeConnectedCenter(source, direction, widgets, layouts, gap);
      map.set(direction, { decision, freeCenter: free.center });
    }
    return map;
  }, [eligible, layouts, settings.notes.gapRatio, settings.notes.minGap, source, widgets]);

  useEffect(() => {
    if (eligible) return;
    armed.current = false;
    setActive(null);
    onPreview(null);
  }, [eligible, onPreview]);

  const show = (direction: NoteDirection, isArmed: boolean) => {
    if (!source) return;
    const entry = entries.get(direction);
    if (!entry) return;
    setActive({ direction, armed: isArmed });
    onPreview({
      source,
      direction,
      decision: entry.decision,
      freeCenter: entry.freeCenter,
    });
  };

  const hide = () => {
    armed.current = false;
    setActive(null);
    onPreview(null);
  };

  const execute = (direction: NoteDirection) => {
    if (!source) return;
    const entry = entries.get(direction);
    if (!entry) return;
    const { decision, freeCenter } = entry;
    if (decision.kind === "clone") {
      onCreate(source.id, direction, freeCenter);
    } else if (decision.kind === "connect") {
      onConnect(source.id, decision.target.id, {
        startSide: sideOfDirection(direction),
        endSide: decision.endSide,
      });
    }
    hide();
  };

  const createNew = (direction: NoteDirection) => {
    if (!source) return;
    const entry = entries.get(direction);
    if (!entry) return;
    onCreate(source.id, direction, entry.freeCenter);
    hide();
  };

  if (!eligible || !source) return null;

  const activeTarget = active
    ? targets.find((target) => target.direction === active.direction)
    : undefined;
  const activeEntry = active ? entries.get(active.direction) : undefined;
  const card =
    active && activeTarget && activeEntry &&
    (activeEntry.decision.kind === "connect" || activeEntry.decision.kind === "duplicate")
      ? {
          left: Math.min(
            Math.max(8, activeTarget.left + 48),
            Math.max(8, frame.viewport.width - 256),
          ),
          top: Math.min(
            Math.max(8, activeTarget.top - 4),
            Math.max(8, frame.viewport.height - 150),
          ),
        }
      : null;

  return (
    <div className="edge-continue-layer" role="group" aria-label={t("continue.layer")}>
      {targets.map((target) => {
        const entry = entries.get(target.direction);
        if (!entry) return null;
        const label = t(LABEL[target.direction]);
        const isActive = active?.direction === target.direction;
        const hasCard =
          entry.decision.kind === "connect" || entry.decision.kind === "duplicate";
        return (
          <IconButton
            key={target.direction}
            icon="plus"
            label={label}
            size="compact"
            variant="ghost"
            className="edge-continue"
            style={{ left: target.left, top: target.top }}
            selected={isActive}
            onPointerEnter={() => {
              pointer.current = "mouse";
              show(target.direction, false);
            }}
            onPointerLeave={() => {
              if (!isActive || !hasCard) hide();
            }}
            onFocus={() => show(target.direction, false)}
            onBlur={() => {
              if (!isActive || !hasCard) hide();
            }}
            onPointerDown={(event) => {
              pointer.current = event.pointerType;
              if (event.pointerType !== "touch") {
                if (event.button !== 0 || !connectDrag) return;
                press.current = {
                  direction: target.direction,
                  x: event.clientX,
                  y: event.clientY,
                  dragging: false,
                };
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  /* automation without an active pointer */
                }
                return;
              }
              if (armed.current && isActive) {
                armed.current = false;
                execute(target.direction);
              } else {
                armed.current = true;
                show(target.direction, true);
              }
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const current = press.current;
              if (!current || !connectDrag || !source) return;
              if (!current.dragging) {
                // A few pixels are still a click on the "+"; past that it is a line.
                if (Math.hypot(event.clientX - current.x, event.clientY - current.y) <= 4) return;
                current.dragging = true;
                onPreview(null);
                setActive(null);
                connectDrag.startConnect(source.id, sideOfDirection(current.direction), {
                  x: current.x,
                  y: current.y,
                });
              }
              // The canvas gesture reads only coordinates from the event.
              connectDrag.onPointerMove(event as unknown as React.PointerEvent<HTMLCanvasElement>);
            }}
            onPointerUp={() => {
              const current = press.current;
              press.current = null;
              if (current?.dragging && connectDrag) {
                suppressClick.current = true;
                connectDrag.onPointerUp();
              }
            }}
            onPointerCancel={() => {
              const current = press.current;
              press.current = null;
              if (current?.dragging && connectDrag) connectDrag.onPointerUp();
            }}
            onClick={() => {
              // Touch is handled on pointerdown: the first tap arms, the second acts.
              if (pointer.current === "touch") return;
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              execute(target.direction);
            }}
          />
        );
      })}

      {active && activeTarget && activeEntry?.decision.kind === "clone" && (
        <div
          className="edge-continue-tip"
          role="status"
          style={(() => {
            // Beside the "+", on the side it continues, and always inside the viewport:
            // the ghost can be off-screen, the sentence about it cannot (P5).
            const horizontal = active.direction === "left" || active.direction === "right";
            const rawLeft = horizontal
              ? active.direction === "right"
                ? activeTarget.left + 44
                : activeTarget.left - TIP_WIDTH
              : activeTarget.left + 22 - TIP_WIDTH / 2;
            const rawTop = horizontal
              ? activeTarget.top + 22 - 14
              : active.direction === "down"
                ? activeTarget.top + 44
                : activeTarget.top - 32;
            return {
              left: Math.min(Math.max(8, rawLeft), Math.max(8, frame.viewport.width - TIP_WIDTH - 8)),
              top: Math.min(Math.max(8, rawTop), Math.max(8, frame.viewport.height - 36)),
              width: TIP_WIDTH,
              justifyContent: horizontal
                ? active.direction === "right"
                  ? "flex-start"
                  : "flex-end"
                : "center",
            };
          })()}
        >
          <span>{t(TIP[active.direction])}</span>
        </div>
      )}

      {card && active && activeEntry && (
        <div
          className="edge-continue-card"
          style={card}
          onPointerEnter={() => {
            pointer.current = "mouse";
          }}
          onPointerLeave={hide}
        >
          <p className="edge-continue-title">
            {activeEntry.decision.kind === "duplicate"
              ? t("continue.alreadyLinked")
              : t("continue.connect")}
          </p>
          <div className="edge-continue-actions">
            {activeEntry.decision.kind === "connect" && (
              <Button variant="secondary" size="compact" onClick={() => execute(active.direction)}>
                {t("continue.connectAction")}
              </Button>
            )}
            <Button variant="ghost" size="compact" onClick={() => createNew(active.direction)}>
              {t("continue.createNew")}
            </Button>
          </div>
          <p className="edge-continue-hint">{t("continue.hint")}</p>
        </div>
      )}
    </div>
  );
}
