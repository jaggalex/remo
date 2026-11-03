import { useEffect, useState } from "react";

/**
 * Light, dark or system theme (design-system tokens).
 *
 * The choice is a browser preference, not board state: it is stored in localStorage and
 * applied to the root element so every token, the canvas palette and native controls
 * follow it. `system` listens to the OS preference without a reload.
 */
export type Theme = "light" | "dark" | "system";

const KEY = "remo.theme";

export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
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
