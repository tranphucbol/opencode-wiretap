// Public surface of @wiretap/shared: the wire types exchanged between
// the plugin (writer), the API server (reader) and the web UI, plus the
// provider-shape normalizers both the server and the UI rely on.

export type {
  ContentBlock,
  Message,
  ResponseInputItem,
  SystemBlock,
  RequestBody,
  CapturedRequest,
  SessionSummary,
  RequestSummary,
  ApiError,
} from "./types.ts";

export { getRequestMessages, getRequestSystem } from "./normalize.ts";
