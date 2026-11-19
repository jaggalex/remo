import { useEffect, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import type { ConnectionStatus, Presence } from "@remo/doc";
import { soleSelectedGroup, type KanbanState, type Widget } from "@remo/model";
import { api } from "./api";
import type { CommandContext } from "./commands";
import { addColumn, addSwimlane, groupNameOf, setColumnWip } from "@remo/doc";
import { currentRoom } from "./identity";
import { CardFilterPanel } from "./CardFilterPanel";
import { Button, IconButton, Input } from "@remo/ui";
import { HelpLink } from "./help/HelpLink";
import { InspectorFold } from "./InspectorFold";
import { objectText } from "./vote/voteLabels";
import { useI18n } from "./i18n";
import {
  CardFieldsPanel,
  GroupNameField,
  ObjectLinkPanel,
  ObjectNameField,
  TagsPanel,
} from "./BoardObjectPanels";
import { Contained } from "./ErrorBoundary";
import { SectionPanel } from "./SectionPanel";
import { SelectionActions } from "./SelectionActions";
import { TableCellPanel } from "./TableCellPanel";

/**
 * Sync details are for a developer: a development build opened with `?debug`, the same
 * switch as the canvas cursor readout (ADR-236).
 */
const SYNC_DETAILS =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("debug");

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
  status: ConnectionStatus;
  visiblePresence: Presence[];
  /** Open a board deep link, e.g. an internal link target. */
  onOpenObject: (boardId: string, widgetId: string) => void;
}

/**
 * The inspector inside its own failure boundary (ADR-171): an object the panel cannot
 * show closes the panel, not the room, and selecting something else retries.
 */
export function BoardInspector(props: BoardInspectorProps) {
  return (
    <Contained scope="panel" resetKey={props.selectedIds.join(",")}>
      <InspectorBody {...props} />
    </Contained>
  );
}

