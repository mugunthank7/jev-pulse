import { useEffect, useRef } from "react";
import type { ScoredItem } from "@jev-pulse/schema";
import { Sim, type Particle } from "../lib/sim";

type Props = { items: ScoredItem[]; running: boolean; onHover: (item: ScoredItem | null) => void };

/**
 * Canvas2D radar. Additive blending ("lighter") gives the neon glow on dense clusters.
 * Story it tells: raw items enter from the feed (left, grey) -> Jev core decides -> items
 * take their category colour and fly to their cluster.
 */
export function Radar({ items, running, onHover }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef(new Sim());
  const fed = useRef(0);
  const mouse = useRef({ x: -999, y: -999 });
  const hovered = useRef<Particle | null>(null);
  const ticker = useRef<{ text: string; t: number }[]>([]);
  const runningRef = useRef(running);
  useEffect(() => { runningRef.current = running; }, [running]);

  useEffect(() => {
    if (items.length < fed.current) { sim.current.reset(); fed.current = 0; ticker.current = []; }
    const fresh = items.slice(fed.current);
    sim.current.add(fresh, performance.now());
    for (const it of fresh.slice(-4)) ticker.current.push({ text: it.text.slice(0, 44), t: performance.now() });
    ticker.current = ticker.current.slice(-6);
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
      s.step(dt, now);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(5,6,11,0.32)";
      ctx.fillRect(0, 0, s.w, s.h);

      // radar rings + sweep
      ctx.strokeStyle = "rgba(255,255,255,0.035)"; ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(s.cx, s.cy, s.radius * 0.5 * i, 0, Math.PI * 2); ctx.stroke(); }
      const sweep = ((now / 5000) % 1) * Math.PI * 2;
      const g = ctx.createConicGradient(sweep, s.cx, s.cy);
      g.addColorStop(0, "rgba(120,160,255,0.06)"); g.addColorStop(0.08, "rgba(120,160,255,0)"); g.addColorStop(1, "rgba(120,160,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.cx, s.cy, Math.max(s.w, s.h), 0, Math.PI * 2); ctx.fill();

      // incoming feed lane (left)
      const laneTop = s.cy - s.h * 0.25, laneBot = s.cy + s.h * 0.25;
      const lane = ctx.createLinearGradient(0, 0, s.cx, 0);
      lane.addColorStop(0, "rgba(140,170,255,0.07)"); lane.addColorStop(1, "rgba(140,170,255,0)");
      ctx.fillStyle = lane; ctx.beginPath(); ctx.moveTo(0, laneTop); ctx.lineTo(s.cx, s.cy - 10); ctx.lineTo(s.cx, s.cy + 10); ctx.lineTo(0, laneBot); ctx.closePath(); ctx.fill();
      ctx.font = "600 10px ui-monospace, monospace"; ctx.textAlign = "left";
      ctx.fillStyle = "rgba(170,190,255,0.75)"; ctx.fillText("INCOMING FEED", 16, laneTop - 8);
      ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fillText("unsorted →", 16, laneTop + 6);
      // ticker of raw text entering
      ticker.current.forEach((t, i) => {
        const age = (now - t.t) / 2400;
        if (age > 1) return;
        ctx.fillStyle = `rgba(210,220,255,${0.55 * (1 - age)})`;
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillText(t.text, 16, laneBot + 20 + i * 14);
      });

      // Jev core
      const pulse = 1 + 0.06 * Math.sin(now / 300);
      const coreR = 22 * pulse;
      const cg = ctx.createRadialGradient(s.cx, s.cy, 2, s.cx, s.cy, coreR * 2.4);
      cg.addColorStop(0, runningRef.current ? "rgba(150,200,255,0.55)" : "rgba(150,200,255,0.25)"); cg.addColorStop(1, "rgba(150,200,255,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(s.cx, s.cy, coreR * 2.4, 0, Math.PI * 2); ctx.fill();
      for (const f of s.flashes) {
        const a = 1 - (now - f.t) / 500;
        ctx.strokeStyle = `hsla(${f.hue},90%,70%,${0.5 * a})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.cx, s.cy, coreR + (1 - a) * 30, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(190,220,255,0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.cx, s.cy, coreR, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(230,240,255,0.95)"; ctx.textAlign = "center"; ctx.font = "700 11px ui-monospace, monospace";
      ctx.fillText("JEV", s.cx, s.cy + 4);
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(`${s.sorted} sorted`, s.cx, s.cy + coreR + 16);

      // cluster labels sit just outside each cluster, on the radial line from the core
      for (const a of s.anchors) {
        const off = s.radius * 0.36 + 18;
        const lx = a.x + a.dx * off, ly = a.y + a.dy * off;
        ctx.textAlign = "center";
        ctx.font = "700 11px ui-monospace, monospace";
        ctx.fillStyle = `hsla(${a.hue},90%,72%,0.95)`;
        ctx.fillText(a.label.toUpperCase(), lx, ly);
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillText(String(a.count), lx, ly + 14);
      }

      // particles
      ctx.globalCompositeOperation = "lighter";
      let best: Particle | null = null, bestD = 14 * 14;
      for (const p of s.particles) {
        if (p.stage === 0) {
          // unsorted: neutral grey-blue comet
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7);
          grad.addColorStop(0, "rgba(200,215,255,0.8)"); grad.addColorStop(1, "rgba(200,215,255,0)");
          ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
          continue;
        }
        const age = Math.min((now - p.sortedAt) / 500, 1);
        const glow = p.r * (1.6 + p.conf * 1.2) * (0.5 + 0.5 * age) * (1 + (1 - age) * 1.5);
        const pulseA = p.escalate ? 0.55 + 0.45 * Math.sin(now / 220 + p.angle) : 1;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
        const sat = 55 + p.conf * 40;
        grad.addColorStop(0, `hsla(${p.hue},${sat}%,${60 + p.conf * 15}%,${0.7 * pulseA})`);
        grad.addColorStop(0.35, `hsla(${p.hue},${sat}%,55%,${0.16 * pulseA})`);
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
