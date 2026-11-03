import { useId } from "react";
import { useUiStrings, type UiKey } from "../i18n";
import { Button, Icon } from "./basics";
import { Avatar } from "./display";
import { Switch } from "./fields";
import { Banner } from "./overlays";
import { cx } from "./util";

/** The product’s board roles (IAM-v1). `owner` is never assigned from a row: it is shown, locked. */
export type Role = "owner" | "coowner" | "editor" | "commenter" | "viewer";
const ROLES: Role[] = ["coowner", "editor", "commenter", "viewer"];
const roleKey = (r: string) => `role.${r}` as UiKey;

export interface AccessRowProps {
  name: string;
  /** Where the role comes from, in words (П7): “Through team PM”, “Granted by Alex”. */
  source: string;
  role: Role;
  roles?: Role[];
  onRoleChange?: (role: Role | "none") => void;
  you?: boolean;
  agent?: boolean;
  /** The role cannot be changed here (inherited, or the owner): shown as text. */
  locked?: boolean;
  removable?: boolean;
  revoked?: boolean;
  disabled?: boolean;
}

/** A subject in Share: who + role + source + action (паттерн 1). */
export function AccessRow({ name, source, role, roles = ROLES, onRoleChange, you, agent, locked, removable, revoked, disabled }: AccessRowProps) {
  const { t } = useUiStrings();
  const id = useId();
  return (
    <div className={cx("rm-access", revoked && "is-revoked")}>
      <Avatar name={name} agent={agent} />
      <div className="rm-access-main">
        <div className="rm-access-name"><span className="rm-ellipsis" title={name}>{name}</span>{you && <span className="rm-access-you">{t("you")}</span>}</div>
        <div className="rm-access-source" id={id}>{source}</div>
      </div>
      {locked ? (
        <span className="rm-access-role is-static">{t(roleKey(role))}</span>
      ) : (
        <div className="rm-input rm-select rm-compact rm-access-select">
          <select aria-label={t("role", { name })} aria-describedby={id} value={role} disabled={disabled}
            onChange={(e) => onRoleChange?.(e.target.value as Role | "none")}>
            {[...roles, ...(removable ? (["none"] as const) : [])].map((r) => <option key={r} value={r}>{t(roleKey(r))}</option>)}
          </select>
          <Icon name="chevron-down" />
        </div>
      )}
    </div>
  );
}

export interface PublicLinkProps { enabled: boolean; role?: "viewer" | "commenter" | "editor"; password?: boolean; expires?: string; url?: string; onToggle?: (enabled: boolean) => void; onCopy?: () => void }

/** “Public link” block: state in words, the consequence as a warning, copy. */
export function PublicLink({ enabled, role = "viewer", password, expires, url, onToggle, onCopy }: PublicLinkProps) {
  const { t } = useUiStrings();
  const state = enabled
    ? [t("linkOn"), t(roleKey(role)).toLowerCase(), password ? t("linkPassword") : t("linkNoPassword"), ...(expires ? [t("linkUntil", { date: expires })] : [])].join(" · ")
    : t("linkOff");
  return (
    <section className="rm-publink">
      <div className="rm-publink-head">
        <span className="rm-publink-icon"><Icon name="link" /></span>
        <div className="rm-publink-main">
          <div className="rm-publink-title">{t("publicLink")}</div>
          <div className="rm-publink-state">{state}</div>
        </div>
        <Switch checked={enabled} onChange={(e) => onToggle?.(e.target.checked)} aria-label={t("publicLink")} />
      </div>
      {enabled && !password && <Banner tone="warning" title={t("linkWarnTitle")}>{t("linkWarn")}</Banner>}
      {enabled && (
        <div className="rm-publink-copy">
          <div className="rm-input rm-compact is-readonly" style={{ flex: 1 }}><input readOnly value={url ?? ""} aria-label={t("link")} /></div>
          <Button variant="secondary" size="compact" icon="copy" onClick={onCopy}>{t("copy")}</Button>
        </div>
      )}
    </section>
  );
}
