import { setTableHeaderText, type BoardDocument } from "@remo/doc";
import {
  FILL_LEVELS,
  tableHeaderTextStyle,
  type TableHeaderTextAlign,
  type TableHeaderTextWeight,
  type Widget,
} from "@remo/model";
import { Button, Checkbox, NumberField, Segmented } from "@remo/ui";
import { ColorGridSection } from "./object-panel/ColorWindow";
import { useI18n } from "./i18n";

/**
 * The one typography of every header in a table (ADR-220).
 *
 * Size, weight, italic, colour and alignment live in `appearance.headerText`; the
 * geometry and the painter read the same object, so the Auto band and the painted text
 * cannot disagree.
 */
export function TableHeaderTextControls({
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
  const style = tableHeaderTextStyle(layout);
  const weight =
    style.weight === "bold"
      ? t("section.look.weightBold")
      : style.weight === "medium"
        ? t("section.look.weightMedium")
        : t("section.look.weightRegular");
  const align =
    style.align === "center"
      ? t("section.look.alignCenter")
      : style.align === "right"
        ? t("section.look.alignRight")
        : t("section.look.alignLeft");

  if (disabled) {
    return (
      <div className="section-header-text">
        <span className="section-field-label">{t("section.look.headerText")}</span>
        <div className="section-readonly">
          <span>
            {t("section.look.headerTextSize")}: {style.size} {t("section.size.unit")} · {weight} ·{" "}
            {align}
            {style.italic ? ` · ${t("section.look.headerTextItalic")}` : ""}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="section-header-text">
      <span className="section-field-label">{t("section.look.headerText")}</span>
      <NumberField
        label={t("section.look.headerTextSize")}
        value={style.size}
        min={8}
        max={48}
        suffix={t("section.size.unit")}
        disabled={disabled}
        size="compact"
        increaseLabel={t("section.size.increase")}
        decreaseLabel={t("section.size.decrease")}
        onCommit={(value) => setTableHeaderText(board, frame.id, { size: value ?? 12 })}
      />
      <div className="section-header-choice">
        <span className="section-header-label">{t("section.look.headerTextWeight")}</span>
        <Segmented
          label={t("section.look.headerTextWeight")}
          value={style.weight}
          onChange={(value) =>
            setTableHeaderText(board, frame.id, { weight: value as TableHeaderTextWeight })
          }
          options={[
            { value: "regular", label: t("section.look.weightRegular"), disabled },
            { value: "medium", label: t("section.look.weightMedium"), disabled },
            { value: "bold", label: t("section.look.weightBold"), disabled },
          ]}
        />
      </div>
      <Checkbox
        className="section-check"
        label={t("section.look.headerTextItalic")}
        checked={style.italic}
        disabled={disabled}
        onChange={(event) =>
          setTableHeaderText(board, frame.id, { italic: event.currentTarget.checked })
        }
      />
      <div className="section-header-choice">
        <span className="section-header-label">{t("section.look.headerTextAlign")}</span>
        <Segmented
          label={t("section.look.headerTextAlign")}
          value={style.align}
          onChange={(value) =>
            setTableHeaderText(board, frame.id, { align: value as TableHeaderTextAlign })
          }
          options={[
            { value: "left", label: t("section.look.alignLeft"), disabled },
            { value: "center", label: t("section.look.alignCenter"), disabled },
            { value: "right", label: t("section.look.alignRight"), disabled },
          ]}
        />
      </div>
      <div className="section-header-color">
        <span className="section-header-label">{t("section.look.headerTextColor")}</span>
        <ColorGridSection
          ariaLabel={t("section.look.headerTextColor")}
          levels={FILL_LEVELS}
          value={style.color}
          auto={!style.color}
          autoLabel={t("section.look.default")}
          onAuto={() => setTableHeaderText(board, frame.id, { color: undefined })}
          onPick={(color) => setTableHeaderText(board, frame.id, { color })}
        />
      </div>
      <Button
        size="compact"
        variant="secondary"
        disabled={disabled}
        onClick={() => setTableHeaderText(board, frame.id, null)}
      >
        {t("section.look.reset")}
      </Button>
    </div>
  );
}
