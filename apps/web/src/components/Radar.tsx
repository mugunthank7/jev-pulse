import { useEffect, useRef } from "react";
import type { ScoredItem } from "@jev-pulse/schema";
import { Sim, type Particle } from "../lib/sim";

type Props = { items: ScoredItem[]; onHover: (item: ScoredItem | null) => void };

/** Canvas2D radar. Additive blending ("lighter") gives the neon glow on dense clusters. */
export function Radar({ items, onHover }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef(new Sim());
  const fed = useRef(0);
  const mouse = useRef({ x: -999, y: -999 });
  const hovered = useRef<Particle | null>(null);

  // Feed new items into the simulation (reset when a new stream starts).
  useEffect(() => {
    if (items.length < fed.current) { sim.current.reset(); fed.current = 0; }
    sim.current.add(items.slice(fed.current), performance.now());
    fed.current = items.length;
  }, [items]);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fit = () => {
      const { clientWidth: w, clientHeight: h } = cv;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.resize(w, h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      s.step(dt);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(5,6,11,0.35)"; // motion trails
      ctx.fillRect(0, 0, s.w, s.h);

      // concentric radar rings + sweep
      ctx.strokeStyle = "rgba(255,255,255,0.035)"; ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(s.w / 2, s.h / 2, (Math.min(s.w, s.h) * 0.18) * i, 0, Math.PI * 2); ctx.stroke(); }
      const sweep = (now / 4000) % 1 * Math.PI * 2;
      const g = ctx.createConicGradient(sweep, s.w / 2, s.h / 2);
      g.addColorStop(0, "rgba(120,160,255,0.07)"); g.addColorStop(0.08, "rgba(120,160,255,0)");
      g.addColorStop(1, "rgba(120,160,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.w / 2, s.h / 2, Math.max(s.w, s.h), 0, Math.PI * 2); ctx.fill();

      // anchor labels
      ctx.globalCompositeOperation = "source-over";
      ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "center";
      for (const a of s.anchors) {
        ctx.fillStyle = `hsla(${a.hue},90%,70%,0.9)`;
        ctx.fillText(a.label.toUpperCase(), a.x, a.y - Math.min(s.w, s.h) * 0.19 - 10);
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillText(String(a.count), a.x, a.y - Math.min(s.w, s.h) * 0.19 + 6);
      }

      // particles
      ctx.globalCompositeOperation = "lighter";
      let best: Particle | null = null, bestD = 14 * 14;
      for (const p of s.particles) {
        const age = Math.min((now - p.born) / 600, 1);
        const glow = p.r * (1.6 + p.conf * 1.2) * (0.4 + 0.6 * age);
        const pulse = p.escalate ? 0.55 + 0.45 * Math.sin(now / 220 + p.angle) : 1;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
        const sat = 55 + p.conf * 40;
        grad.addColorStop(0, `hsla(${p.hue},${sat}%,${60 + p.conf * 15}%,${0.7 * pulse})`);
        grad.addColorStop(0.35, `hsla(${p.hue},${sat}%,55%,${0.16 * pulse})`);
        grad.addColorStop(1, `hsla(${p.hue},${sat}%,50%,0)`);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, glow, 0, Math.PI * 2); ctx.fill();
        const dx = p.x - mouse.current.x, dy = p.y - mouse.current.y, d = dx * dx + dy * dy;
        if (d < bestD) { best = p; bestD = d; }
      }
      if (best !== hovered.current) { hovered.current = best; onHover(best ? (best as Particle).item : null); }
      if (best) {
        const b = best as Particle;
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2); ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [onHover]);

  return (
    <canvas
      ref={canvas}
      className="absolute inset-0 h-full w-full"
      onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top }; }}
      onPointerLeave={() => { mouse.current = { x: -999, y: -999 }; }}
    />
  );
}
