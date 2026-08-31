/**
 * Parser for OpenCode / Claude Code system-prompt text blocks.
 *
 * The full system prompt is injected as the first user message's text block.
 * It begins with "You are OpenCode..." (or "You are Claude Code...") followed
 * by prose, project instruction files ("Instructions from: /path/AGENTS.md"),
 * and top-level XML-tagged sections (<env>, <mcp_instructions>,
 * <available_skills>, <system-reminder>, <example>, ...).
 *
 * Blocks nest: <available_skills> contains many <skill>, each with <name>,
 * <description>, <location>; <mcp_instructions> contains <server name="...">.
 * The parser is recursive and indentation/attribute aware so the UI can render
 * an expandable tree with each section labeled by its tag (and derived name).
 */

export type PromptSegment =
  | { kind: "prose"; text: string }
  | { kind: "instructions"; path: string; text: string }
  | { kind: "xml"; tag: string; attrs: string; text: string };

// Opening tag at line start (allowing indentation) with optional attributes.
const OPEN_TAG_RE = /^(\s*)<([A-Za-z_][\w-]*)((?:\s[^>]*?)?)>/;
const INSTRUCTIONS_RE = /^\s*Instructions from:\s*(.*)$/;

/** Detects text blocks that are (or contain) a system prompt. */
export function isSystemPromptText(text: string): boolean {
  if (!text) return false;
  return (
    /^You are (OpenCode|Claude Code)\b/.test(text) ||
    /(^|\n)Instructions from:\s*\S/.test(text)
  );
}

/** True when the block is the leading system prompt (for the SYSTEM badge). */
export function startsWithSystemIdentity(text: string): boolean {
  return /^You are (OpenCode|Claude Code)\b/.test(text ?? "");
}

/** Removes the common leading indentation shared by all non-blank lines. */
function dedent(text: string): string {
  const lines = text.split("\n");
  let min = Infinity;
  for (const l of lines) {
    if (l.trim().length === 0) continue;
    const lead = l.length - l.trimStart().length;
    if (lead < min) min = lead;
  }
  if (!isFinite(min) || min === 0) return text;
  return lines
    .map((l) => (l.trim().length === 0 ? l : l.slice(min)))
    .join("\n");
}

/**
 * Splits system-prompt text into ordered segments. Prose is preserved
 * verbatim; instruction files and multi-line balanced XML blocks become their
 * own segments. Single-line elements (e.g. <name>x</name>) stay inline as
 * prose. Nesting is handled by re-parsing each block's inner text (see
 * `parsePromptSegments` calls in the renderer), so this only splits one level.
 */
export function parsePromptSegments(text: string): PromptSegment[] {
  const lines = text.split("\n");
  const segments: PromptSegment[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    if (prose.length === 0) return;
    const joined = prose.join("\n");
    if (joined.trim().length > 0)
      segments.push({ kind: "prose", text: joined });
    prose = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Instruction file section: header + everything until next top-level marker.
    const instr = line.match(INSTRUCTIONS_RE);
    if (instr) {
      flushProse();
      const path = instr[1].trim();
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (INSTRUCTIONS_RE.test(l) || OPEN_TAG_RE.test(l)) break;
        bodyLines.push(l);
        i++;
      }
      segments.push({
        kind: "instructions",
        path,
        text: bodyLines.join("\n").replace(/^\n+|\n+$/g, ""),
      });
      continue;
    }

    // XML block: <tag ...> ... </tag> (tag at line start, may be indented).
    const open = line.match(OPEN_TAG_RE);
    if (open) {
      const tag = open[2];
      const attrs = open[3].trim();
      const openEnd = open[0].length;
      const close = `</${tag}>`;

      // Single-line element: <tag>...</tag> on the same line -> keep as prose.
      if (line.indexOf(close, openEnd) !== -1) {
        prose.push(line);
        i++;
        continue;
      }

      // Multi-line block: find the matching close, counting same-name nesting.
      let depth = 1;
      let j = i + 1;
      const sameOpen = new RegExp(`<${tag}(?:\\s[^>]*?)?>`, "g");
      const sameClose = new RegExp(`</${tag}>`, "g");
      for (; j < lines.length; j++) {
        const l = lines[j];
        // Count closes first is unsafe for same-line open+close; count both.
        const opens = (l.match(sameOpen) || []).length;
        const closes = (l.match(sameClose) || []).length;
        depth += opens - closes;
        if (depth <= 0) break;
      }

      if (j < lines.length) {
        flushProse();
        const inner = dedent(lines.slice(i + 1, j).join("\n"));
        segments.push({ kind: "xml", tag, attrs, text: inner });
        i = j + 1;
        continue;
      }
      // No matching close: fall through and treat as prose.
    }

    prose.push(line);
    i++;
  }

  flushProse();
  return segments;
}

/** Derives a friendly title suffix for an XML block: a `name="X"` attribute
 *  or a leading `<name>X</name>` child, if present. */
export function segTitle(attrs: string, inner: string): string | null {
  const attrName = attrs.match(/\bname\s*=\s*"([^"]*)"/);
  if (attrName) return attrName[1];
  const childName = inner.match(/^\s*<name>([^<]*)<\/name>/m);
  if (childName) return childName[1].trim();
  return null;
}
