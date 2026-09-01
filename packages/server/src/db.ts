import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { openReadonly, type SqliteDriver } from "./sqlite.ts";

/**
 * Read-only access to OpenCode's SQLite database to resolve session titles.
 *
 * OpenCode stores session metadata (title, parent, directory) in
 * `~/.local/share/opencode/opencode.db` (see opencode
 * packages/core/src/database/database.ts → join(Global.Path.data, "opencode.db")).
 * The DB runs in WAL mode, so a read-only connection is safe to open
 * concurrently while OpenCode is running. We only issue indexed primary-key
 * lookups, so the multi-GB file size is irrelevant to performance.
 */

const DEFAULT_DB = path.join(os.homedir(), ".local/share/opencode/opencode.db");

/**
 * Resolve the DB path: OPENCODE_DB (absolute) overrides the XDG default.
 * Read lazily, not at import time, so CLI flags can set OPENCODE_DB first.
 */
export function dbPath(): string {
  return process.env.OPENCODE_DB
    ? path.resolve(process.env.OPENCODE_DB)
    : DEFAULT_DB;
}

export interface SessionMeta {
  title: string | null;
  parentId: string | null;
  directory: string | null;
}

let opening: Promise<SqliteDriver | null> | null = null;

/** Lazily open the DB read-only, once. Resolves to null if unavailable. */
function getDb(): Promise<SqliteDriver | null> {
  const file = dbPath();
  opening ??= existsSync(file) ? openReadonly(file) : Promise.resolve(null);
  return opening;
}

/** True if the OpenCode DB was found and opened. */
export async function dbAvailable(): Promise<boolean> {
  return (await getDb()) !== null;
}

// SQLite limits bound variables (default 999). Chunk well under that.
const CHUNK = 900;

/**
 * Batch-resolve session metadata by id. Missing ids and any DB error degrade
 * gracefully to an empty map (callers fall back to id-only display).
 */
export async function getSessionMeta(
  ids: string[],
): Promise<Map<string, SessionMeta>> {
  const out = new Map<string, SessionMeta>();
  if (ids.length === 0) return out;
  const conn = await getDb();
  if (!conn) return out;

  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = conn.all(
        `SELECT id, title, parent_id AS parentId, directory
           FROM session WHERE id IN (${placeholders})`,
        chunk,
      ) as Array<{
        id: string;
        title: string | null;
        parentId: string | null;
        directory: string | null;
      }>;
      for (const r of rows) {
        out.set(r.id, {
          title: r.title,
          parentId: r.parentId,
          directory: r.directory,
        });
      }
    }
  } catch {
    // Schema drift or read error — return whatever we gathered.
  }
  return out;
}
