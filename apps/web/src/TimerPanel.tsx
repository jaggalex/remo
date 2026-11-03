import { useState } from "react";
import { formatRemaining, type TimerPhase } from "@remo/model";
import { HelpLink } from "./help/HelpLink";
import { useI18n } from "./i18n";

/**
 * The shared timer's controls (ADR-075).
 *
 * The countdown itself lives on the board object and is painted from `endsAt`; this
 * panel is where a facilitator starts, pauses, extends or resets it. A viewer can open
 * it but sees only the state and who set it — facilitation is a capability, not a
 * hidden button.
 */
export function TimerPanel({
  open,
  phase,
  remainingMs,
  setBy,
  canFacilitate,
  onStart,
  onPause,
  onResume,
  onExtend,
  onReset,
  onClose,
}: {
  open: boolean;
  /** `idle` when there is no timer object yet. */
  phase: TimerPhase;
  remainingMs: number;
  setBy: string;
  canFacilitate: boolean;
  onStart: (minutes: number) => void;
  onPause: () => void;
  onResume: () => void;
  onExtend: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState(7);
  const presets = [1, 5, 10, 15];
  if (!open) return null;

  const running = phase === "running";
  const paused = phase === "paused";
  const started = phase !== "idle";

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="share-dialog timer-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("facilitation.timer.title")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="share-head">
          <div>
            <h2>
              {t("facilitation.timer.title")} <HelpLink topicId="facilitation.timer" />
            </h2>
            <p className="muted">{t("facilitation.timer.body")}</p>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label={t("facilitation.timer.close")}
          >
            ×
          </button>
        </header>

        <div className={`timer-face ${phase}`}>
          <strong>{formatRemaining(remainingMs)}</strong>
          <span>
            {phase === "expired"
              ? t("facilitation.timer.timeUp")
              : paused
                ? t("facilitation.timer.pausedBy", { name: setBy || "—" })
                : started
                  ? t("facilitation.timer.setBy", { name: setBy || "—" })
                  : t("facilitation.timer.idle")}
          </span>
        </div>

        {!canFacilitate ? (
          <p className="muted">{t("facilitation.timer.readOnly")}</p>
        ) : (
          <>
            {started && (
              <div className="timer-actions">
                {running && (
                  <button type="button" className="ghost-button" onClick={onPause}>
                    {t("facilitation.timer.pause")}
                  </button>
                )}
                {paused && (
                  <button type="button" className="ghost-button" onClick={onResume}>
                    {t("facilitation.timer.resume")}
                  </button>
                )}
                <button type="button" className="ghost-button" onClick={onExtend}>
                  {t("facilitation.timer.extend")}
                </button>
                <button type="button" className="ghost-button" onClick={onReset}>
                  {t("facilitation.timer.reset")}
                </button>
              </div>
            )}

            <section className="timer-section">
              <h3>{started ? t("facilitation.timer.restart") : t("facilitation.timer.start")}</h3>
              <div className="timer-presets">
                {presets.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className="export-choice"
                    onClick={() => onStart(minutes)}
                  >
                    <strong>{t("facilitation.timer.minutes", { n: minutes })}</strong>
                  </button>
                ))}
              </div>
              <div className="timer-custom">
                <label>
                  {t("facilitation.timer.custom")}
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={custom}
                    onChange={(event) => setCustom(Number(event.target.value) || 1)}
                  />
                </label>
                <button type="button" className="share-button" onClick={() => onStart(custom)}>
                  {t("facilitation.timer.start")}
                </button>
              </div>
              <p className="muted">{t("facilitation.timer.startHint")}</p>
            </section>
          </>
        )}
      </section>
    </div>
  );
}
