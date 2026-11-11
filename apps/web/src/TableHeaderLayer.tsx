import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import {
  addAxis,
  moveAxis,
  renameAxis,
  setAxisSize,
  setAxisVertical,
  tableLayoutOf,
} from "@remo/doc";
import {
  cellRect,
  columnHeaderRect,
  layoutTable,
  rowHeaderRect,
  type Camera,
} from "@remo/canvas";
import type { Rect, TableAxis, Widget } from "@remo/model";
import { Menu, type MenuItem } from "@remo/ui";
import { AxisDeleteDialog, type AxisDeleteTarget } from "./AxisDeleteDialog";
import { TableAxisControls } from "./TableAxisControls";
import { TableMirror } from "./TableGrid";
import { useI18n } from "./i18n";
import { setTableAxisSelection, useTableAxisSelection } from "./tableSelection";

type AxisKind = "column" | "row";

interface HeaderEntry {
  frame: Widget;
  kind: AxisKind;
  axis: TableAxis;
  rect: Rect;
}

interface MenuState {
  entry: HeaderEntry;
  x: number;
  y: number;
}

interface EditState {
  frameId: string;
  axisId: string;
  kind: AxisKind;
}

function keyOf(frameId: string, axisId: string): string {
  return `${frameId}:${axisId}`;
}

/**
 * Headers of every section table, as DOM buttons over the canvas (ADR-196).
 *
 * The grid itself is painted, but a header is an interactive control: it selects an
 * axis, opens its menu and edits its title in place. A DOM layer rather than more
 * pointer cases keeps the gesture machine about objects and gives the headers real
 * focus, a real name and a real text field. The canvas still paints the title; the
 * buttons are transparent and only draw the hover and selection rings.
 */
