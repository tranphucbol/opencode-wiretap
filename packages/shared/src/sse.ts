// A provider-agnostic `text/event-stream` reader.
//
// Deliberately lenient: this parses bodies that were captured off a live wire
// and may have been cut mid-event by an abort or a byte cap. A truncated
// trailing event is dropped rather than guessed at, and nothing here throws.

export interface SseEvent {
  /** The `event:` field, or undefined when the stream did not send one. */
  event?: string;
  /** All `data:` lines of this event, joined with newlines per the spec. */
  data: string;
}

/**
 * Split an SSE body into its complete events.
 *
 * Events are separated by a blank line. Only a terminated event is returned,
 * so a stream that stops mid-event contributes everything before the cut and
 * nothing after it.
 */
export function parseSseEvents(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  if (!text) return events;

  // Normalize line endings so \r\n and \r streams split the same way.
  const normalized = text.replace(/\r\n?/g, "\n");

  let event: string | undefined;
  let data: string[] = [];
  let sawField = false;

  const flush = () => {
    if (sawField)
      events.push(
        event === undefined
          ? { data: data.join("\n") }
          : { event, data: data.join("\n") },
      );
    event = undefined;
    data = [];
    sawField = false;
  };

  // A trailing blank line means the final event is complete. Without one the
  // body was cut mid-event, so the last chunk is left unflushed.
  const lines = normalized.split("\n");
  const terminated = normalized.endsWith("\n\n") || normalized.endsWith("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const last = i === lines.length - 1;

    if (line === "") {
      flush();
      continue;
    }
    // Comments/heartbeats.
    if (line.startsWith(":")) continue;
    // An unterminated final line is a partial event — drop it.
    if (last && !terminated) break;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // One optional space after the colon is part of the framing, not the data.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      event = value;
      sawField = true;
    } else if (field === "data") {
      data.push(value);
      sawField = true;
    }
    // `id`, `retry` and unknown fields carry nothing we display.
  }

  // Only dispatch the tail when the body actually ended on a line boundary.
  // Otherwise the stream was cut mid-event and whatever accumulated is a
  // fragment, not an event.
  if (terminated) flush();
  return events;
}

/**
 * Parse an event's `data` payload as JSON, yielding undefined for the `[DONE]`
 * sentinel and for anything unparseable.
 */
export function parseSseData<T = unknown>(data: string): T | undefined {
  const trimmed = data.trim();
  if (!trimmed || trimmed === "[DONE]") return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}
