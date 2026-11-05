import * as Y from "yjs";
import { deltaOf, plainOf, runsOf, seedTextField, withMaterializedText } from "./text";
import { readKanban, writeKanbanState } from "./kanbanState";
import {
  isTemplateTitle,
  readTag,
  readWidget,
  type Board,
  type KanbanState,
  type Tag,
  type TextDeltaOp,
  type TextRun,
  type Widget,
} from "@remo/model";

/**
 * The shared board document (ADR-016/ADR-017).
 *
 * Yjs is the single source of truth: the React tree renders a snapshot of it and
 * never keeps its own copy of widget state. Every command runs in exactly one
 * transaction, which is what makes undo behave like the source product — one
 * gesture, one step (ADR-0160.2).
 */
export * from "./text";
export * from "./tree";
export * from "./connectors";
export * from "./widgets";
export * from "./clipboard";
export * from "./layers";
export * from "./groups";
export * from "./arrange";
export * from "./notes";
export * from "./template";
export * from "./kanbanOps";
export * from "./cards";
export * from "./tags";
export * from "./links";
export * from "./presentation";
export * from "./styles";
export * from "./agentPlan";

export { IMPORT_ORIGIN, LOCAL_ORIGIN } from "./origins";
import { IMPORT_ORIGIN, LOCAL_ORIGIN } from "./origins";

export interface BoardSnapshot {
  widgets: Widget[];
  kanbanStates: Record<string, KanbanState>;
  /** Board title from the document; empty until someone names the board. */
  title: string;
  /** Group names keyed by group id (ADR-101); empty when no group is named. */
  groupNames: Record<string, string>;
  /** Board tag vocabulary (ADR-102), keyed by tag id. */
  tags: Record<string, Tag>;
  /** Ordered frame ids for presentation (ADR-108). */
  presentation: string[];
  /**
   * Whether "bring everyone" follows immediately instead of asking (ADR-076).
   *
   * A board setting, not a follow state: it says what this workshop agreed to, and it
   * is the only thing about following that is persisted.
   */
  allowBringEveryone: boolean;
}

type Listener = () => void;

export class BoardDocument {
  readonly doc: Y.Doc;
  readonly widgets: Y.Map<Widget>;
  /**
   * Authoritative text per widget id.
   *
   * Text is a `Y.Text`, not a field on the widget record: typing has to merge
   * character-wise between peers and stream on every keystroke (the source product
   * writes the title per keystroke — see ADR-016). The
   * widget's `title`/`content` stay as the imported fallback, and snapshots
   * materialize the text over them.
   */
  readonly texts: Y.Map<Y.Text>;

  /**
   * Who is using this document right now.
   *
   * Not part of the shared state — it is the local person's name, used to stamp the
   * objects they create. Everyone's browser knows their own (ADR-046).
   */
  author = "";
  /** Board-level metadata: `title`. Part of the document, so it syncs. */
  readonly meta: Y.Map<string>;
  /** groupId → name (ADR-101). A label beside membership, not an object. */
  readonly groupNames: Y.Map<string>;
  /** tagId → Tag (ADR-102). Board-level vocabulary, not a string on each widget. */
  readonly tags: Y.Map<Tag>;
  /** Ordered frame ids for presentation (ADR-108); empty until someone sets it. */
  readonly presentation: Y.Array<string>;
  /** kanbanId → { columns, swimlanes, cards, columnWidth, headerHeight } */
  readonly kanbans: Y.Map<Y.Map<unknown>>;
  readonly undo: Y.UndoManager;

  private listeners = new Set<Listener>();
  private cache: BoardSnapshot | null = null;

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.widgets = doc.getMap<Widget>("widgets");
    this.texts = doc.getMap<Y.Text>("texts");
    this.meta = doc.getMap<string>("meta");
    this.groupNames = doc.getMap<string>("groupNames");
    this.tags = doc.getMap<Tag>("tags");
    this.presentation = doc.getArray<string>("presentation");
    this.kanbans = doc.getMap<Y.Map<unknown>>("kanbans");

    this.undo = new Y.UndoManager(
      [
        this.widgets,
        this.texts,
        this.meta,
        this.groupNames,
        this.tags,
        this.presentation,
        this.kanbans,
      ],
      {
        trackedOrigins: new Set([LOCAL_ORIGIN]),
        // Keystrokes merge into one step; commands call `stopCapturing()` first, so a
        // drag or a menu action is still exactly one undo step (ADR-006).
        captureTimeout: 400,
      },
    );

