import type { TemplateKey } from "@remo/model";
import { Button, Menu, Popover, type MenuItem } from "@remo/ui";
import { useI18n } from "../i18n";
import { useMenuFocus } from "../useMenuFocus";

/**
 * "More ▾" — everything that has no icon of its own yet (ADR-119, Ш2).
 *
 * Templates, an AI task, apps and Story live here until the "/" line gathers them
 * (ADR-121, stage S4); then this menu disappears. Centre of the top bar stays empty.
 */
export function MoreMenu({
  view,
  onView,
  templates,
  canAskAgents,
  canUseApps,
  writeBlocked,
  onTemplate,
  onAi,
  onApps,
}: {
  /** `more` is the menu, `templates` the picker it opens; null closes both. */
  view: "more" | "templates" | null;
  onView: (value: "more" | "templates" | null) => void;
  templates: ReadonlyArray<{ key: TemplateKey; label: string }>;
  canAskAgents: boolean;
  canUseApps: boolean;
  writeBlocked: boolean;
  onTemplate: (key: TemplateKey) => void;
  onAi: () => void;
  onApps: () => void;
}) {
  const { t } = useI18n();
  const anchor = useMenuFocus(
    view,
    view,
    view === "templates" ? ".rm-popover button" : '[role^="menuitem"]',
  );

  const items: MenuItem[] = [
    {
      label: t("more.templates"),
      icon: "template",
      disabled: templates.length === 0,
      onSelect: () => onView("templates"),
    },
  ];
  if (canAskAgents) {
    items.push({ label: t("more.ai"), icon: "sparkle", onSelect: onAi });
  }
  if (canUseApps) {
    items.push({ label: t("board.apps"), icon: "apps", onSelect: onApps });
  }
  // The mockup keeps the slot honest: Story is planned, and a dead control would lie.
  items.push({ label: t("more.story"), hint: t("more.storyHint"), disabled: true });

  return (
    <span className="topbar-anchor" ref={anchor}>
      <Button
        variant="ghost"
        iconEnd="chevron-down"
        className="more-trigger"
        aria-haspopup={view === "templates" ? "dialog" : "menu"}
        aria-expanded={view !== null}
        onClick={() => onView(view === "more" ? null : "more")}
      >
        {t("more.menu")}
      </Button>
      {view === "more" && (
        <Menu label={t("more.menu")} width={248} onClose={() => onView(null)} items={items} />
      )}
      {view === "templates" && (
        <Popover title={t("board.templates")} width={320} onClose={() => onView(null)}>
          <p className="muted topbar-hint">
            {writeBlocked ? t("iam.readOnly") : t("more.templatesHint")}
          </p>
          <div className="topbar-template-list">
            {templates.map((template) => (
              <Button
                key={template.key}
                variant="secondary"
                size="default"
                className="topbar-template"
                disabled={writeBlocked}
                onClick={() => {
                  onTemplate(template.key);
                  onView(null);
                }}
              >
                {template.label}
              </Button>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}
