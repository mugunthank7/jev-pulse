import { ESCALATE_BELOW, overallConfidence } from "@jev-pulse/schema";
import type { StreamState } from "../lib/stream";

function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{children}</div>
      {sub && <div className="text-[11px] text-white/40">{sub}</div>}
    </div>
  );
}

export function Hud({ state }: { state: StreamState }) {
  const { items, elapsedMs, total, running, backend } = state;
  const n = items.length;
  const cost = items.reduce((a, i) => a + i.costUsd, 0);
  const avgLat = n ? items.reduce((a, i) => a + i.latencyMs, 0) / n : 0;
  const perSec = elapsedMs > 0 ? n / (elapsedMs / 1000) : 0;
  const escalated = items.filter((i) => overallConfidence(i.decision) < ESCALATE_BELOW).length;
  const labeled = items.filter((i) => i.correct !== undefined);
  const right = labeled.filter((i) => i.correct).length;
  const acc = labeled.length ? right / labeled.length : null;
  const pct = total ? Math.min(100, (n / total) * 100) : 0;

  return (
    <div className="glass w-full p-4 sm:w-[300px]">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">backend</span>
        <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px]">
          <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${running ? "animate-pulse bg-emerald-400" : "bg-white/30"}`} />
          {backend === "mock" ? "offline mock" : `${backend} · typesafe/jev-1.13`}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
        <Stat label="Classified" sub={`${n * 5} typed answers`}>{n}</Stat>
        <Stat label="Accuracy" sub={labeled.length ? `${right}/${labeled.length} vs maintainer labels` : "no labels (live scan)"}>{acc === null ? "-" : `${Math.round(acc * 100)}%`}</Stat>
        <Stat label="Avg latency" sub="per issue, 5 questions">{Math.round(avgLat)} ms</Stat>
        <Stat label="Throughput" sub="issues / second">{perSec.toFixed(1)}</Stat>
      </div>
      <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">billed cost</div>
        <div className="mt-2 flex items-baseline justify-between"><span className="text-xs text-white/50">this run</span><span className="font-mono text-lg text-emerald-300">${cost < 0.01 ? cost.toFixed(5) : cost.toFixed(3)}</span></div>
        <div className="flex items-baseline justify-between"><span className="text-xs text-white/50">per 1,000 issues</span><span className="font-mono text-sm text-emerald-300">${n ? ((cost / n) * 1000).toFixed(3) : "0.000"}</span></div>
        <div className="flex items-baseline justify-between"><span className="text-xs text-white/50">low confidence</span><span className="font-mono text-sm text-white/70">{escalated} → escalate</span></div>
        <p className="mt-2 text-[10px] leading-snug text-white/30">Cost is what OpenRouter billed. Compare against Claude and Gemini in the Model race tab.</p>
      </div>
    </div>
  );
}
