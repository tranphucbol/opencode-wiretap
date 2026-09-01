// Turn a raw provider response body back into a message.
//
// The contract for everything in here: recognise the grammar or return
// `undefined`. Never throw. A capture is written from a `catch`-free detached
// promise in the plugin, and a body that surprises us — an HTML error page, a
// Gemini payload, a provider mid-outage — must degrade to "raw only" rather
// than cost the caller its response.
//
// Assembly is tolerant of truncation by construction: every assembler folds
// events into an accumulator, so a stream cut halfway yields the blocks that
// arrived and drops nothing else.

import type { AssembledMessage, ContentBlock, Usage } from "./types.ts";
import { parseSseEvents, parseSseData, type SseEvent } from "./sse.ts";
import { parseJsonLoose } from "./json.ts";

type Json = Record<string, unknown>;

function obj(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function arr(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Drop keys whose value is undefined so the written JSON stays tight. */
function compact<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

// --- Anthropic Messages ------------------------------------------------------

/**
 * A block under construction. Anthropic and OpenAI both stream tool arguments
 * as JSON text fragments, so the parse has to wait until the stream stops.
 */
interface PendingBlock {
  block: ContentBlock;
  json?: string;
}

function finishBlocks(pending: PendingBlock[]): ContentBlock[] {
  return pending.map(({ block, json }) => {
    if (json === undefined) return block;
    return { ...block, input: parseJsonLoose(json) };
  });
}

function anthropicUsage(usage: Json | undefined): Usage | undefined {
  if (!usage) return undefined;
  return compact<Usage>({
    input_tokens: num(usage.input_tokens),
    output_tokens: num(usage.output_tokens),
    cache_read_input_tokens: num(usage.cache_read_input_tokens),
    cache_creation_input_tokens: num(usage.cache_creation_input_tokens),
  });
}

function assembleAnthropicStream(events: SseEvent[]): AssembledMessage {
  const pending: PendingBlock[] = [];
  const message: AssembledMessage = { content: [] };
  let usage: Usage | undefined;

  for (const event of events) {
    const data = obj(parseSseData(event.data));
    if (!data) continue;
    const type = event.event ?? str(data.type);

    switch (type) {
      case "message_start": {
        const start = obj(data.message);
        if (!start) break;
        message.model = str(start.model);
        message.role = str(start.role);
        usage = anthropicUsage(obj(start.usage));
        break;
      }
      case "content_block_start": {
        const index = num(data.index) ?? pending.length;
        const raw = obj(data.content_block);
        if (!raw) break;
        pending[index] = {
          block: { ...raw, type: str(raw.type) ?? "unknown" },
          // tool_use input arrives as input_json_delta fragments; the `input`
          // on the start event is an empty placeholder.
          json: raw.type === "tool_use" ? "" : undefined,
        };
        break;
      }
      case "content_block_delta": {
        const index = num(data.index) ?? 0;
        const delta = obj(data.delta);
        const target = pending[index];
        if (!delta || !target) break;
        if (typeof delta.text === "string") {
          target.block.text = (target.block.text ?? "") + delta.text;
        }
        if (typeof delta.thinking === "string") {
          target.block.thinking =
            (target.block.thinking ?? "") + delta.thinking;
        }
        if (typeof delta.partial_json === "string") {
          target.json = (target.json ?? "") + delta.partial_json;
        }
        if (typeof delta.signature === "string") {
          target.block.signature = delta.signature;
        }
        break;
      }
      case "message_delta": {
        const delta = obj(data.delta);
        if (delta && "stop_reason" in delta) {
          message.stop_reason = (delta.stop_reason as string | null) ?? null;
        }
        const extra = anthropicUsage(obj(data.usage));
        if (extra) usage = { ...usage, ...extra };
        break;
      }
    }
  }

  // Indices are dense in practice, but a truncated stream can leave holes.
  message.content = finishBlocks(pending.filter(Boolean));
  message.usage = usage;
  return message;
}

function assembleAnthropicJson(body: Json): AssembledMessage {
  const content = (arr(body.content) ?? [])
    .map(obj)
    .filter((b): b is Json => b !== undefined)
    .map((b) => ({ ...b, type: str(b.type) ?? "unknown" }) as ContentBlock);

  return {
    model: str(body.model),
    role: str(body.role),
    content,
    stop_reason: (body.stop_reason as string | null | undefined) ?? undefined,
    usage: anthropicUsage(obj(body.usage)),
  };
}

// --- OpenAI Chat Completions -------------------------------------------------

function openaiChatUsage(usage: Json | undefined): Usage | undefined {
  if (!usage) return undefined;
  const promptDetails = obj(usage.prompt_tokens_details);
  const completionDetails = obj(usage.completion_tokens_details);
  return compact<Usage>({
    input_tokens: num(usage.prompt_tokens),
    output_tokens: num(usage.completion_tokens),
    cache_read_input_tokens: num(promptDetails?.cached_tokens),
    reasoning_tokens: num(completionDetails?.reasoning_tokens),
  });
}

/**
 * Fold one `delta` (streaming) or `message` (single response) into the block
 * accumulator. Chat Completions keeps text, reasoning and tool calls in
 * parallel fields, and tool calls are merged by their `index`.
 */
function foldChatDelta(
  delta: Json,
  text: { value: string; seen: boolean },
  thinking: { value: string; seen: boolean },
  tools: Map<number, PendingBlock>,
): void {
  const content = delta.content;
  if (typeof content === "string" && content.length > 0) {
    text.value += content;
    text.seen = true;
  }
  // Non-standard but widely emitted by reasoning models behind this API.
  const reasoning = delta.reasoning_content ?? delta.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    thinking.value += reasoning;
    thinking.seen = true;
  }

  for (const entry of arr(delta.tool_calls) ?? []) {
    const call = obj(entry);
    if (!call) continue;
    const index = num(call.index) ?? tools.size;
    let target = tools.get(index);
    if (!target) {
      target = { block: { type: "tool_use" }, json: "" };
      tools.set(index, target);
    }
    const id = str(call.id);
    if (id) target.block.id = id;
    const fn = obj(call.function);
    if (!fn) continue;
    const name = str(fn.name);
    if (name) target.block.name = name;
    const args = str(fn.arguments);
    if (args) target.json = (target.json ?? "") + args;
  }
}

function chatBlocks(
  text: { value: string; seen: boolean },
  thinking: { value: string; seen: boolean },
  tools: Map<number, PendingBlock>,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  // Reasoning precedes the answer it produced.
  if (thinking.seen)
    blocks.push({ type: "thinking", thinking: thinking.value });
  if (text.seen) blocks.push({ type: "text", text: text.value });
  const ordered = [...tools.entries()].sort((a, b) => a[0] - b[0]);
  blocks.push(...finishBlocks(ordered.map(([, v]) => v)));
  return blocks;
}

function assembleOpenAiChatStream(events: SseEvent[]): AssembledMessage {
  const text = { value: "", seen: false };
  const thinking = { value: "", seen: false };
  const tools = new Map<number, PendingBlock>();
  const message: AssembledMessage = { content: [], role: "assistant" };
  let usage: Usage | undefined;

  for (const event of events) {
    const data = obj(parseSseData(event.data));
    if (!data) continue;

    const model = str(data.model);
    if (model) message.model = model;

    const choice = obj(arr(data.choices)?.[0]);
    if (choice) {
      const delta = obj(choice.delta);
      if (delta) foldChatDelta(delta, text, thinking, tools);
      const finish = choice.finish_reason;
      if (typeof finish === "string") message.stop_reason = finish;
    }

    // Sent once at the end when the caller asked for stream usage.
    const extra = openaiChatUsage(obj(data.usage));
    if (extra) usage = { ...usage, ...extra };
  }

  message.content = chatBlocks(text, thinking, tools);
  message.usage = usage;
  return message;
}

function assembleOpenAiChatJson(body: Json): AssembledMessage {
  const text = { value: "", seen: false };
  const thinking = { value: "", seen: false };
  const tools = new Map<number, PendingBlock>();

  const choice = obj(arr(body.choices)?.[0]);
  const msg = obj(choice?.message);
  if (msg) foldChatDelta(msg, text, thinking, tools);

  const finish = choice?.finish_reason;
  return {
    model: str(body.model),
    role: str(msg?.role) ?? "assistant",
    content: chatBlocks(text, thinking, tools),
    stop_reason: typeof finish === "string" ? finish : undefined,
    usage: openaiChatUsage(obj(body.usage)),
  };
}

// --- OpenAI Responses --------------------------------------------------------

function openaiResponsesUsage(usage: Json | undefined): Usage | undefined {
  if (!usage) return undefined;
  const inputDetails = obj(usage.input_tokens_details);
  const outputDetails = obj(usage.output_tokens_details);
  return compact<Usage>({
    input_tokens: num(usage.input_tokens),
    output_tokens: num(usage.output_tokens),
    cache_read_input_tokens: num(inputDetails?.cached_tokens),
    reasoning_tokens: num(outputDetails?.reasoning_tokens),
  });
}

/** Convert one completed `output[]` item into blocks. */
function responsesItemBlocks(item: Json): ContentBlock[] {
  switch (str(item.type)) {
    case "message":
      return (arr(item.content) ?? [])
        .map(obj)
        .filter((c): c is Json => c !== undefined)
        .map((c) => ({ type: "text", text: str(c.text) ?? "" }));
    case "reasoning": {
      const summary = (arr(item.summary) ?? [])
        .map(obj)
        .map((s) => str(s?.text) ?? "")
        .join("\n");
      return [
        { type: "thinking", thinking: summary || "(encrypted reasoning)" },
      ];
    }
    case "function_call":
      return [
        {
          type: "tool_use",
          id: str(item.call_id) ?? str(item.id),
          name: str(item.name),
          input: parseJsonLoose(str(item.arguments)),
        },
      ];
    default:
      return [{ ...item, type: str(item.type) ?? "unknown" } as ContentBlock];
  }
}

function assembleOpenAiResponsesStream(events: SseEvent[]): AssembledMessage {
  // Keyed by output_index so items stay in the order the API assigned them.
  const items = new Map<number, PendingBlock>();
  const message: AssembledMessage = { content: [], role: "assistant" };
  let usage: Usage | undefined;

  const slot = (index: number, seed: () => PendingBlock): PendingBlock => {
    let found = items.get(index);
    if (!found) {
      found = seed();
      items.set(index, found);
    }
    return found;
  };

  for (const event of events) {
    const data = obj(parseSseData(event.data));
    if (!data) continue;
    const type = event.event ?? str(data.type);
    const index = num(data.output_index) ?? 0;

    switch (type) {
      case "response.created":
      case "response.in_progress":
      case "response.completed":
      case "response.incomplete":
      case "response.failed": {
        const response = obj(data.response);
        if (!response) break;
        message.model = str(response.model) ?? message.model;
        message.stop_reason = str(response.status) ?? message.stop_reason;
        const extra = openaiResponsesUsage(obj(response.usage));
        if (extra) usage = { ...usage, ...extra };
        break;
      }
      case "response.output_item.added": {
        const item = obj(data.item);
        if (!item) break;
        if (str(item.type) === "function_call") {
          slot(index, () => ({
            block: {
              type: "tool_use",
              id: str(item.call_id) ?? str(item.id),
              name: str(item.name),
            },
            json: "",
          }));
        }
        break;
      }
      case "response.output_text.delta": {
        const target = slot(index, () => ({
          block: { type: "text", text: "" },
        }));
        target.block.text = (target.block.text ?? "") + (str(data.delta) ?? "");
        break;
      }
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta": {
        const target = slot(index, () => ({
          block: { type: "thinking", thinking: "" },
        }));
        target.block.thinking =
          (target.block.thinking ?? "") + (str(data.delta) ?? "");
        break;
      }
      case "response.function_call_arguments.delta": {
        const target = slot(index, () => ({
          block: { type: "tool_use" },
          json: "",
        }));
        target.json = (target.json ?? "") + (str(data.delta) ?? "");
        break;
      }
      case "response.output_item.done": {
        // The done event carries the authoritative item; prefer it over the
        // deltas we accumulated, which may have been cut short.
        const item = obj(data.item);
        if (!item) break;
        const blocks = responsesItemBlocks(item);
        if (blocks.length === 1) {
          items.set(index, { block: blocks[0] });
        } else if (blocks.length > 1) {
          // A message item can hold several content parts; flatten them into
          // fractional slots so ordering against other items is preserved.
          items.delete(index);
          blocks.forEach((block, i) =>
            items.set(index + i / (blocks.length + 1), { block }),
          );
        }
        break;
      }
    }
  }

  const ordered = [...items.entries()].sort((a, b) => a[0] - b[0]);
  message.content = finishBlocks(ordered.map(([, v]) => v));
  message.usage = usage;
  return message;
}

