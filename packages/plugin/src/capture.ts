// Owns one request/response pair: writes the request immediately, then tees
// the response and fills the rest in when the stream ends.
//
// Everything here is fire-and-forget. `attach` hands the caller back the
// untouched upstream response synchronously and drains a clone on a detached
// promise, so nothing OpenCode does waits on us and nothing we do can reject
// into its call stack.

import { assembleResponse } from "@wiretap/shared";
import type { CapturedResponse } from "@wiretap/shared";
import { writeRequest, rewriteWithResponse } from "./write.ts";

/** Bytes of raw body kept on disk. Assembly still sees the whole stream. */
const DEFAULT_RAW_MAX_BYTES = 1024 * 1024;

function rawMaxBytes(): number {
  const configured = Number(process.env.WIRETAP_RAW_MAX_BYTES);
  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_RAW_MAX_BYTES;
  }
  return configured;
}

/**
 * Response headers worth keeping. An allowlist rather than a denylist: headers
 * are where credential-shaped values live, so the default has to be "drop".
 */
const HEADER_ALLOWLIST = new Set([
  "content-type",
  "content-length",
  "content-encoding",
  "date",
  "server",
  "retry-after",
  "request-id",
  "x-request-id",
  "cf-ray",
  "openai-model",
  "openai-organization",
  "openai-processing-ms",
  "openai-version",
  "anthropic-organization-id",
]);

/** Header families kept whole, for rate-limit and retry forensics. */
const HEADER_ALLOWED_PREFIXES = ["anthropic-ratelimit-", "x-ratelimit-"];

function pickHeaders(headers: Headers): Record<string, string> {
  const picked: Record<string, string> = {};
  try {
    headers.forEach((value, key) => {
      const name = key.toLowerCase();
      const allowed =
        HEADER_ALLOWLIST.has(name) ||
        HEADER_ALLOWED_PREFIXES.some((p) => name.startsWith(p));
      if (allowed) picked[name] = value;
    });
  } catch (_e) {
    // A non-standard Headers implementation — keep what we have.
  }
  return picked;
}

function encodingOf(contentType: string): "sse" | "json" | "text" {
  const type = contentType.toLowerCase();
  if (type.includes("text/event-stream")) return "sse";
  if (type.includes("json")) return "json";
  return "text";
}

function isAiRequestBody(body: any): boolean {
  return (
    (body.messages && Array.isArray(body.messages)) || // Anthropic, OpenAI Chat, Bedrock Converse
    (body.input && Array.isArray(body.input)) || // OpenAI Responses API
    (body.contents && Array.isArray(body.contents)) // Google Gemini / Vertex
  );
}

function getHeader(headers: any, name: string): string | null {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  if (typeof headers === "object") return headers[name] ?? null;
  return null;
}

function resolveUrl(input: any): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? "unknown";
}

/**
 * Request inits already seen. Both wrapper layers run on the same request —
 * `chat.params` resolves its inner fetch to the already-wrapped
 * `globalThis.fetch` — and forward the *same* init object down the chain, so
 * init identity is what distinguishes a real request from a second pass.
 */
const seen = new WeakSet<object>();

let currentSessionId = "unknown";

/** Remember the session the next requests belong to. */
export function setCurrentSession(sessionId: string): void {
  currentSessionId = sessionId;
}

export interface Capture {
  /** Path of the capture file this handle owns. */
  readonly file: string;
  /**
   * Tee `res` and return it unchanged. The clone is drained on a detached
   * promise; the returned response is immediately usable.
   */
  attach(res: Response): Response;
}

/**
 * The slice of `Response` the drain actually touches.
 *
 * Structural on purpose. Bun's and undici's `Response` declarations are both
 * reachable from this package and disagree on the exact type `clone()`
 * returns; naming only what we read sidesteps that, and lets a test hand in a
 * plain object instead of a real `Response`.
 */
interface DrainableResponse {
  ok: boolean;
  status: number;
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
    };
  } | null;
}

