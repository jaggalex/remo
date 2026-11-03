import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

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
    <label className="setting" key={key}>
      <span className="setting-label">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(event) => set(Number(event.target.value))}
      />
      <small>{hint}</small>
    </label>
  );

  const applyJson = () => {
    try {
      patch(normalizeSettings(JSON.parse(json)));
    } catch {
      setError(t("settings.badJson"));
    }
  };

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
      <div className="settings-panel">
        <header>
          <h2>{t("settings.title")}</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label={t("settings.close")}>
            ✕
          </button>
        </header>

        <p className="muted settings-note">{t("settings.note")}</p>

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
          <label className="setting">
            <span className="setting-label">{t("settings.gridStyleLabel")}</span>
            <select
              value={draft.grid.style}
              onChange={(event) =>
                patch({
                  ...draft,
                  grid: { ...draft.grid, style: event.target.value as BoardSettings["grid"]["style"] },
                })
              }
            >
              <option value="lines">{t("canvas.gridLines")}</option>
              <option value="dots">{t("canvas.gridDots")}</option>
              <option value="off">{t("canvas.gridOff")}</option>
            </select>
          </label>
        </section>

        <section>
          <h3>{t("settings.snapping")}</h3>
          {number(
            t("settings.threshold"),
            t("settings.thresholdHint"),
            draft.snapping.thresholdPx,
            (thresholdPx) => patch({ ...draft, snapping: { ...draft.snapping, thresholdPx } }),
          )}
          <label className="setting setting-check">
            <span className="setting-label">{t("settings.guides")}</span>
            <input
              type="checkbox"
              checked={draft.snapping.guides}
              onChange={(event) =>
                patch({ ...draft, snapping: { ...draft.snapping, guides: event.target.checked } })
              }
            />
            <small>{t("settings.guidesHint")}</small>
          </label>
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
          <label className="setting">
            <span className="setting-label">{t("settings.connectorShape")}</span>
            <select
              value={draft.connectors.shape}
              onChange={(event) =>
                patch({
                  ...draft,
                  connectors: { ...draft.connectors, shape: event.target.value as BoardSettings["connectors"]["shape"] },
                })
              }
            >
              <option value="straight">{t("line.straight")}</option>
              <option value="elbowed">{t("line.elbowed")}</option>
              <option value="curved">{t("line.curved")}</option>
            </select>
          </label>
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
          <label className="setting">
            <span className="setting-label">{t("settings.fontFamily")}</span>
            <input
              type="text"
              value={draft.text.fontFamily}
              onChange={(event) => patch({ ...draft, text: { fontFamily: event.target.value } })}
            />
            <small>{t("settings.fontFamilyHint")}</small>
          </label>
        </section>

        <section>
          <h3>{t("settings.json")}</h3>
          <textarea
            className="settings-json"
            value={json}
            spellCheck={false}
            onChange={(event) => setJson(event.target.value)}
            aria-label={t("settings.json")}
          />
          {error && <p className="settings-error">{error}</p>}
          <div className="settings-actions">
            <button type="button" onClick={applyJson}>
              {t("settings.applyJson")}
            </button>
            <button type="button" onClick={() => patch(DEFAULT_SETTINGS)}>
              {t("settings.reset")}
            </button>
          </div>
        </section>

        <footer className="settings-footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t("settings.cancel")}
          </button>
          <button
            type="button"
            className="share-button"
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            {t("settings.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
