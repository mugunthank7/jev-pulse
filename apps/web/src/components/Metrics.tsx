import { useState } from "react";
import { ENGINE_ORDER, engineStats, project, type EngineId, type SortState } from "../lib/sort";
import { ENGINE_THEME } from "../lib/theme";

const VOLUMES = [1_000, 10_000, 100_000, 1_000_000, 10_000_000];
const CONCURRENCY = 50;
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const money = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString()}` : n >= 10 ? `$${n.toFixed(0)}` : n >= 0.1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const vol = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);
const dur = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${(s / 60).toFixed(0)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);
const label = "text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a93ad]";

function Source({ state }: { state: SortState }) {
  if (!state.runId) return null;
  const base = "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide";
  if (state.synthetic) return <span className={`${base} bg-amber-100 text-amber-800`}>synthetic dev fixture</span>;
  if (state.mode === "live") return <span className={`${base} bg-emerald-100 text-emerald-800`}>live api calls</span>;
  return <span className={`${base} bg-sky-100 text-sky-800`}>recorded real run{state.recordedAt ? ` · ${state.recordedAt.slice(0, 10)}` : ""}</span>;
}

export function Metrics({ state }: { state: SortState }) {
  const [vi, setVi] = useState(3);
  const volume = VOLUMES[vi]!;
  const stats = Object.fromEntries(ENGINE_ORDER.map((e) => [e, engineStats(state.cells[e])])) as Record<EngineId, ReturnType<typeof engineStats>>;
  const live = ENGINE_ORDER.filter((e) => stats[e].n > 0);
  const maxLat = Math.max(...live.map((e) => stats[e].avgLatencyMs), 1);
  const maxCost = Math.max(...live.map((e) => stats[e].avgCostUsd), 1e-12);
  const proj = Object.fromEntries(ENGINE_ORDER.map((e) => [e, project(stats[e], volume, CONCURRENCY)])) as Record<EngineId, ReturnType<typeof project>>;
  const name = (e: EngineId) => state.engines.find((m) => m.id === e)?.label ?? ({ jev: "Jev", gemini: "Gemini", claude: "Claude" } as const)[e];
  const rivals = ENGINE_ORDER.filter((e) => e !== "jev" && stats[e].n > 0);
  const priciest = rivals.length ? rivals.reduce((a, b) => (stats[b].avgCostUsd > stats[a].avgCostUsd ? b : a)) : null;
  const slowest = rivals.length ? rivals.reduce((a, b) => (stats[b].avgLatencyMs > stats[a].avgLatencyMs ? b : a)) : null;
  const saved = priciest && stats.jev.n ? proj[priciest].costUsd - proj.jev.costUsd : 0;

  return (
    <aside className="scroll flex h-full flex-col gap-3 overflow-y-auto pr-1" aria-label="Dataset, accuracy, latency and cost">
      <div className="card p-4">
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold">Dataset</h2><Source state={state} /></div>
        <p className="mt-2 text-[13px] leading-snug font-semibold">Amazon Shopping Queries (ESCI)</p>
        <ul className="mt-1.5 space-y-1 text-xs leading-snug text-[#5b6685]">
          <li>Real shopper queries + real Amazon products</li>
          <li>Human-labeled: <b className="text-[#0b7a5a]">exact</b>, <b className="text-[#8a6700]">substitute</b> or <b className="text-[#b3304b]">no match</b></li>
          <li>653 labeled products · 40 queries · class-balanced sample</li>
        </ul>
        <a href="https://github.com/amazon-science/esci-data" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[11px] font-medium text-[#6a5fe0] hover:underline">amazon-science/esci-data ↗</a>
      </div>

      {ENGINE_ORDER.map((e) => {
        const s = stats[e], t = ENGINE_THEME[e];
        return (
          <div key={e} className="card p-4" style={{ borderColor: `${t.line}88` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.ink }}><span className="h-3 w-3 rounded-full" style={{ background: t.line }} />{name(e)}</div>
              <span className="text-[11px] text-[#8a93ad]">{s.n} calls{s.errors ? ` · ${s.errors} failed` : ""}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div><div className={label}>accuracy</div><div className="text-xl font-extrabold tabular-nums">{s.n ? `${Math.round(s.accuracy * 100)}%` : "–"}</div><div className="text-[10px] text-[#8a93ad]">{s.n ? `${s.correct} of ${s.n}` : ""}</div></div>
              <div><div className={label}>latency</div><div className="text-xl font-extrabold tabular-nums">{s.n ? ms(s.avgLatencyMs) : "–"}</div><div className="text-[10px] text-[#8a93ad]">per item</div></div>
              <div><div className={label}>cost</div><div className="text-xl font-extrabold tabular-nums">{s.n ? money(s.avgCostUsd * 1000) : "–"}</div><div className="text-[10px] text-[#8a93ad]">per 1,000 items</div></div>
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-[#eef0f8]"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${s.n ? Math.max(4, (s.avgLatencyMs / maxLat) * 100) : 0}%`, background: t.line }} /></div>
              <div className="h-2 overflow-hidden rounded-full bg-[#eef0f8]"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${s.n ? Math.max(4, (s.avgCostUsd / maxCost) * 100) : 0}%`, background: t.line, opacity: 0.55 }} /></div>
            </div>
          </div>
        );
      })}

      <div className="card p-4">
        <div className="flex items-baseline justify-between"><h2 className="text-sm font-bold">Projected at scale</h2><span className="text-xs font-semibold text-[#6a5fe0]">{vol(volume)} items / month</span></div>
        <input aria-label="Monthly volume" type="range" min={0} max={VOLUMES.length - 1} step={1} value={vi} onChange={(e) => setVi(Number(e.target.value))} className="mt-2 w-full accent-[#8b7cf0]" />
        <div className="mt-0.5 flex justify-between text-[10px] text-[#8a93ad]">{VOLUMES.map((v) => <span key={v}>{vol(v)}</span>)}</div>
        <div className="mt-3 space-y-2.5">
          {ENGINE_ORDER.map((e) => (
            <div key={e} className="flex items-baseline justify-between gap-2 border-t border-[#eef0f8] pt-2.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: ENGINE_THEME[e].ink }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: ENGINE_THEME[e].line }} />{name(e)}</span>
              <span className="text-right"><span className="text-lg font-extrabold tabular-nums">{stats[e].n ? money(proj[e].costUsd) : "–"}</span><span className="block text-[10px] text-[#8a93ad]">{stats[e].n ? `${dur(proj[e].queueSeconds)} at ${CONCURRENCY} parallel` : ""}</span></span>
            </div>
          ))}
        </div>
        {priciest && stats.jev.n > 0 && saved > 0 && (
          <div className="mt-3 rounded-xl bg-[#d9f5ea] px-3 py-2 text-xs leading-snug text-[#0b7a5a]">At {vol(volume)} a month, Jev costs <b>{money(saved)}</b> less than {name(priciest)}{slowest && stats[slowest].avgLatencyMs > stats.jev.avgLatencyMs ? <> and answers <b>{(stats[slowest].avgLatencyMs / Math.max(stats.jev.avgLatencyMs, 1)).toFixed(1)}×</b> faster than {name(slowest)}</> : null}.</div>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-[#8a93ad]">Projection, not a measurement: linear scaling of the {live.length ? live.map((e) => stats[e].n).join("/") : "0"} measured calls at list prices. Ignores caching, batching, rate limits and discounts. Accuracy is vs human labels on a small sample.</p>
      </div>
    </aside>
  );
}
