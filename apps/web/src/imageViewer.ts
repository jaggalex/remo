import { useSyncExternalStore } from "react";

/**
 * Which picture is open in the viewer (`spec/images.md` §9.7).
 *
 * One tiny store instead of a prop: three different places open the same viewer — a double
 * click on the canvas, `Enter` on the selection, and the object bar — and none of them
 * sits next to the other. The viewer itself is mounted once; whoever opens it only names
 * an object id, and closing returns the id to nothing.
 */

let openId: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openImageViewer(id: string): void {
  if (openId === id) return;
  openId = id;
  emit();
}

export function closeImageViewer(): void {
  if (openId === null) return;
  openId = null;
  emit();
}

/** The object the viewer shows, or null when it is closed. */
export function useImageViewer(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => openId,
    () => null,
  );
}
