import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { screenToWorld, type Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { Button, Icon, IconButton, ProgressRing } from "@remo/ui";
import { useI18n } from "./i18n";
import { IMAGE_ACCEPT } from "./apiFiles";
import {
  cancelImageUpload,
  dismissImageUpload,
  hoveredPoint,
  imageUploads,
  pickerRequests,
  progressQuarter,
  retryImageUpload,
  setHoverPoint,
  startImageUploads,
  subscribeImages,
  unsupportedLabel,
  type IntakeUpload,
} from "./imageIntake";
import { ImageDropFrame } from "./BoardOverlays";
import { QuotaNotice } from "./QuotaNotice";
import { requestBillingTab } from "./billingNav";

/**
 * The canvas end of an upload: drop, paste, picker and the placeholders (§9.2, §9.3).
 *
 * One component owns every way a picture can arrive, because all three end in the same
 * two things — a world point and a placeholder only its author can see. The server makes
 * the object, so this file never writes the document: it waits for the object to appear
 * with the file id it uploaded, then selects it. Until then the picture on screen is a
 * placeholder over the canvas, not an object in the room.
 */

interface Props {
  boardRef: React.RefObject<HTMLCanvasElement | null>;
  camera: Camera;
  viewport: { width: number; height: number };
  widgets: Widget[];
  readOnly: boolean;
  onSelect: (ids: string[]) => void;
  onNotice: (text: string) => void;
}

/** Where a placeholder sits on screen at this camera: the object's own box, scaled. */
function boxStyle(upload: IntakeUpload, camera: Camera, viewport: { width: number; height: number }) {
  const width = Math.max(1, upload.width * camera.zoom);
  const height = Math.max(1, upload.height * camera.zoom);
  return {
    left: (upload.x - camera.x) * camera.zoom + viewport.width / 2 - width / 2,
    top: (upload.y - camera.y) * camera.zoom + viewport.height / 2 - height / 2,
    width,
    height,
  };
}

export function ImageIntake({
  boardRef,
  camera,
  viewport,
  widgets,
  readOnly,
  onSelect,
  onNotice,
}: Props) {
  const { t, count } = useI18n();
  const uploads = useSyncExternalStore(subscribeImages, imageUploads, imageUploads);
  const input = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  /** The last quarter announced per upload, so the live region speaks four times, not forty. */
  const announced = useRef(new Map<string, number>());
  /** Objects this batch already selected: a drop of five selects all five, not the last. */
  const selectedBatch = useRef<string[]>([]);
  /** The quota notice the author closed; a new refusal is a new id and speaks again. */
  const [quotaDismissed, setQuotaDismissed] = useState<string | null>(null);

  const worldAt = useCallback(
    (clientX: number, clientY: number) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return { x: camera.x, y: camera.y };
      return screenToWorld(
        camera,
        { x: 0, y: 0, width: rect.width, height: rect.height },
        { x: clientX - rect.left, y: clientY - rect.top },
      );
    },
    [boardRef, camera],
  );

  const overCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return false;
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    },
    [boardRef],
  );

  /** The middle of the view: where a file chosen from the picker lands. */
  const viewCentre = useCallback(() => ({ x: camera.x, y: camera.y }), [camera]);

  const start = useCallback(
    (files: File[], at: { x: number; y: number }, centred = false) => {
      void startImageUploads(files, at, { centred }).then((result) => {
        if (!result.rejected.length) return;
        // "2 of 3 files can be added: PDF is not supported" (§9.2). The good ones are
        // already uploading; the sentence is about the ones that are not.
        const kinds = [...new Set(result.rejected.map(unsupportedLabel))].join(", ");
        onNotice(
          t("image.drop.partial", {
            supported: result.started,
            total: result.started + result.rejected.length,
            types: kinds,
          }),
        );
      });
    },
    [onNotice, t],
  );

  /** The rail and `I` open the system picker (the canvas is where the camera is). */
  const requests = useSyncExternalStore(subscribeImages, pickerRequests, pickerRequests);
  const seenRequest = useRef(requests);
  useEffect(() => {
    if (requests === seenRequest.current) return;
    seenRequest.current = requests;
    if (!readOnly) input.current?.click();
  }, [readOnly, requests]);

  /** Drag and drop over the canvas, with the frame that says what will happen. */
  useEffect(() => {
    if (readOnly) return;
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Anything outside the board keeps its own drop behaviour — a field in a dialog, a
      // panel — so the canvas claims the event only inside its own rectangle.
      if (!overCanvas(event.clientX, event.clientY)) {
        setDragging(0);
        return;
      }
      event.preventDefault();
      setHoverPoint(worldAt(event.clientX, event.clientY));
      setDragging(event.dataTransfer?.items.length || 1);
    };
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(0);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(0);
      if (!overCanvas(event.clientX, event.clientY)) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      // The point of release is the point of insertion (§9.2), not the middle of the view.
      start(files, worldAt(event.clientX, event.clientY));
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [overCanvas, readOnly, start, worldAt]);

  /** Pointer position, so a paste lands under the cursor when it is over the canvas. */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!overCanvas(event.clientX, event.clientY)) {
        setHoverPoint(null);
        return;
      }
      setHoverPoint(worldAt(event.clientX, event.clientY));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [overCanvas, worldAt]);

  /**
   * Pasted pictures.
   *
   * ⌘V is handled by the paste command, which asks the clipboard API first (a screenshot
   * wins over text there). This listener is the second door: a paste event carries the
   * files even when `navigator.clipboard.read()` is refused.
   */
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (!files.length) return;
      event.preventDefault();
      const point = hoveredPoint() ?? viewCentre();
      start(files, point, true);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [readOnly, start, viewCentre]);

  /**
   * Leaving the room mid-upload asks first (§9.3).
   *
   * The browser owns the wording and only shows it when the page really is going away; the
   * listener exists only while something is in flight, so an ordinary reload stays quiet.
   */
  useEffect(() => {
    if (!uploads.some((upload) => upload.status === "uploading" || upload.status === "preparing")) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older engines need a return value to show the prompt at all.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [uploads]);

  // A new batch starts a new selection; an empty queue forgets the last one.
  useEffect(() => {
    if (uploads.length === 0) selectedBatch.current = [];
  }, [uploads.length]);

  /** Progress is spoken in quarters, never per percent (§9.10). */
  useEffect(() => {
    for (const upload of uploads) {
      if (upload.status !== "uploading") continue;
      const quarter = progressQuarter(upload.progress);
      const before = announced.current.get(upload.id) ?? 0;
      if (quarter <= before) continue;
      announced.current.set(upload.id, quarter);
      setAnnouncement(
        t("image.upload.progress", { name: upload.name, percent: quarter * 25 }),
      );
    }
    for (const key of [...announced.current.keys()]) {
      if (!uploads.some((upload) => upload.id === key)) announced.current.delete(key);
    }
  }, [t, uploads]);

  /**
   * The object appears through the document; this is where the placeholder becomes it.
   *
   * Selecting by file id (not by a response field) is what keeps one source of truth: the
   * server never tells the client which object it made, because the document already does.
   */
  useEffect(() => {
    const done = uploads.filter((upload) => upload.status === "done" && upload.fileId);
    if (!done.length) return;
    const found: string[] = [];
    for (const upload of done) {
      const widget = widgets.find(
        (candidate) => candidate.type === "image" && candidate.fileId === upload.fileId,
      );
      if (!widget) continue;
      found.push(widget.id);
      dismissImageUpload(upload.id);
      setAnnouncement(t("image.upload.done", { name: upload.name }));
    }
    if (!found.length) return;
    // The batch grows as each upload finishes, so the selection is the running set: the
    // last picture to arrive must not replace the four that came before it (§9.2).
    const batch = [...new Set([...selectedBatch.current, ...found])];
    selectedBatch.current = batch;
    onSelect(batch);
  }, [onSelect, t, uploads, widgets]);

  const pickFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    start(list, viewCentre(), true);
  };

  // One notice for the batch, not one per file: the cause is the same for all of them.
  const quotaUpload = uploads.find(
    (upload) =>
      upload.status === "error" && (upload.reason === "quota" || upload.reason === "room_images"),
  );

  return (
    <>
      <input
        ref={input}
        type="file"
        className="image-intake-input"
        accept={IMAGE_ACCEPT}
        multiple
        // The rail button is the control; this input is opened by it and never focused.
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          pickFiles(event.currentTarget.files);
          // The same file may be chosen again after a cancel.
          event.currentTarget.value = "";
        }}
      />
      {dragging > 0 && !readOnly && <ImageDropFrame label={count("images", dragging)} />}
      {quotaUpload && quotaDismissed !== quotaUpload.id && (
        <QuotaNotice
          title={
            quotaUpload.reason === "room_images"
              ? t("image.error.roomImages", { max: quotaUpload.max ?? 500 })
              : t("image.error.quota")
          }
          text={
            quotaUpload.reason === "room_images"
              ? t("storage.quota.roomBody")
              : t("storage.quota.body")
          }
          onSeePlans={() => requestBillingTab(null)}
          onDismiss={() => setQuotaDismissed(quotaUpload.id)}
        />
      )}
      <div className="image-intake" aria-hidden={uploads.length === 0 ? true : undefined}>
        {uploads.map((upload) => {
          const style = boxStyle(upload, camera, viewport);
          const percent = Math.round(upload.progress * 100);
          return (
            <div
              key={upload.id}
              className={`image-slot is-${upload.status}`}
              style={style}
              role="group"
              aria-label={upload.name}
            >
              {upload.previewUrl && (
                <img className="image-slot-preview" src={upload.previewUrl} alt="" />
              )}
              {upload.status === "error" ? (
                <div className="image-slot-body">
                  <p className="image-slot-title">
                    <Icon name="alert" size={14} />
                    {t("image.error.unknown")}
                  </p>
                  <p className="image-slot-reason">{reasonText(t, upload)}</p>
                  <div className="image-slot-actions">
                    <Button size="compact" onClick={() => retryImageUpload(upload.id)}>
                      {t("image.upload.retry")}
                    </Button>
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => dismissImageUpload(upload.id)}
                    >
                      {t("image.upload.remove")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="image-slot-mask">
                    <ProgressRing value={upload.progress} label={upload.name} />
                  </div>
                  <div className="image-slot-foot">
                    <span className="image-slot-name" title={upload.name}>
                      {middleTruncate(upload.name)}
                    </span>
                    <IconButton
                      icon="close"
                      label={t("image.upload.cancel")}
                      size="compact"
                      onClick={() => cancelImageUpload(upload.id)}
                    />
                  </div>
                  <span className="rm-sr">{t("image.upload.progress", { name: upload.name, percent })}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="rm-sr" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

/**
 * A long file name keeps both ends: "screenshot-20…-11.png" says more than
 * "screenshot-2026-11-…", because the extension and the tail are what name the file.
 */
function middleTruncate(name: string, limit = 28): string {
  if (name.length <= limit) return name;
  const head = Math.ceil((limit - 1) / 2);
  const tail = Math.floor((limit - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}

/** The sentence for one failed upload, in the words §9.3 promises. */
function reasonText(t: ReturnType<typeof useI18n>["t"], upload: IntakeUpload): string {
  switch (upload.reason) {
    case "too_large":
      return t("image.error.tooLarge");
    case "bad_type":
      return t("image.error.badType");
    case "quota":
      return t("image.error.quota");
    case "room_images":
      return t("image.error.roomImages", { max: upload.max ?? 500 });
    case "busy":
      return t("image.error.busy");
    case "offline":
      return t("image.error.offline");
    default:
      return t("image.error.unknown");
  }
}
