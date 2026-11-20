import type { ImageVariant } from "@remo/canvas";
import { currentRoom } from "./identity";

/**
 * Decoded pictures, shared by the canvas and the export (ADR-249).
 *
 * A picture is decoded once per variant and kept as an `ImageBitmap`: painting a
 * bitmap is a `drawImage`, while decoding a WebP on every frame would be work the
 * compositor cannot reuse. The cache is bounded by decoded pixels, deduplicates
 * concurrent requests (two objects referring to one file, or a repaint while the
 * first request is in flight), and refuses to retry a failure more often than once
 * per 30 seconds — otherwise a missing file would produce one request per frame.
 *
 * `load` is injected, so the LRU, the queue and the backoff are tested without a
 * browser and without a server.
 */

export interface ImageCacheEvent {
  fileId: string;
  variant: ImageVariant;
  /** True when the bitmap arrived; false when the request failed. */
  ok: boolean;
}

export interface ImageCacheOptions {
  /** Fetch and decode one variant; null means the file is gone or unreadable. */
  load: (fileId: string, variant: ImageVariant) => Promise<ImageBitmap | null>;
  /** Decoded bytes kept before the least recently used entry is dropped. */
  budgetBytes?: number;
  /** Requests in flight at once. */
  maxParallel?: number;
  /** A failed file is tried again only after this long (`spec/images.md` §6). */
  retryAfterMs?: number;
  /** Injectable clock, so the backoff is tested without waiting. */
  now?: () => number;
  /** Called whenever a request finishes, successfully or not. */
  onLoaded?: (event: ImageCacheEvent) => void;
}

export interface ImageCache {
  /** A decoded bitmap, or null while it loads, after a failure, or in backoff. */
  load(fileId: string, variant: ImageVariant): Promise<ImageBitmap | null>;
  /** The bitmap only if it is already decoded; never starts a request. */
  peek(fileId: string, variant: ImageVariant): ImageBitmap | null;
  /** Where a key stands, for the painter's loading and unavailable placeholders. */
  status(fileId: string, variant: ImageVariant): "idle" | "loading" | "ready" | "error";
  /** Decoded entries; the tests use it, the product does not. */
  readonly size: number;
  /** Decoded bytes currently held. */
  readonly bytes: number;
  /** Repaint when something arrives; returns the unsubscribe function. */
  subscribe(listener: (event: ImageCacheEvent) => void): () => void;
  clear(): void;
}

interface Entry {
  bitmap: ImageBitmap;
  bytes: number;
}

interface Job {
  fileId: string;
  variant: ImageVariant;
  key: string;
  resolve: (bitmap: ImageBitmap | null) => void;
}

const keyOf = (fileId: string, variant: ImageVariant): string => `${fileId}/${variant}`;

