import { addAxis, duplicateAxis, type BoardDocument } from "@remo/doc";
import type { useI18n } from "./i18n";

type Translate = ReturnType<typeof useI18n>["t"];

/**
 * The table actions shared by every surface (ADR-204, ADR-205).
 *
 * The header menu, the cell menu, the range toolbar and the panel must call one function
 * per action; otherwise the same command grows a second title rule or a second refusal
 * text and the surfaces drift (AGENTS.md, rule 1).
 */
export type AxisKind = "column" | "row";

export function insertAxisNear(
  board: BoardDocument,
  frameId: string,
  kind: AxisKind,
  anchorId: string,
  where: "before" | "after",
  title: string,
): string | null {
  return addAxis(
    board,
    frameId,
    kind,
    where === "before" ? { title, beforeId: anchorId } : { title, afterId: anchorId },
  );
}

export function duplicateAxisNear(
  board: BoardDocument,
  frameId: string,
  kind: AxisKind,
  anchorId: string,
  title: string,
): string | null {
  return duplicateAxis(board, frameId, kind, anchorId, { title });
}

/** One sentence for every merge refusal, so both menus and the toolbar agree. */
export function mergeFailureText(t: Translate, reason: string): string {
  if (reason === "few" || reason === "shape") return t("section.cell.mergeHint");
  if (reason === "locked") return t("section.locked");
  return t("section.cell.mergeRefused");
}
