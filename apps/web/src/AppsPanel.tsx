import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, type AppActionMessage, type InstalledApp, type PanelNode } from "./api";
import { Button, Dialog } from "@remo/ui";
import { HelpLink } from "./help/HelpLink";
import { useI18n, type TranslationKey } from "./i18n";

/**
 * The board's apps panel (ADR-098).
 *
 * The panel draws a schema the server sent; it never evaluates anything. Every visible
 * string is an i18n key resolved here, so language, wording and escaping stay in the host,
 * and a manifest cannot inject a label or a placeholder that the design system has not
 * agreed to.
 */
export function AppsPanel({
  open,
  orgId,
  boardId,
  viewerName,
  onClose,
}: {
  open: boolean;
  orgId?: string;
  boardId: string;
  viewerName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setApps([]);
      return;
    }
    try {
      const result = await api.apps(orgId);
      setApps(result.apps);
      setError(null);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : t("apps.loadFailed"));
    }
  }, [orgId, t]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const vars = { username: viewerName };
  const key = (value: string) => value as TranslationKey;
  const message = (value: AppActionMessage) => t(key(value.key), value.params ?? vars);

  const invoke = async (app: InstalledApp, node: PanelNode) => {
    if (!orgId || !node.action) return;
    setBusy(node.action);
    try {
      const result = await api.invokeApp(orgId, app.appId, {
        boardId,
        action: node.action,
      });
      const answered = result.result.message;
      setMessages((current) => ({
        ...current,
        [app.appId]: answered ? message(answered) : "",
      }));
      setError(null);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : t("apps.actionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const draw = (app: InstalledApp, node: PanelNode): ReactNode => {
    if (node.type === "panel") {
      return (node.children ?? []).map((child) => draw(app, child));
    }
    if (node.type === "text" && node.key) {
      return (
        <p key={node.id ?? node.key} className="app-text">
          {t(key(node.key), vars)}
        </p>
      );
    }
    if (node.type === "button" && node.labelKey && node.action) {
      return (
        <Button
          key={node.id ?? node.labelKey}
          disabled={busy === node.action}
          onClick={() => void invoke(app, node)}>
          {t(key(node.labelKey))}
        </Button>
      );
    }
    // `field` and anything the host does not know draw nothing: the vocabulary is closed.
    return null;
  };

  return (
    <Dialog
      title={t("apps.title")}
      description={t("apps.body")}
      help={<HelpLink topicId="apps.hello" />}
      size="sm"
      onClose={onClose}
    >
      <section className="dialog-stack apps-dialog">

        {error ? <p className="export-status error">{error}</p> : null}

        {!orgId ? <p className="muted">{t("apps.noOrg")}</p> : null}

        {orgId && apps.length === 0 && !error ? (
          <p className="muted">{t("apps.empty")}</p>
        ) : null}

        {apps.map((app) => (
          <article key={app.appId} className="app-card" aria-label={app.appId}>
            <h3>{app.panel?.titleKey ? t(key(app.panel.titleKey)) : app.appId}</h3>
            {draw(app, app.panel ?? { type: "panel" })}
            {messages[app.appId] ? (
              <p className="app-answer" role="status">
                {messages[app.appId]}
              </p>
            ) : null}
          </article>
        ))}
      </section>
    </Dialog>
  );
}
