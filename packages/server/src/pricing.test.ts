import { describe, expect, test } from "bun:test";
import { buildCatalogue, resolvePricing } from "./pricing.ts";

// A miniature models.json, shaped exactly like OpenCode's cache.
const RAW = {
  anthropic: {
    models: {
      "claude-sonnet-4-6": {
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
      "claude-haiku-4-5": {
        cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
      },
      "claude-opus-5": { cost: { input: 5, output: 25 } },
    },
  },
  openai: {
    models: {
      "gpt-5.6-terra": {
        cost: { input: 2, output: 12, cache_read: 0.2, cache_write: 2.5 },
        tiers: [
          {
            input: 4,
            output: 18,
            cache_read: 0.4,
            tier: { type: "context", size: 272_000 },
          },
        ],
      },
      "only-here": { cost: { input: 9, output: 9 } },
    },
  },
  // A knock-off provider that lists the same model id at a different price.
  venice: {
    models: { "claude-opus-5": { cost: { input: 6, output: 30 } } },
  },
  broken: {
    models: { "no-rates": { cost: {} }, "no-cost": {} },
  },
};

const cat = buildCatalogue(RAW);
const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const CODEX = "https://chatgpt.com/backend-api/codex/responses";

describe("buildCatalogue", () => {
  test("indexes models by provider/model", () => {
    expect(cat.byQualified.get("anthropic/claude-sonnet-4-6")?.base.input).toBe(
      3,
    );
    expect(cat.byQualified.get("venice/claude-opus-5")?.base.input).toBe(6);
  });

  test("keeps a bare id only when every provider agrees on its price", () => {
    // Defined once → safe to resolve bare.
    expect(cat.byBareUnambiguous.has("claude-sonnet-4-6")).toBe(true);
    // Defined by anthropic ($5) and venice ($6) → refuse to guess.
    expect(cat.byBareUnambiguous.has("claude-opus-5")).toBe(false);
  });

  test("drops models with no usable rates rather than pricing them at zero", () => {
    expect(cat.byQualified.has("broken/no-rates")).toBe(false);
    expect(cat.byQualified.has("broken/no-cost")).toBe(false);
  });

  test("reads context tiers", () => {
    const tiers = cat.byQualified.get("openai/gpt-5.6-terra")?.tiers;
    expect(tiers).toEqual([
      {
        size: 272_000,
        price: {
          input: 4,
          output: 18,
          cache_read: 0.4,
          cache_write: undefined,
        },
      },
    ]);
  });

  test("ignores tiers of an unrecognised type", () => {
    const odd = buildCatalogue({
      p: {
        models: {
          m: {
            cost: { input: 1 },
            tiers: [{ input: 99, tier: { type: "phase-of-moon", size: 1 } }],
          },
        },
      },
    });
    expect(odd.byQualified.get("p/m")?.tiers).toBeUndefined();
  });

  test("survives a malformed catalogue", () => {
    expect(buildCatalogue(null).byQualified.size).toBe(0);
    expect(buildCatalogue({ p: null }).byQualified.size).toBe(0);
  });
});

describe("resolvePricing", () => {
  test("resolves a known host and model", () => {
    const r = resolvePricing(cat, ANTHROPIC, "claude-sonnet-4-6");
    expect(r?.provider).toBe("anthropic");
    expect(r?.pricing.base.input).toBe(3);
    expect(r?.convention).toBe("disjoint");
  });

  test("uses the OpenAI convention for OpenAI-schema hosts", () => {
    expect(resolvePricing(cat, CODEX, "gpt-5.6-terra")?.convention).toBe(
      "cached-within-input",
    );
  });

  test("strips a trailing release date", () => {
    const r = resolvePricing(cat, ANTHROPIC, "claude-haiku-4-5-20251001");
    expect(r?.pricing.base.input).toBe(1);
  });

  test("prefers the host's provider over a same-named model elsewhere", () => {
    // Both anthropic and venice define claude-opus-5; the host decides.
    expect(
      resolvePricing(cat, ANTHROPIC, "claude-opus-5")?.pricing.base.input,
    ).toBe(5);
  });

  test("refuses an unknown host rather than guessing a provider", () => {
    expect(
      resolvePricing(cat, "https://example.invalid/v1", "claude-sonnet-4-6"),
    ).toBeNull();
  });

  test("returns null for an unknown model", () => {
    expect(resolvePricing(cat, ANTHROPIC, "claude-imaginary-9")).toBeNull();
  });

  test("returns null without a model", () => {
    expect(resolvePricing(cat, ANTHROPIC, null)).toBeNull();
  });

  test("returns null for a malformed url", () => {
    expect(resolvePricing(cat, "not a url", "claude-sonnet-4-6")).toBeNull();
  });

  test("falls back to an unambiguous bare id across providers", () => {
    // `only-here` is defined solely by openai, so reaching it from an
    // Anthropic URL is still unambiguous pricing.
    expect(
      resolvePricing(cat, ANTHROPIC, "only-here")?.pricing.base.input,
    ).toBe(9);
  });
});
