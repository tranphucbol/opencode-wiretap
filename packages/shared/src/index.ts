// Public surface of @wiretap/shared: the wire types exchanged between
// the plugin (writer), the API server (reader) and the web UI, plus the
// provider-shape normalizers both the server and the UI rely on, plus the
// response assemblers the plugin runs at stream end.

export type {
  ContentBlock,
  Message,
  ResponseInputItem,
  SystemBlock,
  RequestBody,
  CapturedRequest,
  CapturedResponse,
  AssembledMessage,
  Usage,
  SessionSummary,
  RequestSummary,
  ApiError,
} from "./types.ts";

export { getRequestMessages, getRequestSystem } from "./normalize.ts";

export { parseSseEvents, parseSseData, type SseEvent } from "./sse.ts";
export { assembleResponse } from "./assemble.ts";

export {
  billableTokens,
  contextTokens,
  effectivePrice,
  computeCost,
  sumCosts,
  type ModelPrice,
  type PriceTier,
  type ModelPricing,
  type UsageConvention,
  type BillableTokens,
  type CostBreakdown,
} from "./cost.ts";
