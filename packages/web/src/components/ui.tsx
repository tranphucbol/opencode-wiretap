import type { ReactNode } from "react";
import type { ModelFamily } from "../lib/model.ts";

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