class FileCapture implements Capture {
  constructor(
    readonly file: string,
    private readonly url: string,
    private readonly sentAt: number,
  ) {}

  attach(res: Response): Response {
    const startedAt = Date.now();
    const base = {
      status: res.status,
      headers: pickHeaders(res.headers),
      startedAt: new Date(startedAt).toISOString(),
      ttfbMs: startedAt - this.sentAt,
    };

    // Order below is load-bearing, not stylistic.
    //
    // In Bun, touching `res.body` *before* `res.clone()` leaves the caller
    // holding the pre-tee stream, which the tee then locks — OpenCode would
    // get `TypeError: ReadableStream is locked` when it reads its own
    // response. Cloning first hands the caller a live branch instead. So:
    // clone before anything reads `res.body`, and inspect the clone from then
    // on. `bodyUsed` is safe to read; it does not materialise the stream.
    if (res.bodyUsed) return res;

    let clone: DrainableResponse;
    try {
      clone = res.clone() as DrainableResponse;
    } catch (_e) {
      // An exotic Response implementation. Leave the capture request-only
      // rather than writing a response we could not actually observe.
      return res;
    }

    // 204s and HEAD-like responses have nothing to drain.
    if (!clone.body) {
      rewriteWithResponse(this.file, {
        ...base,
        completedAt: new Date().toISOString(),
        durationMs: 0,
        state: clone.ok ? "complete" : "error",
        error: clone.ok ? undefined : `HTTP ${clone.status}`,
      });
      return res;
    }

    void this.drain(clone, base, startedAt);
    return res;
  }

  private async drain(
    clone: DrainableResponse,
    base: Omit<CapturedResponse, "completedAt" | "durationMs" | "state">,
    startedAt: number,
  ): Promise<void> {
    const contentType = base.headers["content-type"] ?? "";
    const cap = rawMaxBytes();

    let full = "";
    let capped = "";
    let bytes = 0;
    let cappedBytes = 0;
    let state: CapturedResponse["state"] = clone.ok ? "complete" : "error";
    let error = clone.ok ? undefined : `HTTP ${clone.status}`;

    try {
      const reader = clone.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const text = decoder.decode(value, { stream: true });
        full += text;
        bytes += value.byteLength;
        // Whole chunks only — slicing on a byte boundary would split a
        // multi-byte character. Overshoot is bounded by one chunk.
        if (cappedBytes < cap) {
          capped += text;
          cappedBytes += value.byteLength;
        }
      }
      full += decoder.decode();
    } catch (err) {
      // A stream that died mid-message is the single most valuable thing this
      // plugin can record, so keep everything read so far.
      state = "aborted";
      error = String(err);
    }

    const completedAt = Date.now();
    const response: CapturedResponse = {
      ...base,
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - startedAt,
      state,
      error,
      // A non-2xx body is an error page, not a message; assembling it would
      // only ever produce noise.
      message:
        state === "error"
          ? undefined
          : assembleResponse(this.url, contentType, full),
      raw:
        bytes > 0
          ? {
              encoding: encodingOf(contentType),
              text: capped,
              bytes,
              truncated: cappedBytes < bytes,
            }
          : undefined,
    };

    rewriteWithResponse(this.file, response);
  }
}

/**
 * Write the request half of a capture and return a handle for the response
 * half, or null when this call is not ours to record — a non-AI request, a
 * second pass over an init we already logged, or a failed write.
 */
export function beginCapture(init: any, input: any): Capture | null {
  if (!init?.body || typeof init.body !== "string") return null;
  if (seen.has(init)) return null;
  seen.add(init);
  try {
    const body = JSON.parse(init.body);
    if (!isAiRequestBody(body)) return null;

    const sessionId =
      getHeader(init.headers, "x-opencode-session") || currentSessionId;
    const url = resolveUrl(input);

    const file = writeRequest(sessionId, url, body);
    return file ? new FileCapture(file, url, Date.now()) : null;
  } catch (_e) {
    // Never let logging break the actual request.
    return null;
  }
}
