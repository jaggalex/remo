import { useSyncExternalStore } from "react";

/**
 * The table axis the person is working with (ADR-196).
 *
 * Axis selection is transient UI state, not a document field: the headers on the canvas
 * and the section panel must agree on it, but it is not part of the board and must not
 * enter undo. One small external store keeps that shared value without threading a
 * callback through the canvas, the inspector and the panel.
 */
export interface TableAxisSelection {
  frameId: string;
  axisId: string;
}

let value: TableAxisSelection | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setTableAxisSelection(next: TableAxisSelection | null): void {
  if (value?.frameId === next?.frameId && value?.axisId === next?.axisId) return;
  value = next;
  for (const listener of listeners) listener();
}

export function useTableAxisSelection(): TableAxisSelection | null {
  return useSyncExternalStore(subscribe, () => value, () => value);
}
