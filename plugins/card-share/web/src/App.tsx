// The card-share web viewer: a port of pkubdcard's UseFlow onto the end-to-end encrypted
// channel. The code is minted on the sharer's phone; this page only decrypts what the relay
// forwards (../../src/viewer-client.ts, shared with the app's native viewer).

import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { GateKind, ShareMeta } from "../../src/protocol";
import { ShareViewer, type ViewerState, type ViewerStore } from "../../src/viewer-client";
import { Atmosphere } from "./atmosphere";
import { t } from "./i18n";
import { readShare, type PageShare } from "./link";
import { pulse, reveal } from "./motion";
import { useTheme } from "./theme";
import { Button, Card, CountdownRing, Eyebrow, Field, Icon, Notice, QRFrame, Spinner, ThemeToggle } from "./ui";
import { useWakeLock } from "./wakelock";

const store: ViewerStore = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* no storage: a reload just can't resume */
    }
  },
  delete: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

export function App() {
  const [themeMode, , cycleTheme] = useTheme();
  const share = useMemo(() => readShare(window.location), []);

  return (
    <>
      <Atmosphere />
      <div
        class="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-5"
        style="padding-top:max(env(safe-area-inset-top),18px);padding-bottom:max(env(safe-area-inset-bottom),28px)"
      >
        <Masthead themeMode={themeMode} cycleTheme={cycleTheme} />
        <main class="flex flex-1 flex-col justify-center py-7">{share ? <Viewer share={share} /> : <Status icon="alert" text={t.badLink} />}</main>
        {share && <OpenInApp href={share.appLink} />}
        <Colophon />
      </div>
    </>
  );
}

function Masthead({ themeMode, cycleTheme }: { themeMode: ReturnType<typeof useTheme>[0]; cycleTheme: () => void }) {
  return (
    <header class="flex items-center justify-between pt-1">
      <div class="flex items-center gap-3">
        <span class="grid size-9 select-none place-items-center rounded-[10px] bg-seal text-[17px] font-medium text-white" aria-hidden="true">
          燕
        </span>
        <div class="flex flex-col leading-tight">
          <span class="text-[15px] font-medium text-ink">{t.brand}</span>
          <span class="font-mono text-[10.5px] tracking-[0.22em] text-ink-3">{t.brandSub}</span>
        </div>
      </div>
      <ThemeToggle mode={themeMode} onCycle={cycleTheme} />
    </header>
  );
}

function Viewer({ share }: { share: PageShare }) {
  const [state, setState] = useState<ViewerState>({ s: "loading" });
  const viewer = useRef<ShareViewer | null>(null);

  useEffect(() => {
    const v = new ShareViewer({
      base: share.base,
      channelId: share.channelId,
      k: share.k,
      fetch: window.fetch.bind(window),
      WebSocket: typeof WebSocket === "undefined" ? undefined : (WebSocket as never),
      EventSource: typeof EventSource === "undefined" ? undefined : (EventSource as never),
      store,
      onState: setState,
    });
    viewer.current = v;
    void v.start();
    // Mobile browsers pause timers in the background: ask for a fresh code when back.
    const onVisible = () => {
      if (document.visibilityState === "visible") v.want();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      v.stop();
    };
  }, [share]);

  useWakeLock(state.s === "live" || state.s === "waiting");

  switch (state.s) {
    case "loading":
      return (
        <div class="flex flex-col items-center gap-3 text-[14px] text-ink-2">
          <Spinner class="size-6 text-seal" />
          {t.loading}
        </div>
      );
    case "gate":
      return <Gate state={state} onSubmit={(a) => void viewer.current?.submitGate(a)} />;
    case "waiting":
      return <Waiting meta={state.meta} ownerOnline={state.ownerOnline} expires={viewer.current?.expires ?? 0} />;
    case "live":
      return <Live state={state} expires={viewer.current?.expires ?? 0} />;
    case "paused":
      return <Status icon="clock" text={t.paused} detail={state.message} />;
    case "capped":
      return <Status icon="lock" text={t.capped} />;
    case "ended":
      return <Status icon="lock" text={state.reason === "locked" ? t.endedLocked : state.reason === "kicked" ? t.kicked : state.reason === "cap" ? t.capped : t.ended} />;
    case "expired":
      return <Status icon="clock" text={t.expired} />;
    case "taken":
      return <Status icon="person" text={t.taken} />;
    case "error":
      return <Status icon="alert" text={state.message === "bad_link" ? t.badLink : t.error(state.message)} action={state.message === "bad_link" ? undefined : { label: t.retry, onClick: () => void viewer.current?.start() }} />;
  }
}

