import { useCallback, useState } from "react";
import type { Widget } from "@remo/model";
import { type InfoState } from "./InfoCard";
import { infoRows } from "./infoRows";
import type { TranslationKey } from "./i18n";

/**
 * The Info card's state, kept out of `App` (ADR-093).
 *
 * The card is a read-out: it opens at a point with a snapshot of one object. A locked
 * object also carries the help topic that explains who may release it (ADR-107), so the
 * card is assembled in one place instead of in the app's JSX.
 */
export function useInfoCard(
  typeName: (type: string) => string,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
) {
  const [info, setInfo] = useState<InfoState | null>(null);

  const openInfo = useCallback(
    (widget: Widget, x: number, y: number) => {
      setInfo({
        x,
        y,
        title: typeName(widget.type),
        rows: infoRows(widget, t),
        draftFrameId: widget.type === "frame" && widget.agent?.skill === "room-draft"
          ? widget.id : undefined,
        helpTopicId: widget.locked ? "objects.lock" : undefined,
      });
    },
    [t, typeName],
  );

  const closeInfo = useCallback(() => setInfo(null), []);

  return { info, openInfo, closeInfo };
}
