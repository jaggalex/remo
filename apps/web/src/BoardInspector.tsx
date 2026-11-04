import { useEffect, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import type { ConnectionStatus, Presence } from "@remo/doc";
import { soleSelectedGroup, type KanbanState, type Widget } from "@remo/model";
import { api } from "./api";
import { commandById, type CommandContext } from "./commands";
import { isEditable } from "./BoardCanvas";
import { addColumn, addSwimlane, groupNameOf, setColumnWip } from "@remo/doc";
import { currentRoom } from "./identity";
import { CardFilterPanel } from "./CardFilterPanel";
import { ConfirmDialog as UiConfirmDialog } from "@remo/ui";
import { useI18n, type TranslationKey } from "./i18n";
import {
  CardFieldsPanel,
  GroupNameField,
  ObjectLinkPanel,
  ObjectNameField,
  TagsPanel,
} from "./BoardObjectPanels";

/**
 * The board overview panel.
 *
 * Overview, selection actions, document counts, kanban state and the technical honesty
 * section. It is presentational: every action is a command App already owns, so the
 * panel cannot invent a second path to the document (ADR-093/Q4.2).
 */
export interface BoardInspectorProps {
  toggleInspector: () => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  writeBlocked: boolean;
  commandContext: CommandContext;
  widgets: Widget[];
  board: BoardDocument;
  setWidgetPositions: (
    board: BoardDocument,
    positions: { id: string; x: number; y: number }[],
  ) => void;
  canJoinSelection: boolean;
  connectSelection: () => void;
  setEditingId: (id: string | null) => void;
  selectionLocked: boolean;
  counts: Array<[string, number]>;
  kanbanStates: Record<string, KanbanState>;
  replaceBoard: () => void;
  status: ConnectionStatus;
  visiblePresence: Presence[];
  /** Open a board deep link, e.g. an internal link target. */
  onOpenObject: (boardId: string, widgetId: string) => void;
}

export function BoardInspector(props: BoardInspectorProps) {
  const { t, count, typeName, statusName } = useI18n();
  const {
    toggleInspector, selectedIds, setSelectedIds, writeBlocked,
    commandContext, widgets, board, setWidgetPositions, canJoinSelection,
    connectSelection, setEditingId, selectionLocked, counts, kanbanStates,
    replaceBoard, status, visiblePresence, onOpenObject,
  } = props;
  const groupId = soleSelectedGroup(widgets, selectedIds);
  const card =
    selectedIds.length === 1
      ? widgets.find((widget) => widget.id === selectedIds[0] && widget.type === "card")
      : undefined;
  const selectedWidget =
    selectedIds.length === 1 ? widgets.find((widget) => widget.id === selectedIds[0]) : undefined;
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [confirmReplace, setConfirmReplace] = useState(false);

  useEffect(() => {
    if (!card) return;
    let alive = true;
    api
      .boardPeople(currentRoom())
      .then((result) => {
        if (alive) setPeople(result.people);
      })
      .catch(() => {
        if (alive) setPeople([]);
      });
    return () => {
      alive = false;
    };
  }, [card?.id]);

  return (
        <aside className="inspector">
          <div className="inspector-head">
            <h2>{t("inspector.overview")}</h2>
            <button
              type="button"
              className="inspector-close"
              onClick={toggleInspector}
              title={t("inspector.hide")}
              aria-label={t("inspector.hide")}
            >
              ×
            </button>
          </div>
          <p className="muted inspector-intro">{t("inspector.intro")}</p>

          {selectedIds.length > 0 && (
            <>
              <h2>{t("inspector.selection", { count: selectedIds.length })}</h2>
              <div className={`selection-actions${writeBlocked ? " readonly" : ""}`}>
                {(["copy", "copyLink", "cut", "duplicate", "group", "ungroup", "delete"] as const).map((id) => {
                  const command = commandById(id);
                  if (!command) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={!command.enabled(commandContext)}
                      onClick={() => command.run(commandContext)}
                    >
                      {t(command.label(commandContext) as TranslationKey)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    const positions = widgets
                      .filter((w) => selectedIds.includes(w.id) && !w.parentId)
                      .map((w) => ({ id: w.id, x: w.x + 40, y: w.y }));
                    setWidgetPositions(board, positions);
                  }}
                >
                  {t("inspector.nudge")}
                </button>
                <button
                  type="button"
                  disabled={!canJoinSelection}
                  onClick={connectSelection}
                  title={
                    canJoinSelection ? t("inspector.connectTitle") : t("inspector.connectHint")
                  }
                >
                  {t("inspector.connect")}
                </button>
                <button
                  type="button"
                  disabled={
                    selectedIds.length !== 1 ||
                    !widgets.some((w) => w.id === selectedIds[0] && isEditable(w))
                  }
                  onClick={() => setEditingId(selectedIds[0] ?? null)}
                  title={t("inspector.editTextTitle")}
                >
                  {t("inspector.editText")}
                </button>
                <div className="layer-row" role="group" aria-label={t("inspector.layer")}>
                  {(
                    [
                      ["front", "⤒"],
                      ["forward", "↑"],
                      ["backward", "↓"],
                      ["back", "⤓"],
                    ] as const
                  ).map(([id, glyph]) => {
                    const command = commandById(id);
                    if (!command) return null;
                    const label = t(command.label(commandContext) as TranslationKey);
                    return (
                      <button
                        key={id}
                        type="button"
                        title={label}
                        aria-label={label}
                        disabled={!command.enabled(commandContext)}
                        onClick={() => command.run(commandContext)}
                      >
                        {glyph}
                      </button>
                    );
                  })}
                  {(() => {
                    const command = commandById("lock");
                    if (!command) return null;
                    const label = t(command.label(commandContext) as TranslationKey);
                    return (
                      <button
                        type="button"
                        className={selectionLocked ? "locked" : undefined}
                        title={label}
                        aria-label={label}
                        aria-pressed={selectionLocked}
                        onClick={() => command.run(commandContext)}
                      >
                        {selectionLocked ? "🔒" : "🔓"}
                      </button>
                    );
                  })()}
                </div>
                {(() => {
                  const command = commandById("info");
                  if (!command) return null;
                  return (
                    <button
                      type="button"
                      disabled={!command.enabled(commandContext)}
                      onClick={() => command.run(commandContext)}
                      title={t("inspector.infoTitle")}
                    >
                      {t(command.label(commandContext) as TranslationKey)}
                    </button>
                  );
                })()}
                <button type="button" onClick={() => setSelectedIds([])}>
                  {t("inspector.clear")}
                </button>
              </div>
              {groupId && (
                <GroupNameField
                  board={board}
                  groupId={groupId}
                  name={groupNameOf(board, groupId)}
                  disabled={writeBlocked}
                />
              )}
              {card && (
                <CardFieldsPanel
                  board={board}
                  card={card}
                  people={people}
                  disabled={writeBlocked}
                />
              )}
              {selectedWidget && (
                <ObjectNameField board={board} widget={selectedWidget} disabled={writeBlocked} />
              )}
              {selectedWidget && (
                <ObjectLinkPanel
                  board={board}
                  widget={selectedWidget}
                  widgets={widgets}
                  disabled={writeBlocked}
                  onOpenObject={onOpenObject}
                />
              )}
              <TagsPanel
                board={board}
                widgets={widgets}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                disabled={writeBlocked}
              />
            </>
          )}

          <CardFilterPanel widgets={widgets} setSelectedIds={setSelectedIds} />

          <details className="inspector-tech">
            <summary>{t("inspector.tech")}</summary>
            <p className="muted">{t("inspector.documentNote")}</p>
            <div className="history-row">
              <span>
                {t("inspector.undoStack")} <b>{board.undo.undoStack.length}</b>
              </span>
              <span>
                {t("inspector.redoStack")} <b>{board.undo.redoStack.length}</b>
              </span>
            </div>
            <div className="history-row">
              <span>
                {t("inspector.room")} <b>{currentRoom()}</b>
              </span>
              <span>
                {t("inspector.sync")} <b>{statusName(status)}</b>
              </span>
            </div>
            <div className="history-row">
              <span>
                {t("inspector.inRoom")} <b>{visiblePresence.length}</b>
              </span>
              <span className="muted">
                {visiblePresence
                  .map((p) => (p.self ? t("board.peerYou", { name: p.label }) : p.label))
                  .join(", ")}
              </span>
            </div>
          </details>

          <h2>{t("inspector.contents")}</h2>
          <ul className="counts">
            {counts.map(([type, total]) => (
              <li key={type}>
                <span>{typeName(type)}</span>
                <b>{total}</b>
              </li>
            ))}
          </ul>
          <p className="muted inspector-danger-note">{t("inspector.replaceNote")}</p>
          <button
            type="button"
            className="danger-link"
            disabled={writeBlocked}
            onClick={() => setConfirmReplace(true)}
            title={t("board.replaceTitle")}
          >
            {t("board.replace")}
          </button>
          {confirmReplace && (
            <UiConfirmDialog
              title={t("board.replaceHeading")}
              confirmLabel={t("board.replaceAction")}
              onCancel={() => setConfirmReplace(false)}
              onConfirm={() => {
                setConfirmReplace(false);
                replaceBoard();
              }}
            >
              {t("board.replaceConfirm")}
            </UiConfirmDialog>
          )}

          <h2>{t("inspector.kanban")}</h2>
          <p className="muted">{t("inspector.kanbanNote")}</p>
          {Object.entries(kanbanStates).map(([id, state]) => (
            <div key={id} className="kanban-state">
              <div className="kanban-state-head">
                {count("columns", state.columns.length)} ×{" "}
                {count("swimlanes", state.swimlanes.length)}
              </div>
              <div className="muted">
                {count("cards", Object.keys(state.cards).length)} ·{" "}
                {t("inspector.newColumnWidth", { width: Math.round(state.newColumnWidth) })}
              </div>
              <div className="chips">
                {state.columns.map((column) => (
                  <span key={column.id} className="chip">
                    {column.title}{" "}
                    <b>
                      {Object.values(state.cards).filter((p) => p.columnId === column.id).length}
                    </b>
                  </span>
                ))}
              </div>
              <div className="kanban-actions">
                <button type="button" disabled={writeBlocked} onClick={() => addColumn(board, id)}>
                  {t("inspector.addColumn")}
                </button>
                <button type="button" disabled={writeBlocked} onClick={() => addSwimlane(board, id)}>
                  {t("inspector.addSwimlane")}
                </button>
              </div>
              <div className="wip-grid">
                {state.columns.map((column) => (
                  <label key={column.id} className="wip-field">
                    <span>{column.title}</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={column.wipLimit ?? ""}
                      disabled={writeBlocked}
                      onChange={(event) =>
                        setColumnWip(
                          board,
                          id,
                          column.id,
                          event.target.value ? Number(event.target.value) : null,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="muted">{t("inspector.wipHint")}</p>
              <p className="muted">{t("inspector.kanbanHelp")}</p>
            </div>
          ))}

          <details className="scope">
            <summary>{t("inspector.scope")}</summary>
            <ul className="checklist">
              <li className="done">{t("scope.canvas")}</li>
              <li className="done">{t("scope.painters")}</li>
              <li className="done">{t("scope.matrix")}</li>
              <li className="done">{t("scope.cards")}</li>
              <li className="done">{t("scope.undo")}</li>
              <li className="done">{t("scope.marquee")}</li>
              <li className="done">{t("scope.sync")}</li>
              <li className="done">{t("scope.postgres")}</li>
              <li className="done">{t("scope.text")}</li>
              <li className="done">{t("scope.share")}</li>
              <li className="done">{t("scope.grow")}</li>
              <li className="done">{t("scope.templates")}</li>
              <li className="done">{t("scope.authoring")}</li>
              <li className="done">{t("scope.richText")}</li>
            </ul>
          </details>
        </aside>
  );
}
