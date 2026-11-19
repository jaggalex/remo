import { IconButton } from "@remo/ui";
import { useI18n } from "./i18n";
import { useTheme, type Theme } from "./useTheme";

/**
 * One button, light ⇄ dark (ADR-194).
 *
 * The help portal has no header of its own, so it keeps this single toggle. The
 * accessible name says what the current theme is and what the next click will do, so the
 * icon is never the only carrier of the state.
 */
export function ThemeSwitch() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const next: Theme = theme === "light" ? "dark" : "light";
  const label = t(theme === "light" ? "theme.lightAction" : "theme.darkAction");

  return (
    <IconButton
      className="theme-toggle-button"
      icon={theme === "light" ? "sun" : "moon"}
      label={label}
      title={label}
      onClick={() => setTheme(next)}
    />
  );
}
