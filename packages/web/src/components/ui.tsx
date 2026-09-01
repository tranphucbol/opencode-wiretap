import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";
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

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Richer menu rendering; the trigger always shows `label`. */
  render?: ReactNode;
}

/**
 * Listbox styled from our own tokens.
 *
 * A native <select> renders its option list with the OS widget, which ignores
 * every variable in index.css and reads as foreign in both themes. This keeps
 * a real <button> as the trigger and paints the menu itself.
 *
 * The menu goes through a portal with fixed coordinates because every pane
 * that holds one is `overflow-hidden`; an absolutely positioned menu would be
 * clipped by its own header. Focus stays on the trigger and the highlighted
 * option is advertised via aria-activedescendant, so there is no focus to
 * juggle when the menu opens and closes.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  title,
  ariaLabel,
  className = "",
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    minWidth: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : undefined;

  // Measure before paint so the menu never flashes at the wrong spot.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const estimated = Math.min(options.length * 28 + 8, 288);
    const below = window.innerHeight - r.bottom - 8;
    // Flip above only when there is genuinely more room up there.
    const top =
      below < estimated && r.top - 8 > below
        ? Math.max(8, r.top - estimated - 4)
        : r.bottom + 4;
    setPos({ left: r.left, top, minWidth: r.width });
  }, [open, options.length]);

  // Opening starts the highlight on the current value.
  useEffect(() => {
    if (open) setActiveIdx(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open, selectedIdx]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Scrolling or resizing detaches a fixed menu from its trigger; closing
    // is steadier than chasing the element every frame. The menu's own
    // overflow is exempt — a list long enough to scroll must survive being
    // scrolled.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  // Keep the keyboard-highlighted row in view in a long, scrolled menu.
  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  const commit = (i: number) => {
    const opt = options[i];
    if (opt) onChange(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIdx(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIdx(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(activeIdx);
        break;
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={open ? `${id}-${activeIdx}` : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={`flex items-center gap-1 rounded border bg-base px-1.5 py-1 text-[13px] transition-colors focus:outline-none focus-visible:border-accent-dim focus-visible:text-ink ${
          open
            ? "border-accent-dim text-ink"
            : "border-border text-muted hover:border-border-strong hover:text-ink"
        } ${className}`}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <CaretDown
          size={10}
          weight="bold"
          className={`ml-auto shrink-0 text-faint transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel ?? title}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              minWidth: pos.minWidth,
            }}
            className="z-50 max-h-72 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
          >
            {options.map((o, i) => {
              const isSelected = o.value === value;
              return (
                <div
                  key={String(o.value)}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  data-active={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => commit(i)}
                  className={`flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[13px] whitespace-nowrap ${
                    i === activeIdx ? "bg-elevated" : ""
                  } ${isSelected ? "text-ink" : "text-muted"}`}
                >
                  <Check
                    size={11}
                    weight="bold"
                    className={`shrink-0 text-accent ${
                      isSelected ? "" : "invisible"
                    }`}
                  />
                  <span className="truncate">{o.render ?? o.label}</span>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
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
