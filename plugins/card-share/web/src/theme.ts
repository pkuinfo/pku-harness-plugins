// Theme controller (ported from pkubdcard/web). Three modes: auto (default, follows the OS),
// light, dark. The explicit choice persists in localStorage; "auto" clears it. Storage can be
// unavailable (private mode, some webviews), so every access is guarded.

import { useEffect, useState } from "preact/hooks";

export type ThemeMode = "auto" | "light" | "dark";

const KEY = "card-share.theme";

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* no storage */
  }
  return "auto";
}

export function applyMode(m: ThemeMode) {
  const root = document.documentElement;
  if (m === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", m);
  try {
    if (m === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, m);
  } catch {
    /* no storage */
  }
}

/** Apply the saved mode before the first render (the CSP forbids an inline pre-paint script). */
export function applySavedMode() {
  const m = readMode();
  if (m !== "auto") document.documentElement.setAttribute("data-theme", m);
}

export function useTheme(): [ThemeMode, (m: ThemeMode) => void, () => void] {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  useEffect(() => applyMode(mode), [mode]);
  // Cycle: auto → light → dark → auto
  const cycle = () => setMode((m) => (m === "auto" ? "light" : m === "light" ? "dark" : "auto"));
  return [mode, setMode, cycle];
}
