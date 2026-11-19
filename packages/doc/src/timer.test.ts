import { describe, expect, it } from "vitest";
import { timerPhase, timerRemainingMs } from "@remo/model";
import { BoardDocument } from "./board";
import {
  createTimer,
  extendTimer,
  pauseTimer,
  resetTimer,
  resumeTimer,
  startTimer,
} from "./timer";

function setup() {
  const board = new BoardDocument();
  board.author = "Alex";
  createTimer(board, "t1", { x: 0, y: 0 }, { by: "Alex", byId: "u1" });
  return board;
}

const at = (ms: number) => ({ by: "Alex", byId: "u1", now: ms });

describe("timer commands (ADR-075)", () => {
  it("creates one idle timer object with its author", () => {
    const board = setup();
    const widget = board.widgets.get("t1")!;
    expect(widget.type).toBe("timer");
    expect(widget.createdBy).toBe("Alex");
    expect(widget.timer).toMatchObject({ state: "idle", setBy: "Alex" });
    expect(timerPhase(widget.timer)).toBe("idle");
  });

  it("starts from a chosen number of minutes", () => {
    const board = setup();
    startTimer(board, "t1", 5, at(1_000));
    const timer = board.widgets.get("t1")!.timer!;
    expect(timer.state).toBe("running");
    expect(timer.endsAt).toBe(new Date(301_000).toISOString());
    expect(timerRemainingMs(timer, 61_000)).toBe(240_000);
  });

  it("pauses with the exact milliseconds left and resumes from them", () => {
    const board = setup();
    startTimer(board, "t1", 1, at(0));
    pauseTimer(board, "t1", at(20_000));
    const paused = board.widgets.get("t1")!.timer!;
    expect(paused).toMatchObject({ state: "paused", remainingMs: 40_000, endsAt: null });

    resumeTimer(board, "t1", at(100_000));
    const resumed = board.widgets.get("t1")!.timer!;
    expect(resumed.state).toBe("running");
    expect(resumed.endsAt).toBe(new Date(140_000).toISOString());
  });

  it("extends a running timer, a paused timer and a finished one differently", () => {
    const board = setup();
    startTimer(board, "t1", 1, at(0));
    extendTimer(board, "t1", 1, at(10_000));
    expect(timerRemainingMs(board.widgets.get("t1")!.timer!, 10_000)).toBe(110_000);

    pauseTimer(board, "t1", at(20_000));
    // 100 s were left when paused; a paused extension adds to that value.
    expect(board.widgets.get("t1")!.timer!.remainingMs).toBe(100_000);
    extendTimer(board, "t1", 1, at(20_000));
    expect(board.widgets.get("t1")!.timer!.remainingMs).toBe(160_000);

    resumeTimer(board, "t1", at(30_000));
    expect(timerRemainingMs(board.widgets.get("t1")!.timer!, 30_000)).toBe(160_000);

    // Past the new end: extending a finished countdown starts a fresh one.
    extendTimer(board, "t1", 2, at(300_000));
    const restarted = board.widgets.get("t1")!.timer!;
    expect(restarted.state).toBe("running");
    expect(timerRemainingMs(restarted, 300_000)).toBe(120_000);
  });

  it("resets to idle but keeps the chosen length", () => {
    const board = setup();
    startTimer(board, "t1", 10, at(0));
    resetTimer(board, "t1", at(5_000));
    const timer = board.widgets.get("t1")!.timer!;
    expect(timer).toMatchObject({
      state: "idle",
      endsAt: null,
      remainingMs: null,
      durationMs: 600_000,
    });
  });

  it("ignores commands addressed to a widget that is not a timer", () => {
    const board = setup();
    board.widgets.set("note", {
      id: "note",
      type: "sticky_note",
      parentId: null,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    startTimer(board, "note", 5, at(0));
    expect(board.widgets.get("note")!.timer).toBeUndefined();
  });
});
