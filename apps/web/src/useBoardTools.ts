import { useMemo, useState } from "react";
import type { Widget, KanbanState, ShapeKind } from "@remo/model";
import type { RailTool } from "./ToolRail";
import { cardTargetFor } from "./cardTarget";
import { useI18n } from "./i18n";
import { noteFillChoices, noteFillExtras } from "./object-panel/palette";

/**
 * The rail's behaviour, in one place (ADR-119).
 *
 * Clicking a tool and pressing its key run the same function, so the two can never
 * drift. A tool without variants creates at once; a tool with variants opens a flyout
 * and creates the chosen sample. There is no "active tool" mode: the canvas keeps its
 * select-and-drag gestures, and the rail returns to Select after every creation.
 */
export function useBoardTools({
  widgets,
  selectedIds,
  kanbanStates,
  writeBlocked,
  blockedHint,
  canComment,
  canUndo,
  canRedo,
  undo,
  redo,
  canConnect,
  connectSelection,
  createSticky,
  createStickyStack,
  createText,
  createShape,
  createFrame,
  createCard,
  openComment,
  notify,
  setSelectedIds,
}: {
  widgets: Widget[];
  selectedIds: readonly string[];
  kanbanStates: Record<string, KanbanState>;
  writeBlocked: boolean;
  /** Why creation is off; the rail and the canvas HUD show it in a tooltip. */
  blockedHint: string;
  canComment: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  canConnect: boolean;
  connectSelection: () => void;
  createSticky: (fill?: string) => void;
  createStickyStack: () => void;
  createText: () => void;
  createShape: (kind: ShapeKind) => void;
  createFrame: () => void;
  createCard: () => boolean;
  openComment: () => void;
  notify: (message: string) => void;
  setSelectedIds: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [flyout, setFlyout] = useState<"sticky" | "shape" | null>(null);

  /**
   * The fill grid of the colour window, read once: the rail is a shortcut into the same
   * fourteen colours, not a second list (ADR-127).
   */
  const noteColors = useMemo(() => noteFillChoices(), []);
  /** The named chips come from the model list the note window uses (ADR-140). */
  const noteExtras = useMemo(() => noteFillExtras(), []);

  const canAddCard = Boolean(cardTargetFor(widgets, selectedIds, kanbanStates));

  const run = (tool: RailTool, fill?: string) => {
    switch (tool) {
      case "select":
        setSelectedIds([]);
        break;
      case "sticky":
        createSticky(fill);
        setFlyout(null);
        break;
      case "sticky-stack":
        createStickyStack();
        break;
      case "text":
        createText();
        break;
      case "rectangle":
      case "ellipse":
      case "diamond":
        createShape(tool);
        setFlyout(null);
        break;
      case "connector":
        if (canConnect) connectSelection();
        else notify(t("tool.connectorHint"));
        break;
      case "frame":
        createFrame();
        break;
      case "card":
        if (!createCard()) notify(t("tool.cardHint"));
        break;
      case "comment":
        openComment();
        break;
    }
  };

  const rail = {
    writeBlocked,
    blockedHint,
    canComment,
    flyout,
    onFlyout: setFlyout,
    onSelect: () => run("select"),
    onSticky: (fill?: string) => run("sticky", fill),
    onText: () => run("text"),
    onShape: (kind: ShapeKind) => {
      createShape(kind);
      setFlyout(null);
    },
    onConnector: () => run("connector"),
    onFrame: () => run("frame"),
    onCard: () => run("card"),
    onComment: () => run("comment"),
    canUndo,
    canRedo,
    onUndo: undo,
    onRedo: redo,
    canConnect,
    canAddCard,
    noteColors,
    noteExtras,
  };

  return { rail, run };
}
