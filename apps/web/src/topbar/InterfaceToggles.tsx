import { Button, IconButton, Tooltip } from "@remo/ui";
import { useI18n } from "../i18n";
import type { Theme } from "../useTheme";

/**
 * The two interface controls at the right edge of every header (ADR-194).
 *
 * Theme and language are one click from any screen and never move: home puts them after
 * the account, a room after Share. The account menu no longer carries them. The theme
 * icon shows the current state; the accessible name says what the next click will do.
 * Their tips align to the right edge, so the sentence is not cut by the window.
 */
export function InterfaceToggles({
  theme,
  onTheme,
}: {
  theme: Theme;
  onTheme: (value: Theme) => void;
}) {
  const { t, lang, setLang } = useI18n();
  const nextTheme: Theme = theme === "light" ? "dark" : "light";
  const themeLabel = t(theme === "light" ? "theme.lightAction" : "theme.darkAction");
  const langLabel = t(lang === "ru" ? "lang.switchToEn" : "lang.switchToRu");

  return (
    <>
      <Tooltip label={themeLabel} align="end">
        <IconButton
          icon={theme === "light" ? "sun" : "moon"}
          label={themeLabel}
          size="compact"
          variant="ghost"
          onClick={() => onTheme(nextTheme)}
        />
      </Tooltip>
      <Tooltip label={langLabel} align="end">
        <Button
          variant="ghost"
          size="compact"
          className="header-lang"
          aria-label={langLabel}
          onClick={() => setLang(lang === "ru" ? "en" : "ru")}
        >
          {lang === "ru" ? "RU" : "EN"}
        </Button>
      </Tooltip>
    </>
  );
}
