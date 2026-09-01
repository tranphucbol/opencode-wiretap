import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// A log root of this file's own. The real one is resolved once per process,
// and capture.test.ts already owns it.
const LOG_ROOT = mkdtempSync(join(tmpdir(), "wiretap-prune-"));

const { pruneOldSessions, retentionDays } = await import("./prune.ts");

afterAll(() => rmSync(LOG_ROOT, { recursive: true, force: true }));
afterEach(() => {
  delete process.env.WIRETAP_RETENTION_DAYS;
  rmSync(LOG_ROOT, { recursive: true, force: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** A session directory whose files were last written `daysAgo` days ago. */
function session(id: string, daysAgo: number, files = ["a.json"]): string {
  const dir = join(LOG_ROOT, id);
  mkdirSync(dir, { recursive: true });
  const when = (NOW - daysAgo * DAY_MS) / 1000;
  for (const name of files) {
    const file = join(dir, name);
    writeFileSync(file, "{}");
    utimesSync(file, when, when);
  }
  utimesSync(dir, when, when);
  return dir;
}

describe("retentionDays", () => {
  test("defaults to 15 days", () => {
    expect(retentionDays()).toBe(15);
  });

  test("reads WIRETAP_RETENTION_DAYS", () => {
    process.env.WIRETAP_RETENTION_DAYS = "3";
    expect(retentionDays()).toBe(3);
  });

  test("falls back to the default for junk and negatives", () => {
    for (const value of ["", "  ", "nonsense", "-1"]) {
      process.env.WIRETAP_RETENTION_DAYS = value;
      expect(retentionDays()).toBe(15);
    }
  });
});

describe("pruneOldSessions", () => {
  test("removes sessions past the window and keeps the rest", () => {
    session("ses_old", 20);
    session("ses_edge", 16);
    session("ses_fresh", 14);
    session("ses_today", 0);

    expect(pruneOldSessions(LOG_ROOT, NOW).sort()).toEqual([
      "ses_edge",
      "ses_old",
    ]);
    expect(existsSync(join(LOG_ROOT, "ses_old"))).toBe(false);
    expect(existsSync(join(LOG_ROOT, "ses_edge"))).toBe(false);
    expect(existsSync(join(LOG_ROOT, "ses_fresh"))).toBe(true);
    expect(existsSync(join(LOG_ROOT, "ses_today"))).toBe(true);
  });

  test("ages a session by its newest file, not its oldest", () => {
    const dir = session("ses_long", 40, ["old.json"]);
    const recent = join(dir, "recent.json");
    writeFileSync(recent, "{}");
    const when = (NOW - 1 * DAY_MS) / 1000;
    utimesSync(recent, when, when);

    expect(pruneOldSessions(LOG_ROOT, NOW)).toEqual([]);
    expect(existsSync(dir)).toBe(true);
  });

  test("removes the whole session, not just its expired files", () => {
    const dir = session("ses_mixed", 30, ["a.json", "b.json", "c.json"]);

    expect(pruneOldSessions(LOG_ROOT, NOW)).toEqual(["ses_mixed"]);
    expect(existsSync(dir)).toBe(false);
  });

  test("falls back to directory mtime for an empty session", () => {
    const dir = join(LOG_ROOT, "ses_empty");
    mkdirSync(dir, { recursive: true });
    const when = (NOW - 30 * DAY_MS) / 1000;
    utimesSync(dir, when, when);

    expect(pruneOldSessions(LOG_ROOT, NOW)).toEqual(["ses_empty"]);
    expect(existsSync(dir)).toBe(false);
  });

  test("does nothing when retention is 0", () => {
    process.env.WIRETAP_RETENTION_DAYS = "0";
    session("ses_ancient", 900);

    expect(pruneOldSessions(LOG_ROOT, NOW)).toEqual([]);
    expect(existsSync(join(LOG_ROOT, "ses_ancient"))).toBe(true);
  });

  test("honours a custom window", () => {
    process.env.WIRETAP_RETENTION_DAYS = "2";
    session("ses_three", 3);
    session("ses_one", 1);

    expect(pruneOldSessions(LOG_ROOT, NOW)).toEqual(["ses_three"]);
    expect(existsSync(join(LOG_ROOT, "ses_one"))).toBe(true);
  });

  test("ignores loose files in the log root", () => {
    mkdirSync(LOG_ROOT, { recursive: true });
    const stray = join(LOG_ROOT, "stray.json");
    writeFileSync(stray, "{}");
    const when = (NOW - 400 * DAY_MS) / 1000;
    utimesSync(stray, when, when);

    expect(pruneOldSessions(LOG_ROOT, NOW)).toEqual([]);
    expect(existsSync(stray)).toBe(true);
  });

  test("returns empty when the log root does not exist", () => {
    rmSync(LOG_ROOT, { recursive: true, force: true });
    expect(pruneOldSessions(LOG_ROOT, NOW)).toEqual([]);
  });
});
