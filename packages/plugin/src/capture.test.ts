import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CapturedRequest } from "@wiretap/shared";

// The log root is resolved once, when write.ts is first evaluated, so the
// environment has to be in place before the dynamic import below.
const root = mkdtempSync(join(tmpdir(), "wiretap-capture-"));
process.env.XDG_CONFIG_HOME = root;
const LOG_ROOT = join(root, "opencode", "logs", "wiretap");

const { beginCapture } = await import("./capture.ts");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const URL = "https://api.anthropic.invalid/v1/messages";
const enc = (s: string) => new TextEncoder().encode(s);

/** Start a capture for its own session directory, so file counts stay local. */
function capture(
  session: string,
  body: unknown = { messages: [{ role: "user", content: "hi" }] },
) {
  return beginCapture(
    { body: JSON.stringify(body), headers: { "x-opencode-session": session } },
    URL,
  );
}

/**
 * A response whose body yields `chunks` one per pull, then closes — or errors,
 * when `failWith` is given.
 *
 * Pull-driven on purpose. `controller.error()` discards anything still queued,
 * so enqueueing everything up front and then erroring models a connection that
 * failed *before* delivering a byte, not one that died mid-message.
 */
function streamOf(
  chunks: string[],
  opts: { status?: number; contentType?: string; failWith?: Error } = {},
): Response {
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc(chunks[i++]));
        return;
      }
      if (opts.failWith) controller.error(opts.failWith);
      else controller.close();
    },
  });
  return new Response(stream, {
    status: opts.status ?? 200,
    headers: { "content-type": opts.contentType ?? "text/event-stream" },
  });
}

/** A minimal, well-formed Anthropic stream. */
const ANTHROPIC_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-x","role":"assistant","usage":{"input_tokens":5}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
];

function read(file: string): CapturedRequest {
  return JSON.parse(readFileSync(file, "utf8")) as CapturedRequest;
}

/** Poll until the detached drain has written the response half. */
async function settled(
  file: string,
  timeoutMs = 2000,
): Promise<CapturedRequest> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const json = read(file);
    if (json.response) return json;
    if (Date.now() > deadline)
      throw new Error(`no response written for ${file}`);
    await Bun.sleep(5);
  }
}

/** Give the detached drain a chance to run when we expect it *not* to write. */
async function quiesce() {
  await Bun.sleep(50);
}

describe("beginCapture", () => {
  test("writes the request half immediately and returns a handle", () => {
    const handle = capture("ses_begin");
    expect(handle).not.toBeNull();
    const json = read(handle!.file);
    expect(json.url).toBe(URL);
    expect(json.body.messages).toHaveLength(1);
    expect(json.response).toBeUndefined();
  });

  test("ignores requests that are not AI-shaped", () => {
    expect(capture("ses_notai", { hello: "world" })).toBeNull();
  });

  test("ignores a request with no string body", () => {
    expect(beginCapture({ headers: {} }, URL)).toBeNull();
    expect(beginCapture(undefined, URL)).toBeNull();
  });

  test("writes one file when both wrapper layers see the same init", () => {
    const init = {
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      headers: { "x-opencode-session": "ses_dedupe" },
    };
    const outer = beginCapture(init, URL);
    const inner = beginCapture(init, URL);

    expect(outer).not.toBeNull();
    expect(inner).toBeNull();
    expect(readdirSync(join(LOG_ROOT, "ses_dedupe"))).toHaveLength(1);
  });

  test("returns null instead of throwing when the file cannot be written", () => {
    // A regular file where the session directory needs to be.
    writeFileSync(join(LOG_ROOT, "ses_blocked"), "not a directory");
    expect(capture("ses_blocked")).toBeNull();
  });
});

