// Cost arithmetic. Pure: no I/O, no price table, no provider knowledge.
// The table itself is loaded by the server (see packages/server/src/pricing.ts),
// because it lives on disk and this module is also bundled into the plugin.

import type { Usage } from "./types.ts";

/**
 * Published rates, in USD per *million* tokens — the unit models.dev uses.
 * Every field is optional: a provider that does not bill for caching simply
 * omits those rates, and an omitted rate contributes nothing to the total.
 */
export interface ModelPrice {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

/** A rate sheet that takes over once the request's context grows past `size`. */
export interface PriceTier {
  /** Context-token threshold, inclusive lower bound. */
  size: number;
  price: ModelPrice;
}

/** Everything needed to price one model. */
export interface ModelPricing {
  base: ModelPrice;
  /** Long-context tiers, e.g. OpenAI's 272k step. Ascending by `size`. */
  tiers?: PriceTier[];
}

/**
 * How a provider counts `input_tokens` relative to its cache counters.
 *
 * - `disjoint` — Anthropic. `input_tokens`, `cache_read_input_tokens` and
 *   `cache_creation_input_tokens` partition the prompt; they sum to it.
 * - `cached-within-input` — OpenAI, both Chat Completions and Responses.
 *   `cached_tokens` is a *subset* of `prompt_tokens`/`input_tokens`, so the
 *   cached portion must be subtracted before charging the full input rate or
 *   it gets billed twice.
 *
 * This is not cosmetic. Getting it backwards inflates a cache-heavy OpenAI
 * request by roughly the cache-hit ratio.
 */
export type UsageConvention = "disjoint" | "cached-within-input";

/** Token counts reduced to disjoint buckets, each billed at one rate. */
export interface BillableTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Per-bucket cost in USD, plus their sum. */
export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

const n = (v: number | undefined): number => (typeof v === "number" ? v : 0);

/**
 * Split reported usage into non-overlapping buckets.
 *
 * `reasoning_tokens` is deliberately ignored: every provider that reports it
 * counts it *inside* `output_tokens` and bills it at the output rate, so
 * adding it would double-charge.
 */
export function billableTokens(
  usage: Usage,
  convention: UsageConvention,
): BillableTokens {
  const cacheRead = n(usage.cache_read_input_tokens);
  const cacheWrite = n(usage.cache_creation_input_tokens);
  const rawInput = n(usage.input_tokens);
  const input =
    convention === "cached-within-input"
      ? Math.max(0, rawInput - cacheRead)
      : rawInput;
  return { input, output: n(usage.output_tokens), cacheRead, cacheWrite };
}

/**
 * Total prompt size, used to pick a long-context tier. This is the whole
 * input side including cached tokens, which is what providers threshold on.
 */
export function contextTokens(
  usage: Usage,
  convention: UsageConvention,
): number {
  const b = billableTokens(usage, convention);
  return b.input + b.cacheRead + b.cacheWrite;
}

/** The rate sheet in force for a given context size: the highest tier reached. */
export function effectivePrice(
  pricing: ModelPricing,
  context: number,
): ModelPrice {
  let price = pricing.base;
  for (const tier of pricing.tiers ?? []) {
    if (context >= tier.size) price = tier.price;
  }
  return price;
}

/** Cost of one request, in USD. */
export function computeCost(
  usage: Usage,
  pricing: ModelPricing,
  convention: UsageConvention,
): CostBreakdown {
  const tokens = billableTokens(usage, convention);
  const price = effectivePrice(
    pricing,
    tokens.input + tokens.cacheRead + tokens.cacheWrite,
  );
  const per = (count: number, rate: number | undefined) =>
    (count * n(rate)) / 1_000_000;

  const input = per(tokens.input, price.input);
  const output = per(tokens.output, price.output);
  const cacheRead = per(tokens.cacheRead, price.cache_read);
  const cacheWrite = per(tokens.cacheWrite, price.cache_write);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

/** Sum a set of breakdowns. Returns null when there is nothing to sum. */
export function sumCosts(costs: CostBreakdown[]): CostBreakdown | null {
  if (costs.length === 0) return null;
  const out: CostBreakdown = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  for (const c of costs) {
    out.input += c.input;
    out.output += c.output;
    out.cacheRead += c.cacheRead;
    out.cacheWrite += c.cacheWrite;
    out.total += c.total;
  }
  return out;
}
