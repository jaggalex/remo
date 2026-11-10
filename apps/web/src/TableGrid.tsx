import type { Widget } from "@remo/model";
import { useI18n } from "./i18n";
import { useTableAxisSelection } from "./tableSelection";

/**
 * The section table as real table markup (ADR-196).
 *
 * The canvas paints the grid, but a screen reader needs `table`, `columnheader`,
 * `rowheader` and `cell` nodes with the object titles in them. One renderer feeds the
 * hidden mirror, so the DOM can never describe a different table from the one painted.
 */
export function TableGrid({
  frame,
  widgets,
}: {
  frame: Widget;
  widgets: Widget[];
}) {
  const { t, typeName } = useI18n();
  const layout = frame.layout;
  if (layout?.kind !== "table" || layout.active === false) return null;

  const children = widgets.filter(
    (widget) => widget.parentId === frame.id && widget.cell,
  );
  const inCell = (rowId: string, columnId: string) =>
    children
      .filter(
        (widget) =>
          widget.cell?.rowId === rowId && widget.cell?.columnId === columnId,
      )
      .sort((a, b) => a.y - b.y || a.x - b.x);

  const label = (widget: Widget): string => {
    const named = widget.name?.trim();
    if (named) return named;
    const title = widget.title?.trim();
    if (title) return title;
    const text = widget.content?.replace(/\s+/g, " ").trim();
    if (text) return text;
    return typeName(widget.type);
  };

  return (
    <table>
      <caption>{frame.title || t("section.title")}</caption>
      <thead>
        <tr>
          <td aria-hidden="true" />
          {layout.columns.map((column) => (
            <th key={column.id} scope="col">
              {column.title || t("section.axis.untitled")}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {layout.rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.title || t("section.axis.untitled")}</th>
            {layout.columns.map((column) => {
              const objects = inCell(row.id, column.id);
              return (
                <td key={column.id}>
                  {objects.length === 0 ? (
                    <span>{t("section.mirror.empty")}</span>
                  ) : (
                    <ul>
                      {objects.map((widget) => (
                        <li key={widget.id}>{label(widget)}</li>
                      ))}
                    </ul>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The hidden mirror plus the one-line summary the live region announces. */
export function TableMirror({ widgets }: { widgets: Widget[] }) {
  const { t } = useI18n();
  const selection = useTableAxisSelection();
  const frames = widgets.filter(
    (widget) =>
      widget.type === "frame" &&
      widget.layout?.kind === "table" &&
      widget.layout.active !== false,
  );
  if (!frames.length) return null;

  const live = frames
    .map((frame) => {
      const layout = frame.layout!;
      if (selection?.frameId === frame.id) {
        const column = layout.columns.find((axis) => axis.id === selection.axisId);
        if (column) {
          return t("section.live.axisColumn", {
            name: column.title || t("section.axis.untitled"),
          });
        }
        const row = layout.rows.find((axis) => axis.id === selection.axisId);
        if (row) {
          return t("section.live.axisRow", {
            name: row.title || t("section.axis.untitled"),
          });
        }
      }
      return t("section.live.table", {
        columns: layout.columns.length,
        rows: layout.rows.length,
      });
    })
    .join(" ");

  return (
    <>
      <div className="table-mirror">
        {frames.map((frame) => (
          <TableGrid key={frame.id} frame={frame} widgets={widgets} />
        ))}
      </div>
      <p className="table-mirror" role="status" aria-live="polite" aria-atomic="true">
        {live}
      </p>
    </>
  );
}
