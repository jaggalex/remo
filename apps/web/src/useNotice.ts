import { useEffect, useState } from "react";

/**
 * A transient line under the canvas ("the connector limit is 32").
 *
 * The timer belongs to the message, not to App: every caller only shows a sentence, and
 * the message clears itself. Keeping it here is why App can stay a controller (ADR-093).
 */
export function useNotice(milliseconds = 4000) {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), milliseconds);
    return () => window.clearTimeout(timer);
  }, [notice, milliseconds]);

  return { notice, showNotice: setNotice };
}
