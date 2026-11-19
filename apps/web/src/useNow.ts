import { useEffect, useState } from "react";

/**
 * A ticking clock for things whose truth lives elsewhere (ADR-075).
 *
 * The timer's source of truth is `endsAt` in the document; this hook only makes React
 * repaint. It ticks while the value is running, once a second, and stops when the timer
 * is paused or finished so an idle board does not wake up for nothing.
 */
export function useNow(active: boolean, key = "", intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Re-read the clock whenever the thing being watched changes: a timer that arrives
    // already expired must not be measured against the moment before it existed.
    setNow(Date.now());
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, key, intervalMs]);
  return now;
}