describe("attach", () => {
  test("returns the upstream response untouched, byte for byte", async () => {
    const handle = capture("ses_passthrough")!;
    const upstream = streamOf(ANTHROPIC_SSE);

    const returned = handle.attach(upstream);

    expect(returned).toBe(upstream);
    expect(await returned.text()).toBe(ANTHROPIC_SSE.join(""));
    await settled(handle.file);
  });

  test("does not block the caller on the drain", async () => {
    const handle = capture("ses_nonblocking")!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const upstream = new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(enc("first"));
          await gate;
          controller.enqueue(enc("second"));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/plain" } },
    );

    const returned = handle.attach(upstream);
    const reader = returned.body!.getReader();

    // The first chunk is readable while the rest of the stream is still open,
    // which is only possible if attach never awaited the drain.
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("first");
    expect(read(handle.file).response).toBeUndefined();

    release();
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("second");
    await reader.read();

    const json = await settled(handle.file);
    expect(json.response?.raw?.text).toBe("firstsecond");
  });

  test("leaves the capture request-only when the body is already consumed", async () => {
    const handle = capture("ses_noclone")!;
    const upstream = streamOf(["x"]);
    await upstream.text();

    expect(() => handle.attach(upstream)).not.toThrow();
    await quiesce();
    expect(read(handle.file).response).toBeUndefined();
  });

  test("never locks the caller out of its own response body", async () => {
    // Regression guard. Bun locks the pre-tee stream if `res.body` is read
    // before `res.clone()`, which would make OpenCode's own read of the
    // response throw. Every branch of attach must leave the caller able to
    // stream normally.
    for (const [session, upstream] of [
      ["ses_lock_sse", streamOf(["a", "b"])],
      ["ses_lock_err", streamOf(["boom"], { status: 500 })],
    ] as const) {
      const handle = capture(session)!;
      const returned = handle.attach(upstream);

      expect(returned.body!.locked).toBe(false);
      const reader = returned.body!.getReader();
      let out = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
      expect(out.length).toBeGreaterThan(0);
      await settled(handle.file);
    }
  });

  test("survives its capture file disappearing mid-flight", async () => {
    const handle = capture("ses_vanish")!;
    handle.attach(streamOf(ANTHROPIC_SSE));
    rmSync(handle.file, { force: true });
    // An unhandled rejection here would fail the run.
    await quiesce();
  });
});

