import { expect, test } from "bun:test";
import { asJsonTree, jsonText } from "./json.ts";

test("an object tool input is walkable as a tree", () => {
  const input = { filePath: "/tmp/a.ts", limit: 20 };
  expect(asJsonTree(input)).toBe(input);
});

test("an array is walkable as a tree", () => {
  expect(asJsonTree([1, 2])).toEqual([1, 2]);
});

test("a JSON string of arguments is parsed into a tree", () => {
  expect(asJsonTree('{"command":"ls"}')).toEqual({ command: "ls" });
});

test("a truncated arguments fragment stays text", () => {
  expect(asJsonTree('{"command":"l')).toBeUndefined();
});

test("prose is not mistaken for JSON", () => {
  expect(asJsonTree("no response captured")).toBeUndefined();
});

test("a bare JSON scalar has no tree to show", () => {
  expect(asJsonTree("42")).toBeUndefined();
  expect(asJsonTree(42)).toBeUndefined();
  expect(asJsonTree(null)).toBeUndefined();
  expect(asJsonTree(undefined)).toBeUndefined();
});

test("text keeps strings verbatim and pretty-prints the rest", () => {
  expect(jsonText("plain")).toBe("plain");
  expect(jsonText({ a: 1 })).toBe('{\n  "a": 1\n}');
});

test("text survives a value JSON cannot serialize", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(jsonText(cyclic)).toBe("[object Object]");
  expect(jsonText(undefined)).toBe("undefined");
});
