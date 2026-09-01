// Retention for captured logs. Captures are never overwritten, so without a
// sweep the log root grows for as long as OpenCode is installed.
//
// Two rules shape this file:
//
//   1. Nothing throws, same as write.ts. A retention sweep must never be able
//      to break a session.
//   2. A session is pruned whole or not at all. Splitting one in half would
//      leave the viewer showing a conversation missing its opening turns,
//      which is worse than keeping it. See
//      docs/decisions/005-captures-pruned-by-session-age.md.

import { join } from "node:path";
import { readdirSync, rmSync, statSync } from "node:fs";
import { logRoot } from "./write.ts";

/** Days a session is kept after its last write. */
const DEFAULT_RETENTION_DAYS = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Configured retention window in days. `0` disables pruning entirely. */
export function retentionDays(): number {
  const raw = process.env.WIRETAP_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
  const configured = Number(raw);
  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_RETENTION_DAYS;
  }
  return configured;
}

/**
 * When a session last changed: the newest mtime among its files, falling back
 * to the directory's own mtime when it holds none.
 *
 * mtime rather than the timestamp in the filename because the response half is
 * rewritten in after the request lands — mtime is the moment the session
 * actually went quiet, which is what the window is measured against.
 *
 * Throws if the directory cannot be read at all; callers treat that as "leave
 * it alone", so an unreadable session is kept rather than deleted blind.
 */
function lastTouched(dir: string): number {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    try {
      const { mtimeMs } = statSync(join(dir, name));
      if (mtimeMs > newest) newest = mtimeMs;
    } catch (_e) {
      // A file that vanished mid-scan says nothing about the session's age.
    }
  }
  return newest || statSync(dir).mtimeMs;
}

/**
 * Delete every session directory under `root` untouched for longer than the
 * retention window, and return the ids removed.
 *
 * `root` and `now` are parameters so a test can sweep a directory of its own
 * at a time of its choosing, without reaching for the environment.
 *
 * Best effort throughout: a session that cannot be inspected or removed is
 * skipped and the sweep carries on.
 */
export function pruneOldSessions(
  root: string = logRoot(),
  now: number = Date.now(),
): string[] {
  const removed: string[] = [];

  const days = retentionDays();
  if (days === 0) return removed;
  const cutoff = now - days * DAY_MS;

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (_e) {
    // No log root yet — nothing has ever been captured.
    return removed;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    try {
      if (lastTouched(dir) >= cutoff) continue;
      rmSync(dir, { recursive: true, force: true });
      removed.push(entry.name);
    } catch (_e) {
      // Keep going; one stubborn session should not stop the sweep.
    }
  }

  return removed;
}
