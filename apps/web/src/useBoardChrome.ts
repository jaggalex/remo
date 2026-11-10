import { useCallback, useMemo, useRef, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import { currentRoom } from "./identity";
import type { TranslationKey } from "./i18n";

/**
 * The topbar's own ephemeral state: the rename draft, the "copied" flash, the share
 * link and the inspector switch.
 *
 * None of it belongs in the document. Keeping it here means App composes the board and
 * the chrome does not have to grow App's state list.
 */
export function useBoardChrome({
  board,
  t,
}: {
  board: BoardDocument;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  /** Escape cancels the rename; the flag survives until the blur that follows. */
  const titleCancelled = useRef(false);
  const [copied, setCopied] = useState(false);

  const renameBoard = useCallback(
    (value: string) => {
      board.setTitle(value.trim());
      setTitleDraft(null);
    },
    [board],
  );

  /** The room is in the URL, so the link *is* the invitation. */
  const shareLink = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("room", currentRoom());
    params.delete("select");
    // The link invites a person, not a name or a language: the recipient brings
    // their own (identity.ts, ADR-021). Carrying `?user=Alice` would make Bob
    // appear as Alice until he noticed the name field.
    params.delete("user");
    params.delete("lang");
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }, []);

  const [shareFallback, setShareFallback] = useState<string | null>(null);

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; a field with the link is the fallback (ADR-118).
      setShareFallback(shareLink);
      setCopied(false);
    }
  }, [shareLink]);

  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try {
      // ADR-197: a person with no stored choice starts with the inspector closed.
      return window.localStorage.getItem("remo.inspector") === "open";
    } catch {
      return false;
    }
  });

  const openInspector = useCallback(() => {
    setInspectorOpen(true);
    try {
      window.localStorage.setItem("remo.inspector", "open");
    } catch {
      // The panel is already open for this visit; persistence is a convenience.
    }
  }, []);

  const toggleInspector = useCallback(() => {
    setInspectorOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem("remo.inspector", next ? "open" : "closed");
      } catch {
        // A private window may refuse storage; the panel still toggles for this visit.
      }
      return next;
    });
  }, []);

  return {
    titleDraft,
    setTitleDraft,
    titleCancelled,
    renameBoard,
    copied,
    copyShareLink,
    shareFallback,
    closeShareFallback: () => setShareFallback(null),
    inspectorOpen,
    openInspector,
    toggleInspector,
  };
}
