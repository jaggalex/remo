import { useEffect, useState } from "react";
import { setTableHeaderSize, type BoardDocument } from "@remo/doc";
import type { Widget } from "@remo/model";
import { Input } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * The row-header strip width and the column-header band height (ADR-217).
 *
 * Empty means Auto: the strip follows its longest label and the band follows the wrapped
 * or vertical titles. A number is a manual size; the text ellipsizes when it no longer
 * fits, exactly as it does past the Auto cap.
 */
export function TableHeaderSize({
  board,
  frame,
  disabled,
}: {
  board: BoardDocument;
  frame: Widget;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const layout = frame.layout?.kind === "table" ? frame.layout : null;
  const [width, setWidth] = useState(
    layout?.headerWidth == null ? "" : String(Math.round(layout.headerWidth)),
  );
  const [height, setHeight] = useState(
    layout?.headerHeight == null ? "" : String(Math.round(layout.headerHeight)),
  );

  useEffect(() => {
    setWidth(layout?.headerWidth == null ? "" : String(Math.round(layout.headerWidth)));
    setHeight(layout?.headerHeight == null ? "" : String(Math.round(layout.headerHeight)));
  }, [layout?.headerWidth, layout?.headerHeight]);

  if (!layout) return null;

  const commit = (which: "width" | "height", value: string) => {
    const px = Number(value);
    if (!value.trim() || !Number.isFinite(px) || px <= 0) {
      setTableHeaderSize(board, frame.id, which, null);
      if (which === "width") setWidth("");
      else setHeight("");
      return;
    }
    setTableHeaderSize(board, frame.id, which, px);
  };

  return (
    <div className="section-field">
      <span className="section-field-label">{t("section.size.header")}</span>
      <div className="axis-size-px">
        <Input
          inputMode="numeric"
          size="compact"
          suffix={t("section.size.unit")}
          label={t("section.size.headerWidth")}
          placeholder={t("section.size.auto")}
          value={width}
          disabled={disabled}
          onChange={(event) => setWidth(event.currentTarget.value.replace(/[^0-9]/g, ""))}
          onBlur={(event) => commit("width", event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit("width", event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setWidth(layout.headerWidth == null ? "" : String(Math.round(layout.headerWidth)));
            }
          }}
        />
        <Input
          inputMode="numeric"
          size="compact"
          suffix={t("section.size.unit")}
          label={t("section.size.headerHeight")}
          placeholder={t("section.size.auto")}
          value={height}
          disabled={disabled}
          onChange={(event) => setHeight(event.currentTarget.value.replace(/[^0-9]/g, ""))}
          onBlur={(event) => commit("height", event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit("height", event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setHeight(layout.headerHeight == null ? "" : String(Math.round(layout.headerHeight)));
            }
          }}
        />
      </div>
    </div>
  );
}