function InspectorBody(props: BoardInspectorProps) {
  const { t, typeName, statusName } = useI18n();
  const {
    toggleInspector, selectedIds, setSelectedIds, writeBlocked,
    commandContext, widgets, board, setWidgetPositions, canJoinSelection,
    connectSelection, setEditingId, selectionLocked, counts, kanbanStates,
    status, visiblePresence, onOpenObject,
  } = props;
  const groupId = soleSelectedGroup(widgets, selectedIds);
  const card =
    selectedIds.length === 1
      ? widgets.find((widget) => widget.id === selectedIds[0] && widget.type === "card")
      : undefined;
  const selectedWidget =
    selectedIds.length === 1 ? widgets.find((widget) => widget.id === selectedIds[0]) : undefined;
  const section =
    selectedWidget?.type === "frame" ? selectedWidget : undefined;
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);

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

  // One subject at a time (ADR-236): the room when nothing is selected, a kanban when one
  // is, otherwise the selection. Room-wide content never shows beside another subject.
  const kanban =
    selectedWidget?.type === "kanban" && kanbanStates[selectedWidget.id]
      ? { id: selectedWidget.id, state: kanbanStates[selectedWidget.id]! }
      : null;
  const subject = selectedIds.length === 0 ? "room" : kanban ? "kanban" : "selection";
  // The header names the subject: its kind, then its own name (ADR-236, sketch D4).
  const kicker =
    subject === "room"
      ? t("inspector.kindRoom")
      : selectedWidget
        ? section?.layout?.kind === "table"
          ? t("inspector.kindTable", { kind: typeName("frame") })
          : typeName(selectedWidget.type)
        : null;
  const heading =
    subject === "room"
      ? board.title || t("board.untitled")
      : selectedWidget
        ? subjectName(selectedWidget) || typeName(selectedWidget.type)
        : t("inspector.selection", { count: selectedIds.length });
  // One help per panel, about the subject it shows.
  const helpTopic = section ? "section.table" : card ? "cards.fields" : "room.panel";
  const tagNames = (selectedWidget?.tagIds ?? [])
    .map((id) => (board.tags.get(id) as { name?: string } | undefined)?.name)
    .filter(Boolean)
    .join(", ");
  const nameValue = selectedWidget?.name || (selectedWidget?.link ? t("inspector.hasLink") : t("inspector.none"));

  return (
        <aside className="inspector" aria-label={t("inspector.overview")}>
          <div className="inspector-head">
            <div className="inspector-subject">
              {kicker && <span className="inspector-kicker">{kicker}</span>}
              <h2 className="inspector-title">{heading}</h2>
            </div>
            <HelpLink topicId={helpTopic} label={t("inspector.help")} className="help-link icon-link" />
            <IconButton icon="close" size="compact" label={t("inspector.hide")} onClick={toggleInspector} />
          </div>

          {subject === "room" && (
            <>
              <h3 className="inspector-group">{t("inspector.contents")}</h3>
              <ul className="counts">
                {counts.map(([type, total]) => (
                  <li key={type}>
                    <span>{typeName(type)}</span>
                    <b>{total}</b>
                  </li>
                ))}
              </ul>
              <CardFilterPanel widgets={widgets} setSelectedIds={setSelectedIds} />
            </>
          )}

          {selectedIds.length > 0 && (
            <>
              <SelectionActions
                commandContext={commandContext}
                widgets={widgets}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                board={board}
                setWidgetPositions={setWidgetPositions}
                canJoinSelection={canJoinSelection}
                connectSelection={connectSelection}
                setEditingId={setEditingId}
                selectionLocked={selectionLocked}
                writeBlocked={writeBlocked}
              />
              {kanban && (
                <KanbanStatePanel board={board} id={kanban.id} state={kanban.state} writeBlocked={writeBlocked} />
              )}
              {groupId && (
                <GroupNameField
                  board={board}
                  groupId={groupId}
                  name={groupNameOf(board, groupId)}
                  disabled={writeBlocked}
                />
              )}
              {section && (
                <SectionPanel
                  board={board}
                  frame={section}
                  widgets={widgets}
                  writeBlocked={writeBlocked}
                  onDeleted={() => setSelectedIds([])}
                />
              )}
              {!section && (
                <TableCellPanel
                  board={board}
                  widgets={widgets}
                  selectedIds={selectedIds}
                  writeBlocked={writeBlocked}
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
              {/* Rare groups fold to one row each (ADR-236). */}
              {selectedWidget && (
                <InspectorFold label={t("inspector.nameAndLink")} value={nameValue} className="name-link-fold">
                  <ObjectNameField board={board} widget={selectedWidget} disabled={writeBlocked} />
                  <ObjectLinkPanel
                    board={board}
                    widget={selectedWidget}
                    widgets={widgets}
                    disabled={writeBlocked}
                    onOpenObject={onOpenObject}
                  />
                </InspectorFold>
              )}
              <InspectorFold label={t("tags.title")} value={tagNames || t("inspector.none")} className="tags-fold">
                <TagsPanel
                  board={board}
                  widgets={widgets}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  disabled={writeBlocked}
                />
              </InspectorFold>
            </>
          )}

          {/* A developer's instrument, not a product readout (ADR-236): the person has the
              save icon in the header. */}
          {SYNC_DETAILS && (
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
          )}
        </aside>
  );
}

/** A selected kanban's state (ADR-236): its columns, swimlanes and WIP limits. */
function KanbanStatePanel({
  board,
  id,
  state,
  writeBlocked,
}: {
  board: BoardDocument;
  id: string;
  state: KanbanState;
  writeBlocked: boolean;
}) {
  const { t, count } = useI18n();
  return (
    <div className="kanban-state">
      <h3 className="inspector-group">{t("inspector.kanban")}</h3>
      <div className="kanban-state-head">
        {count("columns", state.columns.length)} × {count("swimlanes", state.swimlanes.length)}
      </div>
      <div className="muted">
        {count("cards", Object.keys(state.cards).length)} ·{" "}
        {t("inspector.newColumnWidth", { width: Math.round(state.newColumnWidth) })}
      </div>
      <div className="chips">
        {state.columns.map((column) => (
          <span key={column.id} className="chip">
            {column.title}{" "}
            <b>{Object.values(state.cards).filter((p) => p.columnId === column.id).length}</b>
          </span>
        ))}
      </div>
      <div className="kanban-actions">
        <Button variant="ghost" size="compact" disabled={writeBlocked} onClick={() => addColumn(board, id)}>
          {t("inspector.addColumn")}
        </Button>
        <Button variant="ghost" size="compact" disabled={writeBlocked} onClick={() => addSwimlane(board, id)}>
          {t("inspector.addSwimlane")}
        </Button>
      </div>
      <div className="wip-grid">
        {state.columns.map((column) => (
          <Input
            key={column.id}
            type="number"
            size="compact"
            label={column.title}
            min={1}
            max={999}
            value={column.wipLimit ?? ""}
            disabled={writeBlocked}
            onChange={(event) =>
              setColumnWip(board, id, column.id, event.target.value ? Number(event.target.value) : null)
            }
          />
        ))}
      </div>
      <p className="muted">{t("inspector.wipHint")}</p>
    </div>
  );
}

/** What a person calls an object: its name, else its title or text, as voting rows do. */
function subjectName(widget: Widget): string {
  const line = (widget.name || objectText(widget)).split("\n")[0]!.trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}
