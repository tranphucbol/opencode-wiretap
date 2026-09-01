import { describe, expect, test } from "bun:test";
import {
  billableTokens,
  computeCost,
  contextTokens,
  effectivePrice,
  sumCosts,
} from "./cost.ts";
import type { ModelPricing } from "./cost.ts";

// Real rates, taken from OpenCode's models.dev cache.
const SONNET: ModelPricing = {
  base: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
};

const GPT: ModelPricing = {
  base: { input: 2, output: 12, cache_read: 0.2, cache_write: 2.5 },
  tiers: [{ size: 272_000, price: { input: 4, output: 18, cache_read: 0.4 } }],
};

describe("billableTokens", () => {
  test("treats Anthropic counters as disjoint", () => {
    const usage = {
      input_tokens: 1_000,
      output_tokens: 500,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 2_000,
    };
    expect(billableTokens(usage, "disjoint")).toEqual({
      input: 1_000,
      output: 500,
      cacheRead: 10_000,
      cacheWrite: 2_000,
    });
  });

  test("subtracts cached tokens out of OpenAI's input total", () => {
    // OpenAI reports cached_tokens as a subset of input_tokens. Charging the
    // full input at the input rate *and* again at the cache rate is the whole
    // bug this convention exists to prevent.
    const usage = {
      input_tokens: 10_000,
      output_tokens: 500,
      cache_read_input_tokens: 8_000,
    };
    expect(billableTokens(usage, "cached-within-input")).toEqual({
      input: 2_000,
      output: 500,
      cacheRead: 8_000,
      cacheWrite: 0,
    });
  });

  test("never reports negative input when counters disagree", () => {
    const usage = { input_tokens: 100, cache_read_input_tokens: 900 };
    expect(billableTokens(usage, "cached-within-input").input).toBe(0);
  });

  test("ignores reasoning tokens, which are already inside output", () => {
    const usage = { output_tokens: 1_000, reasoning_tokens: 800 };
    expect(billableTokens(usage, "cached-within-input").output).toBe(1_000);
  });

  test("treats absent counters as zero", () => {
    expect(billableTokens({}, "disjoint")).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
});

describe("contextTokens", () => {
  test("counts the whole input side under either convention", () => {
    const anthropic = {
      input_tokens: 1_000,
      cache_read_input_tokens: 200_000,
      cache_creation_input_tokens: 5_000,
    };
    expect(contextTokens(anthropic, "disjoint")).toBe(206_000);

    const openai = { input_tokens: 206_000, cache_read_input_tokens: 200_000 };
    expect(contextTokens(openai, "cached-within-input")).toBe(206_000);
  });

  test("excludes output tokens", () => {
    expect(contextTokens({ output_tokens: 9_999 }, "disjoint")).toBe(0);
  });
});

describe("effectivePrice", () => {
  test("uses base rates below the threshold", () => {
    expect(effectivePrice(GPT, 271_999).input).toBe(2);
  });

  test("switches at the threshold, inclusive", () => {
    expect(effectivePrice(GPT, 272_000).input).toBe(4);
  });

  test("takes the highest tier reached", () => {
    const laddered: ModelPricing = {
      base: { input: 1 },
      tiers: [
        { size: 100, price: { input: 2 } },
        { size: 200, price: { input: 3 } },
      ],
    };
    expect(effectivePrice(laddered, 250).input).toBe(3);
  });

  test("falls back to base when there are no tiers", () => {
    expect(effectivePrice(SONNET, 10_000_000)).toBe(SONNET.base);
  });
});

describe("computeCost", () => {
  test("prices a disjoint request bucket by bucket", () => {
    const cost = computeCost(
      {
        input_tokens: 1_000,
        output_tokens: 500,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 2_000,
      },
      SONNET,
      "disjoint",
    );
    expect(cost.input).toBeCloseTo(0.003, 10);
    expect(cost.output).toBeCloseTo(0.0075, 10);
    expect(cost.cacheRead).toBeCloseTo(0.003, 10);
    expect(cost.cacheWrite).toBeCloseTo(0.0075, 10);
    expect(cost.total).toBeCloseTo(0.021, 10);
  });

  test("does not double-charge OpenAI cached input", () => {
    const usage = {
      input_tokens: 10_000,
      output_tokens: 1_000,
      cache_read_input_tokens: 8_000,
    };
    const right = computeCost(usage, GPT, "cached-within-input");
    const wrong = computeCost(usage, GPT, "disjoint");
    // 2k fresh @ $2 + 1k out @ $12 + 8k cached @ $0.2
    expect(right.total).toBeCloseTo(0.004 + 0.012 + 0.0016, 10);
    expect(wrong.total).toBeGreaterThan(right.total);
  });

  test("applies the long-context tier off the full prompt size", () => {
    const usage = { input_tokens: 300_000, output_tokens: 1_000 };
    const cost = computeCost(usage, GPT, "cached-within-input");
    expect(cost.input).toBeCloseTo((300_000 * 4) / 1e6, 10);
    expect(cost.output).toBeCloseTo((1_000 * 18) / 1e6, 10);
  });

  test("counts a missing rate as free rather than as NaN", () => {
    const noCacheWrite: ModelPricing = { base: { input: 5, output: 30 } };
    const cost = computeCost(
      { input_tokens: 1_000, cache_creation_input_tokens: 4_000 },
      noCacheWrite,
      "disjoint",
    );
    expect(cost.cacheWrite).toBe(0);
    expect(cost.total).toBeCloseTo(0.005, 10);
  });

  test("prices an empty usage at zero", () => {
    expect(computeCost({}, SONNET, "disjoint").total).toBe(0);
  });
});

describe("sumCosts", () => {
  test("adds bucket by bucket", () => {
    const a = computeCost({ input_tokens: 1_000 }, SONNET, "disjoint");
    const b = computeCost({ output_tokens: 1_000 }, SONNET, "disjoint");
    const total = sumCosts([a, b]);
    expect(total?.input).toBeCloseTo(0.003, 10);
    expect(total?.output).toBeCloseTo(0.015, 10);
    expect(total?.total).toBeCloseTo(0.018, 10);
  });

  test("returns null for nothing, distinguishing it from a priced zero", () => {
    expect(sumCosts([])).toBeNull();
    expect(sumCosts([computeCost({}, SONNET, "disjoint")])?.total).toBe(0);
  });
});
