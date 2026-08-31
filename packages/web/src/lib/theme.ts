import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** localStorage key holding the user's persisted theme choice. Must match the
 *  pre-paint bootstrap script in index.html. */
export const THEME_KEY = "theme";

/** The explicitly stored choice, or null if the user hasn't chosen one. */
export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function persist(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

/** Apply a theme to <html> and persist it to localStorage. */
function apply(theme: Theme, save = true) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  if (save) persist(theme);
}

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Theme state synced with the `.dark` class on <html> and persisted to
 * localStorage under THEME_KEY. The initial class is set pre-paint by the
 * bootstrap script in index.html; this hook mirrors it, lets the user toggle,
 * and — until an explicit choice is stored — follows the OS preference live.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current);

  // Ensure localStorage always reflects the active theme, even when the user
  // is still on the system default (writes the resolved value once).
  useEffect(() => {
    const t = current();
    setTheme(t);
    if (!storedTheme()) persist(t);
  }, []);

  // Follow OS theme changes only while no explicit choice is stored.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (storedTheme()) return; // user chose explicitly → don't override
      const next: Theme = e.matches ? "dark" : "light";
      apply(next, false);
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      apply(next); // toggles class + persists explicit choice
      return next;
    });
  }, []);

  return [theme, toggle];
}
