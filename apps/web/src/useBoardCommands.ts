import { useCallback, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  addConnectorWaypoint,
  alignWidgets,
  copyFragment,
  createConnectedNote,
  distributeWidgets,
  createConnector,
  createSticky,
  deleteConnectorWaypoint,
  deleteWidgets,
  groupWidgets,
  moveCard,
  moveConnectorWaypoint,
  moveSelectionToCell,
  moveWidgets,
  noteMarksOf,
  pasteFragment,
  reattachConnectorEnd,
  setConnectorProps,
  setConnectorRouting,
  setFillColor,
  setNoteFontSize,
  setNoteTextAlign,
  setNoteTextVAlign,
  setShapeStyle,
  setStickySize,
  setTextColor,
  toggleNoteMark,
  ungroupWidgets,
  setWidgetDelta,
  setWidgetText,
  swapConnectorEnds,
  type BoardDocument,
  type BoardFragment,
  type AlignEdge,
  type ConnectorOptions,
  type ConnectorPatch,
  type DistributeAxis,
  type NoteDirection,
  type StyleSnapshot,
  type WidgetPosition,
  type WidgetRect,
  transformSelection,
} from "@remo/doc";
import {
  newId,
  linePresetStyle,
  shapePresetStyle,
  stickyFill,
  type KanbanState,
  type LinePreset,
  type ShapePreset,
  type StickySize,
  type TextDeltaOp,
  type ConnectorSide,
  type TextMarks,
  type Widget,
} from "@remo/model";
import type { ArrangeBarActions } from "./ArrangeBar";
import type { ConnectorBarActions } from "./ConnectorBar";
import { mainLevel, sharedFillLevel, toneColor } from "./object-panel/colorWindowData";
import { decodeFragment, encodeFragment, readClipboard, writeClipboard } from "./clipboard";
import { isGroupable, selectionHasGroup, type CommandContext } from "./commands";
import { useBoardCreation } from "./useBoardCreation";
import type { BoardSettings } from "./settings";
import { DEFAULT_FILL } from "./objectDefaults";

/**
 * Everything the UI can do to the board, in one hook (ADR-060).
 *
 * These callbacks were two thirds of `App.tsx`: each a thin, correct wrapper over a
 * document command, each needing the same board, selection and settings. Moving them out
 * leaves the app with state, effects, the menu and the JSX.
 */

export interface BoardCommandDeps {
  board: BoardDocument;
  widgets: Widget[];
  selectedIds: string[];
  /** Kanban matrices, so a card can be created into a real cell from the rail. */
  kanbanStates: Record<string, KanbanState>;
  settings: BoardSettings;
  /** This tab's last copied fragment, for paste on plain HTTP. */
  clipboardFragment: MutableRefObject<BoardFragment | null>;
  /** The last line style the person used; new lines inherit it. */
  lastConnector: MutableRefObject<ConnectorOptions>;
  /** Copy style / paste style. */
  styleClipboard: MutableRefObject<StyleSnapshot | null>;
  setSelectedIds: (ids: string[]) => void;
  setEditingId: (id: string | null) => void;
  /** Opens the Info card; the app owns that state. */
  openInfo: (widget: Widget, x: number, y: number) => void;
  /** Ask before a delete that may take connectors with it. */
  requestDelete: (ids: readonly string[]) => void;
  /** Where the last context menu was opened, so Info can be anchored there. */
  menuPoint: MutableRefObject<{ x: number; y: number } | null>;
  /** Copy a board deep link to one object (ADR-103); the app owns the URL. */
  copyLink: (id: string) => void;
  /** The signed-in person, for the author lock (ADR-107). */
  actor: { id: string | null; name: string };
  /** `board.manage` on this board: the escape hatch for somebody else's lock. */
  canManage: boolean;
  /** Show why a lock could not be released; the app owns the notice. */
  refuseUnlock: (authorName: string) => void;
  /** Open the tidy dialog; the app owns the dialog, the preview and the plan. */
  onTidy: (ids: readonly string[]) => void;
  /** Gather a compatible selection into one section (ADR-198). */
  onGather: (ids: readonly string[]) => void;
}

