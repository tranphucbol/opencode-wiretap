// Shared types between the Express backend and the React frontend.

import type { CostBreakdown } from "./cost.ts";

/** A captured content block inside a message (Anthropic Messages API). */
export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  // tool_use
  name?: string;
  input?: unknown;
  id?: string;
  // tool_result
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

export interface Message {
  role: string;
  content: string | ContentBlock[];
}

/** Captured OpenAI Responses API input item. */
export interface ResponseInputItem {
  role?: string;
  content?: string | ContentBlock[];
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: unknown;
  summary?: ContentBlock[];
  [key: string]: unknown;
}

export interface SystemBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** The `body` field of a captured request = full Messages API payload. */
export interface RequestBody {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  thinking?: { type?: string; budget_tokens?: number };
  instructions?: string;
  system?: string | SystemBlock[];
  messages?: Message[];
  input?: ResponseInputItem[];
  tools?: Array<{
    name?: string;
    description?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Token accounting, normalized across providers. */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
}

/**
 * A provider response reduced to the same block vocabulary the request side
 * uses, so the viewer renders both halves through one component.
 */
export interface AssembledMessage {
  model?: string;
  role?: string;
  content: ContentBlock[];
  stop_reason?: string | null;
  usage?: Usage;
}

/**
 * What came back for a captured request. Written into the same file as the
 * request once the response stream ends.
 */
export interface CapturedResponse {
  status: number;
  /** Allowlisted response headers — never the whole set. */
  headers: Record<string, string>;
  /** When the response headers arrived. */
  startedAt: string;
  /** When the body stream ended. */
  completedAt: string;
  /** Request sent → headers arrived. */
  ttfbMs: number;
  /** Headers arrived → stream ended. */
  durationMs: number;
  /**
   * Stream completion only. Whether the stored raw copy was capped is
   * `raw.truncated`, deliberately not folded in here: a fully assembled
   * message should not look damaged just because its raw copy was elided.
   */
  state: "complete" | "aborted" | "error";
  error?: string;
  /** Absent when the body grammar is not one we know how to assemble. */
  message?: AssembledMessage;
  raw?: {
    encoding: "sse" | "json" | "text";
    text: string;
    /** Byte length of the *full* body, even when `text` is a prefix. */
    bytes: number;
    truncated: boolean;
  };
}

/** The full shape of one captured `*.json` log file. */
export interface CapturedRequest {
  timestamp: string;
  url: string;
  body: RequestBody;
  /**
   * Absent while the call is in flight, and on every capture written before
   * response capture existed. Readers must treat it as optional forever.
   */
  response?: CapturedResponse;
}

/** Session summary for the left pane (cheap to compute). */
export interface SessionSummary {
  id: string;
  fileCount: number;
  lastModified: string; // ISO
  title: string | null; // from OpenCode DB; null if not found
  parentId: string | null; // set for sub-agent/child sessions
  directory: string | null; // project directory of the session
  /**
   * Total USD across the session's captures. `null` means *not costed yet* —
   * the background pass has not reached this session — and is distinct from
   * `0`, which means costed and nothing in it was priceable.
   */
  cost: number | null;
}

/** Request summary for the middle pane (one row per file). */
export interface RequestSummary {
  file: string;
  seq: number;
  timestamp: string;
  model: string | null;
  messageCount: number;
  size: number; // bytes
  /** HTTP status of the response; null when no response was captured. */
  status: number | null;
  /** Output tokens the model reported; null when unknown. */
  outputTokens: number | null;
  /**
   * USD cost, computed at read time from reported usage and the local price
   * table. Null when there is no usage to price or no rates for the model —
   * never 0, so "free" stays distinguishable from "unknown".
   */
  cost: CostBreakdown | null;
}

export interface ApiError {
  error: string;
}
