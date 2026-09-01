import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type {
  ModelPrice,
  ModelPricing,
  PriceTier,
  UsageConvention,
} from "@wiretap/shared";

/**
 * Model prices, read from OpenCode's own models.dev snapshot.
 *
 * OpenCode caches the full models.dev catalogue at
 * `~/.cache/opencode/models.json` and bills against it, so reading that file
 * gives the viewer exactly the rates OpenCode itself used — no network, no
 * second source of truth to drift, no hand-maintained table to go stale.
 * Absent file, unreadable file or unknown model all degrade to "no cost",
 * the same way db.ts degrades to "no session titles".
 *
 * Shape: `{ [providerId]: { models: { [modelId]: { cost, tiers? } } } }`,
 * with `cost` in USD per million tokens.
 */

const DEFAULT_MODELS = path.join(os.homedir(), ".cache/opencode/models.json");

/** Resolve the catalogue path: OPENCODE_MODELS overrides the default. */
export function modelsPath(): string {
  return process.env.OPENCODE_MODELS
    ? path.resolve(process.env.OPENCODE_MODELS)
    : DEFAULT_MODELS;
}

/**
 * Host → provider, plus the token-accounting convention that host's response
 * grammar uses.
 *
 * Deliberately explicit and deliberately short. An unlisted host yields no
 * price at all, which surfaces as "unknown" in the UI — far better than
 * guessing a provider id and inventing a number. Every entry below other than
 * Anthropic speaks the OpenAI usage schema, where `cached_tokens` is a subset
 * of the prompt total; see UsageConvention.
 */
const HOSTS: Record<string, { provider: string; convention: UsageConvention }> =
  {
    "api.anthropic.com": { provider: "anthropic", convention: "disjoint" },
    "chatgpt.com": { provider: "openai", convention: "cached-within-input" },
    "api.openai.com": { provider: "openai", convention: "cached-within-input" },
    "openrouter.ai": {
      provider: "openrouter",
      convention: "cached-within-input",
    },
    "generativelanguage.googleapis.com": {
      provider: "google",
      convention: "cached-within-input",
    },
    "api.x.ai": { provider: "xai", convention: "cached-within-input" },
    "api.groq.com": { provider: "groq", convention: "cached-within-input" },
    "api.deepseek.com": {
      provider: "deepseek",
      convention: "cached-within-input",
    },
    "api.mistral.ai": {
      provider: "mistral",
      convention: "cached-within-input",
    },
    "api.cerebras.ai": {
      provider: "cerebras",
      convention: "cached-within-input",
    },
  };

interface RawCost {
  input?: unknown;
  output?: unknown;
  cache_read?: unknown;
  cache_write?: unknown;
}

interface RawModel {
  cost?: RawCost;
  tiers?: Array<RawCost & { tier?: { type?: string; size?: unknown } }>;
}

export interface Catalogue {
  /** Keyed `provider/model`. The authoritative lookup. */
  byQualified: Map<string, ModelPricing>;
  /**
   * Keyed by bare model id, but only where every provider defining that id
   * agrees on price. Of ~3.5k ids in the catalogue, ~835 have providers that
   * disagree — `claude-opus-5` alone ranges from $0 to $6/Mtok — so an
   * unconditional bare lookup would silently fabricate rates.
   */
  byBareUnambiguous: Map<string, ModelPricing>;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function toPrice(raw: RawCost | undefined): ModelPrice | null {
  if (!raw) return null;
  const price: ModelPrice = {
    input: num(raw.input),
    output: num(raw.output),
    cache_read: num(raw.cache_read),
    cache_write: num(raw.cache_write),
  };
  // A model with no usable rate is not priceable; treat it as absent so the
  // UI says "unknown" rather than confidently reporting $0.
  const usable =
    price.input !== undefined ||
    price.output !== undefined ||
    price.cache_read !== undefined ||
    price.cache_write !== undefined;
  return usable ? price : null;
}

function toPricing(model: RawModel): ModelPricing | null {
  const base = toPrice(model.cost);
  if (!base) return null;
  const tiers: PriceTier[] = [];
  for (const raw of model.tiers ?? []) {
    // Only context-size tiers are meaningful here; models.dev has no others
    // today, but an unknown tier type must not be applied blindly.
    if (raw.tier?.type !== "context") continue;
    const size = num(raw.tier.size);
    const price = toPrice(raw);
    if (size === undefined || !price) continue;
    tiers.push({ size, price });
  }
  tiers.sort((a, b) => a.size - b.size);
  return tiers.length > 0 ? { base, tiers } : { base };
}

function samePrice(a: ModelPrice, b: ModelPrice): boolean {
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.cache_read === b.cache_read &&
    a.cache_write === b.cache_write
  );
}