export function useBoardCommands(deps: BoardCommandDeps) {
  const {
    board,
    widgets,
    selectedIds,
    kanbanStates,
    settings,
    clipboardFragment,
    lastConnector,
    styleClipboard,
    setSelectedIds,
    setEditingId,
    openInfo,
    menuPoint,
    requestDelete,
    copyLink,
    actor,
    canManage,
    refuseUnlock,
    onTidy,
    onGather,
  } = deps;

  const {
    onAddCard,
    onAddColumn,
    nextSpot,
    addSticky,
    addStickyStack,
    addText,
    addCardFromSelection,
    canJoinSelection,
    addFrame,
    addShape,
  } = useBoardCreation({
    board,
    widgets,
    selectedIds,
    kanbanStates,
    settings,
    setSelectedIds,
    startEditing: setEditingId,
  });

  const textOf = useCallback((id: string) => board.textOf(id), [board]);
  const deltaOf = useCallback((id: string) => board.deltaOf(id), [board]);

  /**
   * Typing streams into the document; the editing session is one undo step.
   *
   * The note does **not** grow: it keeps its size and Auto text shrinks to fit
   * (ADR-027), which is why typing a lot into a sticky makes the letters smaller
   * instead of the note taller. Resizing is a deliberate gesture with its own handle.
   */
  const onSetText = useCallback(
    (id: string, delta: TextDeltaOp[]) => setWidgetDelta(board, id, delta),
    [board],
  );

  const moveMany = useCallback(
    (positions: WidgetPosition[]) => moveWidgets(board, positions),
    [board],
  );

  /** A drop into a table cell: membership and the landing offset in one transaction. */
  const moveToCell = useCallback(
    (
      frameId: string,
      rowId: string,
      columnId: string,
      ids: string[],
      offset: { x: number; y: number },
    ) => moveSelectionToCell(board, frameId, ids, { rowId, columnId, offset }),
    [board],
  );

  /** Arrange the multi-selection: the bar above it is the only entry point. */
  const alignSelection = useCallback(
    (edge: AlignEdge) => alignWidgets(board, selectedIds, edge),
    [board, selectedIds],
  );

  const distributeSelection = useCallback(
    (axis: DistributeAxis) => distributeWidgets(board, selectedIds, axis),
    [board, selectedIds],
  );

  /** Commit a reshaped line: one gesture, one undo step. */
  const patchConnector = useCallback(
    (id: string, patch: ConnectorPatch) => setConnectorProps(board, [id], patch),
    [board],
  );

  const selectionLocked = useMemo(
    () => widgets.some((widget) => selectedIds.includes(widget.id) && widget.locked),
    [selectedIds, widgets],
  );

  const resizeSelection = useCallback(
    (rects: WidgetRect[]) => transformSelection(board, rects),
    [board],
  );

  const onMoveCard = useCallback(
    (kanbanId: string, cardId: string, columnId: string, swimlaneId: string) =>
      moveCard(board, kanbanId, cardId, columnId, swimlaneId),
    [board],
  );

  /**
   * A connector needs exactly two objects that can be connected. Cards inside a
   * kanban are not among them: the source product offers no anchor on a card and a
   * link between two cards has no useful meaning, so the button explains instead of
   * silently doing nothing.
   */
  const connectSelection = useCallback(() => {
    if (selectedIds.length !== 2) return;
    // The remembered line style, not the model fallback: the rail's connector is the same
    // kind of new line as one drawn by hand (ADR-129). Routing stays the elbow the rail
    // has always drawn, so only the paint half of the preset is passed.
    createConnector(board, newId("conn"), selectedIds[0]!, selectedIds[1]!, {
      arrow: lastConnector.current.arrow,
      strokeColor: lastConnector.current.strokeColor,
      strokeWidth: lastConnector.current.strokeWidth,
      strokeStyle: lastConnector.current.strokeStyle,
    });
  }, [board, selectedIds]);

  const onConnect = useCallback(
    (
      fromId: string,
      toId: string,
      sides: { startSide: ConnectorSide; endSide: ConnectorSide },
    ) =>
      createConnector(board, newId("conn"), fromId, toId, {
        ...lastConnector.current,
        startSide: sides.startSide,
        endSide: sides.endSide,
      }),
    [board],
  );

  /** Copy these ids: groups expand and frame contents come along. */
  const copyIds = useCallback(
    async (ids: string[]): Promise<boolean> => {
      if (!ids.length) return false;
      const fragment = copyFragment(board, ids);
      if (!fragment) return false;
      clipboardFragment.current = fragment;
      await writeClipboard(encodeFragment(fragment));
      return true;
    },
    [board],
  );

  const cutIds = useCallback(
    async (ids: string[]) => {
      if (!(await copyIds(ids))) return;
      deleteWidgets(board, ids);
      setSelectedIds([]);
    },
    [board, copyIds],
  );

  /**
   * Paste the clipboard fragment.
   *
   * `at` is a world point for a right-click paste; without one the copy cascades by
   * a small offset, so a paste never lands exactly on the original. Plain text from
   * another application becomes a sticky note, which is what the source product does.
   */
  const pasteSelection = useCallback(
    async (at?: { x: number; y: number }) => {
      const text = await readClipboard();
      const fragment = (text ? decodeFragment(text) : null) ?? clipboardFragment.current;
      if (fragment) {
        const roots = pasteFragment(board, fragment, at ? { at } : {});
        if (roots.length) setSelectedIds(roots);
        return;
      }

      const value = text?.trim();
      if (!value) return;
      const id = createSticky(board, newId("sticky"), at ?? nextSpot());
      setWidgetText(board, id, value);
      setSelectedIds([id]);
    },
    [board, nextSpot],
  );

  /** Duplicate in place, offset — no system clipboard involved. */
  const duplicateIds = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const fragment = copyFragment(board, ids);
      if (!fragment) return;
      const roots = pasteFragment(board, fragment, { offset: { x: 32, y: 32 } });
      if (roots.length) setSelectedIds(roots);
    },
    [board],
  );

  const groupIds = useCallback(
    (ids: string[]) => {
      const groupId = groupWidgets(board, ids);
      if (!groupId) return;
      // Select every member, so the badge and the next drag treat it as one group.
      setSelectedIds(
        [...board.widgets.values()]
          .filter((widget) => widget.groupId === groupId)
          .map((widget) => widget.id),
      );
    },
    [board],
  );

  /**
   * Everything the command list needs, in one object.
   *
   * The commands own the document changes; the app supplies only what they cannot do
   * themselves: the system clipboard, the selection, and opening the editor or the
   * Info card (ADR-050).
   */
  const commandContext = useMemo<CommandContext>(
    () => ({
      board,
      widgets,
      ids: selectedIds,
      copy: (ids) => void copyIds([...ids]),
      cut: (ids) => void cutIds([...ids]),
      paste: () => void pasteSelection(),
      duplicate: (ids) => duplicateIds([...ids]),
      select: setSelectedIds,
      deleteSelection: requestDelete,
      copyLink,
      info: (widget) => {
        const at = menuPoint.current ?? {
          x: Math.max(24, window.innerWidth / 2 - 120),
          y: 140,
        };
        openInfo(widget, at.x, at.y);
      },
      styleClipboard: {
        get: () => styleClipboard.current,
        set: (snapshot) => {
          styleClipboard.current = snapshot;
        },
      },
      actor,
      canManage,
      refuseUnlock,
      tidy: onTidy,
    }),
    [
      actor,
      board,
      canManage,
      copyIds,
      copyLink,
      cutIds,
      onTidy,
      duplicateIds,
      openInfo,
      refuseUnlock,
      requestDelete,
      selectedIds,
      widgets,
    ],
  );

  /** One note beside another, linked, in one undo step; the caret moves there. */
  const addConnectedNote = useCallback(
    (sourceId: string, direction: NoteDirection, center?: { x: number; y: number }) => {
      const created = createConnectedNote(
        board,
        sourceId,
        direction,
        { note: newId("sticky"), connector: newId("conn") },
        lastConnector.current,
        { ratio: settings.notes.gapRatio, min: settings.notes.minGap },
        center,
      );
      if (!created) return;
      setSelectedIds([created]);
      setEditingId(created);
    },
    [board, settings.notes.gapRatio, settings.notes.minGap],
  );

  /** Everything the floating note bar can do, bound to the current selection. */
  const stickyActions = useMemo(
    () => ({
      setColor: (name: string) => setFillColor(board, selectedIds, name),
      setInk: (color: string | null) => setTextColor(board, selectedIds, color),
      setStroke: (color: string) => setShapeStyle(board, selectedIds, { strokeColor: color }),
      setStrokeWidth: (width: number) => setShapeStyle(board, selectedIds, { strokeWidth: width }),
      setStrokeStyle: (strokeStyle: "normal" | "dashed") =>
        setShapeStyle(board, selectedIds, { strokeStyle }),
      setSize: (size: StickySize) => setStickySize(board, selectedIds, size),
      setFont: (size: number | null) => setNoteFontSize(board, selectedIds, size),
      toggleMark: (mark: keyof TextMarks) => toggleNoteMark(board, selectedIds, mark),
      setAlign: (align: "left" | "center" | "right") =>
        setNoteTextAlign(board, selectedIds, align),
      setVAlign: (vAlign: "top" | "middle" | "bottom") =>
        setNoteTextVAlign(board, selectedIds, vAlign),
      applyShapePreset: (preset: ShapePreset) =>
        // One `transact` for fill, outline and width: one chip, one undo step. A preset
        // is a complete look, so it also makes the border solid again (ADR-120).
        setShapeStyle(board, selectedIds, {
          ...shapePresetStyle(preset),
          strokeStyle: "normal",
        }),
      remove: () => requestDelete(selectedIds),
    }),
    [board, requestDelete, selectedIds],
  );

  const noteMarks = useCallback((id: string) => noteMarksOf(board, id), [board]);

  /** Everything the connector bar can do, bound to the selected line. */
  const connectorActions = useMemo<ConnectorBarActions>(
    () => ({
      setRouting: (routing) => {
        lastConnector.current = { ...lastConnector.current, routing };
        setConnectorRouting(board, selectedIds, routing);
      },
      setWidth: (strokeWidth) => {
        lastConnector.current = { ...lastConnector.current, strokeWidth };
        setConnectorProps(board, selectedIds, { strokeWidth });
      },
      setDash: (strokeStyle) => {
        lastConnector.current = { ...lastConnector.current, strokeStyle };
        setConnectorProps(board, selectedIds, { strokeStyle });
      },
      setColor: (strokeColor) => {
        lastConnector.current = { ...lastConnector.current, strokeColor };
        setConnectorProps(board, selectedIds, { strokeColor });
      },
      setArrow: (arrow) => {
        lastConnector.current = { ...lastConnector.current, arrow };
        setConnectorProps(board, selectedIds, { arrow });
      },
      swapEnds: () => swapConnectorEnds(board, selectedIds),
      setFont: (size: number | null) => setNoteFontSize(board, selectedIds, size),
      setInk: (color: string | null) => setTextColor(board, selectedIds, color),
      applyPreset: (preset: LinePreset) => {
        // New lines inherit what was just applied, like every other control on this bar.
        lastConnector.current = {
          ...lastConnector.current,
          strokeColor: preset.color,
          strokeStyle: preset.dash,
          strokeWidth: preset.width,
          arrow: preset.arrow,
        };
        // One `transact` inside `setConnectorProps` for colour, width, dash and the head:
        // one chip, one undo step (ADR-120).
        setConnectorProps(board, selectedIds, { ...linePresetStyle(preset), arrow: preset.arrow });
      },
      remove: () => requestDelete(selectedIds),
    }),
    [board, selectedIds],
  );

  /**
   * The selection before "one type" narrowed it, so "All" brings the rest back.
   *
   * It is ignored when the current selection is no longer part of it: clicking another
   * object must not resurrect a selection the person has already left.
   */
  const narrowedFrom = useRef<string[] | null>(null);
  const selectType = useCallback(
    (type: string | null) => {
      const previous = narrowedFrom.current;
      const base =
        previous && selectedIds.every((id) => previous.includes(id)) ? previous : selectedIds;
      if (!type) {
        narrowedFrom.current = null;
        if (base !== selectedIds) setSelectedIds([...base]);
        return;
      }
      narrowedFrom.current = base;
      setSelectedIds(base.filter((id) => widgets.find((widget) => widget.id === id)?.type === type));
    },
    [selectedIds, setSelectedIds, widgets],
  );

  /**
   * Everything the multi-selection bar can do, bound to the current selection.
   *
   * Grouping asks the command registry whether it applies, so the bar cannot disagree
   * with the context menu and ⌘G about what a group is; it runs the same document call.
   * The shared colour is one document call too, so one click is one undo step (ADR-120).
   */
  const arrangeActions = useMemo<ArrangeBarActions>(
    () => ({
      align: alignSelection,
      distribute: distributeSelection,
      group: () => groupIds([...selectedIds]),
      ungroup: () => ungroupWidgets(board, [...selectedIds]),
      remove: () => requestDelete(selectedIds),
      tidy: () => onTidy(selectedIds),
      gather: () => onGather(selectedIds),
      canGroup: isGroupable(commandContext),
      canUngroup: selectionHasGroup(commandContext),
      selectType,
      setColour: (color) => {
        const allConnectors =
          selectedIds.length > 0 &&
          selectedIds.every(
            (id) => widgets.find((widget) => widget.id === id)?.type === "connector",
          );
        if (allConnectors) setConnectorProps(board, selectedIds, { strokeColor: color });
        else setFillColor(board, selectedIds, color);
      },
    }),
    [
      alignSelection,
      board,
      commandContext,
      distributeSelection,
      groupIds,
      onGather,
      onTidy,
      requestDelete,
      selectType,
      selectedIds,
      widgets,
    ],
  );

  /**
   * Keys 1–7 paint the main colour of the selection without opening the window (ADR-127).
   *
   * The main colour is the one the bar's sample shows: fill for notes, shapes and a
   * multi-selection, the line for connectors, the ink for free text. A fill keeps its row
   * (100 or 300) and a line, border or text is always 600. A selection with no common role
   * does nothing rather than recolouring half of it.
   */
  const applyTone = useCallback(
    (toneIndex: number) => {
      const selected = selectedIds
        .map((id) => widgets.find((widget) => widget.id === id))
        .filter((widget): widget is Widget => Boolean(widget));
      if (!selected.length) return;
      if (selected.every((widget) => widget.type === "connector")) {
        const hex = toneColor(toneIndex, mainLevel("line", selected[0]!.style?.strokeColor));
        if (hex) setConnectorProps(board, selectedIds, { strokeColor: hex });
        return;
      }
      if (selected.every((widget) => widget.type === "text")) {
        const hex = toneColor(toneIndex, mainLevel("text", selected[0]!.style?.color));
        if (hex) setTextColor(board, selectedIds, hex);
        return;
      }
      if (!selected.every((widget) => widget.type === "sticky_note" || widget.type === "shape")) {
        return;
      }
      // Every fill decides the row: one row for all when they agree, 100 when they do not
      // (ADR-129), so a key never splits the selection across two rows.
      const fills = selected.map((widget) =>
        widget.type === "sticky_note"
          ? stickyFill(widget.style?.fillColor)
          : (widget.style?.fillColor ?? DEFAULT_FILL),
      );
      const hex = toneColor(toneIndex, sharedFillLevel(fills));
      if (hex) setFillColor(board, selectedIds, hex);
    },
    [board, selectedIds, widgets],
  );

  return {
    textOf,
    deltaOf,
    onSetText,
    moveMany,
    moveToCell,
    alignSelection,
    distributeSelection,
    patchConnector,
    selectionLocked,
    resizeSelection,
    onMoveCard,
    onAddCard,
    onAddColumn,
    nextSpot,
    addSticky,
    addStickyStack,
    addText,
    addCardFromSelection,
    canJoinSelection,
    addShape,
    addFrame,
    connectSelection,
    onConnect,
    copyIds,
    cutIds,
    pasteSelection,
    duplicateIds,
    groupIds,
    commandContext,
    addConnectedNote,
    stickyActions,
    noteMarks,
    connectorActions,
    arrangeActions,
    applyTone,
    onAddWaypoint: (id: string, x: number, y: number, index?: number) =>
      Boolean(addConnectorWaypoint(board, id, x, y, undefined, index)),
    onMoveWaypoint: (id: string, waypointId: string, x: number, y: number) =>
      moveConnectorWaypoint(board, id, waypointId, x, y),
    onDeleteWaypoint: (id: string, waypointId: string) =>
      deleteConnectorWaypoint(board, id, waypointId),
    onReattachEnd: (
      id: string,
      end: "start" | "end",
      item: string,
      side?: ConnectorSide,
    ) => reattachConnectorEnd(board, id, end, item, side),
  };
}
