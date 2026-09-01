export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(n) / Math.log(1024)),
    units.length - 1,
  );
  const v = n / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatRelative(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const diff = Date.now() - d;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

/**
 * USD, with precision that follows the magnitude — a single cheap request can
 * land near $0.0001 while a session total runs to dollars, and one fixed
 * precision would either round the former to nothing or bury the latter in
 * noise.
 */
export function formatUsd(v: number): string {
  if (v <= 0) return "$0";
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  if (v >= 0.0001) return `$${v.toFixed(4)}`;
  return "<$0.0001";
}

/** Short session id: strip the `ses_` prefix, keep a readable head+tail. */
export function shortId(id: string): string {
  const core = id.startsWith("ses_") ? id.slice(4) : id;
  if (core.length <= 14) return core;
  return `${core.slice(0, 8)}…${core.slice(-4)}`;
}
