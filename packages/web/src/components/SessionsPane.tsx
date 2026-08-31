import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  MagnifyingGlass,
  CaretRight,
  CaretDown,
  ArrowElbowDownRight,
} from "@phosphor-icons/react";
import type { SessionSummary } from "@wiretap/shared";
import { formatRelative, shortId } from "../lib/format.ts";
import { Spinner, ErrorState } from "./ui.tsx";

type Sort = "recent" | "count" | "id" | "title";

interface TreeNode {
  session: SessionSummary;
  children: TreeNode[];
  subtreeLast: string; // max lastModified across subtree (for "recent" sort)
}

interface Row {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
}

function label(s: SessionSummary): string {
  return s.title && s.title.trim() ? s.title : shortId(s.id);
}

/** Build a forest: children nest under parents present in the set; anything
 *  whose parent is absent (or null) becomes a root. */
function buildForest(sessions: SessionSummary[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [], subtreeLast: s.lastModified });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const pid = node.session.parentId;
    const parent = pid ? byId.get(pid) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // Propagate the most-recent timestamp up so active trees can float to top.
  const computeLast = (n: TreeNode): string => {
    let last = n.session.lastModified;
    for (const c of n.children) {
      const cl = computeLast(c);
      if (cl > last) last = cl;
    }
    n.subtreeLast = last;
    return last;
  };
  roots.forEach(computeLast);
  return roots;
}

function comparator(sort: Sort): (a: TreeNode, b: TreeNode) => number {
  return (a, b) => {
    if (sort === "count") return b.session.fileCount - a.session.fileCount;
    if (sort === "id") return a.session.id.localeCompare(b.session.id);
    if (sort === "title")
      return label(a.session).localeCompare(label(b.session));
    return a.subtreeLast < b.subtreeLast ? 1 : -1; // recent
  };
}

export function SessionsPane({
  sessions,
  loading,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const roots = useMemo(() => buildForest(sessions), [sessions]);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const cmp = comparator(sort);

    // When filtering, a node is visible if it or any descendant matches.
    const visible = new Set<string>();
    if (f) {
      const matches = (n: TreeNode) =>
        label(n.session).toLowerCase().includes(f) ||
        n.session.id.toLowerCase().includes(f);
      const mark = (n: TreeNode): boolean => {
        let keep = matches(n);
        for (const c of n.children) if (mark(c)) keep = true;
        if (keep) visible.add(n.session.id);
        return keep;
      };
      roots.forEach(mark);
    }

    const out: Row[] = [];
    const walk = (list: TreeNode[], depth: number) => {
      for (const n of [...list].sort(cmp)) {
        if (f && !visible.has(n.session.id)) continue;
        const hasChildren = n.children.length > 0;
        out.push({ node: n, depth, hasChildren });
        // Filtering force-expands so matches are reachable.
        const isCollapsed = !f && collapsed.has(n.session.id);
        if (hasChildren && !isCollapsed) walk(n.children, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, filter, sort, collapsed]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold tracking-wide text-ink">
            SESSIONS
          </span>
          <span className="tnum text-[13px] text-faint">{sessions.length}</span>
        </div>
        <button
          onClick={onRefresh}
          title="Refresh"
          className="rounded p-1 text-muted transition-colors hover:bg-elevated hover:text-ink active:translate-y-px"
        >
          <ArrowClockwise size={14} weight="bold" />
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={13}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter title or id…"
            className="w-full rounded border border-border bg-base py-1 pr-2 pl-7 font-mono text-[13px] text-ink placeholder:text-faint focus:border-accent-dim focus:outline-none"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="rounded border border-border bg-base px-1.5 py-1 text-[13px] text-muted focus:border-accent-dim focus:outline-none"
        >
          <option value="recent">recent</option>
          <option value="count">count</option>
          <option value="title">title</option>
          <option value="id">id</option>
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && sessions.length === 0 && (
          <Spinner label="loading sessions…" />
        )}
        {error && <ErrorState message={error} />}
        {rows.map(({ node, depth, hasChildren }) => {
          const s = node.session;
          const active = s.id === selectedId;
          const isCollapsed = collapsed.has(s.id);
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(s.id);
                }
              }}
              title={s.title ? `${s.title}\n${s.id}` : s.id}
              className={`flex cursor-pointer items-center gap-1.5 border-l-2 py-1.5 pr-3 text-left transition-colors focus:outline-none ${
                active
                  ? "border-accent bg-elevated"
                  : "border-transparent hover:bg-surface-2"
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(s.id);
                  }}
                  title={isCollapsed ? "Expand" : "Collapse"}
                  className="-my-1 shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-elevated hover:text-ink"
                >
                  {isCollapsed ? (
                    <CaretRight size={12} weight="bold" />
                  ) : (
                    <CaretDown size={12} weight="bold" />
                  )}
                </button>
              ) : depth > 0 ? (
                <ArrowElbowDownRight
                  size={12}
                  className="shrink-0 text-faint/60"
                />
              ) : (
                <span className="w-[13px] shrink-0" />
              )}

              <span
                className={`truncate text-[14px] ${
                  active ? "text-ink" : "text-muted"
                } ${s.title ? "" : "tnum"}`}
              >
                {label(s)}
              </span>

              <span className="tnum ml-auto shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-faint">
                {s.fileCount}
              </span>
              <span className="tnum shrink-0 text-[12px] text-faint">
                {formatRelative(s.lastModified)}
              </span>
            </div>
          );
        })}
        {!loading && rows.length === 0 && !error && (
          <div className="px-3 py-4 text-xs text-faint">no sessions match</div>
        )}
      </div>
    </div>
  );
}
