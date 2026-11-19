import { useCallback, useState } from "react";
import type { MutableRefObject } from "react";
import type { BoardDocument } from "@remo/doc";
import type { KanbanState } from "@remo/model";
import { buildBoardMenu } from "./boardMenu";
import type { ContextTarget } from "./BoardCanvas";
import type { MenuState } from "./ContextMenu";
import type { TranslationKey } from "./i18n";

/**
 * The canvas context menu: where it opened, and what it shows there.
 *
 * Right-click and Shift+F10 both land here; the menu is one component with one state
 * (`ContextMenu`), and the items come from the board's command registry (`boardMenu.ts`).
 */
export function useBoardContextMenu({
  board,
  kanbanStates,
  commandContext,
  writeBlocked,
  copyIds,
  duplicateIds,
  pasteSelection,
  setSelectedIds,
  menuPoint,
  t,
  onNotice,
}: {
  board: BoardDocument;
  kanbanStates: Record<string, KanbanState>;
  commandContext: Parameters<typeof buildBoardMenu>[0]["commandContext"];
  writeBlocked: boolean;
  copyIds: (ids: string[]) => Promise<boolean>;
  duplicateIds: (ids: string[]) => void;
  pasteSelection: (point?: { x: number; y: number }) => Promise<void>;
  setSelectedIds: (ids: string[]) => void;
  /** Where the last menu was opened, so a command that needs a point can use it. */
  menuPoint: MutableRefObject<{ x: number; y: number } | null>;
  t: (key: TranslationKey) => string;
  onNotice?: (text: string) => void;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback(
    (
      target: ContextTarget,
      point: { x: number; y: number; world: { x: number; y: number } },
    ) => {
      const result = buildBoardMenu({
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
        onNotice,
      });
      if (result.select) setSelectedIds(result.select);
      if (result.point) menuPoint.current = result.point;
      setMenu(result.menu);
    },
    [
      board,
      commandContext,
      copyIds,
      duplicateIds,
      kanbanStates,
      pasteSelection,
      setSelectedIds,
      t,
      writeBlocked,
      onNotice,
    ],
  );

  return { menu, openMenu, closeMenu: () => setMenu(null) };
}