describe("state resolution", () => {
  test("2xx SSE reaching done → complete, assembled, raw sse", async () => {
    const handle = capture("ses_sse")!;
    handle.attach(streamOf(ANTHROPIC_SSE));

    const { response } = await settled(handle.file);
    expect(response?.state).toBe("complete");
    expect(response?.status).toBe(200);
    expect(response?.error).toBeUndefined();
    expect(response?.message?.model).toBe("claude-x");
    expect(response?.message?.content).toEqual([
      { type: "text", text: "hello" },
    ]);
    expect(response?.message?.usage).toEqual({
      input_tokens: 5,
      output_tokens: 2,
    });
    expect(response?.raw?.encoding).toBe("sse");
    expect(response?.raw?.truncated).toBe(false);
    expect(response?.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(response?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("2xx non-SSE JSON → complete, assembled, raw json", async () => {
    const handle = capture("ses_json")!;
    const body = JSON.stringify({
      type: "message",
      role: "assistant",
      model: "claude-x",
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
    });
    handle.attach(streamOf([body], { contentType: "application/json" }));

    const { response } = await settled(handle.file);
    expect(response?.state).toBe("complete");
    expect(response?.raw?.encoding).toBe("json");
    expect(response?.message?.content).toEqual([{ type: "text", text: "hi" }]);
  });

  test("non-2xx → error, no message, body kept", async () => {
    const handle = capture("ses_429")!;
    const body = '{"type":"error","error":{"type":"rate_limit_error"}}';
    handle.attach(
      streamOf([body], { status: 429, contentType: "application/json" }),
    );

    const { response } = await settled(handle.file);
    expect(response?.state).toBe("error");
    expect(response?.status).toBe(429);
    expect(response?.error).toBe("HTTP 429");
    expect(response?.message).toBeUndefined();
    expect(response?.raw?.text).toBe(body);
  });

  test("an HTML error page keeps raw and assembles nothing", async () => {
    const handle = capture("ses_html")!;
    const body = "<html><title>502 Bad Gateway</title></html>";
    handle.attach(streamOf([body], { status: 502, contentType: "text/html" }));

    const { response } = await settled(handle.file);
    expect(response?.state).toBe("error");
    expect(response?.message).toBeUndefined();
    expect(response?.raw?.encoding).toBe("text");
    expect(response?.raw?.text).toBe(body);
  });

  test("a stream that dies mid-message → aborted, assembled from the partial", async () => {
    const handle = capture("ses_aborted")!;
    handle.attach(
      streamOf(ANTHROPIC_SSE.slice(0, 3), {
        failWith: new Error("connection reset"),
      }),
    );

    const { response } = await settled(handle.file);
    expect(response?.state).toBe("aborted");
    expect(response?.error).toContain("connection reset");
    // Everything that arrived before the cut is still assembled.
    expect(response?.message?.content).toEqual([
      { type: "text", text: "hello" },
    ]);
    expect(response?.message?.stop_reason).toBeUndefined();
    expect(response?.raw?.text).toBe(ANTHROPIC_SSE.slice(0, 3).join(""));
  });

  test("no body → complete with no raw and no message", async () => {
    const handle = capture("ses_204")!;
    handle.attach(new Response(null, { status: 204 }));

    const { response } = await settled(handle.file);
    expect(response?.state).toBe("complete");
    expect(response?.status).toBe(204);
    expect(response?.raw).toBeUndefined();
    expect(response?.message).toBeUndefined();
    expect(response?.durationMs).toBe(0);
  });

  test("exceeding the cap truncates raw but not the assembled message", async () => {
    const previous = process.env.WIRETAP_RAW_MAX_BYTES;
    // Smaller than the first chunk, so only that chunk is kept.
    process.env.WIRETAP_RAW_MAX_BYTES = "10";
    try {
      const handle = capture("ses_capped")!;
      handle.attach(streamOf(ANTHROPIC_SSE));

      const { response } = await settled(handle.file);
      expect(response?.state).toBe("complete");
      expect(response?.raw?.truncated).toBe(true);
      expect(response?.raw?.text).toBe(ANTHROPIC_SSE[0]);
      expect(response?.raw?.bytes).toBe(ANTHROPIC_SSE.join("").length);
      // Assembly ran over the whole stream, not the stored prefix.
      expect(response?.message?.content).toEqual([
        { type: "text", text: "hello" },
      ]);
      expect(response?.message?.usage?.output_tokens).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.WIRETAP_RAW_MAX_BYTES;
      else process.env.WIRETAP_RAW_MAX_BYTES = previous;
    }
  });

  test("a body with no recognised grammar keeps raw and omits message", async () => {
    const handle = capture("ses_gemini")!;
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "hi" }], role: "model" } }],
    });
    handle.attach(streamOf([body], { contentType: "application/json" }));

    const { response } = await settled(handle.file);
    expect(response?.state).toBe("complete");
    expect(response?.message).toBeUndefined();
    expect(response?.raw?.text).toBe(body);
  });
});

describe("header handling", () => {
  test("keeps allowlisted headers and drops everything else", async () => {
    const handle = capture("ses_headers")!;
    const upstream = new Response(enc("{}"), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_123",
        "anthropic-ratelimit-requests-remaining": "42",
        "x-ratelimit-limit-tokens": "80000",
        authorization: "Bearer sk-should-never-be-written",
        "set-cookie": "session=secret",
        "x-internal-trace": "abc",
      },
    });
    handle.attach(upstream);

    const { response } = await settled(handle.file);
    const headers = response!.headers;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["request-id"]).toBe("req_123");
    expect(headers["anthropic-ratelimit-requests-remaining"]).toBe("42");
    expect(headers["x-ratelimit-limit-tokens"]).toBe("80000");
    expect(headers.authorization).toBeUndefined();
    expect(headers["set-cookie"]).toBeUndefined();
    expect(headers["x-internal-trace"]).toBeUndefined();
  });
});
