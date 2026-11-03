import { useEffect, useRef } from "react";
import { api, type SessionUser } from "./api";
import type { Lang } from "./i18n";
import type { Theme } from "./useTheme";

type AccountPreferences = NonNullable<SessionUser["preferences"]>;

const THEMES = new Set<Theme>(["system", "light", "dark"]);
const LANGS = new Set<Lang>(["ru", "en"]);

function serverTheme(preferences: AccountPreferences | undefined): Theme | null {
  const value = preferences?.theme;
  return value && THEMES.has(value) ? value : null;
}

function serverLang(preferences: AccountPreferences | undefined): Lang | null {
  const value = preferences?.lang;
  return value && LANGS.has(value) ? value : null;
}

/**
 * Theme and language follow the account (ADR-150).
 *
 * Before sign-in the local choice applies; when the account has values they win, and
 * when it has none the browser's current choice seeds the account. A change made while
 * signed in is written back once. The browser copy stays, so sign-out and a reload
 * without a session still read a sensible value.
 */
export function useAccountPreferences({
  me,
  theme,
  setTheme,
  lang,
  setLang,
}: {
  me: SessionUser | null;
  theme: Theme;
  setTheme: (value: Theme) => void;
  lang: Lang;
  setLang: (value: Lang) => void;
}) {
  /** What this account is known to hold, and whether the local state has caught up. */
  const known = useRef<{ id: string; theme: Theme; lang: Lang; ready: boolean } | null>(null);
  const local = useRef({ theme, lang });
  local.current = { theme, lang };

  useEffect(() => {
    if (!me) {
      known.current = null;
      return;
    }
    const storedTheme = serverTheme(me.preferences);
    const storedLang = serverLang(me.preferences);
    const nextTheme = storedTheme ?? local.current.theme;
    const nextLang = storedLang ?? local.current.lang;
    known.current = { id: me.id, theme: nextTheme, lang: nextLang, ready: false };

    if (nextTheme !== local.current.theme) setTheme(nextTheme);
    if (nextLang !== local.current.lang) setLang(nextLang);

    // An account created before this feature has no values. Its first signed-in browser
    // hands over the choice it already shows instead of resetting the person to defaults.
    if (storedTheme === null || storedLang === null) {
      void api.updatePreferences({ theme: nextTheme, lang: nextLang }).catch(() => {
        /* the local choice still applies; a later change writes again */
      });
    }
    // `me.id` is the sign-in boundary: a fresh `me` object for the same account must not
    // re-apply stored values over a change the person just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  useEffect(() => {
    const current = known.current;
    if (!me || !current || current.id !== me.id) return;
    // Wait until the local state equals what the sign-in effect applied or seeded, so
    // the old value is never written back over the account's value.
    if (!current.ready) {
      if (current.theme === theme && current.lang === lang) current.ready = true;
      return;
    }
    if (current.theme === theme && current.lang === lang) return;
    current.theme = theme;
    current.lang = lang;
    void api.updatePreferences({ theme, lang }).catch(() => {
      /* keep the local choice; the next change retries the write */
    });
  }, [me, theme, lang]);
}
