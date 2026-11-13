import { useEffect } from "react";
import type { BoardDocument } from "@remo/doc";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { TableCellMenu, type TableCellMenuState } from "./TableCellMenu";
import { SectionLayoutDialog } from "./SectionLayoutDialog";
import { SectionLayoutPreview } from "./SectionLayoutPreview";
import {
  closeSectionLayout,
  useSectionLayoutRequest,
} from "./sectionLayoutStore";
import { planSectionTable } from "@remo/doc";
import { useI18n } from "./i18n";
import { TableSelectionLayer } from "./TableSelectionLayer";
import { SectionTitleLayer } from "./SectionTitleLayer";
import { tableCellSelection } from "./tableCellSelection";

/**
 * The two canvas surfaces of a table selection (ADR-204): the range highlight and the
 * cell menu. Kept together so the board component stays a composition, not a drawer of
 * every table control.
 */
export function CanvasTableLayer({
  board,
  widgets,
  camera,
  viewport,
  selectedIds,
  onNotice,
  onSelect,
  readOnly,
  presenting,
  menu,
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  viewport: { width: number; height: number };
  selectedIds: readonly string[];
  onNotice?: (text: string) => void;
  onSelect: (ids: string[]) => void;
  readOnly: boolean;
  presenting: boolean;
  menu: TableCellMenuState;
}) {
  const { t } = useI18n();
  const selection = menu.point ? tableCellSelection() : null;
  const layoutRequest = useSectionLayoutRequest();
  const layoutFrame = layoutRequest
    ? widgets.find((widget) => widget.id === layoutRequest.frameId)
    : undefined;
  useEffect(() => {
    if (layoutRequest && !layoutFrame) closeSectionLayout();
  }, [layoutRequest, layoutFrame]);

  const layoutPlan =
    layoutRequest && layoutFrame
      ? planSectionTable(layoutFrame, widgets, layoutRequest.mode, {
          column1: t("section.axis.placeholderColumn", { n: 1 }),
          column2: t("section.axis.placeholderColumn", { n: 2 }),
          row1: t("section.axis.placeholderRow", { n: 1 }),
        })
      : null;
  return (
    <>
      {layoutRequest && layoutFrame && layoutPlan && (
        <SectionLayoutPreview
          frame={layoutFrame}
          widgets={widgets}
          plan={layoutPlan}
          camera={camera}
          viewport={viewport}
        />
      )}
      <SectionTitleLayer
        board={board}
        widgets={widgets}
        camera={camera}
        viewport={viewport}
        selectedIds={selectedIds}
        readOnly={readOnly}
        presenting={presenting}
        onSelect={onSelect}
        onNotice={onNotice}
      />
      <TableSelectionLayer
        board={board}
        widgets={widgets}
        camera={camera}
        viewport={viewport}
        selectedIds={selectedIds}
        readOnly={readOnly}
        presenting={presenting}
      />
      {layoutRequest && layoutFrame && layoutPlan && (
        <SectionLayoutDialog
          board={board}
          frame={layoutFrame}
          plan={layoutPlan}
          request={layoutRequest}
          camera={camera}
          viewport={viewport}
          onClose={closeSectionLayout}
        />
      )}
      {menu.point && selection && (
        <TableCellMenu
          board={board}
          widgets={widgets}
          selection={selection}
          point={menu.point}
          onClose={menu.close}
          onNotice={onNotice}
        />
      )}
    </>
  );
}
