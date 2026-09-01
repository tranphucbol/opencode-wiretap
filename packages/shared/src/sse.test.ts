import { describe, expect, test } from "bun:test";
import { parseSseData, parseSseEvents } from "./sse.ts";

describe("parseSseEvents", () => {
  test("splits events on blank lines", () => {
    expect(parseSseEvents("data: one\n\ndata: two\n\n")).toEqual([
      { data: "one" },
      { data: "two" },
    ]);
  });

  test("concatenates multi-line data fields into one event", () => {
    expect(parseSseEvents('data: {\ndata:   "a": 1\ndata: }\n\n')).toEqual([
      { data: '{\n  "a": 1\n}' },
    ]);
  });

  test("keeps the event name and skips comment lines", () => {
    const text = ": ping\nevent: message_start\ndata: {}\n\n";
    expect(parseSseEvents(text)).toEqual([
      { event: "message_start", data: "{}" },
    ]);
  });

  test("ignores fields we do not read, without inventing an event", () => {
    const text = "id: 7\nretry: 500\n\ndata: x\n\n";
    expect(parseSseEvents(text)).toEqual([{ data: "x" }]);
  });

  test("strips exactly one leading space after the colon", () => {
    expect(parseSseEvents("data:  padded\n\n")).toEqual([{ data: " padded" }]);
  });

  test("tolerates CRLF framing", () => {
    expect(parseSseEvents("event: a\r\ndata: b\r\n\r\n")).toEqual([
      { event: "a", data: "b" },
    ]);
  });

  test("drops a trailing partial event without throwing", () => {
    const cut = 'data: complete\n\nevent: message_delta\ndata: {"par';
    expect(parseSseEvents(cut)).toEqual([{ data: "complete" }]);
  });

  test("returns nothing for an empty body", () => {
    expect(parseSseEvents("")).toEqual([]);
  });
});

describe("parseSseData", () => {
  test("parses JSON payloads", () => {
    expect(parseSseData<{ type: string }>('{"type":"ping"}')).toEqual({
      type: "ping",
    });
  });

  test("treats the [DONE] sentinel as carrying no event", () => {
    expect(parseSseData("[DONE]")).toBeUndefined();
  });

  test("returns undefined rather than throwing on a truncated payload", () => {
    expect(parseSseData('{"a":')).toBeUndefined();
  });
});
