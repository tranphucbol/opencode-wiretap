export type ModelFamily = "opus" | "sonnet" | "haiku" | "other";

/** Classify a model string into a badge family (drives theme-aware colors). */
export function modelFamily(model: string | null): ModelFamily {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return "other";
}

/** Trim the trailing dated suffix, e.g. claude-haiku-4-5-20251001 → haiku-4-5. */
export function shortModel(model: string | null): string {
  if (!model) return "—";
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
