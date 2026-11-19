import { useEffect, useRef, useState } from "react";
import { patchWidget, type BoardDocument } from "@remo/doc";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { Icon, Menu, type MenuItem } from "@remo/ui";
import { useI18n } from "./i18n";
import { setSectionView } from "./sectionView";

/**
 * The section title and the view badge on the canvas (ADR-207).
 *
 * Both are chrome: screen-space, above the section, outside its box. The title is a
 * button that selects and renames; the badge is a menu trigger for the same view switch
 * the panel uses. Nothing here is a document field except `frame.title`.
 */
export function SectionTitleLayer({
  board,
  widgets,
  camera,
  viewport,
  selectedIds,
  readOnly,
  presenting,
  onSelect,
  onNotice,
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  viewport: { width: number; height: number };
  selectedIds: readonly string[];
  readOnly: boolean;
  presenting: boolean;
  onSelect: (ids: string[]) => void;
  onNotice?: (text: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [menu, setMenu] = useState<{ frame: Widget; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editing]);

  if (presenting || camera.zoom < 0.2) return null;

  const commit = (value?: string) => {
    if (!editing) return;
    const frame = widgets.find((widget) => widget.id === editing.id);
    const next = (value ?? editing.draft).trim();
    if (frame && next !== (frame.title ?? "")) {
      patchWidget(board, frame.id, { title: next });
    }
    setEditing(null);
  };

  const switchView = (frame: Widget, view: "free" | "table") => {
    const wasTable = frame.layout?.kind === "table" && frame.layout.active !== false;
    setSectionView(board, frame.id, view, t);
    onSelect([frame.id]);
    if (view === "free" && wasTable) onNotice?.(t("section.view.removed"));
    setMenu(null);
  };

  const menuItems = (frame: Widget): MenuItem[] => {
    const table = frame.layout?.kind === "table" && frame.layout.active !== false;
    return [
      {
        label: t("section.view.section"),
        checked: !table,
        onSelect: () => switchView(frame, "free"),
      },
      {
        label: t("section.view.table"),
        checked: table,
        onSelect: () => switchView(frame, "table"),
      },
    ];
  };

  const frames = widgets.filter((widget) => widget.type === "frame");

  return (
    <>
      <div className="section-titles" aria-hidden="false">
        {frames.map((frame) => {
          const left = (frame.x - frame.width / 2 - camera.x) * camera.zoom + viewport.width / 2;
          const top = (frame.y - frame.height / 2 - camera.y) * camera.zoom + viewport.height / 2;
          const right = left + frame.width * camera.zoom;
          if (right < 0 || left > viewport.width) return null;
          const selected = selectedIds.length === 1 && selectedIds[0] === frame.id;
          const table = frame.layout?.kind === "table" && frame.layout.active !== false;
          const title = frame.title?.trim() ?? "";
          const isEditing = editing?.id === frame.id;
          return (
            <div
              key={frame.id}
              className={`section-title-strip${selected ? " is-selected" : ""}`}
              style={{ left, top: top - 26 }}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="section-title-input"
                  value={editing.draft}
                  aria-label={t("section.title.rename")}
                  maxLength={2000}
                  onChange={(event) =>
                    setEditing({ id: frame.id, draft: event.currentTarget.value })
                  }
                  onBlur={(event) => commit(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commit(event.currentTarget.value);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={`section-title${title ? "" : " is-empty"}`}
                  aria-label={t("section.title.rename")}
                  title={title || undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.detail > 1) {
                      if (!readOnly && !frame.locked) {
                        setEditing({ id: frame.id, draft: title });
                      }
                      return;
                    }
                    onSelect([frame.id]);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== "F2") return;
                    event.preventDefault();
                    if (readOnly || frame.locked) return;
                    setEditing({ id: frame.id, draft: title });
                  }}
                >
                  {title || t("section.title.placeholder")}
                </button>
              )}
              {table && (
                <button
                  type="button"
                  className="section-view-badge"
                  disabled={readOnly || Boolean(frame.locked)}
                  aria-haspopup="menu"
                  aria-expanded={menu?.frame.id === frame.id}
                  aria-label={`${t("section.view.label")}: ${t("section.view.table")}`}
                  title={frame.locked ? t("section.view.locked") : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect([frame.id]);
                    const box = event.currentTarget.getBoundingClientRect();
                    setMenu({ frame, x: box.left, y: box.bottom + 4 });
                  }}
                >
                  <Icon name="table" size={14} />
                  {t("section.view.table")}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <div className="section-view-menu" style={{ left: menu.x, top: menu.y }}>
          <Menu
            label={t("section.view.label")}
            items={menuItems(menu.frame)}
            onClose={() => setMenu(null)}
          />
        </div>
      )}
    </>
  );
}
