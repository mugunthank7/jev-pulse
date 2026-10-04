import { useState } from "react";
import { ENGINE_COLOR, ENGINE_ORDER, engineStats, project, type EngineId, type SortState } from "../lib/sort";

const VOLUMES = [1_000, 10_000, 100_000, 1_000_000, 10_000_000];
const CONCURRENCY = 50;
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const money = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString()}` : n >= 10 ? `$${n.toFixed(0)}` : n >= 0.1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const perItem = (n: number) => (n < 0.0001 ? `$${n.toFixed(6)}` : `$${n.toFixed(5)}`);
const vol = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);
const dur = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${(s / 60).toFixed(0)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);

function Mode({ state }: { state: SortState }) {
  if (!state.runId) return null; // nothing loaded yet
  const cls = "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide";
  if (state.synthetic) return <span className={`${cls} border-amber-400/60 bg-amber-400/10 text-amber-300`}>synthetic dev fixture</span>;
  if (state.mode === "live") return <span className={`${cls} border-emerald-400/50 text-emerald-300`}>live api calls</span>;
  return <span className={`${cls} border-sky-400/50 text-sky-300`}>replay of a real run{state.recordedAt ? ` · ${state.recordedAt.slice(0, 10)}` : ""}</span>;
}

export function Metrics({ state, pad }: { state: SortState; pad: boolean }) {
  const [vi, setVi] = useState(3);
  const volume = VOLUMES[vi]!;
  const stats = Object.fromEntries(ENGINE_ORDER.map((e) => [e, engineStats(state.cells[e])])) as Record<EngineId, ReturnType<typeof engineStats>>;
  const live = ENGINE_ORDER.filter((e) => stats[e].n > 0);
  const maxLat = Math.max(...live.map((e) => stats[e].avgLatencyMs), 1);
  const maxCost = Math.max(...live.map((e) => stats[e].avgCostUsd), 1e-12);
  const proj = Object.fromEntries(ENGINE_ORDER.map((e) => [e, project(stats[e], volume, CONCURRENCY)])) as Record<EngineId, ReturnType<typeof project>>;
  const name = (e: EngineId) => state.engines.find((m) => m.id === e)?.label ?? e;
  const jev = stats.jev, rivals = ENGINE_ORDER.filter((e) => e !== "jev" && stats[e].n > 0);
  const priciest = rivals.length ? rivals.reduce((a, b) => (stats[b].avgCostUsd > stats[a].avgCostUsd ? b : a)) : null;
  const saved = priciest && jev.n ? proj[priciest].costUsd - proj.jev.costUsd : 0;
  const slowest = rivals.length ? rivals.reduce((a, b) => (stats[b].avgLatencyMs > stats[a].avgLatencyMs ? b : a)) : null;

  return (
    <aside className={`flex h-full flex-col gap-3 overflow-y-auto p-3 sm:p-4 ${pad ? "lg:pt-16" : ""}`} aria-label="Live latency, cost and accuracy">
      <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold tracking-tight">Live metrics</h2><Mode state={state} /></div>

      {ENGINE_ORDER.map((e) => {
        const s = stats[e], c = ENGINE_COLOR[e];
        return (
          <div key={e} className="glass p-3" style={{ boxShadow: `inset 0 0 0 1px ${c}33` }}>
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 10px ${c}` }} />{name(e)}</div><span className="font-mono text-[10px] text-white/35">{s.n} calls{s.errors ? ` · ${s.errors} err` : ""}</span></div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">accuracy</div><div className="text-lg font-semibold tabular-nums">{s.n ? `${Math.round(s.accuracy * 100)}%` : "-"}</div></div>
              <div><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">latency</div><div className="text-lg font-semibold tabular-nums">{s.n ? ms(s.avgLatencyMs) : "-"}</div></div>
              <div><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">per item</div><div className="text-lg font-semibold tabular-nums">{s.n ? perItem(s.avgCostUsd) : "-"}</div></div>
            </div>
            <div className="mt-2 space-y-1">
              <div className="h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full rounded transition-all duration-500" style={{ width: `${s.n ? Math.max(3, (s.avgLatencyMs / maxLat) * 100) : 0}%`, background: c }} /></div>
              <div className="h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full rounded transition-all duration-500" style={{ width: `${s.n ? Math.max(3, (s.avgCostUsd / maxCost) * 100) : 0}%`, background: c, opacity: 0.55 }} /></div>
            </div>
          </div>
        );
      })}

      <div className="glass p-3">
        <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">Projected at scale</span><span className="font-mono text-[10px] text-white/40">{vol(volume)} items / month</span></div>
        <input aria-label="Monthly volume" type="range" min={0} max={VOLUMES.length - 1} step={1} value={vi} onChange={(e) => setVi(Number(e.target.value))} className="mt-2 w-full accent-fuchsia-400" />
        <div className="mt-1 flex justify-between font-mono text-[9px] text-white/30">{VOLUMES.map((v) => <span key={v}>{vol(v)}</span>)}</div>
        <div className="mt-3 space-y-2">
          {ENGINE_ORDER.map((e) => (
            <div key={e} className="flex items-baseline justify-between gap-2 border-t border-white/10 pt-2">
              <span className="flex items-center gap-1.5 text-xs" style={{ color: ENGINE_COLOR[e] }}><span className="h-2 w-2 rounded-full" style={{ background: ENGINE_COLOR[e] }} />{name(e)}</span>
              <span className="text-right"><span className="text-lg font-semibold tabular-nums">{stats[e].n ? money(proj[e].costUsd) : "-"}</span><span className="block font-mono text-[10px] text-white/40">{stats[e].n ? `${dur(proj[e].queueSeconds)} at ${CONCURRENCY} parallel` : ""}</span></span>
            </div>
          ))}
        </div>
        {priciest && jev.n > 0 && saved > 0 && (
          <div className="mt-3 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">At {vol(volume)}/month Jev costs <b>{money(saved)}</b> less than {name(priciest)}{slowest && stats[slowest].avgLatencyMs > jev.avgLatencyMs ? <> and answers <b>{(stats[slowest].avgLatencyMs / Math.max(jev.avgLatencyMs, 1)).toFixed(1)}×</b> faster than {name(slowest)}</> : null}.</div>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-white/35">Projected from the {live.length ? live.map((e) => stats[e].n).join("/") : "0"} measured calls above: linear scaling of per-item cost and latency at list prices. It ignores caching, batching, rate limits and volume discounts. Accuracy is against human ESCI labels on a small sample; read it as indicative, not definitive.</p>
    </aside>
  );
}
