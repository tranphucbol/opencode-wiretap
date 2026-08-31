// Shared types between the Express backend and the React frontend.

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

/** The full shape of one captured `*.json` log file. */
export interface CapturedRequest {
  timestamp: string;
  url: string;
  body: RequestBody;
}

/** Session summary for the left pane (cheap to compute). */
export interface SessionSummary {
  id: string;
  fileCount: number;
  lastModified: string; // ISO
  title: string | null; // from OpenCode DB; null if not found
  parentId: string | null; // set for sub-agent/child sessions
  directory: string | null; // project directory of the session
}

/** Request summary for the middle pane (one row per file). */
export interface RequestSummary {
  file: string;
  seq: number;
  timestamp: string;
  model: string | null;
  messageCount: number;
  size: number; // bytes
}

export interface ApiError {
  error: string;
}
