import { describe, expect, test } from "bun:test";
import { assembleResponse } from "./assemble.ts";

const SSE = "text/event-stream";
const JSON_CT = "application/json";
const URL = "https://api.example.invalid/v1/messages";

/** Build an SSE body from `[eventName, payload]` pairs. */
function sse(...events: Array<[string, unknown]>): string {
  return events
    .map(
      ([name, payload]) =>
        `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`,
    )
    .join("");
}

/** Build an SSE body of bare `data:` chunks, as OpenAI Chat sends. */
function dataOnly(...payloads: unknown[]): string {
  return (
    payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

describe("Anthropic Messages — stream", () => {
  test("concatenates text deltas in order into one block", () => {
    const body = sse(
      [
        "message_start",
        {
          type: "message_start",
          message: {
            model: "claude-x",
            role: "assistant",
            usage: { input_tokens: 10 },
          },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hel" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "lo" },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 4 },
        },
      ],
      ["message_stop", { type: "message_stop" }],
    );

    const message = assembleResponse(URL, SSE, body);
    expect(message?.model).toBe("claude-x");
    expect(message?.role).toBe("assistant");
    expect(message?.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(message?.stop_reason).toBe("end_turn");
    expect(message?.usage).toEqual({ input_tokens: 10, output_tokens: 4 });
  });

  test("keeps interleaved thinking and text as separate blocks in emission order", () => {
    const body = sse(
      [
        "message_start",
        {
          type: "message_start",
          message: { model: "claude-x", role: "assistant" },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "hmm" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig" },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "answer" },
        },
      ],
    );

    const content = assembleResponse(URL, SSE, body)?.content;
    expect(content?.map((b) => b.type)).toEqual(["thinking", "text"]);
    expect(content?.[0]).toMatchObject({ thinking: "hmm", signature: "sig" });
    expect(content?.[1]).toMatchObject({ text: "answer" });
  });

  test("reassembles input_json_delta fragments into parsed tool input", () => {
    const body = sse(
      [
        "message_start",
        {
          type: "message_start",
          message: { model: "claude-x", role: "assistant" },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tu_1",
            name: "read",
            input: {},
          },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"pa' },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: 'th":"a.ts"}' },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
    );

    expect(assembleResponse(URL, SSE, body)?.content[0]).toMatchObject({
      type: "tool_use",
      id: "tu_1",
      name: "read",
      input: { path: "a.ts" },
    });
  });

  test("merges message_start and message_delta usage", () => {
    const body = sse(
      [
        "message_start",
        {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 100,
              cache_read_input_tokens: 90,
              cache_creation_input_tokens: 5,
            },
          },
        },
      ],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { output_tokens: 250 },
        },
      ],
    );

    expect(assembleResponse(URL, SSE, body)?.usage).toEqual({
      input_tokens: 100,
      cache_read_input_tokens: 90,
      cache_creation_input_tokens: 5,
      output_tokens: 250,
    });
  });

  test("truncation mid tool_use yields what arrived and keeps the fragment verbatim", () => {
    const body =
      sse(
        [
          "message_start",
          { type: "message_start", message: { model: "claude-x" } },
        ],
        [
          "content_block_start",
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
        ],
        [
          "content_block_delta",
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "before" },
          },
        ],
        [
          "content_block_start",
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "tu_1", name: "edit" },
          },
        ],
      ) +
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_de';

    const content = assembleResponse(URL, SSE, body)?.content;
    expect(content).toHaveLength(2);
    expect(content?.[0]).toMatchObject({ type: "text", text: "before" });
    // No fragments arrived, so the accumulated JSON is empty and stays absent.
    expect(content?.[1]).toMatchObject({ type: "tool_use", name: "edit" });
  });

  test("a malformed tool argument survives as the raw string", () => {
    const body = sse(
      ["message_start", { type: "message_start", message: {} }],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "t", name: "n" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"broken' },
        },
      ],
    );

    expect(assembleResponse(URL, SSE, body)?.content[0].input).toBe('{"broken');
  });
});

