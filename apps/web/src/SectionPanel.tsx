import { useEffect, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import {
  addAxis,
  deleteAxis,
  deleteWidgets,
  moveAxis,
  removeTable,
  renameAxis,
  setAxisSize,
  setAxisVertical,
  setTableFill,
  showTable,
  tableLayoutOf,
} from "@remo/doc";
import {
  FILL_LEVELS,
  type TableAxis,
  type TableAxisSize,
  type TableLayout,
  type Widget,
} from "@remo/model";
import { Button, Icon, Input, Segmented } from "@remo/ui";
import { AxisDeleteDialog } from "./AxisDeleteDialog";
import { HelpLink } from "./help/HelpLink";
import { colorName } from "./object-panel/colorWindowData";
import { ColorGridSection } from "./object-panel/ColorWindow";
import { useI18n } from "./i18n";
import { setTableAxisSelection, useTableAxisSelection } from "./tableSelection";

/**
 * The section panel (ADR-196, ADR-199).
 *
 * A section is a frame; this panel is the one place its table is turned on, axes are
 * managed, fills are chosen and the section itself is removed. Every action calls the
 * document command and nothing else, so the panel cannot invent a second path to the
 * table. Transient UI state (which axis is open) is local; the table itself never is.
 */
type AxisKind = "column" | "row";

type FillTarget =
  | { kind: "table" }
  | { kind: "headers" }
  | { kind: "column"; id: string }
  | { kind: "row"; id: string };

function axesOf(layout: TableLayout | null | undefined, kind: AxisKind): TableAxis[] {
  if (!layout) return [];
  return kind === "column" ? layout.columns : layout.rows;
}

function axisObjects(
  widgets: readonly Widget[],
  frameId: string,
  kind: AxisKind,
  axisId: string,
): Widget[] {
  const field = kind === "column" ? "columnId" : "rowId";
  return widgets.filter(
    (widget) => widget.parentId === frameId && widget.cell?.[field] === axisId,
  );
}

function fillValue(layout: TableLayout | null | undefined, target: FillTarget): string | undefined {
  const appearance = layout?.appearance;
  if (!appearance) return undefined;
  if (target.kind === "table") return appearance.table;
  if (target.kind === "headers") return appearance.headers;
  return target.kind === "column"
    ? appearance.columns?.[target.id]
    : appearance.rows?.[target.id];
}

function fillsEqual(a: FillTarget | null, b: FillTarget): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "table" || a.kind === "headers") return true;
  return "id" in b && a.id === b.id;
}