function assembleOpenAiResponsesJson(body: Json): AssembledMessage {
  const content = (arr(body.output) ?? [])
    .map(obj)
    .filter((i): i is Json => i !== undefined)
    .flatMap(responsesItemBlocks);

  return {
    model: str(body.model),
    role: "assistant",
    content,
    stop_reason: str(body.status),
    usage: openaiResponsesUsage(obj(body.usage)),
  };
}

// --- Dispatch ----------------------------------------------------------------

const ANTHROPIC_EVENTS = new Set([
  "message_start",
  "content_block_start",
  "content_block_delta",
  "message_delta",
  "message_stop",
]);

function looksLikeSse(contentType: string, text: string): boolean {
  if (contentType.toLowerCase().includes("text/event-stream")) return true;
  const head = text.slice(0, 64).trimStart();
  return head.startsWith("data:") || head.startsWith("event:");
}

function assembleSse(text: string): AssembledMessage | undefined {
  const events = parseSseEvents(text);
  if (events.length === 0) return undefined;

  for (const event of events) {
    const data = obj(parseSseData(event.data));
    const type = event.event ?? str(data?.type);

    if (type && ANTHROPIC_EVENTS.has(type)) {
      return assembleAnthropicStream(events);
    }
    if (type && type.startsWith("response.")) {
      return assembleOpenAiResponsesStream(events);
    }
    if (data && arr(data.choices)) {
      return assembleOpenAiChatStream(events);
    }
  }
  return undefined;
}

