import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  fitToBounds,
  proposalLayout,
  type ProposalLayout,
  type ProposalPlan,
} from "@remo/canvas";
import type { Widget } from "@remo/model";
import { cameraStore } from "./cameraStore";

/**
 * The plan under review, shared between the task panel and the canvas (ADR-188).
 *
 * The panel lives in the dialog tree and the canvas in the board tree; neither should
 * re-render the other's ancestors, so the plan sits outside React like the camera does.
 * The panel publishes what it shows and clears it when it closes; the overlay paints it.
 * Nothing here touches the document.
 */
export interface ProposalPreview {
  /** Changes when the plan changes (a new task, a relayout): the canvas refits once. */
  key: string;
  plan: ProposalPlan;
  /** Screen pixels the panel covers at the bottom; the fit keeps the plan above it. */
  bottomInset: number;
}

class ProposalStore {
  private value: ProposalPreview | null = null;
  private listeners = new Set<() => void>();

  get = (): ProposalPreview | null => this.value;

  set = (next: ProposalPreview | null): void => {
    if (next === this.value) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const proposalStore = new ProposalStore();

/** The layout the overlay last painted, for the dev probe (`window.__remo.proposal`). */
let painted: ProposalLayout | null = null;
export function paintedProposal(): ProposalLayout | null {
  return painted;
}

export function useProposal(): ProposalPreview | null {
  return useSyncExternalStore(proposalStore.subscribe, proposalStore.get, proposalStore.get);
}

/**
 * The layout the overlay paints, and one camera fit per plan.
 *
 * The fit happens when a plan first appears (or is laid out again), never on later room
 * edits: a person who panned away keeps their camera. The plan is framed in the part of
 * the canvas the panel does not cover.
 */
export function useProposalLayout(
  resolve: (id: string) => Widget | undefined,
  viewport: { width: number; height: number },
): ProposalLayout | null {
  const proposal = useProposal();
  const layout = useMemo(
    () => (proposal ? proposalLayout(proposal.plan, resolve) : null),
    [proposal, resolve],
  );
  painted = layout;
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!proposal) {
      fitted.current = null;
      return;
    }
    if (fitted.current === proposal.key || !layout?.bounds) return;
    if (!viewport.width || !viewport.height) return;
    const visible = Math.max(viewport.height - proposal.bottomInset, viewport.height * 0.4);
    const camera = fitToBounds(
      {
        ...layout.bounds,
        width: Math.max(layout.bounds.width, 1),
        height: Math.max(layout.bounds.height, 1),
      },
      { x: 0, y: 0, width: viewport.width, height: visible },
      0.85,
    );
    // Never zoom in past 100 %: two small notes would fill the screen and lose the room.
    camera.zoom = Math.min(camera.zoom, 1);
    // Centre the plan in the uncovered part: shift the camera down by half the inset.
    const shift = (viewport.height - visible) / 2 / camera.zoom;
    cameraStore.set({ ...camera, y: camera.y + shift }, "fit");
    fitted.current = proposal.key;
  }, [proposal, layout, viewport.width, viewport.height]);
  return layout;
}
