import express from "express";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  SessionSummary,
  RequestSummary,
  CapturedRequest,
} from "@wiretap/shared";
import { getRequestMessages } from "@wiretap/shared";
import { getSessionMeta, dbAvailable, DB_PATH } from "./db.ts";

const DEFAULT_LOG_DIR = path.join(
  os.homedir(),
  ".config/opencode/logs/wiretap",
);

const LOG_DIR = path.resolve(process.env.LOG_DIR ?? DEFAULT_LOG_DIR);
const PORT = Number(process.env.API_PORT ?? 3001);

// Filenames look like: 2026-07-03T06-09-01-148Z_0001.json
const FILE_RE = /^([0-9TZ:.\-]+)_(\d+)\.json$/;
// Session dirs look like: ses_0d967bbabffeTij3Ph7fLBAuCf
const SESSION_RE = /^[A-Za-z0-9_\-]+$/;

const app = express();

/**
 * Resolve a path *inside* LOG_DIR, rejecting traversal. Returns null if the
 * resolved path escapes the root.
 */
function safeJoin(...parts: string[]): string | null {
  const resolved = path.resolve(LOG_DIR, ...parts);
  const rel = path.relative(LOG_DIR, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/** Extract the ISO-ish timestamp prefix from a captured filename. */
function parseFileName(name: string): { seq: number; tsPrefix: string } | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  return { tsPrefix: m[1], seq: Number(m[2]) };
}

// GET /api/sessions — shallow scan, cheap. No file parsing.
app.get("/api/sessions", async (_req, res) => {
  try {
    const entries = await fs.readdir(LOG_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    const sessions: SessionSummary[] = await Promise.all(
      dirs.map(async (dir) => {
        const full = path.join(LOG_DIR, dir.name);
        const files = await fs.readdir(full);
        const jsonFiles = files.filter((f) => f.endsWith(".json"));
        // Filenames are timestamp-prefixed → lexical max === most recent.
        let lastModified = "";
        if (jsonFiles.length > 0) {
          const latest = jsonFiles.reduce((a, b) => (a > b ? a : b));
          const parsed = parseFileName(latest);
          lastModified = parsed
            ? parsed.tsPrefix.replace(
                /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
                "T$1:$2:$3.$4Z",
              )
            : "";
        }
        if (!lastModified) {
          const st = await fs.stat(full);
          lastModified = st.mtime.toISOString();
        }
        return {
          id: dir.name,
          fileCount: jsonFiles.length,
          lastModified,
          title: null,
          parentId: null,
          directory: null,
        };
      }),
    );

    // Enrich with titles from OpenCode's DB (single batched, indexed lookup).
    const meta = getSessionMeta(sessions.map((s) => s.id));
    for (const s of sessions) {
      const m = meta.get(s.id);
      if (m) {
        s.title = m.title;
        s.parentId = m.parentId;
        s.directory = m.directory;
      }
    }

    sessions.sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sessions/:id — list requests in one session, with light metadata.
app.get("/api/sessions/:id", async (req, res) => {
  const { id } = req.params;
  if (!SESSION_RE.test(id)) {
    res.status(400).json({ error: "invalid session id" });
    return;
  }
  const dir = safeJoin(id);
  if (!dir) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const rows: RequestSummary[] = await Promise.all(
      files.map(async (file) => {
        const full = path.join(dir, file);
        const parsed = parseFileName(file);
        const seq = parsed?.seq ?? 0;
        let model: string | null = null;
        let messageCount = 0;
        let timestamp = "";
        let size = 0;
        try {
          const st = await fs.stat(full);
          size = st.size;
          const raw = await fs.readFile(full, "utf8");
          const json = JSON.parse(raw) as CapturedRequest;
          model = json.body?.model ?? null;
          messageCount = getRequestMessages(json.body).length;
          timestamp = json.timestamp ?? "";
        } catch {
          // Corrupt/partial file — still list it with what we have.
        }
        return { file, seq, timestamp, model, messageCount, size };
      }),
    );

    rows.sort((a, b) => a.seq - b.seq);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sessions/:id/:file — stream one raw captured request.
app.get("/api/sessions/:id/:file", (req, res) => {
  const { id, file } = req.params;
  if (!SESSION_RE.test(id) || !FILE_RE.test(file)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const full = safeJoin(id, file);
  if (!full) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const stream = createReadStream(full);
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).json({ error: "not found" });
  });
  stream.pipe(res);
});

app.get("/api/config", (_req, res) => {
  res.json({ logDir: LOG_DIR, dbPath: DB_PATH, dbFound: dbAvailable() });
});

app.listen(PORT, () => {
  console.log(`[wiretap] API on http://localhost:${PORT}`);
  console.log(`[wiretap] LOG_DIR = ${LOG_DIR}`);
});
