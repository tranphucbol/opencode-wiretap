import type { Plugin } from "@opencode-ai/plugin";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const LOG_ROOT = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "opencode",
  "logs",
  "wiretap",
);

let sequence = 0;
let currentSessionId = "unknown";

/**
 * Request inits already seen. Both wrapper layers run on the same request —
 * `chat.params` resolves its inner fetch to the already-wrapped
 * `globalThis.fetch` — and forward the *same* init object down the chain, so
 * init identity is what distinguishes a real request from a second pass.
 */
const logged = new WeakSet<object>();

function getHeader(headers: any, name: string): string | null {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  if (typeof headers === "object") return headers[name] ?? null;
  return null;
}

function isAiRequestBody(body: any): boolean {
  return (
    (body.messages && Array.isArray(body.messages)) || // Anthropic, OpenAI Chat, Bedrock Converse
    (body.input && Array.isArray(body.input)) || // OpenAI Responses API
    (body.contents && Array.isArray(body.contents)) // Google Gemini / Vertex
  );
}

function resolveUrl(input: any): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? "unknown";
}

function writeLog(sessionId: string, url: string, body: string): void {
  const dir = join(LOG_ROOT, sessionId);
  mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const seq = String(sequence++).padStart(4, "0");
  const file = join(dir, `${ts}_${seq}.json`);

  const envelope = {
    timestamp: new Date().toISOString(),
    url,
    body: JSON.parse(body),
  };

  writeFileSync(file, JSON.stringify(envelope, null, 2));
}

function tryLog(init: any, input: any): void {
  if (!init?.body || typeof init.body !== "string") return;
  if (logged.has(init)) return;
  logged.add(init);
  try {
    const body = JSON.parse(init.body);
    if (!isAiRequestBody(body)) return;

    const sessionId =
      getHeader(init.headers, "x-opencode-session") || currentSessionId;
    const url = resolveUrl(input);

    writeLog(sessionId, url, init.body);
  } catch (_e) {
    // Never let logging break the actual request
  }
}

const plugin: Plugin = async (_ctx) => {
  // --- Layer 1: globalThis.fetch wrapper ---
  // Catches most providers since AI SDK calls ultimately go through fetch.
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: any, init?: any) => {
    tryLog(init, input);
    return originalFetch(input, init);
  };

  return {
    // --- Layer 2: chat.params fetch wrapper ---
    // Catches providers whose SDK may bypass globalThis.fetch
    // (e.g. AWS Bedrock using its own HTTP client).
    // Wraps the per-request fetch that opencode passes to streamText.
    "chat.params": async (input, output) => {
      if (input.sessionID) {
        currentSessionId = input.sessionID;
      }

      const existingFetch = (output as any).options?.fetch ?? globalThis.fetch;

      (output as any).options = (output as any).options ?? {};
      (output as any).options.fetch = async (
        fetchInput: any,
        fetchInit?: any,
      ) => {
        tryLog(fetchInit, fetchInput);
        return existingFetch(fetchInput, fetchInit);
      };
    },
  };
};

export default plugin;