/** Exported for tests: turn a parsed models.json into lookup tables. */
export function buildCatalogue(raw: unknown): Catalogue {
  const byQualified = new Map<string, ModelPricing>();
  const bare = new Map<string, ModelPricing | null>(); // null = disagreement

  const providers = (raw ?? {}) as Record<
    string,
    { models?: Record<string, RawModel> }
  >;
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== "object") continue;
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      const pricing = toPricing(model ?? {});
      if (!pricing) continue;
      byQualified.set(`${providerId}/${modelId}`, pricing);

      if (!bare.has(modelId)) {
        bare.set(modelId, pricing);
        continue;
      }
      const seen = bare.get(modelId);
      if (seen && !samePrice(seen.base, pricing.base)) bare.set(modelId, null);
    }
  }

  const byBareUnambiguous = new Map<string, ModelPricing>();
  for (const [id, pricing] of bare)
    if (pricing) byBareUnambiguous.set(id, pricing);
  return { byQualified, byBareUnambiguous };
}

let loading: Promise<Catalogue | null> | null = null;

function load(): Promise<Catalogue | null> {
  loading ??= fs
    .readFile(modelsPath(), "utf8")
    .then((text) => buildCatalogue(JSON.parse(text)))
    .catch(() => null);
  return loading;
}

/** True if the price catalogue was found and parsed. */
export async function pricingAvailable(): Promise<boolean> {
  return (await load()) !== null;
}

export interface ResolvedPricing {
  provider: string;
  pricing: ModelPricing;
  convention: UsageConvention;
}

/** Drop a trailing release date, e.g. `claude-haiku-4-5-20251001`. */
function undated(model: string): string | null {
  const m = /^(.*)-\d{8}$/.exec(model);
  return m ? m[1] : null;
}

/**
 * Look up rates for a captured request. Returns null — never a zero price —
 * when the host, the model or the catalogue itself is unknown.
 */
export function resolvePricing(
  catalogue: Catalogue,
  url: string,
  model: string | null,
): ResolvedPricing | null {
  if (!model) return null;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const entry = HOSTS[host];
  if (!entry) return null;

  const candidates = [model, undated(model)].filter(
    (m): m is string => m !== null,
  );
  for (const id of candidates) {
    const qualified = catalogue.byQualified.get(`${entry.provider}/${id}`);
    if (qualified) {
      return {
        provider: entry.provider,
        pricing: qualified,
        convention: entry.convention,
      };
    }
  }
  // Fall back to a bare id only where the whole catalogue agrees on its price.
  for (const id of candidates) {
    const agreed = catalogue.byBareUnambiguous.get(id);
    if (agreed) {
      return {
        provider: entry.provider,
        pricing: agreed,
        convention: entry.convention,
      };
    }
  }
  return null;
}

/** Load the catalogue (once) and resolve. Null when pricing is unavailable. */
export async function priceFor(
  url: string,
  model: string | null,
): Promise<ResolvedPricing | null> {
  const catalogue = await load();
  return catalogue ? resolvePricing(catalogue, url, model) : null;
}

/** Load the catalogue once, for callers pricing many files in a loop. */
export function catalogue(): Promise<Catalogue | null> {
  return load();
}
