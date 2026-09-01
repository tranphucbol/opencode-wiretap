import { useCallback, useState } from "react";

/** localStorage keys holding the user's persisted auto-fetch choices. */
export const AUTO_FETCH_ENABLED_KEY = "autoFetchEnabled";
export const AUTO_FETCH_INTERVAL_KEY = "autoFetchIntervalMs";

/** Selectable poll intervals, in milliseconds. */
export const AUTO_FETCH_INTERVALS = [5000, 10000, 30000, 60000] as const;
export type AutoFetchInterval = (typeof AUTO_FETCH_INTERVALS)[number];

const DEFAULT_INTERVAL: AutoFetchInterval = 10000;

function storedEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_FETCH_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function storedInterval(): AutoFetchInterval {
  try {
    const v = Number(localStorage.getItem(AUTO_FETCH_INTERVAL_KEY));
    return (AUTO_FETCH_INTERVALS as readonly number[]).includes(v)
      ? (v as AutoFetchInterval)
      : DEFAULT_INTERVAL;
  } catch {
    return DEFAULT_INTERVAL;
  }
}

function persistEnabled(v: boolean) {
  try {
    localStorage.setItem(AUTO_FETCH_ENABLED_KEY, String(v));
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

function persistInterval(v: AutoFetchInterval) {
  try {
    localStorage.setItem(AUTO_FETCH_INTERVAL_KEY, String(v));
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

/**
 * Auto-fetch on/off + interval, persisted to localStorage under
 * AUTO_FETCH_ENABLED_KEY / AUTO_FETCH_INTERVAL_KEY (mirrors lib/theme.ts).
 */
export function useAutoFetch(): [
  boolean,
  AutoFetchInterval,
  (v: boolean) => void,
  (v: AutoFetchInterval) => void,
] {
  const [enabled, setEnabledState] = useState<boolean>(storedEnabled);
  const [intervalMs, setIntervalState] =
    useState<AutoFetchInterval>(storedInterval);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    persistEnabled(v);
  }, []);

  const setIntervalMs = useCallback((v: AutoFetchInterval) => {
    setIntervalState(v);
    persistInterval(v);
  }, []);

  return [enabled, intervalMs, setEnabled, setIntervalMs];
}