const label = (meta: ShareMeta) => meta.label ?? meta.nameHint ?? t.someone;

function Gate({ state, onSubmit }: { state: Extract<ViewerState, { s: "gate" }>; onSubmit: (a: { name?: string; pin?: string }) => void }) {
  const ref = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const needName = state.need.includes("name");
  const needPin = state.need.includes("pin");
  const ok = (!needName || name.trim().length > 0) && (!needPin || /^\d{4,8}$/.test(pin));
  useEffect(() => reveal(ref.current), []);

  const wrongText = (w: GateKind[] | undefined) => (w ?? []).map((k) => (k === "pin" ? t.wrongPin : t.wrongName)).join(" · ");

  return (
    <form
      ref={ref}
      class="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !state.busy) onSubmit({ ...(needName ? { name } : {}), ...(needPin ? { pin } : {}) });
      }}
    >
      <header data-reveal class="flex flex-col gap-2">
        <Eyebrow>{t.from(label(state.meta))}</Eyebrow>
        <h2 class="text-[21px] font-semibold tracking-tight text-ink">{t.gateTitle}</h2>
        <p class="text-[14px] leading-relaxed text-ink-2">{t.gateBody}</p>
      </header>

      {needName && (
        <div data-reveal>
          <Field label={t.nameLabel} aux={t.nameAux} htmlFor="name">
            <input
              id="name"
              class="input"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder={state.meta.nameHint}
              autocomplete="off"
              autocorrect="off"
              spellcheck={false}
              autofocus
            />
          </Field>
        </div>
      )}

      {needPin && (
        <div data-reveal>
          <Field label={t.pinLabel} aux={t.pinAux} htmlFor="pin">
            <input
              id="pin"
              class="input font-mono tracking-[0.3em]"
              value={pin}
              onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              placeholder="••••"
              autofocus={!needName}
            />
          </Field>
        </div>
      )}

      {state.remaining !== undefined && (
        <div data-reveal>
          <Notice>
            {wrongText(state.wrong)}
            {state.wrong?.length ? " · " : ""}
            {t.wrong(state.remaining)}
          </Notice>
        </div>
      )}

      <div data-reveal class="flex justify-end">
        <Button type="submit" variant="primary" arrow={!state.busy} busy={state.busy} disabled={!ok}>
          {state.busy ? t.verifying : t.verify}
        </Button>
      </div>
    </form>
  );
}

function ShareFooter({ meta, expires }: { meta: ShareMeta; expires: number }) {
  const now = useNow();
  const parts = [expires ? t.shareLeft(mmss(expires - now)) : "", meta.capYuan != null ? t.cap(meta.capYuan) : ""].filter(Boolean);
  if (!parts.length) return null;
  return <p class="font-mono text-[11px] tracking-wider text-ink-3">{parts.join(" · ")}</p>;
}

function Waiting({ meta, ownerOnline, expires }: { meta: ShareMeta; ownerOnline: boolean; expires: number }) {
  return (
    <div class="flex flex-col items-center gap-5 text-center">
      <header class="flex flex-col items-center gap-1.5">
        <Eyebrow>{t.payTitle}</Eyebrow>
        <p class="text-[14px] text-ink-2">{t.from(label(meta))}</p>
      </header>
      <div class="hero-glow inline-block">
        <div class="qr-frame grid place-items-center" style="width:280px;height:280px">
          <Spinner class="size-6 text-[#c8362b]" />
        </div>
      </div>
      <p class="flex items-center gap-2 text-[13px] text-ink-2">
        {!ownerOnline && <Icon.phone class="size-4 text-seal-ink" />}
        {ownerOnline ? t.waiting : t.offline}
      </p>
      <ShareFooter meta={meta} expires={expires} />
    </div>
  );
}

