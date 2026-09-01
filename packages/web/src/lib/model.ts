/**
 * Badge families. Names mirror the `family` field that models.dev publishes
 * (see `@opencode-ai/models`, type `ModelFamily`), collapsed to the families
 * that actually show up in OpenCode traffic.
 *
 * The SDK is deliberately *not* a dependency here: its offline `/snapshot`
 * export is ~5 MB and its HTTP client would make this viewer need network
 * access just to color a badge. The taxonomy below was derived from it.
 */
export type ModelFamily =
  | "opus"
  | "sonnet"
  | "haiku"
  | "gpt"
  | "gpt-codex"
  | "gpt-sol"
  | "gpt-terra"
  | "gpt-luna"
  | "other";

/**
 * Classify a model string into a badge family (drives theme-aware colors).
 * Order matters: the more specific variant has to win over bare `gpt`.
 */
export function modelFamily(model: string | null): ModelFamily {
  // Some providers qualify the id with a route prefix ("azure/gpt-5.1-codex",
  // "openai/gpt-5.6-sol"); classify on the bare model id.
  const m = (model ?? "")
    .toLowerCase()
    .slice((model ?? "").lastIndexOf("/") + 1);

  // Anthropic — models.dev families claude-opus / claude-sonnet / claude-haiku.
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";

  // OpenAI — models.dev families gpt-codex / gpt-sol / gpt-terra / gpt-luna,
  // plus gpt / gpt-mini / gpt-nano / gpt-pro / o* collapsed into `gpt`.
  // Variant checks stay scoped to gpt-* so unrelated families that merely
  // contain the substring (e.g. `solar`) don't get captured.
  if (m.startsWith("codex")) return "gpt-codex";
  if (m.startsWith("gpt") || /^o\d/.test(m)) {
    if (m.includes("codex")) return "gpt-codex";
    if (m.endsWith("-sol")) return "gpt-sol";
    if (m.endsWith("-terra")) return "gpt-terra";
    if (m.endsWith("-luna")) return "gpt-luna";
    return "gpt";
  }

  return "other";
}

/** Trim the trailing dated suffix, e.g. claude-haiku-4-5-20251001 → haiku-4-5. */
export function shortModel(model: string | null): string {
  if (!model) return "—";
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
