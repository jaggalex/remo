import { currentRoom } from "./identity";
import { ImageUploadError, uploadImage, type UploadFailure } from "./apiFiles";

/**
 * Pictures arriving on the board: picker, drop, paste and the upload placeholders.
 *
 * The server owns the object — it creates it with one command after the bytes and the row
 * are written (`spec/images.md` §5.1) — so this module owns the other half of that rule:
 * until a `201` arrives nobody but the author sees anything, and what the author sees is a
 * placeholder with a progress ring and a cancel button.
 *
 * The store lives outside React because three surfaces start an upload (the rail, a drop
 * on the canvas, a paste) and one surface draws them. A pure helper set is exported beside
 * it so placement and validation are tested without a browser.
 */

/** Longest side of a new object in board units (§3.2); the server applies the same rule. */
export const IMAGE_LONG_SIDE = 480;
/** Pictures per row when a drop carries several (§9.2). */
export const IMAGE_GRID_COLUMNS = 4;
/**
 * Gap between pictures in a batch, in board units — the canvas twin of `--space-4`.
 *
 * Geometry in board units cannot read a CSS length, so the number is written here, in the
 * one place that lays a batch out; the DOM overlay around a single object uses the token.
 */
export const IMAGE_GRID_GAP = 24;
/** The MIME types the picker and the drop accept (§9.1); SVG and HEIC are out of scope. */
const SUPPORTED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** A file's type, from its MIME when the browser knows it and its extension otherwise. */
export function imageTypeOf(file: File): string | null {
  const type = (file.type ?? "").toLowerCase();
  if (SUPPORTED.has(type)) return type;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name ?? "")?.[1]?.toLowerCase();
  const fromName = extension ? EXTENSIONS[extension] : undefined;
  return fromName ?? null;
}

export function isImageFile(file: File): boolean {
  return imageTypeOf(file) !== null;
}

/** "PDF", "SVG", "HEIC" — how a refusal names the files it could not take (§9.2). */
export function unsupportedLabel(file: File): string {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name ?? "")?.[1];
  if (extension) return extension.toUpperCase();
  const subtype = (file.type ?? "").split("/")[1];
  return (subtype || "?").toUpperCase();
}

/** Split a drop into what can be added and what cannot, without dropping either. */
export function splitFiles(files: readonly File[]): { supported: File[]; rejected: File[] } {
  const supported: File[] = [];
  const rejected: File[] = [];
  for (const file of files) (isImageFile(file) ? supported : rejected).push(file);
  return { supported, rejected };
}

/** The object a picture becomes: long side ≤ 480 and never larger than the picture. */
export function imageBox(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  const width = Math.max(1, Math.round(naturalWidth));
  const height = Math.max(1, Math.round(naturalHeight));
  const longest = Math.max(width, height);
  const scale = longest > IMAGE_LONG_SIDE ? IMAGE_LONG_SIDE / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface IntakeBox {
  width: number;
  height: number;
}

/**
 * Centres of a batch, in rows of four, starting at `origin` (the drop point).
 *
 * Columns are as wide as the widest picture in them and rows as tall as the tallest, so a
 * mixed batch never overlaps and never leaves a picture hanging half a gap off its row.
 */
export function gridCentres(
  boxes: readonly IntakeBox[],
  origin: { x: number; y: number },
  gap: number = IMAGE_GRID_GAP,
  columns: number = IMAGE_GRID_COLUMNS,
): Array<{ x: number; y: number }> {
  if (!boxes.length) return [];
  const perRow = Math.max(1, columns);
  const rows = Math.ceil(boxes.length / perRow);
  const columnWidths = new Array<number>(Math.min(perRow, boxes.length)).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  boxes.forEach((box, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, box.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, box.height);
  });
  const columnX: number[] = [];
  let x = origin.x;
  for (let column = 0; column < columnWidths.length; column += 1) {
    columnX[column] = x;
    x += (columnWidths[column] ?? 0) + gap;
  }
  const rowY: number[] = [];
  let y = origin.y;
  for (let row = 0; row < rowHeights.length; row += 1) {
    rowY[row] = y;
    y += (rowHeights[row] ?? 0) + gap;
  }
  return boxes.map((box, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    return {
      // A narrow picture is centred in its column rather than pinned to the left edge.
      x: (columnX[column] ?? origin.x) + (columnWidths[column] ?? box.width) / 2,
      y: (rowY[row] ?? origin.y) + (rowHeights[row] ?? box.height) / 2,
    };
  });
}

