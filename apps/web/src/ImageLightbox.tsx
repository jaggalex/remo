import { useEffect, useMemo, useRef, useState } from "react";
import type { Widget } from "@remo/model";
import { IconButton, Lightbox, Spinner } from "@remo/ui";
import { useI18n } from "./i18n";
import { downloadOriginal, imageVariantUrl } from "./apiFiles";
import { currentRoom } from "./identity";
import { useBoardCapability } from "./accessSnapshot";
import { closeImageViewer, useImageViewer } from "./imageViewer";

/**
 * The full-window view of one picture (`spec/images.md` §9.7).
 *
 * The bytes come from the same `/files/...` address the canvas uses — `w2048`, because a
 * viewer is the one place a picture is looked at, not glanced at. Zoom and pan are local
 * view state, never the document's: looking closely at a picture does not change the room.
 * Download is offered only with `board.export`, which is also the right the original route
 * checks, so the button and the answer cannot disagree.
 */
export function ImageLightbox({ widgets }: { widgets: Widget[] }) {
  const { t, typeName } = useI18n();
  const openId = useImageViewer();
  const widget = openId ? widgets.find((candidate) => candidate.id === openId) : undefined;
  const canExport = useBoardCapability("board.export");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** A drag is one gesture across many renders, so its start lives in a ref. */
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const image = widget?.type === "image" ? widget : undefined;
  const fileId = image?.fileId;
  const naturalWidth = image?.naturalWidth ?? 0;
  const naturalHeight = image?.naturalHeight ?? 0;

  // A different picture starts fitted, not at whatever the previous one was zoomed to.
  useEffect(() => {
    if (!openId) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setLoaded(false);
    setFailed(false);
  }, [openId]);

  // The object may disappear while the viewer is open (deleted elsewhere or by undo).
  useEffect(() => {
    if (openId && widgets.some((candidate) => candidate.id === openId)) return;
    if (openId) closeImageViewer();
  }, [openId, widgets]);

  const url = useMemo(
    () => (fileId ? imageVariantUrl(fileId, "w2048", currentRoom()) : ""),
    [fileId],
  );

  if (!openId) return null;
  if (!image) {
    // The object was deleted (or the link is stale): the viewer has nothing to show.
    return null;
  }

  const fitScale = () => {
    const box = bodyRef.current?.getBoundingClientRect();
    if (!box || !naturalWidth || !naturalHeight) return 1;
    return Math.min(box.width / naturalWidth, box.height / naturalHeight, 1);
  };

  const toggleFit = () => {
    const fit = fitScale();
    if (scale !== fit) {
      setScale(fit);
      setOffset({ x: 0, y: 0 });
      return;
    }
    // 100 %: one picture pixel per screen pixel. A small picture zooms in, a large one
    // overflows and is panned by dragging.
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <Lightbox
      title={image.name || image.alt || typeName("image")}
      subtitle={
        naturalWidth && naturalHeight
          ? `${naturalWidth} × ${naturalHeight}`
          : undefined
      }
      caption={image.alt ? t("image.lightbox.caption", { text: image.alt }) : undefined}
      onClose={closeImageViewer}
      actions={
        canExport && fileId ? (
          <IconButton
            icon="download"
            label={t("image.lightbox.download")}
            onClick={() => downloadOriginal(fileId)}
          />
        ) : undefined
      }
    >
      <div
        ref={bodyRef}
        className="image-lightbox-stage"
        title={t("image.lightbox.hint")}
        onDoubleClick={toggleFit}
        onWheel={(event) => {
          setScale((current) =>
            Math.min(8, Math.max(0.05, current * Math.exp(-event.deltaY * 0.002))),
          );
        }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setOffset({
            x: start.ox + (event.clientX - start.x),
            y: start.oy + (event.clientY - start.y),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {!loaded && !failed && (
          <span className="image-lightbox-loading">
            <Spinner />
          </span>
        )}
        {failed ? (
          <p className="image-lightbox-missing">{t("canvas.imageUnavailable")}</p>
        ) : (
          <img
            className="image-lightbox-picture"
            src={url}
            alt={image.alt || t("image.noDescription")}
            draggable={false}
            style={{
              width: naturalWidth ? naturalWidth * scale : undefined,
              height: naturalHeight ? naturalHeight * scale : undefined,
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }}
            onLoad={() => {
              setLoaded(true);
              // Open fitted: a 6000 px photo at 100 % would start cropped in every
              // direction, which reads as a bug rather than as a zoom level.
              setScale(fitScale());
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </Lightbox>
  );
}
