// Build release notes for a tag from the commits behind it.
//
//   bun run scripts/release-notes.ts v0.2.0 [v0.1.1]
//
// The release workflow pipes this into `gh release create --notes-file`.
// GitHub's own `--generate-notes` lists merged pull requests, and this repo
// commits straight to main, so it produces an empty body — see the v0.1.1
// release. Commits are the only changelog this project actually has.
//
// The second argument is the previous tag; omitted, it is resolved with
// `git describe`. Requires unshallow history (`fetch-depth: 0` in CI).

import { execFileSync } from "node:child_process";

export interface Commit {
  sha: string;
  subject: string;
}

interface Entry extends Commit {
  /** Subject with the `type(scope)!:` prefix removed. */
  text: string;
  breaking: boolean;
}

/** `type(optional scope)!: description` — the shape AGENTS.md commits use. */
const CONVENTIONAL =
  /^(?<type>[a-z]+)(?:\([^)]*\))?(?<bang>!)?:\s*(?<text>.+)$/;

// Order matters: it is the order sections appear in the notes.
const SECTIONS: readonly { heading: string; types: readonly string[] }[] = [
  { heading: "Features", types: ["feat"] },
  { heading: "Fixes", types: ["fix"] },
  { heading: "Performance", types: ["perf"] },
  { heading: "Changes", types: ["refactor", "style"] },
  { heading: "Docs", types: ["docs"] },
  { heading: "Build", types: ["build", "ci"] },
  { heading: "Tests", types: ["test"] },
];

function parse(c: Commit): { entry: Entry; type: string | null } {
  const m = CONVENTIONAL.exec(c.subject);
  if (!m?.groups) {
    return { entry: { ...c, text: c.subject, breaking: false }, type: null };
  }
  const { type, bang, text } = m.groups as Record<string, string | undefined>;
  return {
    entry: { ...c, text: text ?? c.subject, breaking: Boolean(bang) },
    type: type ?? null,
  };
}

const bullet = (e: Entry) => `- ${e.text} — ${e.sha}`;

/**
 * Render grouped markdown notes. Pure — the git calls live in `main` — so the
 * grouping is testable without a repository.
 *
 * Every commit lands in exactly one section; anything unrecognised falls to
 * "Other" rather than being dropped, because a changelog that silently omits
 * commits is worse than an untidy one.
 */
export function renderNotes(opts: {
  commits: readonly Commit[];
  repo: string;
  tag: string;
  previous: string | null;
}): string {
  const { commits, repo, tag, previous } = opts;

  const grouped = new Map<string, Entry[]>();
  const other: Entry[] = [];
  const breaking: Entry[] = [];

  for (const c of commits) {
    const { entry, type } = parse(c);
    if (entry.breaking) breaking.push(entry);
    const section = SECTIONS.find((s) => type && s.types.includes(type));
    if (section) {
      const list = grouped.get(section.heading) ?? [];
      list.push(entry);
      grouped.set(section.heading, list);
    } else {
      other.push(entry);
    }
  }

  const out: string[] = [];

  if (breaking.length > 0) {
    out.push("## Breaking changes", "", ...breaking.map(bullet), "");
  }
  for (const { heading } of SECTIONS) {
    const list = grouped.get(heading);
    if (list?.length) out.push(`## ${heading}`, "", ...list.map(bullet), "");
  }
  if (other.length > 0) {
    out.push("## Other", "", ...other.map(bullet), "");
  }
  if (commits.length === 0) {
    out.push("No commits since the previous release.", "");
  }

  const base = `https://github.com/${repo}`;
  const link = previous
    ? `${base}/compare/${previous}...${tag}`
    : `${base}/commits/${tag}`;
  out.push(`**Full Changelog**: ${link}`);

  return out.join("\n");
}

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

/** Same, but git's own stderr is swallowed — for calls expected to fail. */
const gitQuiet = (...args: string[]) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

/** owner/name, from CI's env when present and the origin remote otherwise. */
function resolveRepo(): string {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv) return fromEnv;
  const url = git("remote", "get-url", "origin");
  const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
  if (!m?.[1]) throw new Error(`cannot derive owner/name from remote: ${url}`);
  return m[1];
}

function main() {
  const tag = process.argv[2];
  if (!tag) {
    console.error("usage: bun run scripts/release-notes.ts <tag> [previous]");
    process.exit(1);
  }

  let previous: string | null = process.argv[3] ?? null;
  if (!previous) {
    // The first release has no predecessor, which is not an error.
    try {
      previous = gitQuiet("describe", "--tags", "--abbrev=0", `${tag}^`);
    } catch {
      previous = null;
    }
  }

  const range = previous ? `${previous}..${tag}` : tag;
  // %x00 is expanded by git; a literal NUL cannot be passed as an argv entry.
  const raw = git("log", range, "--no-merges", "--pretty=format:%h%x00%s");
  const commits: Commit[] = raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const [sha = "", subject = ""] = line.split("\u0000");
      return { sha, subject };
    });

  console.log(renderNotes({ commits, repo: resolveRepo(), tag, previous }));
}

if (import.meta.main) main();
