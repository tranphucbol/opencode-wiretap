import type { Plugin } from "@opencode-ai/plugin";
import { beginCapture, setCurrentSession } from "./capture.ts";
import { pruneOldSessions } from "./prune.ts";

/**
 * Record a call, if it is one we have not already recorded, and tee whatever
 * comes back.
 *
 * Both wrapper layers below run this. Only one of them ever gets a handle:
 * `beginCapture` dedupes on the init object, so the outer layer writes the
 * file and the inner one is told to stand down. That makes the layer holding
 * the handle the same layer that tees, without any extra bookkeeping.
 */
async function through(
  fetchImpl: (input: any, init?: any) => Promise<Response>,
  input: any,
  init: any,
): Promise<Response> {
  const capture = beginCapture(init, input);
  const res = await fetchImpl(input, init);
  return capture ? capture.attach(res) : res;
}

/**
 * Sweep expired sessions off disk, once, after init has returned.
 *
 * Deferred rather than awaited: the sweep stats every session directory, and
 * startup should not wait on that. The timer is unref'd where the runtime
 * supports it so a short-lived process is never held open by it.
 */
function scheduleRetentionSweep(): void {
  try {
    const timer = setTimeout(() => pruneOldSessions(), 0) as unknown as {
      unref?: () => void;
    };
    timer?.unref?.();
  } catch (_e) {
    // Housekeeping is never worth failing a plugin load over.
  }
}

const plugin: Plugin = async (_ctx) => {
  scheduleRetentionSweep();

  // --- Layer 1: globalThis.fetch wrapper ---
  // Catches most providers since AI SDK calls ultimately go through fetch.
  const originalFetch = globalThis.fetch;

  // Cast: the wrapper is a plain function and does not carry runtime-specific
  // statics such as Bun's `fetch.preconnect`. That has always been true here;
  // only the type now says so.
  globalThis.fetch = ((input: any, init?: any) =>
    through(originalFetch, input, init)) as typeof globalThis.fetch;

  return {
    // --- Layer 2: chat.params fetch wrapper ---
    // Catches providers whose SDK may bypass globalThis.fetch
    // (e.g. AWS Bedrock using its own HTTP client).
    // Wraps the per-request fetch that opencode passes to streamText.
    "chat.params": async (input, output) => {
      if (input.sessionID) {
        setCurrentSession(input.sessionID);
      }

      const existingFetch = (output as any).options?.fetch ?? globalThis.fetch;

      (output as any).options = (output as any).options ?? {};
      (output as any).options.fetch = (fetchInput: any, fetchInit?: any) =>
        through(existingFetch, fetchInput, fetchInit);
    },
  };
};

export default plugin;
