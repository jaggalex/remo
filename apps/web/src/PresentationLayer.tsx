import { useEffect, useMemo, useState } from "react";
import {
  addAllFrames,
  addPresentationSlide,
  addPresentationSlides,
  movePresentationSlide,
  removePresentationSlide,
  slideLabel,
  type BoardDocument,
} from "@remo/doc";
import type { BoardConnection, Presence } from "@remo/doc";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { Button, Input } from "@remo/ui";
import { useI18n } from "./i18n";
import { HelpLink } from "./help/HelpLink";
import { usePresentation } from "./usePresentation";

/**
 * Presentation controls (ADR-108, ADR-165).
 *
 * A floating trigger and a compact panel keep the board readable; the presenter's live
 * state lives in awareness, and the order of any objects lives in the document.
 */
export function PresentationLayer({
  board,
  widgets,
  selectedIds,
  camera,
  setCamera,
  connection,
  presence,
  canFacilitate,
  panelOpen,
  onPanelOpen,
  onPresentingChange,
}: {
  board: BoardDocument;
  widgets: Widget[];
  selectedIds: readonly string[];
  camera: Camera;
  setCamera: (camera: Camera) => void;
  connection: BoardConnection | null;
  presence: Presence[];
  canFacilitate: boolean;
  panelOpen: boolean;
  onPanelOpen: (value: boolean) => void;
  /** Tells the canvas to hide state marks that are not content (ADR-193). */
  onPresentingChange: (presenting: boolean) => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
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

  useEffect(() => {
    onPresentingChange(Boolean(presentation.local || presentation.remote));
  }, [onPresentingChange, presentation.local, presentation.remote]);

  const slides = presentation.slides;
  const byId = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget])), [widgets]);
  const labelOf = (id: string) => {
    const widget = byId.get(id);
    return widget ? slideLabel(widget) : id;
  };
  // Names are not unique (ADR-165), so a short id keeps two same-named objects apart.
  const shortId = (id: string) => id.slice(0, 8);

  const chosen = new Set(slides);
  const needle = filter.trim().toLowerCase();
  const available = widgets
    .filter((widget) => !chosen.has(widget.id))
    .filter((widget) => !needle || slideLabel(widget).toLowerCase().includes(needle))
    .sort((a, b) => slideLabel(a).localeCompare(slideLabel(b)));
  const selectedOnBoard = selectedIds.filter((id) => byId.has(id) && !chosen.has(id));

  return (
    <>
      {presentation.local && (
        <div className="present-bar" role="status">
          <span>
            {t("presentation.slide", {
              current: (presentation.local.index ?? 0) + 1,
              total: slides.length,
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
            {slides.length === 0 && <p className="muted">{t("presentation.noSlides")}</p>}
            <ol className="presentation-list">
              {slides.map((id, index) => (
                <li key={id}>
                  <span>
                    {index + 1}. {labelOf(id)}{" "}
                    <span className="presentation-id">{shortId(id)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => movePresentationSlide(board, id, index - 1)}
                    aria-label={t("presentation.up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === slides.length - 1}
                    onClick={() => movePresentationSlide(board, id, index + 1)}
                    aria-label={t("presentation.down")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removePresentationSlide(board, id)}
                    aria-label={t("presentation.remove")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>

            <div className="presentation-picker">
              <Input
                type="search"
                size="compact"
                label={t("presentation.filter")}
                placeholder={t("presentation.filterPlaceholder")}
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
              />
              <ul className="presentation-available">
                {available.map((widget) => (
                  <li key={widget.id}>
                    <span>
                      {slideLabel(widget)}{" "}
                      <span className="presentation-id">{shortId(widget.id)}</span>
                    </span>
                    <Button
                      size="compact"
                      variant="secondary"
                      onClick={() => addPresentationSlide(board, widget.id)}
                    >
                      {t("presentation.add")}
                    </Button>
                  </li>
                ))}
              </ul>
              {available.length === 0 && widgets.length > 0 && (
                <p className="muted">{t("presentation.noAvailable")}</p>
              )}
            </div>

            <div className="presentation-actions">
              <Button variant="secondary" onClick={() => addAllFrames(board)}>
                {t("presentation.addAll")}
              </Button>
              <Button
                variant="secondary"
                disabled={selectedOnBoard.length === 0}
                onClick={() => addPresentationSlides(board, selectedOnBoard)}
              >
                {t("presentation.addSelection", { count: selectedOnBoard.length })}
              </Button>
              <Button
                variant="primary"
                disabled={!canFacilitate || slides.length === 0}
                onClick={presentation.start}
              >
                {t("presentation.start")}
              </Button>
            </div>
            {!canFacilitate && <p className="muted">{t("presentation.forbidden")}</p>}
          </div>
        </div>
      )}
    </>
  );
}
