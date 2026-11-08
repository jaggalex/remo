import {
  bounds,
  newId,
  type Board,
  type KanbanState,
} from "@remo/model";
import type { BoardDocument } from "./board";
import { writeKanbanState } from "./kanbanState";
import { seedTextField } from "./text";

/**
 * Adding a template to a board that already has content.
 *
 * Ids are remapped (two captured templates can share ids), parents and endpoints follow,
 * and the template lands to the right of what is already there instead of on top of it
 * (ADR-016). Loading a *fresh* board is a different job and stays with the class.
 */

/* ------------------------------------------------------ template insertion -- */

export interface InsertOptions {
  /** Gap between existing content and the inserted template, in canvas units. */
  gap?: number;
}

/**
 * Add a template to a board that already has content.
 *
 * The source product does this too: applying a template *adds* it and leaves the
 * existing board alone (ADR-019). Widget ids from two templates
 * can collide — both captures use the ids they shipped with — so every inserted
 * widget gets a fresh id and its parent link is remapped, which also makes applying
 * the same template twice safe.
 *
 * Placement is ours, not the source product's: it anchors the template and lets it
 * overlap (ADR-019). We put it to the right of what is already
 * there instead, so a board with several templates stays readable.
 */
export function insertTemplate(
  board: BoardDocument,
  template: Board,
  kanbanStates: Record<string, KanbanState> = {},
  options: InsertOptions = {},
): { offset: { x: number; y: number }; inserted: number } {
  const gap = options.gap ?? 400;
  const existing = board.readWidgets();
  const incoming = bounds(template.widgets);

  // Anchor on the right of the existing content, aligned to its top. An empty board
  // puts the template where it is, so a first insert keeps the captured geometry.
  const offset =
    existing.length === 0
      ? { x: 0, y: 0 }
      : {
          x: bounds(existing).x + bounds(existing).width + gap - incoming.x,
          y: bounds(existing).y - incoming.y,
        };

  const idMap = new Map<string, string>();
  for (const widget of template.widgets) {
    // Prefixed rather than random: it stays greppable against the capture it came from.
    idMap.set(widget.id, newId(`${widget.type.slice(0, 4)}_ins`));
  }

  // Groups are membership, so a second insertion must not make two clusters share
  // an id (ADR-022). Their names follow the same remapping (ADR-101).
  const groupMap = new Map<string, string>();
  for (const widget of template.widgets) {
    if (!widget.groupId || groupMap.has(widget.groupId)) continue;
    groupMap.set(widget.groupId, newId("grp"));
  }

  board.transact(() => {
    for (const widget of template.widgets) {
      const id = idMap.get(widget.id)!;
      const parentId = widget.parentId ? (idMap.get(widget.parentId) ?? null) : null;
      const start = widget.start?.item ? idMap.get(widget.start.item) : undefined;
      const end = widget.end?.item ? idMap.get(widget.end.item) : undefined;
      const groupId = widget.groupId ? groupMap.get(widget.groupId) : undefined;
      const next = {
        ...widget,
        id,
        parentId,
        x: widget.x + offset.x,
        y: widget.y + offset.y,
        // Endpoints only exist in the template, so they are remapped; a connector
        // whose end did not come along is dropped below.
        ...(widget.type === "connector" ? { start: start ? { item: start } : undefined, end: end ? { item: end } : undefined } : {}),
      };
      if (groupId) next.groupId = groupId;
      else delete next.groupId;
      board.widgets.set(id, next);

      seedTextField(board, { ...widget, id }, widget.title ?? widget.content ?? "");
    }

    for (const [oldId, name] of Object.entries(template.groupNames ?? {})) {
      const groupId = groupMap.get(oldId);
      if (groupId) board.groupNames.set(groupId, name);
    }

    // A connector that lost an endpoint during remapping has nothing to join.
    for (const widget of board.readWidgets()) {
      if (widget.type !== "connector") continue;
      if (!widget.start?.item || !widget.end?.item) board.widgets.delete(widget.id);
    }

    for (const [kanbanId, state] of Object.entries(kanbanStates)) {
      const newKanbanId = idMap.get(kanbanId);
      if (!newKanbanId) continue;
      writeKanbanState(board, newKanbanId, state, idMap);
    }
  });

  return { offset, inserted: template.widgets.length };
}

