import {
  clampTimerMs,
  TIMER_DEFAULT_MS,
  type TimerState,
  type Widget,
} from "@remo/model";
import type { BoardDocument } from "./board";
import { LOCAL_ORIGIN } from "./origins";

/**
 * The shared session timer (ADR-075).
 *
 * One board object, not a per-client countdown: every command writes `endsAt` in UTC
 * and every client derives the remaining seconds from it. Starting, pausing, extending
 * and resetting are commands with one transaction each, so undo behaves like any other
 * single gesture.
 *
 * Authority is the role, not this module: the UI shows these controls to
 * `board.facilitate`, and a viewer cannot write to the room at all.
 */
export interface TimerActor {
  /** Display name recorded on the widget ("Set by Alex"). */
  by: string;
  byId?: string;
  /** Injectable clock for tests; production uses the wall clock. */
  now?: number;
}

export const TIMER_WIDTH = 240;
export const TIMER_HEIGHT = 128;

export function createTimer(
  board: BoardDocument,
  id: string,
  at: { x: number; y: number },
  actor: TimerActor,
): void {
  const widget: Widget = {
    id,
    type: "timer",
    parentId: null,
    x: at.x,
    y: at.y,
    width: TIMER_WIDTH,
    height: TIMER_HEIGHT,
    timer: {
      durationMs: TIMER_DEFAULT_MS,
      endsAt: null,
      remainingMs: null,
      state: "idle",
      setBy: actor.by,
      setById: actor.byId,
    },
  };
  board.transact(() => {
    board.widgets.set(id, {
      ...widget,
      ...(board.author && !widget.createdBy ? { createdBy: board.author } : {}),
      createdAt: Date.now(),
    });
  }, LOCAL_ORIGIN);
}

function update(board: BoardDocument, id: string, timer: TimerState): void {
  board.transact(() => {
    const current = board.widgets.get(id);
    if (!current || current.type !== "timer") return;
    board.widgets.set(id, { ...current, timer });
  }, LOCAL_ORIGIN);
}

function currentTimer(board: BoardDocument, id: string): { widget: Widget; timer: TimerState } | null {
  const widget = board.widgets.get(id);
  if (!widget || widget.type !== "timer") return null;
  return {
    widget,
    timer:
      widget.timer ?? {
        durationMs: TIMER_DEFAULT_MS,
        endsAt: null,
        remainingMs: null,
        state: "idle",
        setBy: "",
      },
  };
}

/** Start from the beginning with a chosen length (or continue from a paused value). */
export function startTimer(
  board: BoardDocument,
  id: string,
  minutes: number,
  actor: TimerActor,
): void {
  const found = currentTimer(board, id);
  if (!found) return;
  const now = actor.now ?? Date.now();
  const durationMs = clampTimerMs(minutes * 60_000);
  update(board, id, {
    ...found.timer,
    durationMs,
    endsAt: new Date(now + durationMs).toISOString(),
    remainingMs: null,
    state: "running",
    setBy: actor.by,
    setById: actor.byId,
  });
}

/** Pause keeps the exact milliseconds that were left; resuming continues from them. */
export function pauseTimer(board: BoardDocument, id: string, actor: TimerActor): void {
  const found = currentTimer(board, id);
  if (!found || found.timer.state !== "running" || !found.timer.endsAt) return;
  const now = actor.now ?? Date.now();
  const remainingMs = Math.max(0, new Date(found.timer.endsAt).getTime() - now);
  update(board, id, {
    ...found.timer,
    endsAt: null,
    remainingMs,
    state: "paused",
    setBy: actor.by,
    setById: actor.byId,
  });
}

export function resumeTimer(board: BoardDocument, id: string, actor: TimerActor): void {
  const found = currentTimer(board, id);
  if (!found || found.timer.state !== "paused") return;
  const now = actor.now ?? Date.now();
  const remainingMs = Math.max(0, found.timer.remainingMs ?? found.timer.durationMs);
  update(board, id, {
    ...found.timer,
    endsAt: new Date(now + remainingMs).toISOString(),
    remainingMs: null,
    state: "running",
    setBy: actor.by,
    setById: actor.byId,
  });
}

/**
 * `+1 min`, also after the time is up.
 *
 * While running it moves the end; while paused it adds to the remaining value; after
 * expiry it starts again from now, because adding time to a finished countdown would
 * otherwise leave it finished.
 */
export function extendTimer(
  board: BoardDocument,
  id: string,
  minutes: number,
  actor: TimerActor,
): void {
  const found = currentTimer(board, id);
  if (!found) return;
  const now = actor.now ?? Date.now();
  const addMs = clampTimerMs(minutes * 60_000);
  const timer = found.timer;
  const expired =
    timer.state === "running" &&
    !!timer.endsAt &&
    new Date(timer.endsAt).getTime() <= now;

  if (timer.state === "paused") {
    update(board, id, {
      ...timer,
      durationMs: timer.durationMs + addMs,
      remainingMs: Math.max(0, timer.remainingMs ?? 0) + addMs,
      setBy: actor.by,
      setById: actor.byId,
    });
    return;
  }
  if (timer.state === "running" && timer.endsAt && !expired) {
    update(board, id, {
      ...timer,
      durationMs: timer.durationMs + addMs,
      endsAt: new Date(new Date(timer.endsAt).getTime() + addMs).toISOString(),
      setBy: actor.by,
      setById: actor.byId,
    });
    return;
  }
  // Idle or finished: start a fresh countdown of the added length.
  update(board, id, {
    ...timer,
    durationMs: addMs,
    endsAt: new Date(now + addMs).toISOString(),
    remainingMs: null,
    state: "running",
    setBy: actor.by,
    setById: actor.byId,
  });
}

/** Back to idle, keeping the chosen length for the next start. */
export function resetTimer(board: BoardDocument, id: string, actor: TimerActor): void {
  const found = currentTimer(board, id);
  if (!found) return;
  update(board, id, {
    ...found.timer,
    endsAt: null,
    remainingMs: null,
    state: "idle",
    setBy: actor.by,
    setById: actor.byId,
  });
}
