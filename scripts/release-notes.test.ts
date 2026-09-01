import { describe, expect, test } from "bun:test";
import { renderNotes, type Commit } from "./release-notes.ts";

const opts = { repo: "o/r", tag: "v0.2.0", previous: "v0.1.1" };
const render = (commits: Commit[]) => renderNotes({ ...opts, commits });

describe("renderNotes", () => {
  test("groups commits under their conventional type", () => {
    const md = render([
      { sha: "aaa1111", subject: "feat: add auto-fetch controls" },
      { sha: "bbb2222", subject: "fix: deduplicate wrapped fetch requests" },
      { sha: "ccc3333", subject: "docs: add release runbook" },
    ]);

    expect(md).toContain("## Features\n\n- add auto-fetch controls — aaa1111");
    expect(md).toContain(
      "## Fixes\n\n- deduplicate wrapped fetch requests — bbb2222",
    );
    expect(md).toContain("## Docs\n\n- add release runbook — ccc3333");
  });

  test("orders sections features first, and omits empty ones", () => {
    const md = render([
      { sha: "ccc3333", subject: "docs: add release runbook" },
      { sha: "aaa1111", subject: "feat: add auto-fetch controls" },
    ]);

    expect(md.indexOf("## Features")).toBeLessThan(md.indexOf("## Docs"));
    expect(md).not.toContain("## Fixes");
    expect(md).not.toContain("## Breaking changes");
  });

  test("keeps unrecognised subjects rather than dropping them", () => {
    const md = render([{ sha: "ddd4444", subject: "wip on the parser" }]);
    expect(md).toContain("## Other\n\n- wip on the parser — ddd4444");
  });

  test("understands scopes and surfaces breaking changes", () => {
    const md = render([
      { sha: "eee5555", subject: "feat(viewer)!: drop the legacy route" },
    ]);

    // Listed twice on purpose: once as breaking, once in its own section.
    expect(md).toContain("## Breaking changes\n\n- drop the legacy route");
    expect(md).toContain("## Features\n\n- drop the legacy route — eee5555");
  });

  test("links a compare range when a previous tag exists", () => {
    expect(render([])).toContain(
      "**Full Changelog**: https://github.com/o/r/compare/v0.1.1...v0.2.0",
    );
  });

  test("falls back to the commit list for a first release", () => {
    const md = renderNotes({ ...opts, previous: null, commits: [] });
    expect(md).toContain(
      "**Full Changelog**: https://github.com/o/r/commits/v0.2.0",
    );
    expect(md).toContain("No commits since the previous release.");
  });
});
