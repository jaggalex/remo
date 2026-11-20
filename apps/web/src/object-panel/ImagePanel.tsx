import { useRef, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import { fitImageToNaturalSize, replaceImageFile, setImageAlt } from "@remo/doc";
import { Button, IconButton, Menu } from "@remo/ui";
import { useI18n } from "../i18n";
import { IMAGE_ACCEPT, ImageUploadError, downloadOriginal, uploadImage } from "../apiFiles";
import { currentRoom } from "../identity";
import { useBoardCapability } from "../accessSnapshot";
import { openImageViewer } from "../imageViewer";
import { ObjectBar } from "./ObjectBar";
import { usePopover } from "../usePopover";
import { useMenuFocus } from "../useMenuFocus";
import { PanelWindow } from "./PanelWindow";
import { ImageAltWindow } from "./ImageAltWindow";

/**
 * The object bar of a selected picture (`spec/images.md` §9.5).
 *
 * Replace · Description · Open · More. A picture has no colour, size preset or text mark,
 * so the note bar would be empty furniture; what a picture does have is a file behind it,
 * a description in front of it and a viewer over it. Everything here is one document edit
 * or one upload — there is no third kind of action.
 */

export interface ImageBarTarget {
  id: string;
  /** Screen box and placement, for the shared bar frame. */
  rect: { left: number; top: number; width: number; height: number };
  placement: { left: number; top: number };
  /** Centre in board units: where a replacement file's object would land. */
  x: number;
  y: number;
  width: number;
  alt?: string;
  fileId?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  /** A locked picture has no Replace, and Description and the size change are refused. */
  locked: boolean;
}

type PopoverName = "alt" | "more" | null;

export function ImagePanel({
  target,
  board,
  onNotice,
}: {
  target: ImageBarTarget | null;
  board: BoardDocument;
  onNotice: (text: string) => void;
}) {
  const { t } = useI18n();
  const canExport = useBoardCapability("board.export");
  const { open, setOpen, ref } = usePopover<PopoverName>(target?.id);
  const moreRef = useMenuFocus(open, "more");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  if (!target) return null;

  /**
   * The upload route creates an object (`spec/images.md` §4.1 has no "bytes only" call), so
   * a replacement adopts it: the object the server just made is removed in the same
   * transaction that puts its file behind this one. Until the document delivers it, there
   * is nothing to remove, and the replacement still applies to this object.
   */
  const waitForStray = async (fileId: string): Promise<string | null> => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const stray = board
        .readWidgets()
        .find(
          (widget) =>
            widget.type === "image" && widget.fileId === fileId && widget.id !== target.id,
        );
      if (stray) return stray.id;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return null;
  };

  const replace = async (file: File) => {
    setBusy(true);
    try {
      const stored = await uploadImage({
        boardId: currentRoom(),
        file,
        at: { x: target.x, y: target.y },
      });
      const stray = await waitForStray(stored.id);
      replaceImageFile(
        board,
        target.id,
        {
          fileId: stored.id,
          naturalWidth: stored.width,
          naturalHeight: stored.height,
          dominantColor: stored.dominantColor,
        },
        stray ?? undefined,
      );
    } catch (failure) {
      const reason = failure instanceof ImageUploadError ? failure.reason : "unknown";
      onNotice(
        reason === "too_large"
          ? t("image.error.tooLarge")
          : reason === "bad_type"
            ? t("image.error.badType")
            : reason === "quota" || reason === "room_images"
              ? t("image.error.quota")
              : t("image.error.unknown"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ObjectBar ref={ref} placement={target.placement} label={t("sticky.properties")}>
      <input
        ref={input}
        type="file"
        className="image-intake-input"
        accept={IMAGE_ACCEPT}
        // The bar's Replace button is the control; this input is opened by it.
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void replace(file);
        }}
      />
      {/* A locked picture has no Replace at all: the lock is the answer, not a greyed
          button that would explain itself on hover (§9.5). */}
      {!target.locked && (
        <Button size="compact" loading={busy} onClick={() => input.current?.click()}>
          {t("image.replace")}
        </Button>
      )}
      <span className="sb-divider" aria-hidden="true" />
      <span className="sb-anchor">
        <Button
          size="compact"
          variant="ghost"
          disabled={target.locked}
          aria-expanded={open === "alt"}
          onClick={() => setOpen(open === "alt" ? null : "alt")}
        >
          {t("image.description")}
        </Button>
        {open === "alt" && (
          <ImageAltWindow
            alt={target.alt ?? ""}
            onSave={(value) => setImageAlt(board, target.id, value)}
            onClose={() => setOpen(null)}
          />
        )}
      </span>
      <IconButton
        icon="eye"
        size="compact"
        label={t("image.open")}
        onClick={() => openImageViewer(target.id)}
      />
      <span className="sb-more" ref={moreRef}>
        <IconButton
          icon="more"
          size="compact"
          label={t("sticky.more")}
          aria-expanded={open === "more"}
          selected={open === "more"}
          onClick={() => setOpen(open === "more" ? null : "more")}
        />
        {open === "more" && (
          <PanelWindow>
            <Menu
              label={t("sticky.more")}
              onClose={() => setOpen(null)}
              items={[
                ...(canExport && target.fileId
                  ? [
                      {
                        label: t("image.downloadOriginal"),
                        icon: "download" as const,
                        onSelect: () => {
                          downloadOriginal(target.fileId!);
                          setOpen(null);
                        },
                      },
                    ]
                  : []),
                {
                  label: t("image.naturalSize"),
                  icon: "fit" as const,
                  disabled: target.locked,
                  onSelect: () => {
                    fitImageToNaturalSize(board, target.id);
                    setOpen(null);
                  },
                },
              ]}
            />
          </PanelWindow>
        )}
      </span>
    </ObjectBar>
  );
}
