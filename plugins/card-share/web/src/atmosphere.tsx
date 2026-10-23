// Lightweight Canvas atmosphere — a faint drifting "technical field" of dots
// with occasional hairline links and a rare seal-tinted mote. Sits fixed behind
// everything, fades out toward the centre (radial mask) so it never competes
// with the token / QR hero. Cheap: <=56 motes, rAF-throttled, pauses when the
// tab is hidden, and never starts under prefers-reduced-motion.

import { useEffect, useRef } from "preact/hooks";

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  seal: boolean;
}

export function Atmosphere() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const c = ctx; // non-null captures for nested closures
    const canvas = cv;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let motes: Mote[] = [];
    let raf = 0;
    let running = true;
    let frame = 0;

    // Theme-dependent colours, re-read on resize + theme mutation.
    let lineColor = "rgba(0,0,0,0.04)";
    let sealColor = "#c8362b";
    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      lineColor = cs.getPropertyValue("--grid-line").trim() || lineColor;
      sealColor = cs.getPropertyValue("--seal").trim() || sealColor;
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(56, Math.round((w * h) / 28000));
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: Math.random() * 1.3 + 0.4,
        seal: Math.random() < 0.08,
      }));
      readColors();
    }

    function step() {
      frame++;
      c.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;
      const maxD = Math.hypot(cx, cy);

      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        m.x += m.vx;
        m.y += m.vy;
        if (m.x < 0) m.x += w;
        if (m.x > w) m.x -= w;
        if (m.y < 0) m.y += h;
        if (m.y > h) m.y -= h;

        // radial mask: fade toward centre so the hero stays clean
        const d = Math.hypot(m.x - cx, m.y - cy) / maxD;
        const fade = Math.min(1, Math.max(0, (d - 0.18) * 1.4));

        c.beginPath();
        c.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        if (m.seal) {
          c.fillStyle = sealColor;
          c.globalAlpha = 0.22 * fade;
        } else {
          c.fillStyle = lineColor;
          c.globalAlpha = fade;
        }
        c.fill();

        // sparse links between near neighbours
        for (let j = i + 1; j < motes.length; j++) {
          const n = motes[j];
          const dx = m.x - n.x;
          const dy = m.y - n.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < 9000) {
            c.beginPath();
            c.moveTo(m.x, m.y);
            c.lineTo(n.x, n.y);
            c.strokeStyle = lineColor;
            c.globalAlpha = (1 - dist2 / 9000) * 0.5 * fade;
            c.lineWidth = 0.6;
            c.stroke();
          }
        }
      }
      c.globalAlpha = 1;
      if (frame % 600 === 0) readColors();
      if (running) raf = requestAnimationFrame(step);
    }

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(step);
      }
    }

    resize();
    raf = requestAnimationFrame(step);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    const mo = new MutationObserver(readColors);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      mo.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      class="pointer-events-none fixed inset-0 z-0"
    />
  );
}
