import { setElevation, type BoardDocument } from "@remo/doc";
import { canElevate, elevationOf, type Elevation, type Widget } from "@remo/model";
import type { MenuItem } from "@remo/ui";
import type { TranslationKey } from "./i18n";

const LEVELS = [null, "raised", "floating"] as const;
const KEY: Record<string, TranslationKey> = {
  none: "inspector.elevation.none",
  raised: "inspector.elevation.raised",
  floating: "inspector.elevation.floating",
};

/**
 * The shadow of the selection in «⋯ More actions» (ADR-245): a heading and three levels,
 * the current one checked. Offered only when every selected object can stand off the
 * board; a mixed selection checks nothing, and a choice sets one level for all of them
 * in one undo step. A rare action, so it lives with the other rare ones (ADR-237) and does
 * not add a row to the panel.
 */
export function elevationMenuItems(
  board: BoardDocument,
  widgets: readonly Widget[],
  selectedIds: readonly string[],
  disabled: boolean,
  t: (key: TranslationKey) => string,
): MenuItem[] {
  const selected = widgets.filter((widget) => selectedIds.includes(widget.id));
  if (selected.length === 0 || !selected.every(canElevate)) return [];
  const levels = new Set(selected.map((widget) => elevationOf(widget)));
  const current = levels.size === 1 ? [...levels][0]! : undefined;
  const readOnly = disabled || selected.every((widget) => widget.locked);
  return [
    { separator: true },
    { heading: t("inspector.elevation") },
    ...LEVELS.map((level: Elevation | null) => ({
      label: t(KEY[level ?? "none"]!),
      checked: current === level,
      disabled: readOnly,
      onSelect: () => setElevation(board, selectedIds, level),
    })),
  ];
}
