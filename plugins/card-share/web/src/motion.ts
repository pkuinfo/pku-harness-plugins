// Thin, reduced-motion-aware wrappers over the `motion` (vanilla) animate API.
// Every entrance/micro-interaction in the app routes through here so a single
// prefers-reduced-motion guard governs the whole experience.

import { animate, stagger } from "motion";

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const DUR = 0.44;

export function reducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function show(el: HTMLElement) {
  el.style.opacity = "1";
  el.style.transform = "none";
  el.style.filter = "none";
}

/** Staggered rise-in of a container's direct children on mount. */
export function reveal(
  container: HTMLElement | null,
  opts: { selector?: string; y?: number; delay?: number; gap?: number } = {},
) {
  if (!container) return;
  const targets = Array.from(
    container.querySelectorAll<HTMLElement>(opts.selector ?? ":scope > [data-reveal]"),
  );
  if (!targets.length) return;
  if (reducedMotion()) {
    targets.forEach(show);
    return;
  }
  try {
    animate(
      targets,
      { opacity: [0, 1], y: [opts.y ?? 10, 0] },
      { duration: DUR, ease: EASE, delay: stagger(opts.gap ?? 0.06, { startDelay: opts.delay ?? 0.03 }) },
    );
  } catch {
    targets.forEach(show);
  }
}

/** The 6-digit token minting: each digit rises + de-blurs in sequence. */
export function mintDigits(container: HTMLElement | null) {
  if (!container) return;
  const digits = Array.from(container.querySelectorAll<HTMLElement>("[data-digit]"));
  if (!digits.length) return;
  if (reducedMotion()) {
    digits.forEach(show);
    return;
  }
  try {
    animate(
      digits,
      { opacity: [0, 1], y: [16, 0], filter: ["blur(7px)", "blur(0px)"] },
      { duration: 0.5, ease: EASE, delay: stagger(0.07, { startDelay: 0.08 }) },
    );
  } catch {
    digits.forEach(show);
  }
}

/** A quick breath when the payment barcode refreshes. */
export function pulse(el: HTMLElement | null) {
  if (!el || reducedMotion()) return;
  try {
    animate(el, { scale: [0.985, 1], opacity: [0.55, 1] }, { duration: 0.5, ease: EASE });
  } catch {
    /* noop */
  }
}