/** The whole batch as one box, so a paste can be centred on a point instead of a corner. */
export function gridExtent(
  boxes: readonly IntakeBox[],
  gap: number = IMAGE_GRID_GAP,
  columns: number = IMAGE_GRID_COLUMNS,
): { width: number; height: number } {
  if (!boxes.length) return { width: 0, height: 0 };
  const centres = gridCentres(boxes, { x: 0, y: 0 }, gap, columns);
  const perRow = Math.max(1, columns);
  const rows = Math.ceil(boxes.length / perRow);
  const width = Math.max(
    ...centres.map((centre, index) => centre.x + (boxes[index]?.width ?? 0) / 2),
  );
  const height = Math.max(
    ...centres.map((centre, index) => {
      const row = Math.floor(index / perRow);
      return row < rows ? centre.y + (boxes[index]?.height ?? 0) / 2 : 0;
    }),
  );
  return { width, height };
}

/** The origin that centres a batch on `point` — where a paste lands (§9.2). */
export function gridOriginForCentre(
  boxes: readonly IntakeBox[],
  point: { x: number; y: number },
  gap: number = IMAGE_GRID_GAP,
  columns: number = IMAGE_GRID_COLUMNS,
): { x: number; y: number } {
  const extent = gridExtent(boxes, gap, columns);
  return { x: point.x - extent.width / 2, y: point.y - extent.height / 2 };
}

/** The quarter of the way a progress announcement has reached (§9.10: at most every 25 %). */
export function progressQuarter(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(4, Math.max(0, Math.floor(fraction * 4)));
}

/* --------------------------------------------------------------- the store -- */

export type IntakeStatus = "preparing" | "uploading" | "done" | "error";

export interface IntakeUpload {
  id: string;
  file: File;
  name: string;
  /** The object's size in board units, and its centre: what the placeholder draws. */
  width: number;
  height: number;
  x: number;
  y: number;
  /** The local preview, shown under the progress mask; revoked when the upload ends. */
  previewUrl: string | null;
  progress: number;
  status: IntakeStatus;
  /** When the batch was started; a duplicate paste within half a second is dropped. */
  startedAt: number;
  /** The stored file, once the server has it: how the board finds the new object. */
  fileId?: string;
  reason?: UploadFailure;
  /** For `room_images`: the room's limit, straight from the 402. */
  max?: number;
}

let uploads: IntakeUpload[] = [];
let pickerRequest = 0;
/** Where the pointer last was over the canvas, in board units; a paste uses it if present. */
let hoverPoint: { x: number; y: number } | null = null;
const listeners = new Set<() => void>();
const aborters = new Map<string, AbortController>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function imageUploads(): readonly IntakeUpload[] {
  return uploads;
}

export function pickerRequests(): number {
  return pickerRequest;
}

/** Ask the mounted board to open the system file picker (rail button, `I`). */
export function requestImagePicker(): void {
  pickerRequest += 1;
  emit();
}

export function setHoverPoint(point: { x: number; y: number } | null): void {
  hoverPoint = point;
}

export function hoveredPoint(): { x: number; y: number } | null {
  return hoverPoint;
}

function patch(id: string, changes: Partial<IntakeUpload>): void {
  uploads = uploads.map((item) => (item.id === id ? { ...item, ...changes } : item));
  emit();
}

function remove(id: string): void {
  const item = uploads.find((candidate) => candidate.id === id);
  if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  aborters.get(id)?.abort();
  aborters.delete(id);
  uploads = uploads.filter((candidate) => candidate.id !== id);
  emit();
}

