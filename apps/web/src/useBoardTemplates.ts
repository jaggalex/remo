import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { insertTemplate, loadBoard, type BoardDocument } from "@remo/doc";
import {
  reconstructKanban,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  toBoard,
  type Board,
  type KanbanState,
  type NormalizedTemplate,
  type TemplateKey,
  type Widget,
} from "@remo/model";
import type { Access } from "./api";

type TemplatesFile = { templates: Record<string, NormalizedTemplate> };

/**
 * Templates: the file, the active tab, and the two ways a template reaches the board.
 *
 * Tabs **add** to the board, because applying a template must preserve what is there;
 * replacing the whole board is a separate, explicit action, because it destroys other
 * people's work (ADR-015). Seeding happens only in an empty room and only after sync
 * has said the room is empty.
 */
export function useBoardTemplates({
  board,
  widgets,
  access,
  boardTitle,
  synced,
  status,
  setSelectedIds,
  reframe,
}: {
  board: BoardDocument;
  widgets: Widget[];
  access: Access | null;
  /** The server-side name, kept when a template seeds a newly created board. */
  boardTitle?: string;
  synced: boolean;
  status: string;
  setSelectedIds: (ids: string[]) => void;
  /** Imported content is re-framed; remote edits never move the camera. */
  reframe: () => void;
}) {
  const [templates, setTemplates] = useState<TemplatesFile | null>(null);
  /**
   * A newly created board asks for its starting point in the URL. `empty` means
   * "do not seed", which is different from "no preference" (seed the default).
   */
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requested = params.get("template");
  const requestedName = requested ? (params.get("name") ?? undefined) : undefined;
  const requestedTemplate = TEMPLATE_KEYS.find((key) => key === requested);
  const seedEmpty = requested === "empty";
  const [active, setActive] = useState<TemplateKey>(requestedTemplate ?? "kanban-framework");

  // The choice belongs to creation, not to every reload: drop it once read.
  useEffect(() => {
    if (!requested) return;
    const next = new URLSearchParams(window.location.search);
    next.delete("template");
    next.delete("name");
    const query = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [requested]);

  useEffect(() => {
    fetch("/templates.json")
      .then((response) => response.json())
      .then((data: TemplatesFile) => setTemplates(data))
      .catch((error) => console.error("failed to load templates.json", error));
  }, []);

  /** Kanban matrices for a template, keyed by the captured widget ids. */
  const kanbanStatesFor = useCallback((key: TemplateKey, model: Board) => {
    const states: Record<string, KanbanState> = {};
    for (const widget of model.widgets) {
      if (widget.type !== "kanban") continue;
      states[widget.id] = reconstructKanban(
        key,
        widget,
        model.widgets.filter((w) => w.parentId === widget.id),
      );
    }
    return states;
  }, []);

  /**
   * Put a template into the document. One non-undoable transaction that replaces
   * the board, because a template import is not a user edit.
   */
  const loadTemplate = useCallback(
    (key: TemplateKey, file: TemplatesFile) => {
      const template = file.templates[key];
      if (!template) return;
      const model = toBoard(key, template);
      // Keep a name a person chose; a template name is only a default for an
      // unnamed board (ADR-100).
      const current = board.title;
      const keep = requestedName ||
        (current && !Object.values(TEMPLATE_LABELS).includes(current) ? current : boardTitle);
      loadBoard(board, model, kanbanStatesFor(key, model), { title: keep });
      setSelectedIds([]);
      reframe();
    },
    [board, boardTitle, kanbanStatesFor, reframe, requestedName, setSelectedIds],
  );

  const seeded = useRef(false);

  /**
   * Seed the room only when it is empty.
   *
   * A client that joins a room which already has content must never write a
   * template over it — the document is shared, so seeding on every mount would
   * erase everyone else's work. Waiting for `sync` first is what makes that safe:
   * until then the local replica is empty even if the room is not.
   *
   * With no sync service reachable there is nobody to clobber, so the app falls
   * back to local-only and seeds too; otherwise a missing server would leave an
   * empty board and no explanation.
   */
  const readyToSeed =
    Boolean(access?.capabilities.includes("board.edit")) && (synced || status === "disconnected");

  useEffect(() => {
    if (!templates || !readyToSeed || seeded.current) return;
    seeded.current = true;
    if (seedEmpty || widgets.length > 0) return;
    // A named board opened without a template is a board someone already created;
    // do not seed over it while the first sync is still arriving. Only a legacy room
    // with no server title gets the default template, and an explicit `?template=`
    // always wins.
    if (!requested && boardTitle) return;
    loadTemplate(active, templates);
  }, [active, boardTitle, loadTemplate, readyToSeed, seedEmpty, templates, widgets.length]);

  /** A tab adds its template beside what is already on the board. */
  const addTemplate = useCallback(
    (key: TemplateKey) => {
      setActive(key);
      const template = templates?.templates[key];
      if (!template) return;
      const model = toBoard(key, template);
      insertTemplate(board, model, kanbanStatesFor(key, model));
      // Frame the new content: it was placed beside what was already there.
      reframe();
    },
    [board, kanbanStatesFor, reframe, templates],
  );

  const replaceBoard = useCallback(() => {
    if (templates) loadTemplate(active, templates);
  }, [active, loadTemplate, templates]);

  return { active, setActive, addTemplate, replaceBoard };
}
