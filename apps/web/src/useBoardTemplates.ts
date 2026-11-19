import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { insertTemplate, loadBoard, type BoardDocument } from "@remo/doc";
import {
  isTemplateTitle,
  reconstructKanban,
  TEMPLATE_KEYS,
  toBoard,
  type Board,
  type KanbanState,
  type NormalizedTemplate,
  type TemplateKey,
  type Widget,
} from "@remo/model";
import type { Access } from "./api";
import { useI18n } from "./i18n";

type TemplatesFile = { locale?: string; templates: Record<string, NormalizedTemplate> };

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
  langReady = true,
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
  /** Wait for the account language before seeding a new board (ADR-169). */
  langReady?: boolean;
}) {
  const { lang } = useI18n();
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
    let alive = true;
    const path = lang === "en" ? "/templates.json" : `/templates.${lang}.json`;
    const load = (target: string) =>
      fetch(target).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<TemplatesFile>;
      });
    load(path)
      .catch(() => load("/templates.json"))
      .then((data) => {
        if (alive) setTemplates(data);
      })
      .catch((error) => console.error(`failed to load ${path}`, error));
    return () => {
      alive = false;
    };
  }, [lang]);

  /** Kanban matrices for a template, keyed by the captured widget ids. */
  const kanbanStatesFor = useCallback((key: TemplateKey, model: Board, locale: "en" | "ru") => {
    const states: Record<string, KanbanState> = {};
    for (const widget of model.widgets) {
      if (widget.type !== "kanban") continue;
      states[widget.id] = reconstructKanban(
        key,
        widget,
        model.widgets.filter((w) => w.parentId === widget.id),
        locale,
      );
    }
    return states;
  }, [lang]);

  /**
   * Put a template into the document. One non-undoable transaction that replaces
   * the board, because a template import is not a user edit.
   */
  const loadTemplate = useCallback(
    (key: TemplateKey, file: TemplatesFile) => {
      const template = file.templates[key];
      if (!template) return;
      const locale = file.locale === "ru" ? "ru" : "en";
      const model = toBoard(key, template);
      // Keep a name a person chose; a template name is only a default for an
      // unnamed board (ADR-100).
      const current = board.title;
      const keep = requestedName ||
        (current && !isTemplateTitle(current) ? current : boardTitle);
      loadBoard(board, model, kanbanStatesFor(key, model, locale), { title: keep });
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
    if (!templates || !readyToSeed || !langReady || seeded.current) return;
    // The file may still be the English fallback while the profile language is
    // settling; seeding now would make an English board for a Russian account.
    if (templates.locale && templates.locale !== lang) return;
    seeded.current = true;
    if (seedEmpty || widgets.length > 0) return;
    // A named board opened without a template is a board someone already created;
    // do not seed over it while the first sync is still arriving. Only a legacy room
    // with no server title gets the default template, and an explicit `?template=`
    // always wins.
    if (!requested && boardTitle) return;
    loadTemplate(active, templates);
  }, [
    active,
    boardTitle,
    lang,
    langReady,
    loadTemplate,
    readyToSeed,
    seedEmpty,
    templates,
    widgets.length,
  ]);

  /** A tab adds its template beside what is already on the board. */
  const addTemplate = useCallback(
    (key: TemplateKey) => {
      setActive(key);
      const template = templates?.templates[key];
      if (!template) return;
      const locale = templates.locale === "ru" ? "ru" : "en";
      const model = toBoard(key, template);
      insertTemplate(board, model, kanbanStatesFor(key, model, locale));
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
