/**
 * The image HTTP surface, as the browser sees it (ADR-249, `spec/images.md` §4.1).
 *
 * Three calls, one rule: the browser never talks to a bucket. Uploads go to the board,
 * reads name the room as context, and an original is only ever a download behind the
 * export right. `XMLHttpRequest` rather than `fetch` for the upload, because a 20 MiB
 * photo needs upload progress and a cancel button, and `fetch` has neither in every
 * browser we support.
 */
import { csrfToken } from "./csrf";
import { currentRoom } from "./identity";

/** §9.1: exactly the formats the server accepts; SVG and HEIC are out of scope. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

/** The MIME types behind that `accept` list, for a drag that carries no filename. */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/** The row the upload answers with, narrowed to what the client uses. */
export interface UploadedFile {
  id: string;
  width: number;
  height: number;
  dominantColor?: string;
  variants?: Record<string, { w: number; h: number; bytes?: number }>;
}

/** Why an upload failed, in the words §9.3 gives each cause. */
export type UploadFailure =
  | "too_large"
  | "bad_type"
  | "quota"
  | "room_images"
  | "busy"
  | "offline"
  | "cancelled"
  | "unknown";

export class ImageUploadError extends Error {
  constructor(
    readonly reason: UploadFailure,
    /** The room's image limit for `room_images`, straight from the 402. */
    readonly max?: number,
  ) {
    super(reason);
  }
}

/** §9.3: the reason for a status the server answered with. */
function reasonFor(status: number, code: string): UploadFailure {
  if (status === 413 || code === "TOO_LARGE") return "too_large";
  if (status === 415 || code === "BAD_TYPE") return "bad_type";
  if (status === 503 || status === 429 || code === "SERVER_BUSY" || code === "RATE_LIMITED") {
    return "busy";
  }
  return "unknown";
}

export interface UploadOptions {
  boardId: string;
  file: File;
  /** The object's centre in board units: the server creates the object there (§5.1). */
  at: { x: number; y: number };
  alt?: string;
  /**
   * The picture whose file this upload replaces (§5.3). The server then dispatches
   * `board.image.replace` instead of `board.image.create`, so no object is created and
   * there is nothing to adopt or delete afterwards.
   */
  replaceWidgetId?: string;
  onProgress?: (fraction: number) => void;
  /** Abort signal from the placeholder's ×; the request is cancelled, not just ignored. */
  signal?: AbortSignal;
}

/**
 * Upload one picture.
 *
 * Resolves after the server has written the file **and** created the object with one
 * command, so a 201 means "everybody sees it now" (`spec/images.md` §5.1). The response
 * describes the file; the object arrives through the document, like every other change.
 */
export function uploadImage({
  boardId,
  file,
  at,
  alt,
  replaceWidgetId,
  onProgress,
  signal,
}: UploadOptions): Promise<UploadedFile> {
  return new Promise<UploadedFile>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ImageUploadError("cancelled"));
      return;
    }
    const request = new XMLHttpRequest();
    request.open("POST", `/api/boards/${encodeURIComponent(boardId)}/files`);
    request.withCredentials = true;
    const token = csrfToken();
    if (token) request.setRequestHeader("X-CSRF-Token", token);

    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });

    const done = (run: () => void) => {
      signal?.removeEventListener("abort", abort);
      run();
    };

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(event.total > 0 ? event.loaded / event.total : 0);
    });
    request.addEventListener("load", () => {
      done(() => {
        let payload: Record<string, unknown> = {};
        try {
          payload = request.responseText ? JSON.parse(request.responseText) : {};
        } catch {
          payload = {};
        }
        if (request.status === 201 && payload.file) {
          resolve(payload.file as UploadedFile);
          return;
        }
        if (request.status === 402) {
          reject(
            new ImageUploadError(
              payload.limit === "room_images" ? "room_images" : "quota",
              typeof payload.max === "number" ? payload.max : undefined,
            ),
          );
          return;
        }
        reject(new ImageUploadError(reasonFor(request.status, String(payload.error ?? ""))));
      });
    });
    request.addEventListener("error", () => done(() => reject(new ImageUploadError("offline"))));
    request.addEventListener("abort", () =>
      done(() => reject(new ImageUploadError("cancelled"))),
    );

    const body = new FormData();
    body.append("file", file, file.name);
    body.append("x", String(at.x));
    body.append("y", String(at.y));
    if (alt) body.append("alt", alt);
    if (replaceWidgetId) body.append("replace", replaceWidgetId);
    request.send(body);
  });
}

/**
 * Copy a file into another organisation (`spec/images.md` §5.2).
 *
 * One organisation reuses the id and the server answers 200; across organisations the
 * bytes are copied under a new id and the target's quota grows.
 */
export async function copyFileToBoard(boardId: string, fileId: string): Promise<UploadedFile> {
  const token = csrfToken();
  const response = await fetch(
    `/api/boards/${encodeURIComponent(boardId)}/files/${encodeURIComponent(fileId)}/copy`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: token ? { "X-CSRF-Token": token } : {},
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status === 402) {
      throw new ImageUploadError(
        payload.limit === "room_images" ? "room_images" : "quota",
        typeof payload.max === "number" ? payload.max : undefined,
      );
    }
    throw new ImageUploadError(reasonFor(response.status, String(payload.error ?? "")));
  }
  const payload = (await response.json()) as { file: UploadedFile };
  return payload.file;
}

/**
 * The untouched original, as an attachment (§4.1).
 *
 * The room is part of the address because a file id alone does not say who is asking;
 * the server answers 404 without `board.export`, so the button is only shown to somebody
 * who has the right (`spec/images.md` §9.5).
 */
export function originalFileUrl(fileId: string, boardId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}/original?board=${encodeURIComponent(boardId)}`;
}

/**
 * Take the original as a file.
 *
 * A plain navigation, not a `fetch`: the response is an attachment and the browser owns
 * the save dialog. `download` is a hint only — the server's `Content-Disposition` decides.
 */
export function downloadOriginal(fileId: string, boardId: string = currentRoom()): void {
  const link = document.createElement("a");
  link.href = originalFileUrl(fileId, boardId);
  link.rel = "noopener";
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** One variant for a direct `<img>` (the canvas uses the decoded cache instead). */
export function imageVariantUrl(fileId: string, variant: string, boardId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}/${variant}?board=${encodeURIComponent(boardId)}`;
}
