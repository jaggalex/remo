import {
  addAllFrames,
  movePresentationFrame,
  removePresentationFrame,
  type BoardDocument,
} from "@remo/doc";
import type { BoardConnection, Presence } from "@remo/doc";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { useI18n } from "./i18n";
import { HelpLink } from "./help/HelpLink";
import { usePresentation } from "./usePresentation";

/**
 * Presentation controls (ADR-108).
 *
 * A floating trigger and a compact panel keep the board readable; the presenter's live
 * state lives in awareness, and the order lives beside the frames in the document.
 */
export function PresentationLayer({
  board,
  widgets,
  camera,
  setCamera,
  connection,
  presence,
  canFacilitate,
  panelOpen,
  onPanelOpen,
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  setCamera: (camera: Camera) => void;
  connection: BoardConnection | null;
  presence: Presence[];
  canFacilitate: boolean;
  panelOpen: boolean;
  onPanelOpen: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const presentation = usePresentation({
    board,
    widgets,
    camera,
    setCamera,
    connection,
    presence,
    canFacilitate,
    panelOpen,
    setPanelOpen: onPanelOpen,
    t,
  });
  const frames = presentation.frames;
  const frameName = (id: string) =>
    widgets.find((widget) => widget.id === id)?.title || id;

  return (
    <>
      {presentation.local && (
        <div className="present-bar" role="status">
          <span>
            {t("presentation.slide", {
              current: (presentation.local.index ?? 0) + 1,
              total: frames.length,
            })}
          </span>
          <button type="button" onClick={presentation.previous} aria-label={t("presentation.previous")}>
            ‹
          </button>
          <button type="button" onClick={presentation.next} aria-label={t("presentation.next")}>
            ›
          </button>
          <button type="button" onClick={presentation.stop}>
            {t("presentation.stop")}
          </button>
        </div>
      )}

      {presentation.remote && !presentation.watching && (
        <div className="present-join" role="dialog" aria-label={t("presentation.title")}>
          <span>
            {t("presentation.running", {
              name: presentation.presenterName ?? t("presentation.someone"),
            })}
          </span>
          <button type="button" onClick={presentation.join}>
            {t("presentation.watch")}
          </button>
        </div>
      )}

      {presentation.remote && presentation.watching && (
        <div className="present-follow" role="status">
          <span>
            {t("presentation.watching", {
              name: presentation.presenterName ?? t("presentation.someone"),
            })}
          </span>
          <button type="button" onClick={presentation.returnToPresenter}>
            {t("presentation.return")}
          </button>
          <button type="button" onClick={presentation.leave}>
            {t("presentation.leave")}
          </button>
        </div>
      )}

      {presentation.notice && <div className="canvas-notice">{presentation.notice}</div>}

      {presentation.panelOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onPointerDown={() => presentation.setPanelOpen(false)}
        >
          <div
            className="presentation-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("presentation.title")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header>
              <b>
                {t("presentation.title")} <HelpLink topicId="presentation.mode" />
              </b>
              <button
                type="button"
                onClick={() => presentation.setPanelOpen(false)}
                aria-label={t("presentation.close")}
              >
                ✕
              </button>
            </header>
            <p className="muted">{t("presentation.hint")}</p>
            {frames.length === 0 && <p className="muted">{t("presentation.noFrames")}</p>}
            <ol className="presentation-list">
              {frames.map((id, index) => (
                <li key={id}>
                  <span>
                    {index + 1}. {frameName(id)}
                  </span>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => movePresentationFrame(board, id, index - 1)}
                    aria-label={t("presentation.up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === frames.length - 1}
                    onClick={() => movePresentationFrame(board, id, index + 1)}
                    aria-label={t("presentation.down")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removePresentationFrame(board, id)}
                    aria-label={t("presentation.remove")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
            <div className="presentation-actions">
              <button type="button" onClick={() => addAllFrames(board)}>
                {t("presentation.addAll")}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!canFacilitate || frames.length === 0}
                onClick={presentation.start}
              >
                {t("presentation.start")}
              </button>
            </div>
            {!canFacilitate && <p className="muted">{t("presentation.forbidden")}</p>}
          </div>
        </div>
      )}
    </>
  );
}
