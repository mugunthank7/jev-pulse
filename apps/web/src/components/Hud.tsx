import { ESCALATE_BELOW, LLM_REF, overallConfidence } from "@jev-pulse/schema";
import type { StreamState } from "../lib/stream";

function Counter({ value, format }: { value: number; format: (n: number) => string }) {
  return <span>{format(value)}</span>;
}

const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`);
const dur = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`);

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
  const judgments = n * 5; // five typed questions per item
  const avgLat = n ? items.reduce((a, i) => a + i.latencyMs, 0) / n : 0;
  const perSec = elapsedMs > 0 ? n / (elapsedMs / 1000) : 0;
  const escalated = items.filter((i) => overallConfidence(i.decision) < ESCALATE_BELOW).length;
  const llmCost = n * LLM_REF.costUsd;
  const llmTime = n * LLM_REF.latencyMs; // sequential reference
  const pct = total ? Math.min(100, (n / total) * 100) : 0;

  return (
    <div className="glass w-full p-4 sm:w-[300px]">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">backend</span>
        <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px]">
          <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${running ? "animate-pulse bg-emerald-400" : "bg-white/30"}`} />
          {backend}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
        <Stat label="Decisions" sub={`${n} items × 5 questions`}><Counter value={judgments} format={(v) => Math.round(v).toLocaleString()} /></Stat>
        <Stat label="Throughput" sub="items / second"><Counter value={perSec} format={(v) => v.toFixed(1)} /></Stat>
        <Stat label="Avg latency" sub="per item"><Counter value={avgLat} format={(v) => `${Math.round(v)} ms`} /></Stat>
        <Stat label="Escalate" sub="low confidence → LLM"><Counter value={escalated} format={(v) => String(Math.round(v))} /></Stat>
      </div>
      <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">vs. a frontier LLM</div>
        <div className="mt-2 flex items-baseline justify-between"><span className="text-xs text-white/50">Jev cost</span><span className="font-mono text-lg text-emerald-300">{usd(cost)}</span></div>
        <div className="flex items-baseline justify-between"><span className="text-xs text-white/50">LLM cost</span><span className="font-mono text-sm text-rose-300/80 line-through decoration-white/30">{usd(llmCost)}</span></div>
        <div className="flex items-baseline justify-between"><span className="text-xs text-white/50">LLM time (serial)</span><span className="font-mono text-sm text-rose-300/80">{dur(llmTime)}</span></div>
        <div className="flex items-baseline justify-between"><span className="text-xs text-white/50">Jev time</span><span className="font-mono text-sm text-emerald-300">{dur(elapsedMs)}</span></div>
        <p className="mt-2 text-[10px] leading-snug text-white/30">LLM reference: $0.0304 and ~10 s per decision (TypeSafe's published comparison). Jev cost is estimated from tokens at $0.042/M.</p>
      </div>
    </div>
  );
}