/** The axis name commits on blur or Enter: typing is one undo step (ADR-196). */
function AxisNameField({
  board,
  frameId,
  axis,
  disabled,
}: {
  board: BoardDocument;
  frameId: string;
  axis: TableAxis;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(axis.title);

  useEffect(() => setValue(axis.title), [axis.id, axis.title]);

  const commit = () => {
    if (value.trim() === axis.title.trim()) return;
    renameAxis(board, frameId, axis.id, value);
  };

  return (
    <Input
      label={t("section.axis.title")}
      value={value}
      maxLength={80}
      disabled={disabled}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setValue(axis.title);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export interface SectionPanelProps {
  board: BoardDocument;
  frame: Widget;
  widgets: Widget[];
  writeBlocked: boolean;
  /** The frame is gone; the inspector should drop the selection with it. */
  onDeleted: () => void;
}

export function SectionPanel({
  board,
  frame,
  widgets,
  writeBlocked,
  onDeleted,
}: SectionPanelProps) {
  const { t, count } = useI18n();
  const layout = tableLayoutOf(board, frame.id);
  const active = Boolean(layout && layout.active !== false);
  const readOnly = writeBlocked || Boolean(frame.locked);
  const columns = axesOf(layout, "column");
  const rows = axesOf(layout, "row");

  const storedAxis = useTableAxisSelection();
  const axisId = storedAxis?.frameId === frame.id ? storedAxis.axisId : null;
  const selectAxis = (id: string | null) => {
    setTableAxisSelection(id ? { frameId: frame.id, axisId: id } : null);
  };
  const [lookOpen, setLookOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState<FillTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    axisId: string;
    kind: AxisKind;
  } | null>(null);

  const column = columns.find((axis) => axis.id === axisId);
  const row = rows.find((axis) => axis.id === axisId);
  const selected = column ?? row;
  const selectedKind: AxisKind | null = column ? "column" : row ? "row" : null;

  useEffect(() => {
    setLookOpen(false);
    setFillOpen(null);
    setPendingDelete(null);
  }, [frame.id]);

  useEffect(() => {
    if (!axisId) return;
    if (columns.some((axis) => axis.id === axisId)) return;
    if (rows.some((axis) => axis.id === axisId)) return;
    selectAxis(null);
  }, [axisId, columns, rows]);

  useEffect(() => {
    setFillOpen(null);
  }, [axisId]);

  const add = (kind: AxisKind) => {
    if (readOnly) return;
    const ownName =
      kind === "column" ? "section.axis.placeholderColumn" : "section.axis.placeholderRow";
    const oppositeName =
      kind === "column" ? "section.axis.placeholderRow" : "section.axis.placeholderColumn";
    const axes = axesOf(layout, kind);
    const id = addAxis(board, frame.id, kind, {
      // The first axis creates a content axis beside it, so the empty one is second.
      title: t(ownName, { n: axes.length === 0 ? 2 : axes.length + 1 }),
      firstTitle: t(ownName, { n: 1 }),
      oppositeTitle: t(oppositeName, { n: 1 }),
    });
    if (id) selectAxis(id);
  };

  const switchView = (next: string) => {
    if (readOnly) return;
    if (next === "table") {
      if (!layout) {
        // The first column also creates the content axis: old material stays in the
        // first cell and the new axis is empty (ADR-196, H4 default).
        add("column");
      } else if (layout.active === false) {
        showTable(board, frame.id);
      }
      return;
    }
    if (layout && layout.active !== false) {
      removeTable(board, frame.id);
      selectAxis(null);
    }
  };

  const requestDelete = () => {
    if (!selected || !selectedKind || readOnly) return;
    const objects = axisObjects(widgets, frame.id, selectedKind, selected.id);
    if (!objects.length) {
      const result = deleteAxis(board, frame.id, selected.id, { mode: "move" });
      if (result.ok) selectAxis(null);
      return;
    }
    setPendingDelete({ axisId: selected.id, kind: selectedKind });
  };

  const fillLabel = (target: FillTarget): string => {
    if (target.kind === "table") return t("section.look.table");
    if (target.kind === "headers") return t("section.look.headers");
    const axis = target.kind === "column"
      ? columns.find((entry) => entry.id === target.id)
      : rows.find((entry) => entry.id === target.id);
    const name = axis?.title || t("section.axis.untitled");
    return t(
      target.kind === "column" ? "section.look.selectedColumn" : "section.look.selectedRow",
      { name },
    );
  };

  const fillRows: Array<{ target: FillTarget; label: string; value?: string }> = [
    {
      target: { kind: "table" },
      label: t("section.look.table"),
      value: fillValue(layout, { kind: "table" }),
    },
    {
      target: { kind: "headers" },
      label: t("section.look.headers"),
      value: fillValue(layout, { kind: "headers" }),
    },
  ];
  if (selected && selectedKind) {
    const target: FillTarget =
      selectedKind === "column"
        ? { kind: "column", id: selected.id }
        : { kind: "row", id: selected.id };
    fillRows.push({ target, label: fillLabel(target), value: fillValue(layout, target) });
  }

  const canRemove = Boolean(layout) && layout!.active !== false && !readOnly;
  const deleteLabel =
    selectedKind === "row"
      ? t("section.axis.deleteRow")
      : t("section.axis.deleteColumn");

  return (
    <section className="section-panel" aria-label={t("section.title")}>
      <div className="section-panel-head">
        <h2>
          {t("section.title")} <HelpLink topicId="section.table" />
        </h2>
        {active && <span className="section-badge">{t("section.badge.table")}</span>}
      </div>
      <p className="section-panel-title">{frame.title || t("section.axis.untitled")}</p>
      {frame.locked && <p className="muted">{t("section.locked")}</p>}

      <div className="section-group">
        <h3>{t("section.view")}</h3>
        <Segmented
          label={t("section.view")}
          value={active ? "table" : "free"}
          onChange={switchView}
          options={[
            { value: "free", label: t("section.view.free"), disabled: readOnly },
            { value: "table", label: t("section.view.table"), disabled: readOnly },
          ]}
        />
        <p className="muted">{t("section.view.hint")}</p>
      </div>

      <div className="section-group">
        <div className="section-group-head">
          <h3>{t("section.axes")}</h3>
          <div className="section-axis-add">
            <Button
              size="compact"
              variant="secondary"
              icon="plus"
              disabled={readOnly || Boolean(layout && !active)}
              onClick={() => add("column")}
            >
              {t("section.axes.addColumn")}
            </Button>
            <Button
              size="compact"
              variant="secondary"
              icon="plus"
              disabled={readOnly || Boolean(layout && !active)}
              onClick={() => add("row")}
            >
              {t("section.axes.addRow")}
            </Button>
          </div>
        </div>

        {layout && !active && <p className="muted">{t("section.axis.inactive")}</p>}

        {(
          [
            ["column", t("section.columns"), columns],
            ["row", t("section.rows"), rows],
          ] as const
        ).map(([kind, label, axes]) => (
          <div key={kind} className="section-axis-group">
            <span className="section-axis-label">{label}</span>
            {axes.length === 0 ? (
              <p className="muted section-axis-empty">{t("section.axis.empty")}</p>
            ) : (
              <div className="section-axis-list" role="group" aria-label={label}>
                {axes.map((axis) => {
                  const objects = axisObjects(widgets, frame.id, kind, axis.id).length;
                  const isSelected = axis.id === axisId;
                  const title = axis.title || t("section.axis.untitled");
                  return (
                    <button
                      key={axis.id}
                      type="button"
                      className={`section-axis-row${isSelected ? " is-selected" : ""}`}
                      aria-pressed={isSelected}
                      aria-label={`${title} — ${count("objects", objects)}`}
                      onClick={() => selectAxis(isSelected ? null : axis.id)}
                    >
                      <span className="section-axis-title">{title}</span>
                      <span className="section-axis-meta" aria-hidden="true">
                        {objects}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {selected && selectedKind && (
          <div className="section-axis-detail">
            <AxisNameField
              key={selected.id}
              board={board}
              frameId={frame.id}
              axis={selected}
              disabled={readOnly}
            />
            <div className="section-field">
              <span className="section-field-label">{t("section.size.mode")}</span>
              <Segmented
                label={t("section.size.mode")}
                value={selected.size ?? "auto"}
                onChange={(size) =>
                  setAxisSize(board, frame.id, selected.id, size as TableAxisSize)
                }
                options={[
                  { value: "auto", label: t("section.size.auto"), disabled: readOnly },
                  {
                    value: "narrow",
                    label: t(selectedKind === "column" ? "section.size.narrow" : "section.size.low"),
                    disabled: readOnly,
                  },
                  { value: "medium", label: t("section.size.medium"), disabled: readOnly },
                  {
                    value: "wide",
                    label: t(selectedKind === "column" ? "section.size.wide" : "section.size.tall"),
                    disabled: readOnly,
                  },
                ]}
              />
            </div>
            {selectedKind === "column" && (
              <label className="section-check">
                <input
                  type="checkbox"
                  checked={Boolean(selected.vertical)}
                  disabled={readOnly}
                  onChange={(event) =>
                    setAxisVertical(board, frame.id, selected.id, event.currentTarget.checked)
                  }
                />
                <span>{t("section.axis.rotate")}</span>
              </label>
            )}
            <div className="section-axis-actions">
              <Button
                size="compact"
                variant="secondary"
                disabled={
                  readOnly ||
                  (selectedKind === "column"
                    ? columns.findIndex((axis) => axis.id === selected.id) === 0
                    : rows.findIndex((axis) => axis.id === selected.id) === 0)
                }
                onClick={() => moveAxis(board, frame.id, selected.id, -1)}
              >
                {t(selectedKind === "column" ? "section.axis.moveLeft" : "section.axis.moveUp")}
              </Button>
              <Button
                size="compact"
                variant="secondary"
                disabled={
                  readOnly ||
                  (selectedKind === "column"
                    ? columns.findIndex((axis) => axis.id === selected.id) === columns.length - 1
                    : rows.findIndex((axis) => axis.id === selected.id) === rows.length - 1)
                }
                onClick={() => moveAxis(board, frame.id, selected.id, 1)}
              >
                {t(selectedKind === "column" ? "section.axis.moveRight" : "section.axis.moveDown")}
              </Button>
              <Button
                size="compact"
                variant="danger"
                disabled={readOnly}
                onClick={requestDelete}
              >
                {deleteLabel}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="section-group">
        <button
          type="button"
          className="section-look-toggle"
          aria-expanded={lookOpen}
          onClick={() => setLookOpen((open) => !open)}
        >
          <span>{t("section.look")}</span>
          <Icon name={lookOpen ? "minus" : "plus"} size={14} />
        </button>
        {lookOpen && (
          <div className="section-look">
            <p className="muted">{t("section.look.hint")}</p>
            {fillRows.map((entry) => {
              const name = entry.value ? t(colorName(entry.value).key) : t("section.look.default");
              const open = fillsEqual(fillOpen, entry.target);
              return (
                <div key={`${entry.target.kind}-${"id" in entry.target ? entry.target.id : ""}`}>
                  <button
                    type="button"
                    className="section-fill-row"
                    aria-expanded={open}
                    onClick={() => setFillOpen(open ? null : entry.target)}
                  >
                    <span
                      className={`section-fill-dot${entry.value ? "" : " is-empty"}`}
                      style={entry.value ? { background: entry.value } : undefined}
                      aria-hidden="true"
                    />
                    <span className="section-fill-label">{entry.label}</span>
                    <span className="section-fill-name">{name}</span>
                  </button>
                  {open && (
                    <div className="section-fill-window">
                      <ColorGridSection
                        ariaLabel={entry.label}
                        levels={FILL_LEVELS}
                        value={entry.value}
                        auto={!entry.value}
                        autoLabel={t("section.look.default")}
                        onAuto={() => {
                          setTableFill(board, frame.id, entry.target, null);
                          setFillOpen(null);
                        }}
                        onPick={(hex) => {
                          setTableFill(board, frame.id, entry.target, hex);
                          setFillOpen(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="section-group section-remove">
        <button
          type="button"
          className={`section-action${canRemove ? "" : " is-disabled"}`}
          aria-disabled={!canRemove || undefined}
          onClick={() => {
            if (!canRemove) return;
            removeTable(board, frame.id);
            selectAxis(null);
            setFillOpen(null);
          }}
          title={!layout ? t("section.table.removeNone") : t("section.table.removeHint")}
        >
          {t("section.table.remove")}
        </button>
        <p className="muted section-caption">
          {!layout ? t("section.table.removeNone") : t("section.table.removeHint")}
        </p>
        <button
          type="button"
          className="section-action section-action-danger"
          disabled={readOnly}
          onClick={() => {
            deleteWidgets(board, [frame.id], { keepChildren: true });
            onDeleted();
          }}
        >
          {t("section.delete")}
        </button>
        <p className="muted section-caption">{t("section.deleteHint")}</p>
      </div>

      {pendingDelete && (
        <AxisDeleteDialog
          board={board}
          widgets={widgets}
          target={{ frameId: frame.id, ...pendingDelete }}
          onClose={() => setPendingDelete(null)}
          onDeleted={() => {
            setPendingDelete(null);
            selectAxis(null);
          }}
        />
      )}
    </section>
  );
}
