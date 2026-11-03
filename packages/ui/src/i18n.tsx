import { createContext, useContext, type ReactNode } from "react";

/**
 * The strings @remo/ui components show by themselves (close buttons, sync status,
 * role names…). The package owns only the *keys*; the words live in the product's
 * `apps/web/src/i18n.tsx` under `ds.*`, so there is one translation mechanism
 * (AGENTS.md §2.1, §2.4). The app passes an adapter to <UiStringsProvider>.
 */
export type UiKey =
  | "close" | "closeToast" | "hide" | "cancel" | "delete" | "deleteCount" | "actions" | "remove"
  | "saved" | "saving" | "offline" | "offlineShort" | "readOnly"
  | "share" | "tools" | "selectionActions" | "moreActions" | "onBoard"
  | "you" | "role" | "role.owner" | "role.coowner" | "role.editor" | "role.commenter" | "role.viewer" | "role.none"
  | "publicLink" | "linkOn" | "linkPassword" | "linkNoPassword" | "linkUntil" | "linkOff" | "linkWarnTitle" | "linkWarn" | "link" | "copy"
  | "journal" | "journal.time" | "journal.action" | "journal.tokens" | "journal.cost" | "journal.status"
  | "journal.done" | "journal.pending" | "journal.failed" | "journal.rejected"
  | "sticker" | "stickerBy" | "locked" | "longText" | "someone" | "isTyping" | "typing" | "followsYou"
  | "selectedCount" | "lockedBy" | "lockedPlain" | "shape" | "port"
  | "port.tl" | "port.t" | "port.tr" | "port.r" | "port.br" | "port.b" | "port.bl" | "port.l"
  | "connector" | "frame" | "clipped" | "following" | "stop" | "comment" | "commentResolved" | "commentFrom"
  | "zoom" | "zoomOut" | "zoomIn" | "zoomFit" | "zoomValue"
  | "timer" | "timerStart" | "timerPause" | "timerAdd" | "timerDone" | "timerPaused"
  | "vote" | "votesLeft" | "voteEnd" | "voteEnded" | "voteNone" | "minimap" | "viewport";

/** Nouns counted with a number: the app supplies the plural forms. */
export type UiCountKey = "object" | "member" | "vote" | "reply";

export interface UiStrings {
  t: (key: UiKey, vars?: Record<string, string | number>) => string;
  count: (key: UiCountKey, n: number) => string;
  /** BCP 47 tag for Intl formatting of numbers and money. */
  locale: string;
}

const UiStringsContext = createContext<UiStrings | null>(null);

export function UiStringsProvider({ value, children }: { value: UiStrings; children: ReactNode }) {
  return <UiStringsContext.Provider value={value}>{children}</UiStringsContext.Provider>;
}

export function useUiStrings(): UiStrings {
  const value = useContext(UiStringsContext);
  if (!value) throw new Error("@remo/ui components must be rendered inside <UiStringsProvider>");
  return value;
}
