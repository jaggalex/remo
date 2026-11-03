import { useI18n } from "./i18n";
import { useTheme, type Theme } from "./useTheme";

const ORDER: Theme[] = ["system", "light", "dark"];
const ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

/**
 * One button, like the portal: system → light → dark → system.
 *
 * The accessible name says what the current theme is and what the next click will do, so
 * the icon is never the only carrier of the state.
 */
export function ThemeSwitch() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
  const label = t(`theme.${theme}Action` as const);

  return (
    <button
      type="button"
      className="theme-toggle-button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
