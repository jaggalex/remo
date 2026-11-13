import { useEffect, useState } from "react";

/**
 * Light or dark theme (design-system tokens, ADR-194).
 *
 * The choice is a browser preference, not board state: it is stored in localStorage and
 * applied to the root element so every token, the canvas palette and native controls
 * follow it. `system` is gone: an account or browser that still holds it reads as light,
 * and the stored value is rewritten only when the person picks a theme.
 */
export type Theme = "light" | "dark";

const KEY = "remo.theme";

export function readTheme(): Theme {
  try {
    // A stored `system` (or anything unknown) is light, not a third state. The value is
    // left in place until the person chooses, so an older client can still read it.
    return window.localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  return theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the theme still applies for this tab */
    }
  };

  return { theme, setTheme };
}
