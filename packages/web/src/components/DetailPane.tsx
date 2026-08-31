import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaretDown,
  CaretRight,
  Copy,
  Check,
  Brain,
  Wrench,
  ArrowElbowDownRight,
  TextAa,
  Gear,
  FileText,
  BracketsAngle,
  ArrowsInLineVertical,
  ArrowsOutLineVertical,
  Archive,
} from "@phosphor-icons/react";
import {
  getRequestMessages,
  getRequestSystem,
  type CapturedRequest,
  type ContentBlock,
  type Message,
  type SystemBlock,
} from "@wiretap/shared";
import { formatBytes, formatTime } from "../lib/format.ts";
import { modelFamily, shortModel } from "../lib/model.ts";
import {
  isSystemPromptText,
  parsePromptSegments,
  segTitle,
  startsWithSystemIdentity,
} from "../lib/systemPrompt.ts";
import type { PromptSegment } from "../lib/systemPrompt.ts";
import { Spinner, ErrorState, EmptyState, ModelBadge } from "./ui.tsx";

const COLLAPSE_CHARS = 600;

export function DetailPane({
  data,
  file,
  loading,
  error,
}: {
  data: CapturedRequest | null;
  file: string | null;
  loading: boolean;
  error: string | null;
}) {
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpPtr = useRef(0);

  // Reset view mode + collapse state when switching files.
  useEffect(() => {
    setRaw(false);
    setCollapsed(new Set());
    setHighlight(null);
    jumpPtr.current = 0;
  }, [file]);

  const toggleMsg = (i: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const rawJson = useMemo(
    () => (data ? JSON.stringify(data, null, 2) : ""),
    [data],
  );

  const body = data?.body;
  const messages = getRequestMessages(body);
  const compressedIndices = useMemo(
    () => messages.flatMap((m, i) => (messageIsCompressed(m) ? [i] : [])),
    [messages],
  );

  async function copyRaw() {
    await navigator.clipboard.writeText(rawJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  if (!file) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-base">
        <EmptyState
          title="Select a request"
          hint="Pick a captured request to inspect its full payload — system, messages, tools."
        />
      </div>
    );
  }

  const system = getRequestSystem(body);
  const tools = body?.tools ?? [];

  const allCollapsed = messages.length > 0 && collapsed.size >= messages.length;
  const toggleAll = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(messages.map((_, i) => i)));

  function jumpToCompressed() {
    if (compressedIndices.length === 0) return;
    const target =
      compressedIndices[jumpPtr.current % compressedIndices.length];
    jumpPtr.current += 1;
    // Ensure the target is expanded, then scroll to it on the next frame.
    setCollapsed((prev) => {
      if (!prev.has(target)) return prev;
      const next = new Set(prev);
      next.delete(target);
      return next;
    });
    setHighlight(target);
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `#req-msg-${target}`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    window.setTimeout(
      () => setHighlight((h) => (h === target ? null : h)),
      1400,
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-base">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        {body?.model && (
          <ModelBadge
            label={shortModel(body.model)}
            family={modelFamily(body.model)}
          />
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-faint">
          {body?.max_tokens != null && (
            <Meta k="max_tokens" v={body.max_tokens.toLocaleString()} />
          )}
          {body?.temperature != null && (
            <Meta k="temp" v={String(body.temperature)} />
          )}
          {body?.thinking?.budget_tokens != null && (
            <Meta
              k="thinking"
              v={body.thinking.budget_tokens.toLocaleString()}
            />
          )}
          {body?.stream != null && <Meta k="stream" v={String(body.stream)} />}
          {data?.timestamp && <Meta k="at" v={formatTime(data.timestamp)} />}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {!raw && compressedIndices.length > 0 && (
            <button
              onClick={jumpToCompressed}
              title={`Jump to compressed section${
                compressedIndices.length > 1
                  ? ` (${compressedIndices.length})`
                  : ""
              }`}
              className="relative flex items-center justify-center rounded border border-border p-1.5 text-muted transition-colors hover:bg-elevated hover:text-ink active:translate-y-px"
            >
              <Archive size={14} weight="bold" />
              {compressedIndices.length > 1 && (
                <span className="tnum absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] leading-none font-bold text-white">
                  {compressedIndices.length}
                </span>
              )}
            </button>
          )}
          {!raw && messages.length > 0 && (
            <button
              onClick={toggleAll}
              title={
                allCollapsed ? "Expand all messages" : "Collapse all messages"
              }
              className="flex items-center justify-center rounded border border-border p-1.5 text-muted transition-colors hover:bg-elevated hover:text-ink active:translate-y-px"
            >
              {allCollapsed ? (
                <ArrowsOutLineVertical size={14} weight="bold" />
              ) : (
                <ArrowsInLineVertical size={14} weight="bold" />
              )}
            </button>
          )}
          {raw && (
            <button
              onClick={copyRaw}
              title="Copy JSON"
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[13px] text-muted transition-colors hover:bg-elevated hover:text-ink active:translate-y-px"
            >
              {copied ? (
                <Check
                  size={12}
                  weight="bold"
                  className="text-block-tool-result"
                />
              ) : (
                <Copy size={12} />
              )}
              {copied ? "copied" : "copy"}
            </button>
          )}
          <div className="flex overflow-hidden rounded border border-border text-[13px]">
            <ToggleBtn active={!raw} onClick={() => setRaw(false)}>
              structured
            </ToggleBtn>
            <ToggleBtn active={raw} onClick={() => setRaw(true)}>
              raw
            </ToggleBtn>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading && <Spinner label="loading request…" />}
        {error && <ErrorState message={error} />}

        {!loading && !error && data && raw && (
          <pre className="p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-block-text">
            {rawJson}
          </pre>
        )}

        {!loading && !error && data && !raw && (
          <div className="flex flex-col gap-3 p-3">
            {system != null && <SystemSection system={system} />}

            <div className="flex flex-col gap-2">
              {messages.map((m, i) => (
                <MessageCard
                  key={i}
                  message={m}
                  index={i}
                  open={!collapsed.has(i)}
                  onToggle={() => toggleMsg(i)}
                  highlighted={highlight === i}
                />
              ))}
              {messages.length === 0 && (
                <div className="px-1 text-xs text-faint">no messages</div>
              )}
            </div>

            {tools.length > 0 && <ToolsSection tools={tools} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <span className="tnum whitespace-nowrap">
      <span className="text-faint/70">{k}</span>{" "}
      <span className="text-muted">{v}</span>
    </span>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 transition-colors ${
        active ? "bg-elevated text-ink" : "text-faint hover:text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  count,
  icon,
  accent,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  icon: React.ReactNode;
  accent: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        {open ? (
          <CaretDown size={12} className="text-faint" />
        ) : (
          <CaretRight size={12} className="text-faint" />
        )}
        <span style={{ color: accent }}>{icon}</span>
        <span className="text-[14px] font-semibold tracking-wide text-ink">
          {title}
        </span>
        {count != null && (
          <span className="tnum rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-faint">
            {count}
          </span>
        )}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

function SystemSection({ system }: { system: string | SystemBlock[] }) {
  const blocks = Array.isArray(system)
    ? system
    : [{ type: "text", text: system } as SystemBlock];
  return (
    <Section
      title="System"
      icon={<Gear size={13} weight="bold" />}
      accent="var(--color-block-system)"
      count={blocks.length}
    >
      <div className="flex flex-col divide-y divide-border">
        {blocks.map((b, i) => {
          const text = b.text ?? JSON.stringify(b, null, 2);
          return (
            <div key={i} className="px-3 py-2">
              {isSystemPromptText(text) ? (
                <SystemPromptText text={text} />
              ) : (
                <CollapsibleText text={text} bare />
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ToolsSection({
  tools,
}: {
  tools: Array<{ name?: string; description?: string; [k: string]: unknown }>;
}) {
  return (
    <Section
      title="Tools"
      icon={<Wrench size={13} weight="bold" />}
      accent="var(--color-block-tool-use)"
      count={tools.length}
    >
      <div className="flex flex-col divide-y divide-border">
        {tools.map((t, i) => (
          <div key={i} className="px-3 py-2">
            <div className="tnum text-[14px] font-medium text-block-tool-use">
              {t.name ?? "(unnamed)"}
            </div>
            {t.description && (
              <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">
                {t.description}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

const ROLE_ACCENT: Record<string, string> = {
  user: "var(--color-accent)",
  assistant: "var(--color-block-tool-result)",
  system: "var(--color-block-system)",
};

const COMPRESSED_MARKER = "[Compressed conversation section]";

function isCompressedText(text: string): boolean {
  return (text ?? "").trimStart().startsWith(COMPRESSED_MARKER);
}

/** True when a message carries a DCP compress MCP output block. */
function messageIsCompressed(message: Message): boolean {
  const content = message.content;
  if (typeof content === "string") return isCompressedText(content);
  return content.some(
    (b) => b?.type === "text" && isCompressedText(b.text ?? ""),
  );
}

function MessageCard({
  message,
  index,
  open,
  onToggle,
  highlighted,
}: {
  message: Message;
  index: number;
  open: boolean;
  onToggle: () => void;
  highlighted?: boolean;
}) {
  const accent = ROLE_ACCENT[message.role] ?? "var(--color-muted)";
  const blocks: ContentBlock[] =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content;
  const compressed = messageIsCompressed(message);

  return (
    <div
      id={`req-msg-${index}`}
      className={`scroll-mt-2 overflow-hidden rounded-md border bg-surface transition-shadow ${
        highlighted ? "border-accent ring-2 ring-accent/50" : "border-border"
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left transition-colors hover:bg-surface-2"
      >
        {open ? (
          <CaretDown size={11} className="shrink-0 text-faint" />
        ) : (
          <CaretRight size={11} className="shrink-0 text-faint" />
        )}
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span
          className="text-[13px] font-semibold tracking-wide uppercase"
          style={{ color: accent }}
        >
          {message.role}
        </span>
        <span className="tnum text-[12px] text-faint">#{index}</span>
        {compressed && (
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide uppercase"
            style={{
              color: "var(--color-block-thinking)",
              backgroundColor: "var(--model-sonnet-bg)",
            }}
          >
            <Archive size={11} weight="bold" />
            compressed
          </span>
        )}
        <span className="tnum ml-auto text-[12px] text-faint">
          {blocks.length} block{blocks.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col divide-y divide-border">
          {blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function BlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "text": {
      const text = block.text ?? "";
      if (isSystemPromptText(text)) {
        return (
          <BlockShell
            icon={<Gear size={12} weight="bold" />}
            label={
              startsWithSystemIdentity(text) ? "system prompt" : "text · prompt"
            }
            color="var(--color-block-system)"
          >
            <SystemPromptText text={text} />
          </BlockShell>
        );
      }
      return (
        <BlockShell
          icon={<TextAa size={12} weight="bold" />}
          label="text"
          color="var(--color-block-text)"
        >
          <CollapsibleText text={text} bare />
        </BlockShell>
      );
    }
    case "thinking":
      return (
        <BlockShell
          icon={<Brain size={12} weight="bold" />}
          label="thinking"
          color="var(--color-block-thinking)"
        >
          <CollapsibleText
            text={block.thinking ?? ""}
            bare
            className="text-block-thinking/90 italic"
          />
        </BlockShell>
      );
    case "tool_use":
      return (
        <BlockShell
          icon={<Wrench size={12} weight="bold" />}
          label={`tool_use · ${block.name ?? "?"}`}
          color="var(--color-block-tool-use)"
        >
          <JsonBlock value={block.input} />
        </BlockShell>
      );
    case "tool_result":
      return (
        <BlockShell
          icon={<ArrowElbowDownRight size={12} weight="bold" />}
          label={block.is_error ? "tool_result · error" : "tool_result"}
          color={
            block.is_error
              ? "var(--color-block-error)"
              : "var(--color-block-tool-result)"
          }
        >
          {typeof block.content === "string" ? (
            <CollapsibleText text={block.content} bare />
          ) : (
            <JsonBlock value={block.content} />
          )}
        </BlockShell>
      );
    default:
      return (
        <BlockShell
          icon={<TextAa size={12} weight="bold" />}
          label={block.type}
          color="var(--color-muted)"
        >
          <JsonBlock value={block} />
        </BlockShell>
      );
  }
}

function BlockShell({
  icon,
  label,
  color,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2">
      <div
        className="mb-1 flex items-center gap-1.5 text-[12px] font-medium tracking-wide uppercase"
        style={{ color }}
      >
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function CollapsibleText({
  text,
  bare = false,
  className = "",
}: {
  text: string;
  bare?: boolean;
  className?: string;
}) {
  const long = text.length > COLLAPSE_CHARS;
  const [open, setOpen] = useState(false);
  const shown = long && !open ? text.slice(0, COLLAPSE_CHARS) : text;

  return (
    <div className={bare ? "" : "px-3 py-2"}>
      <pre
        className={`font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-block-text ${className}`}
      >
        {shown}
        {long && !open && <span className="text-faint">…</span>}
      </pre>
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-[12px] font-medium text-accent hover:underline"
        >
          {open
            ? "show less"
            : `show ${text.length - COLLAPSE_CHARS} more chars`}
        </button>
      )}
    </div>
  );
}

/** Renders a system-prompt text block: prose + collapsible instruction
 *  files + recursively collapsible XML sections (skills, mcp, env, …). */
function SystemPromptText({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <SegmentList text={text} depth={0} />
    </div>
  );
}

const MAX_SEGMENT_DEPTH = 5;

/** Parses `text` into segments and renders each. Recurses into XML blocks so
 *  nested tags become nested collapsibles. Parsing runs only when this list is
 *  actually rendered (i.e. when its parent collapsible is open). */
function SegmentList({ text, depth }: { text: string; depth: number }) {
  const segments = useMemo(() => parsePromptSegments(text), [text]);

  // Nothing structural to split out — render as plain (collapsible) text.
  if (segments.length === 1 && segments[0].kind === "prose") {
    return <CollapsibleText text={segments[0].text} bare />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {segments.map((seg, i) => (
        <SegmentView key={i} seg={seg} depth={depth} />
      ))}
    </div>
  );
}

function SegmentView({ seg, depth }: { seg: PromptSegment; depth: number }) {
  if (seg.kind === "prose") {
    return <CollapsibleText text={seg.text} bare />;
  }
  if (seg.kind === "instructions") {
    return (
      <SubCollapsible
        icon={<FileText size={11} weight="bold" />}
        label={`Instructions: ${shortPath(seg.path)}`}
        title={`Instructions from: ${seg.path}`}
        accent="var(--color-block-tool-use)"
        meta={lineMeta(seg.text)}
      >
        <CollapsibleText text={seg.text} bare />
      </SubCollapsible>
    );
  }

  const name = segTitle(seg.attrs, seg.text);
  const label = name ? `<${seg.tag}> · ${name}` : `<${seg.tag}>`;
  return (
    <SubCollapsible
      icon={<BracketsAngle size={11} weight="bold" />}
      label={label}
      title={seg.attrs ? `<${seg.tag} ${seg.attrs}>` : `<${seg.tag}> block`}
      accent="var(--color-block-thinking)"
      meta={lineMeta(seg.text)}
    >
      {depth + 1 >= MAX_SEGMENT_DEPTH ? (
        <CollapsibleText text={seg.text} bare />
      ) : (
        <SegmentList text={seg.text} depth={depth + 1} />
      )}
    </SubCollapsible>
  );
}

function SubCollapsible({
  icon,
  label,
  title,
  accent,
  meta,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  accent: string;
  meta?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded border border-border/70 bg-surface-2/40">
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
      >
        {open ? (
          <CaretDown size={11} className="shrink-0 text-faint" />
        ) : (
          <CaretRight size={11} className="shrink-0 text-faint" />
        )}
        <span className="shrink-0" style={{ color: accent }}>
          {icon}
        </span>
        <span
          className="truncate font-mono text-[12px] font-medium"
          style={{ color: accent }}
        >
          {label}
        </span>
        {meta && (
          <span className="tnum ml-auto shrink-0 text-[11px] text-faint">
            {meta}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border/70 bg-base/40 px-2 py-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return "…/" + parts.slice(-2).join("/");
}

function lineMeta(text: string): string {
  const lines = text ? text.split("\n").length : 0;
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

function JsonBlock({ value }: { value: unknown }) {
  const text = useMemo(() => {
    try {
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  return <CollapsibleText text={text} bare />;
}

/** Re-exported for potential reuse / size labels. */
export { formatBytes };
