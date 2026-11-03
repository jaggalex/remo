import { useEffect } from "react";
import type { BoardDocument } from "@remo/doc";
import { rigidWaypoints, type Widget } from "@remo/model";
import { isEditable } from "./BoardCanvas";
import { commandForShortcut, type CommandContext } from "./commands";
import type { RailTool } from "./ToolRail";

/**
 * Keyboard: undo/redo, clipboard, groups, delete, escape. Mirrors the source product's
 * keys, and the same shortcuts the command registry already describes.
 *
 * One listener for the whole board. It is the third surface of the command list —
 * alongside the menu and the panel — so a key cannot do something the registry does not
 * know about (ADR-050).
 */
export function useBoardKeyboard({
  board,
  writeBlocked,
  editingId,
  selectedIds,
  widgets,
  focusedWaypoint,
  setFocusedWaypoint,
  onDeleteWaypoint,
  onMoveWaypoint,
  commandContext,
  addConnectedNote,
  setEditingId,
  setSelectedIds,
  setBoardsOpen,
  forceRender,
  pasteSelection,
  onTool,
  onTone,
}: {
  board: BoardDocument;
  writeBlocked: boolean;
  editingId: string | null;
  selectedIds: string[];
  widgets: Widget[];
  focusedWaypoint: { connectorId: string; waypointId: string } | null;
  setFocusedWaypoint: (point: { connectorId: string; waypointId: string } | null) => void;
  onDeleteWaypoint: (connectorId: string, waypointId: string) => void;
  onMoveWaypoint: (connectorId: string, waypointId: string, x: number, y: number) => void;
  commandContext: CommandContext;
  addConnectedNote: (id: string, side: "left" | "right") => void;
  setEditingId: (id: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  setBoardsOpen: (update: boolean | ((open: boolean) => boolean)) => void;
  forceRender: (update: (n: number) => number) => void;
  /** Only a dependency: a stale command context must not keep the old listener. */
  pasteSelection: unknown;
  /** Creation from the rail; one function shared by clicks and keys (ADR-119). */
  onTool?: (tool: RailTool) => void;
  /** Keys 1–7 paint the main colour of the selection (ADR-127). */
  onTone?: (toneIndex: number) => void;
}) {
useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    // An offline overflow or a revoked write permission stops every mutating
    // shortcut; copy, the board palette and Escape still work.
    if (
      writeBlocked &&
      !(mod && key === "c") &&
      !(mod && key === "k") &&
      event.key !== "Escape"
    ) {
      return;
    }

    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) board.redoOnce();
      else board.undoOnce();
      forceRender((n) => n + 1);
      return;
    }

    if (!editingId && selectedIds.length === 1) {
      const only = widgets.find((widget) => widget.id === selectedIds[0]);
      if (only?.type === "connector") {
        const points = rigidWaypoints(only);
        if (event.key === "Tab") {
          if (!points.length) return;
          event.preventDefault();
          const current = focusedWaypoint?.connectorId === only.id
            ? points.findIndex((point) => point.id === focusedWaypoint.waypointId)
            : -1;
          const next = event.shiftKey
            ? current <= 0 ? points.length - 1 : current - 1
            : (current + 1) % points.length;
          setFocusedWaypoint({ connectorId: only.id, waypointId: points[next]!.id });
          return;
        }
        if (focusedWaypoint?.connectorId === only.id) {
          const point = points.find((candidate) => candidate.id === focusedWaypoint.waypointId);
          if (point) {
            if (event.key === "Escape") {
              event.preventDefault();
              setFocusedWaypoint(null);
              return;
            }
            if (event.key === "Delete" || event.key === "Backspace") {
              event.preventDefault();
              onDeleteWaypoint(only.id, point.id);
              setFocusedWaypoint(null);
              return;
            }
            const step = event.shiftKey ? 10 : 1;
            const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
            const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
            if (dx || dy) {
              event.preventDefault();
              onMoveWaypoint(only.id, point.id, point.x + dx, point.y + dy);
              return;
            }
          }
        }
      }
    }

    const command = commandForShortcut(event, commandContext);
    if (command) {
      event.preventDefault();
      command.run(commandContext);
      return;
    }

    if (mod && key === "k") {
      // The same shortcut the source product uses to get to things.
      event.preventDefault();
      setBoardsOpen((value) => !value);
      return;
    }

    // The colour keys (ADR-127). A digit is a colour, not a tool: it paints the main role
    // of the selection and says so under the grid. Input fields returned above, a modal or
    // an open menu owns the keyboard, and a held digit does not repaint the board.
    if (
      onTone &&
      !mod &&
      !event.altKey &&
      !event.shiftKey &&
      !event.repeat &&
      /^[1-7]$/.test(event.key)
    ) {
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      event.preventDefault();
      onTone(Number(event.key) - 1);
      return;
    }

    if (event.key === "Escape") {
      setEditingId(null);
      setSelectedIds([]);
      setBoardsOpen(false);
      return;
    }

    if (event.key === "Tab" && !editingId && selectedIds.length === 1) {
      const only = widgets.find((w) => w.id === selectedIds[0]);
      if (only && (only.type === "sticky_note" || only.type === "text")) {
        event.preventDefault();
        addConnectedNote(only.id, event.shiftKey ? "left" : "right");
      }
      return;
    }

    if (event.key === "Enter" && !editingId && selectedIds.length === 1) {
      const target = widgets.find((w) => w.id === selectedIds[0]);
      if (target && isEditable(target)) {
        event.preventDefault();
        setEditingId(target.id);
      }
      return;
    }

    // Tool keys (ADR-119). They create at once; there is no placement mode, so the
    // shortcut is the same action as a rail click. A modal owns the keyboard while it
    // is open, and a held key must not pour objects onto the board.
    if (onTool && !mod && !event.altKey && !event.repeat) {
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      if (event.shiftKey) {
        if (key === "n") {
          event.preventDefault();
          onTool("sticky-stack");
        }
        return;
      }
      const tools: Record<string, RailTool> = {
        v: "select",
        n: "sticky",
        t: "text",
        r: "rectangle",
        o: "ellipse",
        l: "connector",
        f: "frame",
        c: "card",
      };
      const tool = tools[key];
      if (tool) {
        event.preventDefault();
        onTool(tool);
      }
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [
  addConnectedNote,
  board,
  commandContext,
  editingId,
  focusedWaypoint,
  onDeleteWaypoint,
  onMoveWaypoint,
  onTool,
  onTone,
  pasteSelection,
  selectedIds,
  widgets,
  writeBlocked,
]);
}
