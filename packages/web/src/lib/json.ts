/**
 * Helpers for deciding whether a captured value is worth showing as a tree.
 *
 * Tool arguments reach the viewer in three shapes: an object (Anthropic sends
 * `input` already parsed), a JSON string (a provider that hands back raw
 * `arguments`), or a fragment that never finished streaming. Only the first
 * two can be walked as a tree; the third has to stay text, because a broken
 * payload is precisely the thing a wiretap exists to show you.
 */

/** The value as an object/array a JSON tree can walk, or `undefined`. */
export function asJsonTree(value: unknown): object | undefined {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object") return value as object;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksJson) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as object)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The value as text: strings verbatim, everything else pretty-printed. */
export function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
