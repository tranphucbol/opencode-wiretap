import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown.tsx";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

test("prose becomes structure", () => {
  expect(html("## Title\n\n- one\n- two")).toContain("<h2>Title</h2>");
  expect(html("## Title\n\n- one\n- two")).toContain("<li>one</li>");
});

test("gfm tables and strikethrough are on", () => {
  expect(html("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("<table>");
  expect(html("~~gone~~")).toContain("<del>gone</del>");
});

test("harness tags survive as literal text", () => {
  const out = html("before <system-reminder>keep me</system-reminder> after");
  expect(out).toContain(
    "&lt;system-reminder&gt;keep me&lt;/system-reminder&gt;",
  );
});

test("a block-level tag is not dropped", () => {
  const out = html("<dcp-message-id>m0006</dcp-message-id>");
  expect(out).toContain("m0006");
  expect(out).toContain("&lt;dcp-message-id&gt;");
});

test("no page-authored markup reaches the DOM", () => {
  const out = html(
    '<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>',
  );
  expect(out).not.toContain("<img");
  expect(out).not.toContain("<script");
  expect(out).toContain("onerror");
});

test("fenced code keeps its own quoting", () => {
  const out = html("```ts\nconst a = 1 < 2;\n```");
  expect(out).toContain("<pre>");
  expect(out).toContain("1 &lt; 2");
});
