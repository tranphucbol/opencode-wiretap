// Disk I/O for captures. Two guarantees live here and nowhere else:
//
//   1. Nothing throws. Every export swallows its own failures — logging must
//      never be able to break the request it is observing.
//   2. Every write is atomic. Files are written to `<name>.tmp` and renamed
//      into place, because the viewer streams captures straight off disk
//      (packages/server/src/index.ts) and a reader must see either the old
//      contents or the new ones, never a half-written file.

import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import type { CapturedRequest, CapturedResponse } from "@wiretap/shared";

export const LOG_ROOT = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "opencode",
  "logs",
  "wiretap",
);

let sequence = 0;

/** Write `text` to `file` via a temp file and a rename. */
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } catch (_e) {
    // Best effort: don't leave a stray temp file behind after a failure.
    try {
      rmSync(tmp, { force: true });
    } catch (_e2) {
      /* nothing further to do */
    }
    throw _e;
  }
}

/**
 * Write the request half of a capture and return the path it landed at, or
 * null if it could not be written. The path is the handle used later to
 * attach the response.
 */
export function writeRequest(
  sessionId: string,
  url: string,
  body: unknown,
): string | null {
  try {
    const dir = join(LOG_ROOT, sessionId);
    mkdirSync(dir, { recursive: true });

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, "-");
    const seq = String(sequence++).padStart(4, "0");
    const file = join(dir, `${ts}_${seq}.json`);

    const envelope: CapturedRequest = {
      timestamp: now.toISOString(),
      url,
      body: body as CapturedRequest["body"],
    };

    writeAtomic(file, JSON.stringify(envelope, null, 2));
    return file;
  } catch (_e) {
    return null;
  }
}

/**
 * Re-read a capture, attach its response and write it back.
 *
 * Re-reading rather than holding the envelope in memory keeps the request
 * bodies (which are large, and there may be many in flight) off the heap for
 * the lifetime of the call.
 */
export function rewriteWithResponse(
  file: string,
  response: CapturedResponse,
): void {
  try {
    const existing = JSON.parse(readFileSync(file, "utf8")) as CapturedRequest;
    existing.response = response;
    writeAtomic(file, JSON.stringify(existing, null, 2));
  } catch (_e) {
    // The request half is already on disk and stays valid; a failure here
    // costs the response, not the capture.
  }
}
