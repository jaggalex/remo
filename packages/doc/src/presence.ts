import { useEffect, useMemo, useState } from "react";

/**
 * Ephemeral presence (ADR-016).
 *
 * Awareness state is never written to the document and never persisted, so a
 * cursor disappearing cannot leave a trace in the board history.
 */
export interface Presence {
  clientId: number;
  /** Stable key of this tab's session; follow targets it (ADR-151). */
  sessionKey: string;
  /** The signed-in account, or null for a guest. */
  accountId: string | null;
  /** The base display name: account name or guest name. */
  name: string;
  /** The account handle, or an empty string for a guest or an old client. */
  handle: string;
  /** The name shown to people; duplicates of one account get " (2)", " (3)". */
  label: string;
  /** When this session joined, used to order duplicate labels. */
  joinedAt: number;
  color: string;
  /** World coordinates of the pointer, or null when it is off-canvas. */
  cursor: { x: number; y: number } | null;
  /** True for the local session. */
  self: boolean;
  /**
   * The peer's viewport, while they are sharing it (ADR-076).
   *
   * Follow is attention, not board state: this lives in awareness and disappears with
   * the socket, so it can never leak into an export or a backup.
   */
  camera: { x: number; y: number; zoom: number } | null;
  /** The session this peer is following, by session key, or null. */
  followTo: string | null;
  /** When this peer asked their followers to stop: both sides can stop a follow. */
  stopFollowersAt: number | null;
  /** A "bring everyone to me" request; `from` is a session key, `name` its label. */
  invite: { from: string; name?: string; at: number } | null;
  /** The slide this peer is presenting (ADR-108, ADR-200), or null. */
  presenting: {
    frameId: string;
    index: number;
    startedAt: number;
    /** Present when the slide is one cell of a table section. */
    cell?: { rowId: string; columnId: string };
  } | null;
  /** The last live reaction, ephemeral and never persisted (ADR-104 amendment). */
  reaction: { emoji: string; at: number; x?: number; y?: number } | null;
}

export interface PresenceUser {
  name: string;
  handle?: string;
  color: string;
  /** Stable per-tab key. Absent on a client from before ADR-151. */
  sessionKey?: string;
  /** The signed-in account, or null for a guest. */
  accountId?: string | null;
  /** When the session joined, used to order duplicate labels. */
  joinedAt?: number;
}

/** Minimal structural type of `y-protocols` Awareness — enough for the UI. */
export interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  setLocalStateField(field: string, value: unknown): void;
  on(event: "change", handler: () => void): void;
  off(event: "change", handler: () => void): void;
}

/**
 * The six presence colours of the design system (`presence-1…6`, light theme).
 *
 * They live here because presence is part of the shared document, not of the local
 * stylesheet; the values match `tokens.json`, so a remote cursor and the DOM name
 * plates in @remo/ui are the same six colours (ADR-078).
 */
export const PRESENCE_COLORS = [
  "#c93e0a",
  "#8a35d6",
  "#1a6ad8",
  "#cc2470",
  "#2b7f17",
  "#9a5800",
];

export function colorFor(clientId: number): string {
  return PRESENCE_COLORS[clientId % PRESENCE_COLORS.length]!;
}

/**
 * Who is in the room, derived from awareness.
 *
 * One entry is one live session, never one name: a laptop and a desktop signed into the
 * same account are two cursors, two cameras and two follow targets (ADR-151). Sessions
 * of one account are grouped only for the label: the first keeps the account name, the
 * next become "Name (2)", "Name (3)".
 */
export function readPresence(
  awareness: AwarenessLike,
  selfSessionKey: string | null,
): Presence[] {
  const entries: Presence[] = [];

  for (const [clientId, state] of awareness.getStates()) {
    const user = state.user as PresenceUser | undefined;
    const name = user?.name ?? "Anonymous";
    const sessionKey = user?.sessionKey ?? `client:${clientId}`;
    entries.push({
      clientId,
      sessionKey,
      accountId: user?.accountId ?? null,
      name,
      handle: typeof user?.handle === "string" ? user.handle : "",
      label: name,
      joinedAt: typeof user?.joinedAt === "number" ? user.joinedAt : 0,
      color: user?.color ?? colorFor(clientId),
      cursor: (state.cursor as { x: number; y: number } | null) ?? null,
      self: selfSessionKey != null && sessionKey === selfSessionKey,
      camera:
        (state.camera as { x: number; y: number; zoom: number } | null | undefined) ?? null,
      followTo: typeof state.followTo === "string" ? state.followTo : null,
      stopFollowersAt:
        typeof state.stopFollowersAt === "number" ? state.stopFollowersAt : null,
      invite:
        state.invite && typeof (state.invite as { at?: unknown }).at === "number"
          ? (state.invite as { from: string; name?: string; at: number })
          : null,
      presenting: (() => {
        const raw = state.presenting as
          | { frameId?: unknown; index?: unknown; startedAt?: unknown; cell?: unknown }
          | null
          | undefined;
        if (!raw || typeof raw.frameId !== "string" || typeof raw.startedAt !== "number") {
          return null;
        }
        const cell =
          raw.cell &&
          typeof (raw.cell as { rowId?: unknown }).rowId === "string" &&
          typeof (raw.cell as { columnId?: unknown }).columnId === "string"
            ? {
                rowId: (raw.cell as { rowId: string }).rowId,
                columnId: (raw.cell as { columnId: string }).columnId,
              }
            : undefined;
        return {
          frameId: raw.frameId,
          index: typeof raw.index === "number" ? raw.index : 0,
          startedAt: raw.startedAt,
          ...(cell ? { cell } : {}),
        };
      })(),
      reaction:
        state.reaction &&
        typeof (state.reaction as { at?: unknown }).at === "number" &&
        typeof (state.reaction as { emoji?: unknown }).emoji === "string"
          ? (state.reaction as { emoji: string; at: number; x?: number; y?: number })
          : null,
    });
  }

  labelSessions(entries);
  return entries.sort(
    (a, b) => Number(b.self) - Number(a.self) || a.label.localeCompare(b.label),
  );
}

/**
 * Suffix only sessions whose account **and** base name collide. A `?user=` test tab
 * names itself differently and must keep that name; two real sessions of one account
 * share the account name and need the index.
 */
function labelSessions(entries: Presence[]): void {
  const byAccountAndName = new Map<string, Presence[]>();
  for (const entry of entries) {
    if (!entry.accountId) continue;
    const key = `${entry.accountId}\u0000${entry.name}`;
    const group = byAccountAndName.get(key) ?? [];
    group.push(entry);
    byAccountAndName.set(key, group);
  }
  for (const group of byAccountAndName.values()) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) => a.joinedAt - b.joinedAt || a.sessionKey.localeCompare(b.sessionKey),
    );
    group.forEach((entry, index) => {
      entry.label = index === 0 ? entry.name : `${entry.name} (${index + 1})`;
    });
  }
}

/** React binding for awareness; re-renders when anyone's presence changes. */
export function usePresence(
  awareness: AwarenessLike | null,
  selfSessionKey: string | null,
): Presence[] {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!awareness) return;
    const bump = () => setVersion((n) => n + 1);
    awareness.on("change", bump);
    return () => awareness.off("change", bump);
  }, [awareness]);

  return useMemo(() => {
    void version;
    return awareness ? readPresence(awareness, selfSessionKey) : [];
  }, [awareness, selfSessionKey, version]);
}
