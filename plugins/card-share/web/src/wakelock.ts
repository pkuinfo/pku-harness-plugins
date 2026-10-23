// Screen Wake Lock — keeps the phone screen on (and not auto-dimming) while a
// payment barcode is shown. There is NO web API to raise hardware brightness;
// this only prevents sleep/dim. The lock auto-releases when the page is hidden,
// so we re-acquire on visibilitychange. No-op where unsupported (e.g. older iOS).

import { useEffect } from "preact/hooks";

type SentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void };

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<SentinelLike> } };
    if (!nav.wakeLock) return;

    let sentinel: SentinelLike | null = null;
    let stopped = false;

    const acquire = async () => {
      if (sentinel || stopped || document.visibilityState !== "visible") return;
      try {
        sentinel = await nav.wakeLock!.request("screen");
        sentinel.addEventListener?.("release", () => { sentinel = null; });
      } catch {
        /* user gesture missing / unsupported — ignore */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
