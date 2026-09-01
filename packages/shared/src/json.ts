/**
 * Parse a JSON string that came off the wire, falling back to the raw string
 * when it is not valid JSON.
 *
 * Providers send tool-call arguments as a string. That string is usually JSON,
 * but a truncated stream or a malformed generation leaves a fragment — which
 * is exactly the thing a wiretap exists to show you, so it is kept verbatim
 * rather than discarded.
 */
export function parseJsonLoose(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
