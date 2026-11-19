import { setTableHeaderSize, type BoardDocument } from "@remo/doc";
import type { Widget } from "@remo/model";
import { NumberField } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * The row-header strip width and the column-header band height (ADR-217, ADR-219).
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
  if (!layout) return null;

  const value = (px: number | undefined) =>
    px == null ? t("section.size.auto") : t("section.size.px", { n: Math.round(px) });

  if (disabled) {
    return (
      <div className="section-field table-header-group">
        <span className="section-field-label">{t("section.size.header")}</span>
        <div className="section-readonly">
          <span>
            {t("section.size.headerHeight")}: {value(layout.headerHeight)}
          </span>
          <span>
            {t("section.size.headerWidth")}: {value(layout.headerWidth)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="section-field table-header-group">
      <span className="section-field-label">{t("section.size.header")}</span>
      <div className="table-header-size">
        <NumberField
          label={t("section.size.headerHeight")}
          value={layout.headerHeight ?? null}
          min={40}
          max={2000}
          suffix={t("section.size.unit")}
          allowEmpty
          placeholder={t("section.size.auto")}
          disabled={disabled}
          increaseLabel={t("section.size.increase")}
          decreaseLabel={t("section.size.decrease")}
          onCommit={(value) => setTableHeaderSize(board, frame.id, "height", value)}
        />
        <NumberField
          label={t("section.size.headerWidth")}
          value={layout.headerWidth ?? null}
          min={64}
          max={2000}
          suffix={t("section.size.unit")}
          allowEmpty
          placeholder={t("section.size.auto")}
          disabled={disabled}
          increaseLabel={t("section.size.increase")}
          decreaseLabel={t("section.size.decrease")}
          onCommit={(value) => setTableHeaderSize(board, frame.id, "width", value)}
        />
      </div>
    </div>
  );
}