function assembleJson(text: string): AssembledMessage | undefined {
  let body: Json | undefined;
  try {
    body = obj(JSON.parse(text));
  } catch {
    return undefined;
  }
  if (!body) return undefined;

  if (body.type === "message" && arr(body.content)) {
    return assembleAnthropicJson(body);
  }
  if (arr(body.choices)) {
    return assembleOpenAiChatJson(body);
  }
  if (body.object === "response" && arr(body.output)) {
    return assembleOpenAiResponsesJson(body);
  }
  return undefined;
}

/**
 * Reduce a captured response body to an `AssembledMessage`, or `undefined`
 * when the grammar is not one of Anthropic Messages, OpenAI Chat Completions
 * or OpenAI Responses.
 *
 * `url` is accepted for future provider disambiguation; dispatch is currently
 * decided by body shape alone, which survives proxies and gateways rewriting
 * the path.
 */
export function assembleResponse(
  _url: string,
  contentType: string,
  text: string,
): AssembledMessage | undefined {
  if (!text) return undefined;
  try {
    const message = looksLikeSse(contentType, text)
      ? assembleSse(text)
      : assembleJson(text);
    // An assembler that recognised the grammar but found nothing in it is
    // still more informative than "unknown" — but an empty, usage-free,
    // model-less result is indistinguishable from a miss, so drop it.
    if (!message) return undefined;
    if (
      message.content.length === 0 &&
      !message.usage &&
      !message.model &&
      message.stop_reason == null
    ) {
      return undefined;
    }
    return message;
  } catch {
    return undefined;
  }
}