    const invalidate = () => {
      this.cache = null;
      for (const listener of this.listeners) listener();
    };
    this.doc.on("afterTransaction", invalidate);
    this.undo.on("stack-item-added", invalidate);
    this.undo.on("stack-item-popped", invalidate);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable between changes — required by `useSyncExternalStore`. */
  snapshot = (): BoardSnapshot => {
    if (this.cache) return this.cache;
    // Everything below is read through the wire readers (ADR-171): any client can write
    // any value into the shared maps, and one malformed object must not blank the room
    // for everyone who syncs it.
    const widgets: Widget[] = [];
    this.widgets.forEach((raw, id) => {
      const widget = readWidget(raw, id);
      if (!widget) return;
      const text = this.texts.get(id);
      // `Y.XmlText` extends `Y.Text`; anything else under `texts` is not text.
      if (!(text instanceof Y.Text)) {
        widgets.push(widget);
        return;
      }
      widgets.push(withMaterializedText(widget, plainOf(text), runsOf(text)));
    });

    const kanbanStates: Record<string, KanbanState> = {};
    this.kanbans.forEach((kanban, kanbanId) => {
      if (kanban instanceof Y.Map) kanbanStates[kanbanId] = readKanban(kanban);
    });

    const groupNames: Record<string, string> = {};
    this.groupNames.forEach((name, groupId) => {
      if (typeof name === "string") groupNames[groupId] = name;
    });

    const tags: Record<string, Tag> = {};
    this.tags.forEach((raw, id) => {
      const tag = readTag(raw, id);
      if (tag) tags[id] = tag;
    });

    const title = this.meta.get("title");
    this.cache = {
      widgets,
      kanbanStates,
      title: typeof title === "string" ? title : "",
      groupNames,
      tags,
      presentation: this.presentation
        .toArray()
        .filter((id): id is string => typeof id === "string"),
      allowBringEveryone: this.meta.get("allow_bring_everyone") === "1",
    };
    return this.cache;
  };

  get canUndo(): boolean {
    return this.undo.canUndo();
  }

  get canRedo(): boolean {
    return this.undo.canRedo();
  }

  /**
   * Run `fn` as one undoable user gesture.
   *
   * Each call closes the previous undo step unless `merge` is set, so two commands
   * issued back to back never collapse into a single undo — only typing does, via
   * `setWidgetText`, which passes `merge: true`.
   */
  transact(fn: () => void, origin: string = LOCAL_ORIGIN, options: { merge?: boolean } = {}): void {
    if (!options.merge) this.undo.stopCapturing();
    this.doc.transact(fn, origin);
  }

  /**
   * Start a new undo step.
   *
   * With `captureTimeout` set, Yjs merges transactions that arrive close together —
   * which is what typing wants and what dragging must not have. Gestures mark their
   * boundary explicitly instead of relying on timing.
   */
  stopCapturing(): void {
    this.undo.stopCapturing();
  }

  /** Board title, or an empty string when it has never been set. */
  get title(): string {
    return this.meta.get("title") ?? "";
  }

  /** Rename the board. A deliberate action, so it is its own undo step. */
  setTitle(title: string): void {
    if (this.title === title) return;
    this.transact(() => this.meta.set("title", title));
  }

  /** Current text of a widget: the shared text if it exists, else the imported one. */
  textOf(id: string): string {
    const shared = this.texts.get(id);
    if (shared) return plainOf(shared);
    const widget = this.widgets.get(id);
    return widget?.title ?? widget?.content ?? "";
  }

  /** Formatted runs of a widget, or undefined when it has no formatting at all. */
  runsOf(id: string): TextRun[] | undefined {
    const shared = this.texts.get(id);
    return shared ? runsOf(shared) : undefined;
  }

  /** Serialized rich text of a widget, for the clipboard and the editor. */
  deltaOf(id: string): TextDeltaOp[] {
    const shared = this.texts.get(id);
    if (shared) return deltaOf(shared);
    const widget = this.widgets.get(id);
    const fallback = widget?.title ?? widget?.content ?? "";
    return fallback ? [{ insert: fallback }] : [];
  }

  undoOnce(): void {
    this.undo.undo();
  }

  redoOnce(): void {
    this.undo.redo();
  }
}

/* --------------------------------------------------------- kanban loading --- */

/** Populate a fresh board from a template in one non-undoable transaction. */
export function loadBoard(
  board: BoardDocument,
  template: Board,
  kanbanStates: Record<string, KanbanState>,
  options: { title?: string } = {},
): void {
  board.transact(() => {
    board.widgets.clear();
    board.kanbans.clear();
    board.texts.clear();
    board.groupNames.clear();
    board.tags.clear();
    board.presentation.delete(0, board.presentation.length);

    for (const widget of template.widgets) {
      board.widgets.set(widget.id, widget);
      seedTextField(board, widget, widget.title ?? widget.content ?? "");
    }

    // A connector that lost an endpoint during remapping has nothing to join.
    for (const widget of [...board.widgets.values()]) {
      if (widget.type !== "connector") continue;
      if (!widget.start?.item || !widget.end?.item) board.widgets.delete(widget.id);
    }

    for (const [groupId, name] of Object.entries(template.groupNames ?? {})) {
      board.groupNames.set(groupId, name);
    }

    for (const [tagId, tag] of Object.entries(template.tags ?? {})) {
      board.tags.set(tagId, tag);
    }
    if (template.presentation?.length) {
      board.presentation.push(template.presentation);
    }

    for (const [kanbanId, state] of Object.entries(kanbanStates)) {
      writeKanbanState(board, kanbanId, state);
    }
    // A template names the board unless a human chose the name. A title that is
    // itself a template name does not count as chosen, so switching templates
    // renames the board instead of leaving a name that describes the old one.
    const current = board.meta.get("title");
    const templateTitles = isTemplateTitle;
    // A board created with a name keeps that name when a template seeds it: the
    // template names the content, not the board (ADR-015/ADR-100).
    if (options.title?.trim()) {
      board.meta.set("title", options.title.trim());
    } else if (template.title && (!current || templateTitles(current))) {
      board.meta.set("title", template.title);
    }
  }, IMPORT_ORIGIN);

  board.undo.clear();
}
