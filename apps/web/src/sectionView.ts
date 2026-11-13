import { addAxis, removeTable, showTable, tableLayoutOf, type BoardDocument } from "@remo/doc";
import type { useI18n } from "./i18n";

type Translate = ReturnType<typeof useI18n>["t"];

export type SectionView = "free" | "table";

/**
 * The one view switch (ADR-207).
 *
 * The panel, the canvas badge and the context menu all call this function; none of them
 * keeps its own state or repeats the "first column creates the axes" rule. It returns the
 * axis to select when the table is created, so every surface lands on the same selection.
 */
export function setSectionView(
  board: BoardDocument,
  frameId: string,
  view: SectionView,
  t: Translate,
): string | null {
  const layout = tableLayoutOf(board, frameId);
  if (view === "table") {
    if (!layout) {
      return addAxis(board, frameId, "column", {
        title: t("section.axis.placeholderColumn", { n: 2 }),
        firstTitle: t("section.axis.placeholderColumn", { n: 1 }),
        oppositeTitle: t("section.axis.placeholderRow", { n: 1 }),
      });
    }
    if (layout.active === false) showTable(board, frameId);
    return null;
  }
  if (layout && layout.active !== false) removeTable(board, frameId);
  return null;
}