/** The picture's own pixels, measured locally so the placeholder has the final shape. */
async function measure(file: File): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const box = imageBox(bitmap.width, bitmap.height);
    bitmap.close?.();
    return box;
  } catch {
    // A format the browser cannot decode locally (some AVIF builds) still uploads: the
    // server measures it and the placeholder takes a square until then.
    return imageBox(320, 320);
  }
}

async function run(item: IntakeUpload): Promise<void> {
  const controller = new AbortController();
  aborters.set(item.id, controller);
  patch(item.id, { status: "uploading", progress: 0, reason: undefined });
  try {
    const stored = await uploadImage({
      boardId: currentRoom(),
      file: item.file,
      at: { x: item.x, y: item.y },
      signal: controller.signal,
      onProgress: (fraction) => patch(item.id, { progress: fraction }),
    });
    // The object exists in the document now. The board finds it by this file id, selects
    // it and removes the placeholder; the bytes on screen and the object are one state.
    patch(item.id, { status: "done", progress: 1, fileId: stored.id });
  } catch (failure) {
    if (failure instanceof ImageUploadError && failure.reason === "cancelled") return;
    const reason = failure instanceof ImageUploadError ? failure.reason : "offline";
    const max = failure instanceof ImageUploadError ? failure.max : undefined;
    patch(item.id, { status: "error", reason, max, progress: 0 });
  } finally {
    aborters.delete(item.id);
  }
}

/** Upload a batch one at a time: the queue is the server's bottleneck, not the browser's. */
async function pump(queue: IntakeUpload[]): Promise<void> {
  for (const item of queue) {
    if (!uploads.some((candidate) => candidate.id === item.id)) continue;
    await run(item);
  }
}

/**
 * Start uploading pictures dropped or pasted at `origin`.
 *
 * Unsupported files are the caller's news to tell (§9.2): this function only takes the
 * ones it can upload and returns how many it refused.
 */
export async function startImageUploads(
  files: readonly File[],
  anchor: { x: number; y: number },
  { centred = false }: { centred?: boolean } = {},
): Promise<{ started: number; rejected: File[] }> {
  const { supported, rejected } = splitFiles(files);
  if (!supported.length) return { started: 0, rejected };
  // One picture must not be uploaded twice because a browser delivered both the paste
  // command and the paste event. The same file within half a second is one drop.
  const now = Date.now();
  const queued = new Set(
    uploads
      .filter((item) => now - item.startedAt < 500)
      .map((item) => `${item.name}:${item.file.size}:${item.file.lastModified}`),
  );
  const unique = supported.filter((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (queued.has(key)) return false;
    queued.add(key);
    return true;
  });
  if (!unique.length) return { started: 0, rejected };
  const measured = await Promise.all(
    unique.map(async (file) => ({ file, box: await measure(file) })),
  );
  const boxes = measured.map((entry) => entry.box);
  // A drop starts at the point it was released; a paste is centred on the cursor or the
  // middle of the view, so the batch does not hang half a screen to one side (§9.2).
  const origin = centred ? gridOriginForCentre(boxes, anchor) : anchor;
  const centres = gridCentres(boxes, origin);
  const batch: IntakeUpload[] = measured.map((entry, index) => {
    const centre = centres[index] ?? { x: origin.x, y: origin.y };
    return {
      id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      file: entry.file,
      name: entry.file.name || "image",
      width: entry.box.width,
      height: entry.box.height,
      x: Math.round(centre.x),
      y: Math.round(centre.y),
      previewUrl: URL.createObjectURL(entry.file),
      progress: 0,
      status: "preparing",
      startedAt: Date.now(),
    };
  });
  uploads = [...uploads, ...batch];
  emit();
  void pump(batch);
  return { started: batch.length, rejected };
}

export function cancelImageUpload(id: string): void {
  remove(id);
}

export function retryImageUpload(id: string): void {
  const item = uploads.find((candidate) => candidate.id === id);
  if (!item || item.status !== "error") return;
  void run(item);
}

export function dismissImageUpload(id: string): void {
  remove(id);
}
