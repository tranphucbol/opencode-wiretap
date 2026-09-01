/**
 * Minimal read-only SQLite driver that works on both Bun and Node.
 *
 * The viewer is published to npm and may be started with either `bunx` or
 * `npx`, so we cannot hard-import `bun:sqlite`. Both backends are loaded
 * dynamically and every failure path degrades to `null`, which callers treat
 * as "session titles unavailable".
 *
 *  - Bun  → `bun:sqlite` (always present)
 *  - Node → `node:sqlite` (unflagged since 22.13; earlier versions need
 *           `--experimental-sqlite` and simply fall through to `null`)
 */

/** The single operation the viewer needs: run a query, get all rows. */
export interface SqliteDriver {
  all(sql: string, params: string[]): unknown[];
}

type BunSqlite = {
  Database: new (
    file: string,
    opts: { readonly: boolean },
  ) => { query(sql: string): { all(...params: string[]): unknown[] } };
};

type NodeSqlite = {
  DatabaseSync: new (
    file: string,
    opts: { readOnly: boolean },
  ) => { prepare(sql: string): { all(...params: string[]): unknown[] } };
};

/**
 * Hide the specifier from bundlers so neither builtin is statically resolved.
 * `bun build --target=node` would otherwise try to inline `bun:sqlite`.
 */
function importBuiltin<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}

async function openBun(file: string): Promise<SqliteDriver | null> {
  if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") return null;
  try {
    const { Database } = await importBuiltin<BunSqlite>("bun:sqlite");
    const db = new Database(file, { readonly: true });
    return { all: (sql, params) => db.query(sql).all(...params) };
  } catch {
    return null;
  }
}

async function openNode(file: string): Promise<SqliteDriver | null> {
  try {
    const { DatabaseSync } = await importBuiltin<NodeSqlite>("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    return { all: (sql, params) => db.prepare(sql).all(...params) };
  } catch {
    return null;
  }
}

/**
 * Open `file` read-only using whichever backend this runtime provides.
 * Returns null when no backend is available or the file cannot be opened.
 */
export async function openReadonly(file: string): Promise<SqliteDriver | null> {
  return (await openBun(file)) ?? (await openNode(file));
}
