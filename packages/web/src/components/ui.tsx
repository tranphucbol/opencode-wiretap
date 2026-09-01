import type { ReactNode } from "react";
import type { ModelFamily } from "../lib/model.ts";
import { formatUsd } from "../lib/format.ts";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-faint">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      {icon && <div className="text-faint opacity-60">{icon}</div>}
      <div className="text-sm text-muted">{title}</div>
      {hint && <div className="max-w-[42ch] text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="m-3 rounded-md border border-block-error/30 bg-block-error/5 px-3 py-2 text-xs text-block-error">
      {message}
    </div>
  );
}

/**
 * HTTP status of a captured response.
 *
 * `null` is a real state, not an error: the call may still be in flight, or
 * the capture may predate response recording. It reads as absence, while a
 * non-2xx reads loudly.
 */
export function StatusChip({ status }: { status: number | null }) {
  if (status == null) {
    return (
      <span
        className="tnum w-8 text-center text-[12px] text-faint/50"
        title="no response captured"
      >
        —
      </span>
    );
  }
  const ok = status >= 200 && status < 300;
  return (
    <span
      className={`tnum w-8 rounded text-center text-[12px] leading-tight font-medium ${
        ok
          ? "text-block-tool-result"
          : "bg-block-error/10 font-bold text-block-error"
      }`}
      title={`HTTP ${status}`}
    >
      {status}
    </span>
  );
}

/**
 * USD cost of a request or session.
 *
 * `null` means genuinely unknown — no usage was reported, the model is not in
 * the local price table, or the sweep has not costed it yet — and renders as
 * absence. Only a real, priced zero shows as `$0`.
 */
export function CostChip({
  usd,
  title,
  className = "",
}: {
  usd: number | null;
  title?: string;
  className?: string;
}) {
  if (usd == null) {
    return <span className={`tnum text-[12px] text-faint/40 ${className}`} />;
  }
  return (
    <span
      className={`tnum text-[12px] text-faint ${className}`}
      title={title ?? "estimated cost"}
    >
      {formatUsd(usd)}
    </span>
  );
}

export function ModelBadge({
  label,
  family,
}: {
  label: string;
  family: ModelFamily;
}) {
  return (
    <span
      className="tnum inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[12px] leading-none font-medium"
      style={{
        color: `var(--model-${family})`,
        backgroundColor: `var(--model-${family}-bg)`,
      }}
    >
      {label}
    </span>
  );
}