export function TableHeaderLayer({
  board,
  widgets,
  camera,
  viewport,
  readOnly,
  presenting = false,
  onSelect,
  drop = null,
  refused = false,
  cursor = null,
  selectedIds = [],
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  viewport: { width: number; height: number };
  readOnly: boolean;
  /** A live presentation is content only; headers are editing chrome. */
  presenting?: boolean;
  onSelect: (ids: string[]) => void;
  /** The cell a dragged selection would land in. */
  drop?: { frameId: string; rowId: string; columnId: string } | null;
  /** The pointer is over a header, which refuses objects. */
  refused?: boolean;
  /** Client coordinates, for the refusal hint. */
  cursor?: { x: number; y: number } | null;
  /** The canvas selection; a selected table shows its insert controls. */
  selectedIds?: readonly string[];
}) {
  const { t } = useI18n();
  const selection = useTableAxisSelection();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AxisDeleteTarget | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const editingRef = useRef<EditState | null>(null);
  const menuTimer = useRef<number | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  const headers = useMemo(() => {
    const found: HeaderEntry[] = [];
    for (const frame of widgets) {
      if (frame.type !== "frame" || frame.layout?.kind !== "table") continue;
      if (frame.layout.active === false) continue;
      const grid = layoutTable(frame, widgets);
      if (!grid) continue;
      for (const column of grid.columns) {
        const rect = columnHeaderRect(grid, column.axis.id);
        if (rect) found.push({ frame, kind: "column", axis: column.axis, rect });
      }
      for (const row of grid.rows) {
        const rect = rowHeaderRect(grid, row.axis.id);
        if (rect) found.push({ frame, kind: "row", axis: row.axis, rect });
      }
    }
    return found;
  }, [widgets]);

  useEffect(() => {
    if (!selection) return;
    const exists = headers.some(
      (entry) =>
        entry.frame.id === selection.frameId && entry.axis.id === selection.axisId,
    );
    if (!exists) setTableAxisSelection(null);
  }, [headers, selection]);

  useLayoutEffect(() => {
    if (!menu) {
      setPlacement(null);
      return;
    }
    const node = menuRef.current;
    if (!node) return;
    const margin = 8;
    const { width, height } = node.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const left = Math.min(Math.max(margin, menu.x), maxLeft);
    const top =
      menu.y + height + margin > window.innerHeight
        ? Math.min(Math.max(margin, menu.y - height), maxTop)
        : Math.min(Math.max(margin, menu.y), maxTop);
    setPlacement({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!editing) {
      editingRef.current = null;
      return;
    }
    const entry = headers.find(
      (candidate) =>
        candidate.frame.id === editing.frameId && candidate.axis.id === editing.axisId,
    );
    setDraft(entry?.axis.title ?? "");
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const exists = headers.some(
      (candidate) =>
        candidate.frame.id === editing.frameId && candidate.axis.id === editing.axisId,
    );
    if (!exists) {
      editingRef.current = null;
      setEditing(null);
    }
  }, [editing, headers]);

  const screenRect = (rect: Rect) => ({
    left: (rect.x - camera.x) * camera.zoom + viewport.width / 2,
    top: (rect.y - camera.y) * camera.zoom + viewport.height / 2,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  });

  const select = (entry: HeaderEntry) => {
    setTableAxisSelection({ frameId: entry.frame.id, axisId: entry.axis.id });
    onSelect([entry.frame.id]);
  };

  const canWrite = (entry: HeaderEntry) => !readOnly && !entry.frame.locked;

  const clearMenuTimer = () => {
    if (menuTimer.current == null) return;
    window.clearTimeout(menuTimer.current);
    menuTimer.current = null;
  };

  useEffect(() => () => clearMenuTimer(), []);

  useEffect(() => {
    const clear = () => clearMenuTimer();
    window.addEventListener("pointerdown", clear, true);
    return () => window.removeEventListener("pointerdown", clear, true);
  }, []);

  const startEditing = (entry: HeaderEntry) => {
    if (!canWrite(entry)) return;
    clearMenuTimer();
    const next = { frameId: entry.frame.id, axisId: entry.axis.id, kind: entry.kind };
    setMenu(null);
    select(entry);
    editingRef.current = next;
    setEditing(next);
  };

  const focusHeader = (frameId: string, axisId: string) => {
    window.requestAnimationFrame(() => buttons.current.get(keyOf(frameId, axisId))?.focus());
  };

  const finishEditing = (commit: boolean, next?: EditState | null) => {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    const entry = headers.find(
      (candidate) =>
        candidate.frame.id === current.frameId && candidate.axis.id === current.axisId,
    );
    if (commit && entry && draft.trim() !== entry.axis.title.trim()) {
      renameAxis(board, entry.frame.id, entry.axis.id, draft);
    }
    setEditing(null);
    if (next) {
      editingRef.current = next;
      setEditing(next);
    } else if (entry) {
      focusHeader(current.frameId, current.axisId);
    }
  };

  const placeholder = (kind: AxisKind, n: number) =>
    t(kind === "column" ? "section.axis.placeholderColumn" : "section.axis.placeholderRow", {
      n,
    });

  const insert = (entry: HeaderEntry, position: "before" | "after") => {
    setMenu(null);
    const layout = tableLayoutOf(board, entry.frame.id);
    if (!layout) return;
    const axes = entry.kind === "column" ? layout.columns : layout.rows;
    const opposite = entry.kind === "column" ? "section.axis.placeholderRow" : "section.axis.placeholderColumn";
    const created = addAxis(board, entry.frame.id, entry.kind, {
      title: placeholder(entry.kind, axes.length + 1),
      firstTitle: placeholder(entry.kind, 1),
      oppositeTitle: t(opposite, { n: 1 }),
      ...(position === "before"
        ? { beforeId: entry.axis.id }
        : { afterId: entry.axis.id }),
    });
    if (created) {
      setTableAxisSelection({ frameId: entry.frame.id, axisId: created });
      onSelect([entry.frame.id]);
    }
  };

  const menuItems = (entry: HeaderEntry): MenuItem[] => {
    const layout = tableLayoutOf(board, entry.frame.id);
    if (!layout) return [];
    const axes = entry.kind === "column" ? layout.columns : layout.rows;
    const index = axes.findIndex((axis) => axis.id === entry.axis.id);
    const kindName = entry.kind === "column" ? t("section.columns") : t("section.rows");
    const items: MenuItem[] = [
      {
        label: t("section.axis.rename"),
        hint: entry.axis.title || t("section.axis.untitled"),
        onSelect: () => startEditing(entry),
      },
      {
        label: t(
          entry.kind === "column"
            ? "section.axis.insertLeft"
            : "section.axis.insertAbove",
        ),
        onSelect: () => insert(entry, "before"),
      },
      {
        label: t(
          entry.kind === "column"
            ? "section.axis.insertRight"
            : "section.axis.insertBelow",
        ),
        onSelect: () => insert(entry, "after"),
      },
      { separator: true },
      {
        label: t(
          entry.kind === "column" ? "section.axis.moveLeft" : "section.axis.moveUp",
        ),
        disabled: index <= 0,
        onSelect: () => {
          moveAxis(board, entry.frame.id, entry.axis.id, -1);
          setMenu(null);
        },
      },
      {
        label: t(
          entry.kind === "column" ? "section.axis.moveRight" : "section.axis.moveDown",
        ),
        disabled: index < 0 || index >= axes.length - 1,
        onSelect: () => {
          moveAxis(board, entry.frame.id, entry.axis.id, 1);
          setMenu(null);
        },
      },
      ...(entry.kind === "column"
        ? [
            {
              label: t("section.axis.rotate"),
              checked: Boolean(entry.axis.vertical),
              onSelect: () => {
                setAxisVertical(board, entry.frame.id, entry.axis.id, !entry.axis.vertical);
                setMenu(null);
              },
            } satisfies MenuItem,
          ]
        : []),
      { separator: true },
      { heading: `${kindName} · ${t("section.size.mode")}` },
      ...[
        { value: "auto" as const, label: t("section.size.auto") },
        {
          value: "narrow" as const,
          label: t(entry.kind === "column" ? "section.size.narrow" : "section.size.low"),
        },
        { value: "medium" as const, label: t("section.size.medium") },
        {
          value: "wide" as const,
          label: t(entry.kind === "column" ? "section.size.wide" : "section.size.tall"),
        },
      ].map(
        (option): MenuItem => ({
          label: option.label,
          checked:
            typeof entry.axis.size !== "number" && (entry.axis.size ?? "auto") === option.value,
          onSelect: () => {
            setAxisSize(board, entry.frame.id, entry.axis.id, option.value);
            setMenu(null);
          },
        }),
      ),
      ...(typeof entry.axis.size === "number"
        ? [
            {
              label: `${t("section.size.manual")} · ${t("section.size.px", { n: entry.axis.size })}`,
              checked: true,
              disabled: true,
              onSelect: () => undefined,
            } satisfies MenuItem,
          ]
        : []),
      { separator: true },
      {
        label: t(
          entry.kind === "column"
            ? "section.axis.deleteColumn"
            : "section.axis.deleteRow",
        ),
        danger: true,
        onSelect: () => {
          setPendingDelete({
            frameId: entry.frame.id,
            axisId: entry.axis.id,
            kind: entry.kind,
          });
          setMenu(null);
        },
      },
    ];
    return items;
  };

  const dropRect = (() => {
    if (!drop) return null;
    const frame = widgets.find((widget) => widget.id === drop.frameId);
    if (!frame) return null;
    const grid = layoutTable(frame, widgets);
    const rect = grid ? cellRect(grid, drop.rowId, drop.columnId) : null;
    return rect ? screenRect(rect) : null;
  })();

  if (presenting || headers.length === 0) return null;

  return (
    <>
      <TableMirror widgets={widgets} />
      <TableAxisControls
        board={board}
        widgets={widgets}
        camera={camera}
        viewport={viewport}
        readOnly={readOnly}
        activeFrameIds={
          new Set([
            ...selectedIds.filter((id) => headers.some((entry) => entry.frame.id === id)),
            ...(selection ? [selection.frameId] : []),
          ])
        }
        onCreated={(frameId, axisId) => {
          setTableAxisSelection({ frameId, axisId });
          onSelect([frameId]);
        }}
      />
      <div className="table-headers" role="group" aria-label={t("section.axes")}>
        {headers.map((entry) => {
          const rect = screenRect(entry.rect);
          if (
            rect.left + rect.width < 0 ||
            rect.left > viewport.width ||
            rect.top + rect.height < 0 ||
            rect.top > viewport.height
          ) {
            return null;
          }
          const label = entry.axis.title || t("section.axis.untitled");
          const selected =
            selection?.frameId === entry.frame.id &&
            selection.axisId === entry.axis.id;
          const isEditing =
            editing?.frameId === entry.frame.id && editing.axisId === entry.axis.id;
          const kindLabel = entry.kind === "column" ? t("section.columns") : t("section.rows");
          return (
            <button
              key={keyOf(entry.frame.id, entry.axis.id)}
              ref={(node) => {
                const key = keyOf(entry.frame.id, entry.axis.id);
                if (node) buttons.current.set(key, node);
                else buttons.current.delete(key);
              }}
              type="button"
              className={`table-header${selected ? " is-selected" : ""}${
                isEditing ? " is-editing" : ""
              }`}
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
              aria-label={`${kindLabel}: ${label}`}
              aria-pressed={selected}
              onClick={(event) => {
                event.stopPropagation();
                if (!selected) {
                  clearMenuTimer();
                  select(entry);
                  return;
                }
                // A double click is an edit, so the menu waits long enough for the
                // second click to turn the gesture into one (ADR-196).
                if (event.detail > 1 || !canWrite(entry)) return;
                clearMenuTimer();
                const box = event.currentTarget.getBoundingClientRect();
                menuTimer.current = window.setTimeout(() => {
                  menuTimer.current = null;
                  setMenu({ entry, x: box.left, y: box.bottom });
                }, 220);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                startEditing(entry);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!canWrite(entry)) return;
                clearMenuTimer();
                select(entry);
                setMenu({ entry, x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "F2") {
                  event.preventDefault();
                  startEditing(entry);
                } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  if (!canWrite(entry)) return;
                  select(entry);
                  const box = event.currentTarget.getBoundingClientRect();
                  setMenu({ entry, x: box.left, y: box.bottom });
                }
              }}
            />
          );
        })}
      </div>

      {editing &&
        (() => {
          const entry = headers.find(
            (candidate) =>
              candidate.frame.id === editing.frameId &&
              candidate.axis.id === editing.axisId,
          );
          if (!entry) return null;
          const rect = screenRect(entry.rect);
          const vertical = entry.kind === "column" && entry.axis.vertical;
          const width = vertical ? Math.max(rect.width, 168) : rect.width;
          const height = Math.min(rect.height, 34);
          return (
            <input
              key={keyOf(entry.frame.id, entry.axis.id)}
              className="table-header-editor"
              style={{
                left: vertical ? rect.left + rect.width / 2 - width / 2 : rect.left,
                top: rect.top + rect.height / 2 - height / 2,
                width,
                height,
              }}
              autoFocus
              value={draft}
              aria-label={t("section.axis.title")}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onBlur={() => finishEditing(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  finishEditing(true);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  finishEditing(false);
                } else if (event.key === "Tab") {
                  event.preventDefault();
                  const index = headers.findIndex(
                    (candidate) =>
                      candidate.frame.id === entry.frame.id &&
                      candidate.axis.id === entry.axis.id,
                  );
                  const nextEntry = headers[index + 1] ?? headers[0];
                  finishEditing(true);
                  if (nextEntry) {
                    window.setTimeout(() => startEditing(nextEntry), 0);
                  }
                }
              }}
            />
          );
        })()}

      {menu && (
        <div
          ref={menuRef}
          className="table-axis-menu"
          style={{
            left: (placement ?? { left: menu.x, top: menu.y }).left,
            top: (placement ?? { left: menu.x, top: menu.y }).top,
            visibility: placement ? undefined : "hidden",
          }}
        >
          <Menu
            label={`${menu.entry.kind === "column" ? t("section.columns") : t("section.rows")}: ${
              menu.entry.axis.title || t("section.axis.untitled")
            }`}
            items={menuItems(menu.entry)}
            onClose={() => setMenu(null)}
          />
        </div>
      )}

      {dropRect && (
        <div
          className="table-drop-cell"
          style={{
            left: dropRect.left,
            top: dropRect.top,
            width: dropRect.width,
            height: dropRect.height,
          }}
          aria-hidden="true"
        />
      )}

      {refused && cursor && (
        <div
          className="table-drop-refused"
          style={{ left: cursor.x + 14, top: cursor.y + 18 }}
          role="status"
        >
          {t("section.cell.refuseHeader")}
        </div>
      )}

      {pendingDelete && (
        <AxisDeleteDialog
          board={board}
          widgets={widgets}
          target={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onDeleted={() => {
            setPendingDelete(null);
            setTableAxisSelection(null);
          }}
        />
      )}
    </>
  );
}
