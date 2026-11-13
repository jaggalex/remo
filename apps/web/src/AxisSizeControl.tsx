import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setAxisAutoResize, setAxisSize, type BoardDocument } from "@remo/doc";
import {
  layoutTable,
  type TableAxis,
  type TableAxisSize,
  type Widget,
} from "@remo/model";
import { Button, Input, Popover, Segmented } from "@remo/ui";
import { useI18n } from "./i18n";
import { PanelWindow } from "./object-panel/PanelWindow";

/**
 * The size of one table axis (ADR-196, ADR-201, ADR-206).
 *
 * Two modes, as the T13 mockup shows: Auto follows the content both ways; Manual keeps
 * the visible size as a floor, so content may still grow it but it never shrinks on its
 * own. Presets are manual sizes. Dragging the boundary is the same command, so the panel
 * and the header menu cannot disagree.
 */
export type AxisKind = "column" | "row";

export function axisSizeValue(
  board: BoardDocument,
  frame: Widget,
  kind: AxisKind,
  axisId: string,
): number {
  const grid = layoutTable(frame, board.readWidgets());
  if (!grid) return 0;
  if (kind === "column") {
    const column = grid.columns.find((entry) => entry.axis.id === axisId);
    return Math.round(column?.width ?? 0);
  }
  const row = grid.rows.find((entry) => entry.axis.id === axisId);
  return Math.round(row?.height ?? 0);
}

export function axisIsManual(axis: TableAxis): boolean {
  return axis.size !== undefined && axis.size !== "auto";
}

export function AxisSizePopover({
  board,
  frame,
  kind,
  axis,
  disabled,
  onClose,
}: {
  board: BoardDocument;
  frame: Widget;
  kind: AxisKind;
  axis: TableAxis;
  disabled: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => String(axisSizeValue(board, frame, kind, axis.id)));
  const manual = axisIsManual(axis);
  const preset = typeof axis.size === "string" && axis.size !== "auto" ? axis.size : "";
  const name = axis.title || t("section.axis.untitled");
  const size = axisSizeValue(board, frame, kind, axis.id);

  useEffect(() => setDraft(String(size)), [size, axis.id]);

  const setMode = (mode: string) => {
    if (disabled) return;
    setAxisAutoResize(board, frame.id, axis.id, mode === "auto");
  };

  const commit = () => {
    const px = Number(draft);
    if (!draft.trim() || !Number.isFinite(px) || px <= 0) {
      setDraft(String(size));
      return;
    }
    if (Math.round(px) !== size) setAxisSize(board, frame.id, axis.id, px);
  };

  return (
    <Popover
      title={t(kind === "column" ? "section.size.columnTitle" : "section.size.rowTitle", {
        name,
      })}
      width={320}
      onClose={onClose}
    >
      <div className="axis-size-pop">
        <Segmented
          label={t("section.size.mode")}
          value={manual ? "manual" : "auto"}
          onChange={setMode}
          options={[
            { value: "auto", label: t("section.size.auto"), disabled },
            { value: "manual", label: t("section.size.manual"), disabled },
          ]}
        />
        <p className="muted axis-size-hint">
          {manual ? t("section.size.manualHint") : t("section.size.autoHint")}
        </p>
        <Segmented
          label={t("section.size.presets")}
          value={preset}
          onChange={(value) => {
            if (disabled) return;
            setAxisSize(board, frame.id, axis.id, value as TableAxisSize);
          }}
          options={[
            {
              value: "narrow",
              label: t(kind === "column" ? "section.size.narrow" : "section.size.low"),
              disabled,
            },
            { value: "medium", label: t("section.size.medium"), disabled },
            {
              value: "wide",
              label: t(kind === "column" ? "section.size.wide" : "section.size.tall"),
              disabled,
            },
          ]}
        />
        <div className="axis-size-px">
          <Input
            inputMode="numeric"
            size="compact"
            suffix={t("section.size.unit")}
            label={t("section.size.pxField")}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.currentTarget.value.replace(/[^0-9]/g, ""))}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft(String(size));
              }
            }}
          />
          <span className="muted axis-size-now">{t("section.size.px", { n: size })}</span>
        </div>
        <p className="muted axis-size-keys">{t("section.size.keyboardHint")}</p>
      </div>
    </Popover>
  );
}

/** The panel control: one button with the current mode, the popover under it (T13, P7). */
export function AxisSizeButton({
  board,
  frame,
  kind,
  axis,
  disabled,
}: {
  board: BoardDocument;
  frame: Widget;
  kind: AxisKind;
  axis: TableAxis;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const size = axisSizeValue(board, frame, kind, axis.id);
  const label = axisIsManual(axis)
    ? `${t("section.size.manual")} · ${t("section.size.px", { n: size })}`
    : t("section.size.content");

  useEffect(() => setOpen(false), [axis.id]);

  useEffect(() => {
    if (!open) return;
    const node = document.querySelector<HTMLElement>(".axis-size-portal .rm-popover");
    node?.setAttribute("tabindex", "-1");
    node?.focus();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (document.querySelector(".axis-size-portal")?.contains(target)) return;
      if (anchor.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      anchor.current?.querySelector("button")?.focus();
    };
  }, [open]);

  return (
    <span className="axis-size-anchor" ref={anchor}>
      <Button
        size="compact"
        variant="secondary"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const rect = anchor.current?.getBoundingClientRect();
          setPosition(rect ? { left: rect.left, top: rect.bottom + 8 } : null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {open &&
        position &&
        createPortal(
          <div className="axis-size-portal" style={{ left: position.left, top: position.top }}>
            <PanelWindow>
              <AxisSizePopover
                board={board}
                frame={frame}
                kind={kind}
                axis={axis}
                disabled={disabled}
                onClose={() => setOpen(false)}
              />
            </PanelWindow>
          </div>,
          document.body,
        )}
    </span>
  );
}
