import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { HelpLink } from "./help/HelpLink";
import type { HelpTopicId } from "./help/topics.generated";

export interface InfoState {
  /** Client coordinates of the click that asked for it. */
  x: number;
  y: number;
  title: string;
  rows: Array<{ label: string; value: string }>;
  /** A topic that explains the state the card is reporting, if any. */
  helpTopicId?: HelpTopicId;
  draftFrameId?: string;
}

/**
 * What the board knows about one object.
 *
 * The source product hides author and dates behind an Info item; so does this. The
 * card is placed with the same measurement-and-clamp as the context menu, because
 * the object you are curious about is often near an edge (ADR-045, ADR-046).
 */
export function InfoCard({ state, onClose, onOpenThread }: {
  state: InfoState | null;
  onClose: () => void;
  onOpenThread?: (frameId: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const [missingThread, setMissingThread] = useState<InfoState | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!state) {
      setPlacement(null);
      return;
    }
    const node = ref.current;
    if (!node) return;
    const margin = 8;
    const { width, height } = node.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    setPlacement({
      left: Math.min(Math.max(margin, state.x), maxLeft),
      top: Math.min(Math.max(margin, state.y), maxTop),
    });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose, state]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      className="info-card"
      role="dialog"
      aria-label={state.title}
      style={{
        left: placement?.left ?? state.x,
        top: placement?.top ?? state.y,
        visibility: placement ? undefined : "hidden",
      }}
    >
      <div className="info-card-head">
        <span>
          {state.title}
          {state.helpTopicId && (
            <>
              {" "}
              <HelpLink topicId={state.helpTopicId} />
            </>
          )}
        </span>
        <button type="button" onClick={onClose} title={t("info.close")} aria-label={t("info.close")}>
          ×
        </button>
      </div>
      <dl>
        {state.rows.map((row) => (
          <div key={row.label} className="info-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {state.draftFrameId && onOpenThread && (
        <button type="button" className="link-button" onClick={() => {
          void onOpenThread(state.draftFrameId!).then((opened) => {
            if (opened) onClose();
            else setMissingThread(state);
          });
        }}>
          {t("roomAgent.openThread")}
        </button>
      )}
      {missingThread === state && <p className="muted">{t("roomAgent.threadMissing")}</p>}
    </div>
  );
}
