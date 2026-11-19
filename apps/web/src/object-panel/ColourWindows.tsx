import { Button, Segmented, Tooltip } from "@remo/ui";
import { FILL_LEVELS, SHAPE_PRESETS, inkFor, resolveColor, type ShapePreset } from "@remo/model";
import { useI18n } from "../i18n";
import {
  ColorGridSection,
  ColorRule,
  ColorWindow,
  InkSection,
} from "./ColorWindow";
import { isTransparent } from "./colorWindowData";
import type { StickyBarActions, StickyBarTarget } from "./stickyTypes";
import { DEFAULT_FILL, DEFAULT_INK, DEFAULT_LINE_STROKE } from "../objectDefaults";

/**
 * The colour window's content for a note, a shape and a free text object (ADR-127).
 *
 * One window per object, roles stacked in words. A note has a sheet and ink; a shape adds
 * its six presets and a border with width and dash; text has one role and no Auto, because
 * it has no fill to derive an ink from. The bars themselves only show the sample.
 */

export function NoteColourWindow({
  target,
  actions,
  onClose,
}: {
  target: StickyBarTarget;
  actions: StickyBarActions;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const fill = isTransparent(target.fillColor)
    ? "transparent"
    : resolveColor(target.fillColor);
  return (
    <ColorWindow title={t("note.sheetColour")} onClose={onClose}>
      <ColorGridSection
        ariaLabel={t("note.sheetColour")}
        levels={FILL_LEVELS}
        value={fill}
        role="note"
        onPick={actions.setColor}
        showKeys
      />
      <ColorRule />
      <InkSection
        label={t("object.text")}
        value={target.textColor}
        onChange={actions.setInk}
        hint={t("color.inkAutoHint")}
      />
    </ColorWindow>
  );
}

export function ShapeColourWindow({
  target,
  actions,
  onClose,
}: {
  target: StickyBarTarget;
  actions: StickyBarActions;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const fill = target.fillColor ?? DEFAULT_FILL;
  const stroke = target.strokeColor ?? DEFAULT_INK;
  const dash = target.strokeStyle === "dashed" ? "dashed" : "normal";
  const preset = SHAPE_PRESETS.find((entry) => shapePresetSelected(entry, target));

  return (
    <ColorWindow title={t("shape.style")} onClose={onClose}>
      <section className="cw-section">
        <div className="cw-head">
          <span className="cw-label">{t("color.presets")}</span>
          <span className="cw-value">
            {preset ? t(`preset.shape.${preset.id}` as "preset.shape.plain") : t("color.customStyle")}
          </span>
        </div>
        <div className="cw-presets" role="group" aria-label={t("color.presets")}>
          {SHAPE_PRESETS.map((entry) => {
            const name = t(`preset.shape.${entry.id}` as "preset.shape.plain");
            return (
              <Tooltip key={entry.id} label={name}>
                <Button
                  variant="ghost"
                  size="compact"
                  className={
                    entry.id === preset?.id ? "cw-preset is-selected" : "cw-preset"
                  }
                  aria-label={name}
                  selected={entry.id === preset?.id}
                  onClick={() => actions.applyShapePreset(entry)}
                >
                  <ShapeSample preset={entry} />
                </Button>
              </Tooltip>
            );
          })}
        </div>
      </section>
      <ColorRule />
      <ColorGridSection
        label={t("object.fill")}
        ariaLabel={t("object.fill")}
        levels={FILL_LEVELS}
        value={fill}
        role="fill"
        onPick={actions.setColor}
        showKeys
      />
      <ColorGridSection
        label={t("object.border")}
        ariaLabel={t("object.border")}
        levels={[600]}
        value={stroke}
        role="stroke"
        onPick={actions.setStroke}
      >
        <div className="cw-row">
          <Segmented
            label={t("shape.outlineWidth")}
            value={String(target.strokeWidth ?? 2)}
            options={[1, 2, 4].map((width) => ({
              value: String(width),
              label: String(width),
            }))}
            onChange={(next) => actions.setStrokeWidth(Number(next))}
          />
          <Segmented
            label={t("object.borderStyle")}
            value={dash}
            options={[
              { value: "normal", label: t("object.borderSolid") },
              { value: "dashed", label: t("object.borderDashed") },
            ]}
            onChange={(next) => actions.setStrokeStyle(next as "normal" | "dashed")}
          />
        </div>
      </ColorGridSection>
      <ColorRule />
      <InkSection
        label={t("object.text")}
        value={target.textColor}
        onChange={actions.setInk}
        hint={t("color.inkAutoHint")}
      />
    </ColorWindow>
  );
}

export function TextColourWindow({
  target,
  actions,
  onClose,
}: {
  target: StickyBarTarget;
  actions: StickyBarActions;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <ColorWindow title={t("object.text")} onClose={onClose}>
      <ColorGridSection
        ariaLabel={t("object.text")}
        levels={[600]}
        value={target.textColor ?? null}
        role="text"
        auto
        onAuto={() => actions.setInk(null)}
        onPick={actions.setInk}
        showKeys
      />
    </ColorWindow>
  );
}

/** A shape preset is the shape it produces: fill, border and width (ADR-120). */
function ShapeSample({ preset }: { preset: ShapePreset }) {
  const empty = isTransparent(preset.fill);
  return (
    <span
      className={empty ? "cw-aa-chip checkerboard" : "cw-aa-chip"}
      aria-hidden="true"
      style={{
        background: empty ? undefined : preset.fill,
        borderColor: preset.stroke,
        borderWidth: preset.strokeWidth ? Math.min(preset.strokeWidth, 2) : 0,
        color: inkFor(preset.fill),
      }}
    >
      Aa
    </span>
  );
}

/**
 * A shape preset is active only when all of its fields are on the object; a shape
 * recoloured by hand matches nothing, which is the honest answer (ADR-120).
 *
 * The fallbacks are the fields `createShape` writes for the "Plain" preset, so a shape
 * whose style was never touched is compared with what the painter actually draws.
 */
export function shapePresetSelected(preset: ShapePreset, target: StickyBarTarget): boolean {
  const fill = (target.fillColor ?? DEFAULT_FILL).toLowerCase();
  const stroke = (target.strokeColor ?? DEFAULT_LINE_STROKE).toLowerCase();
  return (
    fill === preset.fill.toLowerCase() &&
    stroke === preset.stroke.toLowerCase() &&
    (target.strokeWidth ?? 2) === preset.strokeWidth &&
    (target.strokeStyle ?? "normal") === "normal"
  );
}
