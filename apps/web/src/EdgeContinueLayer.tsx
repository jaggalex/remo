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

const DIRECTIONS: NoteDirection[] = ["left", "right", "up", "down"];

const LABEL: Record<NoteDirection, "continue.left" | "continue.right" | "continue.above" | "continue.below"> = {
  left: "continue.left",
  right: "continue.right",
  up: "continue.above",
  down: "continue.below",
};

/**
 * The quiet "+" on the edge of a selected note or shape (ADR-195).
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
}) {
  const { t } = useI18n();
  const [active, setActive] = useState<{ direction: NoteDirection; armed: boolean } | null>(null);
  const armed = useRef(false);
  const pointer = useRef("mouse");

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
              if (event.pointerType !== "touch") return;
              if (armed.current && isActive) {
                armed.current = false;
                execute(target.direction);
              } else {
                armed.current = true;
                show(target.direction, true);
              }
              event.preventDefault();
            }}
            onClick={() => {
              // Touch is handled on pointerdown: the first tap arms, the second acts.
              if (pointer.current === "touch") return;
              execute(target.direction);
            }}
          />
        );
      })}

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