function Live({ state, expires }: { state: Extract<ViewerState, { s: "live" }>; expires: number }) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [full, setFull] = useState(false);

  // Vendor uses EC level L; modules are inked dark on the always-white plate (pkubdcard).
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(state.code, { errorCorrectionLevel: "L", margin: 1, width: 360, color: { dark: "#141110", light: "#00000000" } }).then((u) => live && setQrUrl(u));
    return () => {
      live = false;
    };
  }, [state.code]);

  // A gentle breath each time the code refreshes.
  useEffect(() => {
    if (qrRef.current) pulse(qrRef.current.querySelector("img"));
  }, [state.seq]);

  return (
    <div class="flex flex-col items-center gap-5 text-center">
      <header class="flex flex-col items-center gap-1.5">
        <Eyebrow>{t.payTitle}</Eyebrow>
        <p class="text-[14px] text-ink-2">
          {t.from(label(state.meta))}
          {state.balance != null && <span class="text-ink-3"> · {t.balance(state.balance.toFixed(2))}</span>}
        </p>
      </header>

      <div ref={qrRef}>{qrUrl && <QRFrame src={qrUrl} alt={t.payTitle} size={244} onClick={() => setFull(true)} />}</div>

      <button
        type="button"
        class="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] tracking-wider text-ink-3 transition-colors hover:text-seal-ink"
        onClick={() => setFull(true)}
      >
        <Icon.expand class="size-3.5" /> {t.tapFull}
      </button>

      {state.ownerOnline ? <CountdownRing seconds={state.refreshS} resetKey={state.seq} label={t.refreshEvery(state.refreshS)} /> : <Notice>{t.offline}</Notice>}

      <ShareFooter meta={state.meta} expires={expires} />

      {full && qrUrl && <FullscreenCode owner={label(state.meta)} qrUrl={qrUrl} seq={state.seq} refreshS={state.refreshS} onClose={() => setFull(false)} />}
    </div>
  );
}

// Tap-to-show fullscreen code (pkubdcard): no web API raises hardware brightness, so maximise
// perceived brightness with a pure-white, edge-to-edge field, forced light in every theme.
function FullscreenCode({ owner, qrUrl, seq, refreshS, onClose }: { owner: string; qrUrl: string; seq: number; refreshS: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const c = 81.68;
  return (
    <div
      class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-white px-6"
      style="padding-top:max(env(safe-area-inset-top),24px);padding-bottom:max(env(safe-area-inset-bottom),24px)"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t.fullLabel}
    >
      <p class="font-mono text-[12px] tracking-[0.18em] text-[#666]">{t.from(owner)}</p>
      <div class="rounded-[22px] border border-[#ededed] bg-white p-4 shadow-[0_12px_44px_-14px_rgba(0,0,0,0.28)]">
        <img src={qrUrl} alt={t.payTitle} class="block" style="width:min(78vw,340px);height:min(78vw,340px)" />
      </div>
      <div class="flex items-center gap-2.5 text-[12.5px] text-[#888]" aria-live="polite">
        <svg width="30" height="30" viewBox="0 0 30 30" key={seq} aria-hidden="true">
          <circle cx="15" cy="15" r="13" fill="none" stroke="#e6e6e6" stroke-width="2.5" />
          <circle
            class="ring-progress"
            cx="15"
            cy="15"
            r="13"
            fill="none"
            stroke="#c8362b"
            stroke-width="2.5"
            stroke-linecap="round"
            transform="rotate(-90 15 15)"
            style={`--ring-c:${c}px;--ring-dur:${refreshS}s;stroke-dasharray:${c}px`}
          />
        </svg>
        <span class="font-mono">{t.fullHint(refreshS)}</span>
      </div>
    </div>
  );
}

function Status({ icon, text, detail, action }: { icon: keyof typeof Icon; text: string; detail?: string; action?: { label: string; onClick: () => void } }) {
  const I = Icon[icon];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => reveal(ref.current), []);
  return (
    <div ref={ref}>
      <Card data-reveal class="flex flex-col items-center gap-4 p-7 text-center">
        <span class="grid size-12 place-items-center rounded-full bg-seal-weak text-seal-ink">
          <I class="size-6" />
        </span>
        <p class="text-[16px] font-medium leading-relaxed text-ink">{text}</p>
        {detail && <p class="text-[13px] leading-relaxed text-ink-2">{detail}</p>}
        {action && (
          <Button variant="ghost" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </Card>
    </div>
  );
}

function OpenInApp({ href }: { href: string }) {
  return (
    <a
      href={href}
      class="mb-4 flex items-center gap-3 rounded-[var(--radius-card)] border border-line px-4 py-3 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <Icon.phone class="size-4 shrink-0 text-ink-3" />
      <span class="flex-1">{t.openApp}</span>
      <Icon.arrow class="size-4 shrink-0 text-ink-3" />
    </a>
  );
}

function Colophon() {
  return (
    <footer class="flex items-start gap-2.5 border-t border-line pt-5 text-[12px] leading-relaxed text-ink-3">
      <Icon.shield class="size-4 shrink-0 translate-y-px" />
      <span>{t.colophon}</span>
    </footer>
  );
}
