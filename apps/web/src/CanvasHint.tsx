import { useEffect, useState } from "react";
import { useI18n } from "./i18n";

/** One browser remembers that the hint has been shown (settings are local, ADR-123). */
const HINT_KEY = "remo.canvas.hint";

/**
 * The first-use hint: one plate at the bottom centre, said once.
 *
 * It used to be a permanent caption above the board and grew a second plate on top of
 * the voting line, with the sentence cut by an ellipsis. Now it wraps, disappears on the
 * first real gesture on the canvas or after six seconds, and does not come back — while
 * a voting line is shown it is not rendered at all, because the line is the only thing
 * that belongs in that slot (ADR-119.4, Н1).
 */
export function CanvasHint({ allowed }: { allowed: boolean }) {
  const { t } = useI18n();
  const [seen, setSeen] = useState(() => {
    try {
      return window.localStorage.getItem(HINT_KEY) === "seen";
    } catch {
      // Without storage the hint would come back after every reload: show it once per visit.
      return false;
    }
  });

  // Not shown is not seen: in an empty room the hint waits for something to talk about.
  useEffect(() => {
    if (seen || !allowed) return;
    const timer = window.setTimeout(() => setSeen(true), 6000);
    return () => window.clearTimeout(timer);
  }, [allowed, seen]);

  useEffect(() => {
    if (seen) {
      try {
        window.localStorage.setItem(HINT_KEY, "seen");
      } catch {
        // Nothing to do: the next visit shows the hint again, which is harmless.
      }
      return;
    }
    if (!allowed) return;
    // A gesture on the canvas is what the hint talks about: one is enough.
    const onDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest("canvas")) setSeen(true);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [allowed, seen]);

  if (!allowed || seen) return null;
  return (
    <div className="canvas-hint" role="status">
      {t("canvas.hint")}
    </div>
  );
}
