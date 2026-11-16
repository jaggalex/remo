import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, Input, Select, Textarea } from "@remo/ui";
import { useI18n } from "./i18n";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type BoardSettings,
} from "./settings";

/**
 * Settings dialog.
 *
 * Every value that changes how the board feels is here with a name and a sentence
 * about what it does, plus the whole object as JSON — so a number can be tried,
 * compared and pasted to a teammate instead of being a constant somebody has to
 * recompile (ADR-032).
 */
export function SettingsPanel({
  open,
  settings,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: BoardSettings;
  onChange: (settings: BoardSettings) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<BoardSettings>(settings);
  const [json, setJson] = useState(() => JSON.stringify(settings, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setJson(JSON.stringify(settings, null, 2));
    setError(null);
  }, [open, settings]);

  if (!open) return null;

  const patch = (next: BoardSettings) => {
    setDraft(next);
    setJson(JSON.stringify(next, null, 2));
    setError(null);
  };

  const number = (
    label: string,
    hint: string,
    value: number,
    set: (value: number) => void,
    step = 1,
    key?: string,
  ) => (
    <Input
      key={key}
      type="number"
      label={label}
      hint={hint}
      value={value}
      step={step}
      onChange={(event) => set(Number(event.target.value))}
    />
  );

  const applyJson = () => {
    try {
      patch(normalizeSettings(JSON.parse(json)));
    } catch {
      setError(t("settings.badJson"));
    }
  };

  return (
    <Dialog
      title={t("settings.title")}
      description={t("settings.note")}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            {t("settings.save")}
          </Button>
        </>
      }
    >
      <div className="settings-panel">
        <section>
          <h3>{t("settings.grid")}</h3>
          {number(
            t("settings.gridSize"),
            t("settings.gridSizeHint"),
            draft.grid.size,
            (size) => patch({ ...draft, grid: { ...draft.grid, size } }),
            4,
          )}
        </section>

        <section>
          <h3>{t("settings.gridStyle")}</h3>
          <Select
            label={t("settings.gridStyleLabel")}
            options={[
              { value: "lines", label: t("canvas.gridLines") },
              { value: "dots", label: t("canvas.gridDots") },
              { value: "off", label: t("canvas.gridOff") },
            ]}
              value={draft.grid.style}
              onChange={(event) =>
                patch({
                  ...draft,
                  grid: { ...draft.grid, style: event.target.value as BoardSettings["grid"]["style"] },
                })
              }
            />
        </section>

        <section>
          <h3>{t("settings.snapping")}</h3>
          {number(
            t("settings.threshold"),
            t("settings.thresholdHint"),
            draft.snapping.thresholdPx,
            (thresholdPx) => patch({ ...draft, snapping: { ...draft.snapping, thresholdPx } }),
          )}
          <Checkbox
            label={t("settings.guides")}
            hint={t("settings.guidesHint")}
              checked={draft.snapping.guides}
              onChange={(event) =>
                patch({ ...draft, snapping: { ...draft.snapping, guides: event.target.checked } })
              }
            />
        </section>

        <section>
          <h3>{t("settings.notes")}</h3>
          {number(
            t("settings.gapRatio"),
            t("settings.gapRatioHint"),
            draft.notes.gapRatio,
            (gapRatio) => patch({ ...draft, notes: { ...draft.notes, gapRatio } }),
            0.05,
          )}
          {number(
            t("settings.minGap"),
            t("settings.minGapHint"),
            draft.notes.minGap,
            (minGap) => patch({ ...draft, notes: { ...draft.notes, minGap } }),
            4,
          )}
          <div className="setting-row">
            {(["S", "M", "L"] as const).map((size) =>
              number(
                t("settings.fontCap", { size }),
                "",
                draft.notes.fontCap[size],
                (value) =>
                  patch({
                    ...draft,
                    notes: { ...draft.notes, fontCap: { ...draft.notes.fontCap, [size]: value } },
                  }),
                1,
                size,
              ),
            )}
          </div>
        </section>

        <section>
          <h3>{t("settings.connectors")}</h3>
          <Select
            label={t("settings.connectorShape")}
            options={[
              { value: "straight", label: t("line.straight") },
              { value: "elbowed", label: t("line.elbowed") },
              { value: "curved", label: t("line.curved") },
            ]}
              value={draft.connectors.shape}
              onChange={(event) =>
                patch({
                  ...draft,
                  connectors: { ...draft.connectors, shape: event.target.value as BoardSettings["connectors"]["shape"] },
                })
              }
            />
          {number(
            t("settings.connectorWidth"),
            t("settings.connectorWidthHint"),
            draft.connectors.width,
            (width) => patch({ ...draft, connectors: { ...draft.connectors, width } }),
          )}
          {number(
            t("settings.stubMax"),
            t("settings.stubMaxHint"),
            draft.connectors.stubMax,
            (stubMax) => patch({ ...draft, connectors: { ...draft.connectors, stubMax } }),
          )}
          {number(
            t("settings.stubRatio"),
            t("settings.stubRatioHint"),
            draft.connectors.stubRatio,
            (stubRatio) => patch({ ...draft, connectors: { ...draft.connectors, stubRatio } }),
            0.02,
          )}
        </section>

        <section>
          <h3>{t("settings.shapes")}</h3>
          {number(
            t("settings.shapeStroke"),
            t("settings.shapeStrokeHint"),
            draft.shapes.strokeWidth,
            (strokeWidth) => patch({ ...draft, shapes: { ...draft.shapes, strokeWidth } }),
          )}
        </section>

        <section>
          <h3>{t("settings.text")}</h3>
          <Input
            label={t("settings.fontFamily")}
            hint={t("settings.fontFamilyHint")}
              value={draft.text.fontFamily}
              onChange={(event) => patch({ ...draft, text: { fontFamily: event.target.value } })}
            />
        </section>

        <section>
          <h3>{t("settings.json")}</h3>
          <Textarea
            className="settings-json"
            rows={8}
            value={json}
            spellCheck={false}
            onChange={(event) => setJson(event.target.value)}
            aria-label={t("settings.json")}
          />
          {error && <p className="settings-error">{error}</p>}
          <div className="settings-actions">
            <Button size="compact" onClick={applyJson}>
              {t("settings.applyJson")}
            </Button>
            <Button size="compact" onClick={() => patch(DEFAULT_SETTINGS)}>
              {t("settings.reset")}
            </Button>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
