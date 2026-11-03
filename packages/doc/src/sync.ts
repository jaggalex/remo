import { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import type { BoardDocument } from "./board";
import {
  computeSaveState,
  decodeSaveAck,
  encodeSaveAck,
  OFFLINE_EDIT_LIMIT,
  SAVE_ACK_MESSAGE,
  type SaveState,
} from "./save-status";
import { COMMENTS_CHANGED_MESSAGE } from "./comment-signal";
import type { PresenceUser } from "./presence";
import { VOTES_CHANGED_MESSAGE } from "./vote-signal";

export type { SaveState } from "./save-status";
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface ConnectOptions {
  /** ws:// endpoint of the sync service. */
  url: string;
  /** Room name — one board per room. */
  room: string;
  user: PresenceUser;
  /** Cross-tab sync without a server round trip; harmless but noisy in tests. */
  disableBroadcast?: boolean;
  /**
   * Extra query parameters for the socket URL.
   *
   * The public-link token travels here: y-websocket appends them, and the sync service
   * decides the role from them during the upgrade (spec/IAM-v1.md §7).
   */
  params?: Record<string, string>;
  /**
   * The server closed the socket because access changed (4403) or the session ended
   * (4401). The app refreshes its access view instead of silently reconnecting into
   * the same denial.
   */
  onAccessChanged?: (code: number) => void;
}

export interface BoardConnection {
  provider: WebsocketProvider;
  awareness: Awareness;
  status(): ConnectionStatus;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  onSynced(listener: (synced: boolean) => void): () => void;
  saveState(): SaveState;
  onSaveState(listener: (state: SaveState) => void): () => void;
  /**
   * A nudge that the board's comments changed (ADR-104 amendment). Comments are server
   * rows, so the socket carries one empty frame instead of a document update.
   */
  onCommentsChanged(listener: () => void): () => void;
  /**
   * A nudge that the board's voting session changed (ADR-115). A vote is a server row,
   * so the socket carries one empty frame instead of a document update.
   */
  onVotesChanged(listener: () => void): () => void;
  setCursor(cursor: { x: number; y: number } | null): void;
  /** Announce a new name, colour or account without leaving the room (ADR-149/151). */
  setUser(user: PresenceUser): void;
  disconnect(): void;
}

/** WebSocket.OPEN, without relying on a DOM global in unit tests. */
const SOCKET_OPEN = 1;

/**
 * Join the board's room (ADR-016).
 *
 * The transport is the only thing this adds: the document already is the source of
 * truth, so a remote update simply arrives as another transaction and no merge
 * code exists anywhere in the app.
 *
 * Save state is separate from connection state (ADR-084): `saved` is set only after
 * the server acknowledges a persisted cumulative sequence, never after a local write.
 */
export function connectBoard(
  doc: BoardDocument,
  options: ConnectOptions,
): BoardConnection {
  const awareness = new Awareness(doc.doc);
  awareness.setLocalStateField("user", options.user);

  const provider = new WebsocketProvider(options.url, options.room, doc.doc, {
    awareness,
    disableBc: options.disableBroadcast ?? false,
    ...(options.params ? { params: options.params } : {}),
  });

  /**
   * Awareness entries age out after ~30 s of silence. The protocol library already
   * renews the local state every ~15 s, and the sync service renews the clock on
   * behalf of clients whose tab is hidden and therefore throttled — see
   * `apps/sync/server.mjs`. All this side has to do is re-announce itself when it
   * comes back to the foreground, so peers see the cursor without waiting.
   */
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      awareness.setLocalStateField("heartbeat", Date.now());
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }

  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const commentsListeners = new Set<() => void>();
  const votesListeners = new Set<() => void>();
  const syncListeners = new Set<(synced: boolean) => void>();
  const saveListeners = new Set<(state: SaveState) => void>();
  let current: ConnectionStatus = "connecting";

  /**
   * Cumulative local update numbers. One ack covers every update up to its sequence,
   * so `pending` is just the difference and a reconnect does not need a queue table.
   */
  let localSequence = 0;
  let acknowledgedSequence = 0;

  const publish = (status: ConnectionStatus) => {
    if (status === current) return;
    current = status;
    for (const listener of statusListeners) listener(status);
    publishSave();
  };

  const saveState = (): SaveState => {
    const pending = Math.max(0, localSequence - acknowledgedSequence);
    return computeSaveState({
      connection: current,
      synced: provider.synced,
      pending,
      blocked: pending >= OFFLINE_EDIT_LIMIT,
    });
  };

  const publishSave = () => {
    const state = saveState();
    for (const listener of saveListeners) listener(state);
  };

  const requestAck = () => {
    if (localSequence <= acknowledgedSequence) return;
    const socket = provider.ws;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(encodeSaveAck(localSequence));
  };

  /**
   * The client's sync step 1 asks the server for its state, but the server also sends
   * its own step 1 so the client answers with its offline updates. `synced` arrives
   * before that answer is processed; a few retries make the ack request land after the
   * update without trusting a single timer.
   */
  const ackTimers = new Set<number>();
  const scheduleAck = () => {
    for (const delay of [0, 250, 1000]) {
      const timer = window.setTimeout(() => {
        ackTimers.delete(timer);
        requestAck();
      }, delay);
      ackTimers.add(timer);
    }
  };

  provider.on("status", (event: { status: ConnectionStatus }) => {
    publish(event.status);
    if (event.status === "connected") scheduleAck();
  });
  provider.on("sync", (synced: boolean) => {
    for (const listener of syncListeners) listener(synced);
    publishSave();
    if (synced) scheduleAck();
  });
  provider.on("connection-close", (event: { code?: number }) => {
    publish("disconnected");
    if (event?.code === 4403 || event?.code === 4401) {
      options.onAccessChanged?.(event.code);
    }
  });

  /**
   * A local update is anything not applied by the provider. Remote updates and the
   * initial server state carry the provider as their origin, so they never inflate
   * the unsaved count.
   */
  const onLocalUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === provider) return;
    localSequence += 1;
    publishSave();
    if (current === "connected") requestAck();
  };
  doc.doc.on("update", onLocalUpdate);

  /**
   * y-websocket has no public hook for custom frame handlers. Its provider keeps the
   * handler table as an instance field; one extra type leaves the Yjs protocol
   * untouched and is ignored by older peers.
   */
  const internals = provider as unknown as {
    messageHandlers: Array<
      (encoder: unknown, decoder: { arr: Uint8Array; pos: number }) => void
    >;
  };
  internals.messageHandlers[COMMENTS_CHANGED_MESSAGE] = () => {
    for (const listener of commentsListeners) listener();
  };
  internals.messageHandlers[VOTES_CHANGED_MESSAGE] = () => {
    for (const listener of votesListeners) listener();
  };
  internals.messageHandlers[SAVE_ACK_MESSAGE] = (_encoder, decoder) => {
    const sequence = decodeSaveAck(decoder.arr.subarray(decoder.pos - 1));
    if (sequence === null) return;
    decoder.pos += 4;
    acknowledgedSequence = Math.max(
      acknowledgedSequence,
      Math.min(sequence, localSequence),
    );
    publishSave();
  };

  return {
    provider,
    awareness,
    status: () => current,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onSynced(listener) {
      syncListeners.add(listener);
      return () => syncListeners.delete(listener);
    },
    saveState,
    onSaveState(listener) {
      saveListeners.add(listener);
      return () => saveListeners.delete(listener);
    },
    onCommentsChanged(listener) {
      commentsListeners.add(listener);
      return () => commentsListeners.delete(listener);
    },
    onVotesChanged(listener) {
      votesListeners.add(listener);
      return () => votesListeners.delete(listener);
    },
    setCursor(cursor) {
      awareness.setLocalStateField("cursor", cursor);
    },
    setUser(user) {
      awareness.setLocalStateField("user", user);
    },
    disconnect() {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      for (const timer of ackTimers) window.clearTimeout(timer);
      ackTimers.clear();
      doc.doc.off("update", onLocalUpdate);
      provider.destroy();
      awareness.destroy();
    },
  };
}
