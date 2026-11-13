import { useSyncExternalStore } from "react";
import type { SectionTableMode } from "@remo/doc";

/**
 * The open "how to lay out the material" question (ADR-207, T4).
 *
 * Transient UI state: the panel and the context menu ask for it, the dialog and the
 * canvas preview read it, and nothing enters the document until Apply.
 */
export interface SectionLayoutRequest {
  frameId: string;
  mode: SectionTableMode;
}

let value: SectionLayoutRequest | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function sectionLayoutRequest(): SectionLayoutRequest | null {
  return value;
}

export function openSectionLayout(frameId: string): void {
  value = { frameId, mode: "first" };
  for (const listener of listeners) listener();
}

export function setSectionLayoutMode(mode: SectionTableMode): void {
  if (!value || value.mode === mode) return;
  value = { ...value, mode };
  for (const listener of listeners) listener();
}

export function closeSectionLayout(): void {
  if (!value) return;
  value = null;
  for (const listener of listeners) listener();
}

export function useSectionLayoutRequest(): SectionLayoutRequest | null {
  return useSyncExternalStore(subscribe, () => value, () => value);
}
