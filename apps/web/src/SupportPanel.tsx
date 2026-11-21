import { IconButton } from "@remo/ui";
import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";
import type { SupportConfig, SupportIdentity } from "./apiSupport";

/**
 * The support widget in an isolated frame (ADR-250, `spec/support.md` §2.2).
 *
 * The operator's page never runs on the remo origin: it is a sandboxed iframe from one
 * configured origin, and the person's identity travels by `postMessage` with that exact
 * `targetOrigin`. Nothing here posts to `*`, so a page that replaced the widget cannot
 * receive the hash.
 *
 * `link` is not this component: the menu opens the operator's page in a new tab.
 */
export function SupportPanel({
  open,
  config,
  identity,
  failed,
  onClose,
}: {
  open: boolean;
  config: SupportConfig;
  identity: SupportIdentity | null;
  failed: boolean;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const origin = config.origin ?? "";

  const postIdentity = () => {
    if (!identity || !origin || !frame.current?.contentWindow) return;
    frame.current.contentWindow.postMessage(
      { type: "remo:support:identity", identity },
      origin,
    );
  };

  // The page may finish loading before the identity arrives, and the identity may arrive
  // before the page. Both paths post, and only to the configured origin.
  useEffect(() => {
    if (!open || !identity || !origin) return;
    frame.current?.contentWindow?.postMessage({ type: "remo:support:identity", identity }, origin);
  }, [identity, open, origin]);

  if (!open || config.provider !== "chatwoot" || !origin) return null;

  return (
    <aside className="support-panel" aria-label={t("support.title")}>
      <header className="support-panel-head">
        <div className="support-panel-titles">
          <strong>{t("support.title")}</strong>
          <span className="support-panel-hours">{config.hours[lang]}</span>
        </div>
        <IconButton icon="close" size="compact" label={t("support.close")} onClick={onClose} />
      </header>
      <div className="support-panel-body">
        <iframe
          ref={frame}
          className="support-panel-frame"
          title={t("support.frameTitle")}
          src={`${origin}/widget.html?lang=${lang}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          allow="clipboard-write"
          onLoad={postIdentity}
        />
        {!identity && (
          <p className="support-panel-status">
            {failed ? t("support.error") : t("support.loading")}
          </p>
        )}
      </div>
    </aside>
  );
}