export function createImageCache(options: ImageCacheOptions): ImageCache {
  const budget = options.budgetBytes ?? 256 * 1024 * 1024;
  const maxParallel = Math.max(1, options.maxParallel ?? 6);
  const retryAfter = options.retryAfterMs ?? 30_000;
  const now = options.now ?? Date.now;

  /** Map order is the LRU order: the oldest entry is first. */
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<ImageBitmap | null>>();
  const failedAt = new Map<string, number>();
  const queue: Job[] = [];
  const listeners = new Set<(event: ImageCacheEvent) => void>();
  let running = 0;
  let bytes = 0;
  let generation = 0;

  const emit = (event: ImageCacheEvent) => {
    options.onLoaded?.(event);
    for (const listener of listeners) listener(event);
  };

  const evict = () => {
    // Keep the newest entry even when it alone exceeds the budget: closing the bitmap
    // the caller is about to paint would turn a large picture into a broken one.
    while (bytes > budget && entries.size > 1) {
      const oldest = entries.keys().next().value;
      if (oldest == null) break;
      const entry = entries.get(oldest);
      entries.delete(oldest);
      if (entry) {
        bytes -= entry.bytes;
        entry.bitmap.close?.();
      }
    }
  };

  const store = (key: string, bitmap: ImageBitmap) => {
    // A repaint must find this on the next frame; touching means re-inserting.
    const existing = entries.get(key);
    if (existing) {
      bytes -= existing.bytes;
      entries.delete(key);
    }
    const size = Math.max(1, bitmap.width) * Math.max(1, bitmap.height) * 4;
    entries.set(key, { bitmap, bytes: size });
    bytes += size;
    evict();
  };

  const pump = () => {
    while (running < maxParallel && queue.length) {
      const job = queue.shift()!;
      const startedIn = generation;
      running += 1;
      void options
        .load(job.fileId, job.variant)
        .then((bitmap) => {
          if (startedIn !== generation) {
            job.resolve(null);
            return;
          }
          if (bitmap) {
            failedAt.delete(job.key);
            store(job.key, bitmap);
            emit({ fileId: job.fileId, variant: job.variant, ok: true });
            job.resolve(bitmap);
          } else {
            failedAt.set(job.key, now());
            emit({ fileId: job.fileId, variant: job.variant, ok: false });
            job.resolve(null);
          }
        })
        .catch(() => {
          if (startedIn === generation) {
            failedAt.set(job.key, now());
            emit({ fileId: job.fileId, variant: job.variant, ok: false });
          }
          job.resolve(null);
        })
        .finally(() => {
          // The slot is free even when `clear` happened while this request was out;
          // the count belongs to the queue, not to the generation.
          running = Math.max(0, running - 1);
          pump();
        });
    }
  };

  return {
    load(fileId, variant) {
      const key = keyOf(fileId, variant);
      const entry = entries.get(key);
      if (entry) {
        // Touch: delete and re-insert moves the key to the young end of the map.
        entries.delete(key);
        entries.set(key, entry);
        return Promise.resolve(entry.bitmap);
      }
      const pending = inflight.get(key);
      if (pending) return pending;

      const failed = failedAt.get(key);
      if (failed != null && now() - failed < retryAfter) return Promise.resolve(null);

      const promise = new Promise<ImageBitmap | null>((resolve) => {
        queue.push({ fileId, variant, key, resolve });
      });
      inflight.set(key, promise);
      void promise.finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
      pump();
      return promise;
    },

    peek(fileId, variant) {
      const key = keyOf(fileId, variant);
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      entries.set(key, entry);
      return entry.bitmap;
    },

    status(fileId, variant) {
      const key = keyOf(fileId, variant);
      if (entries.has(key)) return "ready";
      if (inflight.has(key)) return "loading";
      const failed = failedAt.get(key);
      if (failed != null && now() - failed < retryAfter) return "error";
      return "idle";
    },

    get size() {
      return entries.size;
    },

    get bytes() {
      return bytes;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    clear() {
      // Requests already in flight finish and free their slots; their results are
      // dropped, because the generation moved on.
      generation += 1;
      for (const job of queue.splice(0)) job.resolve(null);
      for (const entry of entries.values()) entry.bitmap.close?.();
      entries.clear();
      failedAt.clear();
      inflight.clear();
      bytes = 0;
    },
  };
}

/**
 * One read path: the app's own origin, with the room as context.
 *
 * Sync checks view access to that room and that the room really uses the file, and
 * answers 404 otherwise; the browser never holds a bucket URL (`spec/images.md` §1).
 */
export async function fetchBoardImage(
  fileId: string,
  variant: ImageVariant,
  boardId: string = currentRoom(),
): Promise<ImageBitmap | null> {
  const response = await fetch(
    `/api/files/${encodeURIComponent(fileId)}/${variant}?board=${encodeURIComponent(boardId)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) return null;
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/**
 * The tab's cache. One instance, because the budget is a property of the tab rather
 * than of a component: the export and the canvas must see the same decoded pictures.
 */
export const boardImageCache: ImageCache = createImageCache({
  load: (fileId, variant) => fetchBoardImage(fileId, variant),
});
