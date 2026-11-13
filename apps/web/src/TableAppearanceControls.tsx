import { useEffect, useState } from "react";
import {
  setTableBorder,
  setTablePadding,
  type BoardDocument,
  type TableFillTarget,
} from "@remo/doc";
import {
  FILL_LEVELS,
  NAMED_COLORS,
  type TableBorder,
  type TableBorderStyle,
  type TableLayout,
  type Widget,
} from "@remo/model";
import { Button, Input, Segmented } from "@remo/ui";
import { useI18n } from "./i18n";
import { ColorGridSection } from "./object-panel/ColorWindow";

/**
 * Borders and padding of a table (ADR-208).
 *
 * One row per property; the window picks the area (table, headers, the selected axis or
 * cell) and edits it. The values live in `TableAppearance`, so the painter, export and
 * backup read the same fields.
 */
type Kind = "border" | "padding";

function borderFor(layout: TableLayout, target: TableFillTarget): TableBorder | undefined {
  const borders = layout.appearance?.borders;
  if (!borders) return undefined;
  if (target.kind === "table") return borders.table;
  if (target.kind === "headers") return borders.headers;
  if (target.kind === "column") return borders.columns?.[target.id];
  if (target.kind === "row") return borders.rows?.[target.id];
  return borders.cells?.[`${target.rowId}:${target.columnId}`];
}

function paddingFor(layout: TableLayout, target: TableFillTarget): number | undefined {
  const paddings = layout.appearance?.paddings;
  if (!paddings) return undefined;
  if (target.kind === "table") return paddings.table;
  if (target.kind === "headers") return paddings.headers;
  if (target.kind === "column") return paddings.columns?.[target.id];
  if (target.kind === "row") return paddings.rows?.[target.id];
  return paddings.cells?.[`${target.rowId}:${target.columnId}`];
}

export function TableAppearanceControls({
  board,
  frame,
  targets,
  disabled,
}: {
  board: BoardDocument;
  frame: Widget;
  targets: Array<{ target: TableFillTarget; label: string }>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Kind | null>(null);
  const [index, setIndex] = useState(0);
  const [paddingDraft, setPaddingDraft] = useState("");
  const layout = frame.layout?.kind === "table" ? frame.layout : null;
  const target = targets[Math.min(index, Math.max(0, targets.length - 1))]?.target;
  const border = layout && target ? borderFor(layout, target) : undefined;
  const padding = layout && target ? paddingFor(layout, target) : undefined;

  useEffect(() => {
    setPaddingDraft(padding == null ? "" : String(padding));
  }, [padding, index, open]);

  if (!layout || !target) return null;
  const styleLabel: Record<TableBorderStyle, string> = {
    solid: t("section.look.solid"),
    dashed: t("section.look.dashed"),
    none: t("section.look.none"),
  };
  const setBorder = (next: Partial<TableBorder>) => {
    if (disabled) return;
    setTableBorder(board, frame.id, target, {
      color: next.color ?? border?.color ?? NAMED_COLORS.black,
      width: next.width ?? border?.width ?? 1,
      style: next.style ?? border?.style ?? "solid",
    });
  };
  const commitPadding = () => {
    const px = Number(paddingDraft);
    if (!paddingDraft.trim() || !Number.isFinite(px) || px < 0) {
      setPaddingDraft(padding == null ? "" : String(padding));
      return;
    }
    setTablePadding(board, frame.id, target, px);
  };

  return (
    <>
      <button
        type="button"
        className="section-fill-row"
        aria-expanded={open === "border"}
        onClick={() => setOpen(open === "border" ? null : "border")}
      >
        <span
          className="section-fill-dot"
          style={{ borderColor: border?.color ?? "var(--border-subtle)", background: "transparent" }}
          aria-hidden="true"
        />
        <span className="section-fill-label">{t("section.look.borders")}</span>
        <span className="section-fill-name">
          {border ? `${border.width} px · ${styleLabel[border.style]}` : t("section.look.default")}
        </span>
      </button>
      {open === "border" && (
        <div className="section-fill-window">
          <TargetPicker targets={targets} index={index} onChange={setIndex} />
          <ColorGridSection
            ariaLabel={t("section.look.borderColor")}
            levels={FILL_LEVELS}
            value={border?.color}
            auto={!border}
            autoLabel={t("section.look.default")}
            onAuto={() => {
              if (!disabled) setTableBorder(board, frame.id, target, null);
            }}
            onPick={(color) => setBorder({ color })}
          />
          <span className="section-field-label">{t("section.look.borderWidth")}</span>
          <Segmented
            label={t("section.look.borderWidth")}
            value={String(border?.width ?? 1)}
            onChange={(value) => setBorder({ width: Number(value) })}
            options={[1, 2, 3, 4, 6, 8].map((width) => ({
              value: String(width),
              label: t("section.size.px", { n: width }),
              disabled,
            }))}
          />
          <span className="section-field-label">{t("section.look.borderStyle")}</span>
          <Segmented
            label={t("section.look.borderStyle")}
            value={border?.style ?? "solid"}
            onChange={(value) => setBorder({ style: value as TableBorderStyle })}
            options={[
              { value: "solid", label: t("section.look.solid"), disabled },
              { value: "dashed", label: t("section.look.dashed"), disabled },
              { value: "none", label: t("section.look.none"), disabled },
            ]}
          />
          <Button
            size="compact"
            variant="secondary"
            disabled={disabled}
            onClick={() => setTableBorder(board, frame.id, target, null)}
          >
            {t("section.look.reset")}
          </Button>
        </div>
      )}

      <button
        type="button"
        className="section-fill-row"
        aria-expanded={open === "padding"}
        onClick={() => setOpen(open === "padding" ? null : "padding")}
      >
        <span className="section-fill-label">{t("section.look.padding")}</span>
        <span className="section-fill-name">
          {padding == null ? t("section.look.default") : t("section.size.px", { n: padding })}
        </span>
      </button>
      {open === "padding" && (
        <div className="section-fill-window">
          <TargetPicker targets={targets} index={index} onChange={setIndex} />
          <Segmented
            label={t("section.look.padding")}
            value={padding == null ? "" : String(padding)}
            onChange={(value) => {
              if (!disabled) setTablePadding(board, frame.id, target, Number(value));
            }}
            options={[
              { value: "8", label: t("section.look.paddingS"), disabled },
              { value: "16", label: t("section.look.paddingM"), disabled },
              { value: "32", label: t("section.look.paddingL"), disabled },
            ]}
          />
          <div className="axis-size-px">
            <Input
              inputMode="numeric"
              size="compact"
              suffix={t("section.size.unit")}
              label={t("section.look.padding")}
              value={paddingDraft}
              disabled={disabled}
              onChange={(event) =>
                setPaddingDraft(event.currentTarget.value.replace(/[^0-9]/g, ""))
              }
              onBlur={commitPadding}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPadding();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setPaddingDraft(padding == null ? "" : String(padding));
                }
              }}
            />
            <Button
              size="compact"
              variant="secondary"
              disabled={disabled}
              onClick={() => setTablePadding(board, frame.id, target, null)}
            >
              {t("section.look.reset")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function TargetPicker({
  targets,
  index,
  onChange,
}: {
  targets: Array<{ target: TableFillTarget; label: string }>;
  index: number;
  onChange: (index: number) => void;
}) {
  const { t } = useI18n();
  if (targets.length < 2) return null;
  return (
    <Segmented
      label={t("section.look.target")}
      value={String(index)}
      onChange={(value) => onChange(Number(value))}
      options={targets.map((entry, at) => ({
        value: String(at),
        label: entry.label,
      }))}
    />
  );
}
