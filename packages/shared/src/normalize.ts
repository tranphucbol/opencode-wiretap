import type { ContentBlock, Message, RequestBody } from "./types.ts";
import { parseJsonLoose } from "./json.ts";

function normalizeContent(
  content: string | ContentBlock[] | undefined,
): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.map((block) => {
    if (block.type === "input_text" || block.type === "output_text") {
      return { ...block, type: "text", text: block.text ?? "" };
    }
    if (block.type === "summary_text") {
      return { ...block, type: "thinking", thinking: block.text ?? "" };
    }
    return block;
  });
}

/** Normalize Anthropic Messages and OpenAI Responses payloads into one UI shape. */
export function getRequestMessages(body: RequestBody | undefined): Message[] {
  if (!body) return [];
  if (Array.isArray(body.messages)) return body.messages;
  if (!Array.isArray(body.input)) return [];

  return body.input.map((item): Message => {
    if (item.role) {
      return { role: item.role, content: normalizeContent(item.content) };
    }
    if (item.type === "reasoning") {
      const content = normalizeContent(item.summary);
      return {
        role: "assistant",
        content:
          content.length > 0
            ? content
            : [{ type: "thinking", thinking: "(encrypted reasoning)" }],
      };
    }
    if (item.type === "function_call") {
      return {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: item.call_id,
            name: item.name,
            input: parseJsonLoose(item.arguments),
          },
        ],
      };
    }
    if (item.type === "function_call_output") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: item.call_id,
            content: item.output,
          },
        ],
      };
    }
    return {
      role: "unknown",
      content: [{ type: item.type ?? "unknown", ...item }],
    };
  });
}

export function getRequestSystem(body: RequestBody | undefined) {
  return body?.system ?? body?.instructions;
}
