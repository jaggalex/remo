import { useCallback, useMemo } from "react";
import type { BoardDocument } from "@remo/doc";
import {
  createTimer,
  extendTimer,
  pauseTimer,
  resetTimer,
  resumeTimer,
  startTimer,
} from "@remo/doc";
import {
  newId,
  timerPhase,
  timerRemainingMs,
  type Widget,
} from "@remo/model";
import type { Camera } from "@remo/canvas";
import type { Identity } from "./identity";
import type { SessionUser } from "./api";
import { useNow } from "./useNow";

/**
 * The shared timer (ADR-075).
 *
 * One board object; the remaining time is derived from `endsAt`, and the tick only runs
 * while it counts down. The hook owns the commands and the derived state, App owns the
 * panel's open flag.
 */
export function useSharedTimer({
  board,
  widgets,
  camera,
  identity,
  me,
  setSelectedIds,
  closePanel,
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  identity: Identity;
  me: SessionUser | null;
  setSelectedIds: (ids: string[]) => void;
  /** Choosing a length closes the panel; the countdown is visible on the board. */
  closePanel: () => void;
}) {
  const timerWidget = useMemo(
    () => widgets.find((widget) => widget.type === "timer" && widget.timer),
    [widgets],
  );
  const timerTick = useNow(
    timerPhase(timerWidget?.timer) === "running",
    timerWidget?.timer?.endsAt ?? timerWidget?.timer?.state ?? "",
  );
  const timerNow = timerPhase(timerWidget?.timer) === "running" ? timerTick : Date.now();
  const currentTimerPhase = timerPhase(timerWidget?.timer, timerNow);
  const timerLeft = timerRemainingMs(timerWidget?.timer, timerNow);
  const timerSetBy = timerWidget?.timer?.setBy ?? "";
  const timerActor = useMemo(
    () => ({ by: identity.name || me?.name || "Guest", byId: me?.id }),
    [identity.name, me?.name, me?.id],
  );

  const startSharedTimer = useCallback(
    (minutes: number) => {
      if (timerWidget) {
        startTimer(board, timerWidget.id, minutes, timerActor);
        setSelectedIds([timerWidget.id]);
      } else {
        // The timer starts where the person is looking, not at the board origin.
        const id = newId("timer");
        createTimer(board, id, { x: camera.x, y: camera.y }, timerActor);
        startTimer(board, id, minutes, timerActor);
        setSelectedIds([id]);
      }
      closePanel();
    },
    [board, camera.x, camera.y, timerActor, timerWidget, setSelectedIds, closePanel],
  );

  const timerCommand = useCallback(
    (run: (id: string) => void) => {
      if (!timerWidget) return;
      run(timerWidget.id);
    },
    [timerWidget],
  );

  return {
    timerWidget,
    currentTimerPhase,
    timerLeft,
    timerSetBy,
    timerActor,
    startSharedTimer,
    timerCommand,
    pause: () => timerCommand((id) => pauseTimer(board, id, timerActor)),
    resume: () => timerCommand((id) => resumeTimer(board, id, timerActor)),
    extend: () => timerCommand((id) => extendTimer(board, id, 1, timerActor)),
    reset: () => timerCommand((id) => resetTimer(board, id, timerActor)),
  };
}
