// Shared UI primitives for the 「凭信 · 精密交接」design system (ported from pkubdcard/web/src/ui.tsx).
// All icons are inline linear SVG (24 viewBox / stroke 1.5) — never emoji.

import type { ComponentChildren, JSX } from "preact";
import { t } from "./i18n";
import type { ThemeMode } from "./theme";

/* ─── Icons ───────────────────────────────────────────────────────────── */

type IconProps = { class?: string };
const svg = (path: ComponentChildren, extra: Record<string, unknown> = {}) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width={1.5}
    stroke-linecap="round"
    stroke-linejoin="round"
    {...extra}
  >
    {path}
  </svg>
);

export const Icon = {
  arrow: (p: IconProps) => svg(<path d="M5 12h14M13 6l6 6-6 6" />, p),
  check: (p: IconProps) => svg(<path d="M4 12.5l5 5L20 6.5" />, p),
  copy: (p: IconProps) =>
    svg(
      <>
        <rect x="9" y="9" width="11" height="11" rx="2.2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h8" />
      </>,
      p,
    ),
  shield: (p: IconProps) =>
    svg(
      <>
        <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" />
        <path d="M9 12l2 2 4-4" />
      </>,
      p,
    ),
  key: (p: IconProps) =>
    svg(
      <>
        <circle cx="8" cy="15" r="4" />
        <path d="M10.8 12.2 20 3M17 6l2 2M14 9l2 2" />
      </>,
      p,
    ),
  scan: (p: IconProps) =>
    svg(
      <>
        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
        <path d="M4 12h16" />
      </>,
      p,
    ),
  sun: (p: IconProps) =>
    svg(
      <>
        <circle cx="12" cy="12" r="3.6" />
        <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </>,
      p,
    ),
  moon: (p: IconProps) =>
    svg(<path d="M19.5 14.2A7.5 7.5 0 1 1 9.8 4.5a6 6 0 0 0 9.7 9.7Z" />, p),
  expand: (p: IconProps) =>
    svg(<path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 1 1-1v-4" />, p),
  lock: (p: IconProps) =>
    svg(
      <>
        <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
        <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      </>,
      p,
    ),
  clock: (p: IconProps) =>
    svg(
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3 2" />
      </>,
      p,
    ),
  alert: (p: IconProps) =>
    svg(
      <>
        <path d="M12 4 21 19.5H3L12 4Z" />
        <path d="M12 10v4M12 17h.01" />
      </>,
      p,
    ),
  person: (p: IconProps) =>
    svg(
      <>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
      </>,
      p,
    ),
  phone: (p: IconProps) =>
    svg(
      <>
        <rect x="7" y="3" width="10" height="18" rx="2.4" />
        <path d="M11 17.5h2" />
      </>,
      p,
    ),
  auto: (p: IconProps) =>
    svg(
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 4.5a7.5 7.5 0 0 0 0 15" fill="currentColor" stroke="none" />
      </>,
      p,
    ),
};

/* ─── Spinner ─────────────────────────────────────────────────────────── */

export function Spinner({ class: cls = "" }: { class?: string }) {
  return (
    <svg class={`animate-spin ${cls}`} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    </svg>
  );
}

/* ─── Eyebrow / Card / Field ──────────────────────────────────────────── */

export function Eyebrow({ children, class: cls = "" }: { children: ComponentChildren; class?: string }) {
  return <span class={`eyebrow ${cls}`}>{children}</span>;
}

export function Card({
  children,
  class: cls = "",
  ...rest
}: { children: ComponentChildren; class?: string } & JSX.HTMLAttributes<HTMLDivElement>) {
  return (
    <div class={`card ${cls}`} {...rest}>
      {children}
    </div>
  );
}

export function Field({
  label,
  aux,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  aux?: ComponentChildren;
  hint?: ComponentChildren;
  htmlFor?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="flex flex-col gap-2">
      <label class="flex items-baseline justify-between text-[13px] font-medium text-ink" for={htmlFor}>
        <span>{label}</span>
        {aux && <span class="font-mono text-[11px] tracking-wider text-ink-3">{aux}</span>}
      </label>
      {children}
      {hint && <p class="text-[12.5px] leading-relaxed text-ink-3">{hint}</p>}
    </div>
  );
}

/* ─── Button ──────────────────────────────────────────────────────────── */

type ButtonProps = {
  variant?: "primary" | "ghost" | "quiet";
  busy?: boolean;
  arrow?: boolean;
  class?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  children: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, "class" | "type" | "disabled">;

export function Button({
  variant = "ghost",
  busy,
  arrow,
  class: cls = "",
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} class={`btn btn-${variant} ${cls}`} disabled={busy || disabled} {...rest}>
      <span class="inline-flex items-center gap-1.5">{children}</span>
      {busy ? <Spinner /> : arrow ? <Icon.arrow class="size-[18px]" /> : null}
    </button>
  );
}

/* ─── Notice (aria-live) ──────────────────────────────────────────────── */

export function Notice({ children }: { children: ComponentChildren }) {
  return (
    <div class="notice" role="alert" aria-live="assertive">
      {children}
    </div>
  );
}

/* ─── CountdownRing ───────────────────────────────────────────────────── */

export function CountdownRing({
  seconds,
  resetKey,
  label,
}: {
  seconds: number;
  resetKey: number;
  label: string;
}) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <div class="flex items-center gap-2.5 text-[12.5px] text-ink-3" aria-live="polite">
      <svg width="30" height="30" viewBox="0 0 30 30" key={resetKey} aria-hidden="true">
        <circle cx="15" cy="15" r={r} fill="none" stroke="var(--line)" stroke-width="2.5" />
        <circle
          class="ring-progress"
          cx="15"
          cy="15"
          r={r}
          fill="none"
          stroke="var(--seal)"
          stroke-width="2.5"
          stroke-linecap="round"
          transform="rotate(-90 15 15)"
          style={`--ring-c:${c}px; --ring-dur:${seconds}s; stroke-dasharray:${c}px;`}
        />
      </svg>
      <span class="font-mono tracking-wide">{label}</span>
    </div>
  );
}

/* ─── QRFrame ─────────────────────────────────────────────────────────── */

export function QRFrame({
  src,
  alt,
  size = 240,
  onClick,
}: {
  src: string;
  alt: string;
  size?: number;
  onClick?: () => void;
}) {
  const inner = (
    <div class="qr-frame">
      <img src={src} alt={alt} width={size} height={size} class="block" style={`width:${size}px;height:${size}px`} />
    </div>
  );
  if (onClick) {
    return (
      <button
        type="button"
        class="hero-glow inline-block cursor-pointer rounded-[var(--radius-qr)] transition-transform active:scale-[0.99]"
        onClick={onClick}
        aria-label={t.tapFull}
      >
        {inner}
      </button>
    );
  }
  return <div class="hero-glow inline-block">{inner}</div>;
}

/* ─── ThemeToggle ─────────────────────────────────────────────────────── */

export function ThemeToggle({ mode, onCycle }: { mode: ThemeMode; onCycle: () => void }) {
  const label = t.theme[mode];
  return (
    <button
      class="grid size-10 cursor-pointer place-items-center rounded-[var(--radius-ctl)] border border-line text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
      onClick={onCycle}
      title={label}
      aria-label={t.themeLabel(label)}
    >
      {mode === "light" ? <Icon.sun /> : mode === "dark" ? <Icon.moon /> : <Icon.auto />}
    </button>
  );
}
