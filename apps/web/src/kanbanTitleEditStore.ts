import { useSyncExternalStore } from "react";

/**
 * The kanban title being edited on the canvas (ADR-244).
 *
 * Transient UI state with two ways in, one editor: a double click on the title and the
 * menu's «Переименовать» both open it; the canvas reads it and draws the field.
 */
export interface KanbanTitleEdit {
  kanbanId: string;
  kind: "column" | "lane";
  id: string;
}

let value: KanbanTitleEdit | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function openKanbanTitleEdit(edit: KanbanTitleEdit): void {
  value = edit;
  for (const listener of listeners) listener();
}

export function closeKanbanTitleEdit(): void {
  if (!value) return;
  value = null;
  for (const listener of listeners) listener();
}

export function useKanbanTitleEdit(): KanbanTitleEdit | null {
  return useSyncExternalStore(subscribe, () => value, () => null);
}