describe("Anthropic Messages — single JSON", () => {
  test("produces the same blocks as the equivalent stream", () => {
    const body = JSON.stringify({
      type: "message",
      role: "assistant",
      model: "claude-x",
      content: [
        { type: "text", text: "Hello" },
        { type: "tool_use", id: "tu_1", name: "read", input: { path: "a.ts" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 4 },
    });

    const message = assembleResponse(URL, JSON_CT, body);
    expect(message?.model).toBe("claude-x");
    expect(message?.role).toBe("assistant");
    expect(message?.stop_reason).toBe("tool_use");
    expect(message?.usage).toEqual({ input_tokens: 10, output_tokens: 4 });
    expect(message?.content).toEqual([
      { type: "text", text: "Hello" },
      { type: "tool_use", id: "tu_1", name: "read", input: { path: "a.ts" } },
    ]);
  });
});

describe("OpenAI Chat Completions", () => {
  test("concatenates delta.content across chunks", () => {
    const body = dataOnly(
      {
        model: "gpt-x",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }],
      },
      { model: "gpt-x", choices: [{ index: 0, delta: { content: "lo" } }] },
      {
        model: "gpt-x",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 2 },
      },
    );

    const message = assembleResponse(URL, SSE, body);
    expect(message?.model).toBe("gpt-x");
    expect(message?.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(message?.stop_reason).toBe("stop");
    expect(message?.usage).toEqual({ input_tokens: 7, output_tokens: 2 });
  });

  test("merges tool_calls by index across chunks", () => {
    const body = dataOnly(
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c0",
                  function: { name: "read", arguments: '{"pa' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: "c1",
                  function: { name: "grep", arguments: '{"q":"x"}' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'th":"a.ts"}' } },
              ],
            },
          },
        ],
      },
    );

    expect(assembleResponse(URL, SSE, body)?.content).toEqual([
      { type: "tool_use", id: "c0", name: "read", input: { path: "a.ts" } },
      { type: "tool_use", id: "c1", name: "grep", input: { q: "x" } },
    ]);
  });

  test("surfaces reasoning_content as a thinking block before the text", () => {
    const body = dataOnly(
      { choices: [{ delta: { reasoning_content: "step 1" } }] },
      { choices: [{ delta: { content: "done" } }] },
    );

    expect(assembleResponse(URL, SSE, body)?.content).toEqual([
      { type: "thinking", thinking: "step 1" },
      { type: "text", text: "done" },
    ]);
  });

  test("reads cached and reasoning token details", () => {
    const body = dataOnly({
      choices: [{ delta: { content: "x" } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 80 },
        completion_tokens_details: { reasoning_tokens: 12 },
      },
    });

    expect(assembleResponse(URL, SSE, body)?.usage).toEqual({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 80,
      reasoning_tokens: 12,
    });
  });

  test("single JSON response produces the same blocks as its stream form", () => {
    const body = JSON.stringify({
      object: "chat.completion",
      model: "gpt-x",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello",
            tool_calls: [
              {
                index: 0,
                id: "c0",
                function: { name: "read", arguments: '{"path":"a.ts"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 2 },
    });

    const message = assembleResponse(URL, JSON_CT, body);
    expect(message?.content).toEqual([
      { type: "text", text: "Hello" },
      { type: "tool_use", id: "c0", name: "read", input: { path: "a.ts" } },
    ]);
    expect(message?.stop_reason).toBe("tool_calls");
    expect(message?.usage).toEqual({ input_tokens: 7, output_tokens: 2 });
  });
});

describe("OpenAI Responses", () => {
  test("concatenates output_text deltas and takes usage from response.completed", () => {
    const body = sse(
      [
        "response.created",
        { type: "response.created", response: { model: "gpt-x" } },
      ],
      [
        "response.output_text.delta",
        { type: "response.output_text.delta", output_index: 0, delta: "Hel" },
      ],
      [
        "response.output_text.delta",
        { type: "response.output_text.delta", output_index: 0, delta: "lo" },
      ],
      [
        "response.completed",
        {
          type: "response.completed",
          response: {
            status: "completed",
            usage: {
              input_tokens: 9,
              output_tokens: 3,
              output_tokens_details: { reasoning_tokens: 1 },
            },
          },
        },
      ],
    );

    const message = assembleResponse(URL, SSE, body);
    expect(message?.model).toBe("gpt-x");
    expect(message?.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(message?.stop_reason).toBe("completed");
    expect(message?.usage).toEqual({
      input_tokens: 9,
      output_tokens: 3,
      reasoning_tokens: 1,
    });
  });

  test("surfaces reasoning items as thinking blocks", () => {
    const body = sse(
      [
        "response.reasoning_summary_text.delta",
        {
          type: "response.reasoning_summary_text.delta",
          output_index: 0,
          delta: "because",
        },
      ],
      [
        "response.output_text.delta",
        { type: "response.output_text.delta", output_index: 1, delta: "so" },
      ],
    );

    expect(assembleResponse(URL, SSE, body)?.content).toEqual([
      { type: "thinking", thinking: "because" },
      { type: "text", text: "so" },
    ]);
  });

  test("assembles function_call arguments from their deltas", () => {
    const body = sse(
      [
        "response.output_item.added",
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", call_id: "call_1", name: "read" },
        },
      ],
      [
        "response.function_call_arguments.delta",
        {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: '{"path"',
        },
      ],
      [
        "response.function_call_arguments.delta",
        {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: ':"a.ts"}',
        },
      ],
    );

    expect(assembleResponse(URL, SSE, body)?.content).toEqual([
      { type: "tool_use", id: "call_1", name: "read", input: { path: "a.ts" } },
    ]);
  });

  test("prefers the authoritative item on output_item.done", () => {
    const body = sse(
      [
        "response.output_text.delta",
        { type: "response.output_text.delta", output_index: 0, delta: "par" },
      ],
      [
        "response.output_item.done",
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            content: [{ type: "output_text", text: "partial then whole" }],
          },
        },
      ],
    );

    expect(assembleResponse(URL, SSE, body)?.content).toEqual([
      { type: "text", text: "partial then whole" },
    ]);
  });

  test("single JSON response reads the output array", () => {
    const body = JSON.stringify({
      object: "response",
      model: "gpt-x",
      status: "completed",
      output: [
        { type: "reasoning", summary: [{ type: "summary_text", text: "why" }] },
        { type: "message", content: [{ type: "output_text", text: "hi" }] },
        {
          type: "function_call",
          call_id: "c1",
          name: "read",
          arguments: '{"path":"a.ts"}',
        },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    });

    expect(assembleResponse(URL, JSON_CT, body)?.content).toEqual([
      { type: "thinking", thinking: "why" },
      { type: "text", text: "hi" },
      { type: "tool_use", id: "c1", name: "read", input: { path: "a.ts" } },
    ]);
  });
});

describe("grammar dispatch", () => {
  test("a Gemini body returns undefined rather than throwing", () => {
    const body = JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: "hi" }], role: "model" },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 },
    });
    expect(assembleResponse(URL, JSON_CT, body)).toBeUndefined();
  });

  test("an HTML error page returns undefined rather than throwing", () => {
    const body = "<html><head><title>502 Bad Gateway</title></head></html>";
    expect(assembleResponse(URL, "text/html", body)).toBeUndefined();
  });

  test("an empty body returns undefined", () => {
    expect(assembleResponse(URL, SSE, "")).toBeUndefined();
  });

  test("an SSE body of only [DONE] returns undefined", () => {
    expect(assembleResponse(URL, SSE, "data: [DONE]\n\n")).toBeUndefined();
  });

  test("detects SSE from the body when the content type does not say so", () => {
    const body = dataOnly({ choices: [{ delta: { content: "hi" } }] });
    expect(assembleResponse(URL, "", body)?.content).toEqual([
      { type: "text", text: "hi" },
    ]);
  });
});
