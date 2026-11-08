import { Avatar, Button, Input, Popover, Segmented } from "@remo/ui";
import { useEffect, useState } from "react";
import type { Presence } from "@remo/doc";
import { api, ApiError, type SessionUser } from "../api";
import { useI18n, type Lang } from "../i18n";
import { ABOUT_LABEL } from "../about";
import type { Theme } from "../useTheme";
import { useMenuFocus } from "../useMenuFocus";

/**
 * The account avatar and the interface menu behind it (ADR-119, Ш3/Ш5).
 *
 * The name appears once — on the avatar, with the full name in its tooltip — and the
 * menu answers "who am I here and how is my interface set up": role source, the name on
 * the cursor, theme, language, the organisation and the way out. A link visitor has no
 * account, so the same menu keeps theme and language and offers a sign-in instead.
 */
export function AccountMenu({
  open,
  onOpen,
  name,
  handle,
  self,
  color,
  signedIn,
  roleLine,
  identityName,
  onRenameSelf,
  onAccountRenamed,
  theme,
  onTheme,
  lang,
  onLang,
  orgName,
  onOrg,
  onSessions,
  onSignIn,
  onSignOut,
}: {
  open: boolean;
  onOpen: (value: boolean) => void;
  /** The display name for the tooltip and the face. */
  name: string;
  handle: string;
  /** This person in the presence list, when the room shows people at all. */
  self: Presence | undefined;
  /** The cursor colour: the face and the pointer of one person must match. */
  color: string;
  signedIn: boolean;
  roleLine: string | null;
  identityName: string;
  onRenameSelf: (value: string) => void;
  onAccountRenamed: (user: SessionUser) => void;
  theme: Theme;
  onTheme: (value: Theme) => void;
  lang: Lang;
  onLang: (value: Lang) => void;
  orgName: string | null;
  onOrg: () => void;
  onSessions: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const anchor = useMenuFocus(open, true, ".rm-popover input");
  const [nameDraft, setNameDraft] = useState(name);
  const [handleDraft, setHandleDraft] = useState(handle);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => setNameDraft(name), [name]);
  useEffect(() => setHandleDraft(handle), [handle]);

  const saveName = async () => {
    const next = nameDraft.trim();
    const nextHandle = handleDraft.trim().toLowerCase();
    if (!next || !nextHandle || savingName) return;
    if (next === name && nextHandle === handle) return;
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const result = await api.renameAccount({ name: next, handle: nextHandle });
      onAccountRenamed(result.user);
      setNameSaved(true);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setNameError(
        code === "HANDLE_TAKEN"
          ? t("account.handleTaken")
          : code === "BAD_HANDLE" || code === "HANDLE_TOO_SHORT" || code === "HANDLE_TOO_LONG" || code === "HANDLE_RESERVED"
            ? t("account.handleInvalid")
            : t("account.nameFailed"),
      );
    } finally {
      setSavingName(false);
    }
  };

  return (
    <span className="topbar-anchor topbar-account" ref={anchor}>
      <button
        type="button"
        className={signedIn ? "account-button peer self" : "account-button"}
        aria-label={signedIn ? `${t("account.menu")}: ${name}` : t("account.menu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={signedIn ? t("board.peerYou", { name }) : identityName}
        onClick={() => onOpen(!open)}
      >
        <Avatar
          name={signedIn ? name : identityName}
          background={self?.color ?? color}
          ring={signedIn}
        />
      </button>
      {open && (
        <Popover label={t("account.menu")} width={304} onClose={() => onOpen(false)}>
          {signedIn ? (
            <div className="account-who">
              <strong>{name}</strong>
              <span className="account-role">@{handle}</span>
              {roleLine && <span className="account-role">{roleLine}</span>}
            </div>
          ) : (
            <p className="account-role">{t("auth.loginHint")}</p>
          )}

          {signedIn && (
            <div className="account-field account-name-field">
              <Input
                label={t("account.name")}
                hint={t("account.nameHint")}
                value={nameDraft}
                maxLength={80}
                onChange={(event) => setNameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void saveName();
                }}
              />
              <Input
                label={t("account.handle")}
                hint={t("account.handleHint")}
                prefix="@"
                value={handleDraft}
                maxLength={32}
                onChange={(event) => setHandleDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void saveName();
                }}
              />
              <Button
                size="compact"
                variant="primary"
                loading={savingName}
                disabled={
                  !nameDraft.trim() ||
                  !handleDraft.trim() ||
                  (nameDraft.trim() === name && handleDraft.trim().toLowerCase() === handle)
                }
                onClick={() => void saveName()}
              >
                {t("account.save")}
              </Button>
              {nameError && <p className="auth-error">{nameError}</p>}
              {nameSaved && <p className="account-role">{t("account.nameSaved")}</p>}
            </div>
          )}

          {/* A signed-in cursor is named by the account; only a guest names this browser. */}
          {!signedIn && (
            <Input
              label={t("account.cursorName")}
              value={identityName}
              maxLength={80}
              onChange={(event) => onRenameSelf(event.currentTarget.value)}
            />
          )}

          <div className="account-field">
            <span className="account-field-label">{t("theme.label")}</span>
            <Segmented
              label={t("theme.label")}
              value={theme}
              onChange={(value) => onTheme(value as Theme)}
              options={[
                { value: "system", label: t("theme.system") },
                { value: "light", label: t("theme.light") },
                { value: "dark", label: t("theme.dark") },
              ]}
            />
          </div>

          <div className="account-field">
            <span className="account-field-label">{t("board.language")}</span>
            <Segmented
              label={t("board.language")}
              value={lang}
              onChange={(value) => onLang(value as Lang)}
              options={[
                { value: "ru", label: t("lang.ru") },
                { value: "en", label: t("lang.en") },
              ]}
            />
          </div>

          <span className="account-sep" role="separator" />
          {signedIn ? (
            <>
              <button
                type="button"
                className="rm-menu-item account-item"
                onClick={() => {
                  onOpen(false);
                  onSessions();
                }}
              >
                {t("account.sessions")}
              </button>
              <button
                type="button"
                className="rm-menu-item account-item"
                onClick={() => {
                  onOpen(false);
                  onOrg();
                }}
              >
                {orgName ? t("account.org") : t("org.title")}
              </button>
              <button
                type="button"
                className="rm-menu-item account-item"
                onClick={() => {
                  onOpen(false);
                  onSignOut();
                }}
              >
                {t("org.signOut")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rm-menu-item account-item"
              onClick={() => {
                onOpen(false);
                onSignIn();
              }}
            >
              {t("auth.login")}
            </button>
          )}

          <div className="account-about">
            <a
              href={`https://docs.remo.letii.ru/guide/${lang}/overview/index.html`}
              target="_blank"
              rel="noopener"
            >
              {t("account.docs")}
            </a>
            <span className="muted">{ABOUT_LABEL}</span>
          </div>
        </Popover>
      )}
    </span>
  );
}
