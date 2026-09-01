import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Check, Copy } from "@phosphor-icons/react";
import type { RequestSummary } from "@wiretap/shared";
import { formatBytes, formatTime, shortId } from "../lib/format.ts";
import { modelFamily, shortModel } from "../lib/model.ts";
import { Spinner, ErrorState, EmptyState, ModelBadge } from "./ui.tsx";

export function RequestsPane({
  sessionId,
  requests,
  loading,
  error,
  selectedFile,
  onSelect,
  onRefresh,
}: {
  sessionId: string | null;
  requests: RequestSummary[];
  loading: boolean;
  error: string | null;
  selectedFile: string | null;
  onSelect: (file: string) => void;
  onRefresh: () => void;
}) {
  const [modelFilter, setModelFilter] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Clear the "copied" flash on unmount or when the session changes.
  useEffect(() => setCopied(false), [sessionId]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  async function copySessionId() {
    if (!sessionId) return;
    await navigator.clipboard.writeText(sessionId);
    setCopied(true);
  }

  const models = useMemo(() => {
    const set = new Set<string>();
    for (const r of requests) if (r.model) set.add(r.model);
    return [...set].sort();
  }, [requests]);

  const rows = useMemo(() => {
    const filtered = modelFilter
      ? requests.filter((r) => r.model === modelFilter)
      : requests;
    return [...filtered].sort((a, b) => a.seq - b.seq);
  }, [requests, modelFilter]);

  if (!sessionId) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-surface">
        <EmptyState
          title="Select a session"
          hint="Pick a session on the left to list its captured requests."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-ink">
            REQUESTS
          </span>
          <span
            className="tnum truncate text-[13px] text-faint"
            title={sessionId}
          >
            {shortId(sessionId)}
          </span>
          <button
            onClick={copySessionId}
            title={copied ? "Copied session id" : "Copy session id"}
            aria-label="Copy session id"
            className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-elevated hover:text-ink active:translate-y-px"
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
          </button>
        </div>
        <button
          onClick={onRefresh}
          title="Refresh"
          className="rounded p-1 text-muted transition-colors hover:bg-elevated hover:text-ink active:translate-y-px"
        >
          <ArrowClockwise size={14} weight="bold" />
        </button>
      </header>

      {models.length > 1 && (
        <div className="border-b border-border px-3 py-2">
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="w-full rounded border border-border bg-base px-1.5 py-1 text-[13px] text-muted focus:border-accent-dim focus:outline-none"
          >
            <option value="">all models ({requests.length})</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {shortModel(m)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && <Spinner label="reading requests…" />}
        {error && <ErrorState message={error} />}
        {rows.map((r) => {
          const active = r.file === selectedFile;
          return (
            <button
              key={r.file}
              onClick={() => onSelect(r.file)}
              className={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left transition-colors ${
                active
                  ? "border-accent bg-elevated"
                  : "border-transparent hover:bg-surface-2"
              }`}
            >
              <span className="tnum w-9 shrink-0 text-[13px] text-faint">
                #{String(r.seq).padStart(4, "0")}
              </span>
              <ModelBadge
                label={shortModel(r.model)}
                family={modelFamily(r.model)}
              />
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <span className="tnum text-[12px] text-faint" title="messages">
                  {r.messageCount} msg
                </span>
                <span className="tnum w-14 text-right text-[12px] text-faint">
                  {formatBytes(r.size)}
                </span>
              </span>
            </button>
          );
        })}
        {rows.length > 0 && (
          <div className="tnum px-3 py-2 text-[12px] text-faint">
            {rows.length} request{rows.length === 1 ? "" : "s"} ·{" "}
            {formatTime(rows[rows.length - 1].timestamp)}
          </div>
        )}
        {!loading && rows.length === 0 && !error && (
          <div className="px-3 py-4 text-xs text-faint">no requests</div>
        )}
      </div>
    </div>
  );
}
