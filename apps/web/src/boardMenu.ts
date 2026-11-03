import {
  addColumn,
  addSwimlane,
  deleteColumn,
  deleteSwimlane,
  deleteWidgets,
  moveColumn,
  moveSwimlane,
  renameColumn,
  renameSwimlane,
  type BoardDocument,
} from "@remo/doc";
import type { KanbanState } from "@remo/model";
import type { ContextTarget } from "./BoardCanvas";
import type { MenuState } from "./ContextMenu";
import { commandsFor, type CommandContext } from "./commands";
import type { TranslationKey } from "./i18n";

export interface BoardMenuResult {
  menu: MenuState | null;
  /** Objects the click selects; a card right-click is also a selection. */
  select: string[] | null;
  /** The click point, for a command that needs it (Info, paste). */
  point: { x: number; y: number } | null;
}

/**
 * The canvas context menu for whatever was right-clicked.
 *
 * A pure builder: it decides which items exist, in what order and whether they are
 * enabled, and hands the answer back to App. The menu therefore cannot mutate the
 * document on its own, and the selection menu is the command list itself — same order,
 * same enablement, same run as the keyboard and the panel (ADR-050).
 */
export function buildBoardMenu({
  target,
  point,
  board,
  kanbanStates,
  commandContext,
  writeBlocked,
  copyIds,
  duplicateIds,
  pasteSelection,
  t,
}: {
  target: ContextTarget;
  point: { x: number; y: number; world: { x: number; y: number } };
  board: BoardDocument;
  kanbanStates: Record<string, KanbanState>;
  commandContext: CommandContext;
  writeBlocked: boolean;
  copyIds: (ids: string[]) => Promise<boolean>;
  duplicateIds: (ids: string[]) => void;
  pasteSelection: (at?: { x: number; y: number }) => Promise<void>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}): BoardMenuResult {
  const result: BoardMenuResult = { menu: null, select: null, point: null };
  /** Every branch below sets the menu; the helper keeps that a single assignment. */
  const menu = (state: MenuState | null) => {
    result.menu = state;
  };
  const { x, y } = point;

  if (target.kind === "column") {
    const state = kanbanStates[target.kanbanId];
    if (!state) return result;
    const column = state.columns[target.index];
    menu({
      x,
      y,
      title: t("menu.column", { title: column?.title ?? "" }),
      items: [
        {
          label: t("menu.renameColumn"),
          action: () => undefined,
          rename: {
            value: column?.title ?? "",
            commit: (value) =>
              value && renameColumn(board, target.kanbanId, target.columnId, value),
          },
        },
        {
          label: t("menu.addColumnRight"),
          action: () =>
            addColumn(board, target.kanbanId, t("menu.newColumn"), target.index + 1),
        },
        {
          label: t("menu.moveLeft"),
          action: () =>
            moveColumn(board, target.kanbanId, target.columnId, target.index - 1),
          disabled: target.index === 0,
        },
        {
          label: t("menu.moveRight"),
          action: () =>
            moveColumn(board, target.kanbanId, target.columnId, target.index + 1),
          disabled: target.index >= state.columns.length - 1,
        },
        {
          label: t("menu.deleteColumn"),
          action: () => deleteColumn(board, target.kanbanId, target.columnId),
          disabled: state.columns.length <= 1,
          danger: true,
        },
      ],
    });
    return result;
  }

  if (target.kind === "swimlane") {
    const state = kanbanStates[target.kanbanId];
    if (!state) return result;
    const lane = state.swimlanes[target.index];
    menu({
      x,
      y,
      title: t("menu.swimlane", { title: lane?.title ?? "" }),
      items: [
        {
          label: t("menu.renameSwimlane"),
          action: () => undefined,
          rename: {
            value: lane?.title ?? "",
            commit: (value) =>
              value && renameSwimlane(board, target.kanbanId, target.swimlaneId, value),
          },
        },
        {
          label: t("menu.addSwimlaneBelow"),
          action: () =>
            addSwimlane(board, target.kanbanId, t("menu.newSwimlane"), target.index + 1),
        },
        {
          label: t("menu.moveUp"),
          action: () =>
            moveSwimlane(board, target.kanbanId, target.swimlaneId, target.index - 1),
          disabled: target.index === 0,
        },
        {
          label: t("menu.moveDown"),
          action: () =>
            moveSwimlane(board, target.kanbanId, target.swimlaneId, target.index + 1),
          disabled: target.index >= state.swimlanes.length - 1,
        },
        {
          label: t("menu.deleteSwimlane"),
          action: () => deleteSwimlane(board, target.kanbanId, target.swimlaneId),
          disabled: state.swimlanes.length <= 1,
          danger: true,
        },
      ],
    });
    return result;
  }

  if (target.kind === "card") {
    result.select = [target.cardId];
    result.point = { x, y };
    menu({
      x,
      y,
      title: t("menu.card"),
      items: [
        {
          label: t("menu.copy"),
          action: () => void copyIds([target.cardId]),
        },
        {
          label: t("menu.duplicate"),
          action: () => duplicateIds([target.cardId]),
        },
        {
          label: t("menu.deleteCard"),
          action: () => deleteWidgets(board, [target.cardId]),
          danger: true,
        },
      ],
    });
    return result;
  }

  if (target.kind === "kanban") {
    menu({
      x,
      y,
      title: t("menu.kanban"),
      items: [
        { label: t("menu.addColumn"), action: () => addColumn(board, target.kanbanId) },
        { label: t("menu.addSwimlane"), action: () => addSwimlane(board, target.kanbanId) },
      ],
    });
    return result;
  }

  if (target.kind === "selection" && target.ids.length) {
    // The menu is the command list: same order, same enablement, same run as the
    // keyboard and the panel (ADR-050). Info needs the click point, which is what
    // `menuPoint` is for.
    result.point = { x, y };
    const context: CommandContext = { ...commandContext, ids: target.ids };
    menu({
      x,
      y,
      title:
        target.ids.length === 1
          ? t("menu.object")
          : t("menu.objects", { count: target.ids.length }),
      items: commandsFor("menu", context)
        .filter(
          (command) =>
            !writeBlocked ||
            command.id === "copy" ||
            command.id === "copyLink" ||
            command.id === "copyStyle" ||
            command.id === "info",
        )
        .map((command) => ({
        label: t(command.label(context) as TranslationKey),
        action: () => command.run(context),
        disabled: !command.enabled(context),
        danger: command.danger,
      })),
    });
    return result;
  }

  // Empty canvas: the menu is about the board itself, and paste lands where the
  // click was rather than wherever the cascade happens to be.
  menu({
    x,
    y,
    title: t("menu.canvas"),
    items: [
      { label: t("menu.paste"), action: () => void pasteSelection(point.world) },
    ],
  });

  return result;
}
