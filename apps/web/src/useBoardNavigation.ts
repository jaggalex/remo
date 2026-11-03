import { useCallback, useEffect, useRef } from "react";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { writeClipboard } from "./clipboard";
import { currentRoom } from "./identity";
import type { TranslationKey } from "./i18n";

/**
 * Board-level navigation: switching rooms, the `?select=` jump, and copying an
 * object link (ADR-103).
 *
 * Kept out of App because it is URL and clipboard work, not board state, and App is
 * already at the size where one more concern would be the wrong place for it.
 */
export function useBoardNavigation({
  widgets,
  setSelectedIds,
  setCamera,
  notify,
  t,
}: {
  widgets: readonly Widget[];
  setSelectedIds: (ids: string[]) => void;
  setCamera: (update: (current: Camera) => Camera) => void;
  notify: (message: string) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  /**
   * Open a board from the read panel.
   *
   * The room is part of the URL, so switching boards is a navigation: the sync
   * provider reconnects to the other room and the document reloads from it. A widget
   * id focuses the object the search matched; `template` seeds a newly created board.
   */
  const openBoard = useCallback(
    (boardId: string, widgetId?: string, template?: string, name?: string) => {
      const params = new URLSearchParams(window.location.search);
      params.set("room", boardId);
      if (widgetId) params.set("select", widgetId);
      else params.delete("select");
      if (template) params.set("template", template);
      else params.delete("template");
      // A newly created board carries its name for the one seeding pass; the
      // document title is not yet writable before sync (ADR-100).
      if (name) params.set("name", name);
      else params.delete("name");
      window.location.search = params.toString();
    },
    [],
  );

  // A `?select=` jump selects the matched widget and frames it once, then leaves the
  // URL. Re-applying it on every document change would steal selection and camera from
  // the person for the rest of the session.
  const appliedSelect = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("select");
    if (!wanted || appliedSelect.current === wanted) return;
    const widget = widgets.find((candidate) => candidate.id === wanted);
    if (!widget) return;
    appliedSelect.current = wanted;
    setSelectedIds([widget.id]);
    setCamera((current) => ({ ...current, x: widget.x, y: widget.y }));
    params.delete("select");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [setCamera, setSelectedIds, widgets]);

  /**
   * Copy a link to one object.
   *
   * The internal link is the same URL the product already understands: room plus
   * `select`. It never carries an invitation or a link token, so copying it cannot
   * widen access (ADR-103).
   */
  const copyObjectLink = useCallback(
    async (widgetId: string) => {
      if (!widgetId) return;
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("room", currentRoom());
      url.searchParams.set("select", widgetId);
      const copied = await writeClipboard(url.toString());
      notify(copied ? t("link.copied") : t("link.copyFailed"));
    },
    [notify, t],
  );

  /**
   * Bring one object into view from a list that is not the board (ADR-117).
   *
   * A voting session keeps objects that are off screen; «Показать на доске» selects the
   * object and centres the camera, so the answer to "where is it?" is the object itself
   * rather than another description of it. Closing the panel belongs to the caller.
   */
  const revealWidget = useCallback(
    (widgetId: string) => {
      const widget = widgets.find((candidate) => candidate.id === widgetId);
      if (!widget) return;
      setSelectedIds([widget.id]);
      setCamera((current) => ({ ...current, x: widget.x, y: widget.y }));
    },
    [setCamera, setSelectedIds, widgets],
  );

  return { openBoard, copyObjectLink, revealWidget };
}
