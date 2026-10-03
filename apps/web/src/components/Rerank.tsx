import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { Candidate, EsciLabel } from "@jev-pulse/schema";
import { emptyTotals, useNow, useRerank, type Lane, type LaneMeta, type QueryRun, type Totals } from "../lib/rerank";

const COLOR: Record<Lane | "baseline", string> = { baseline: "#94a3b8", jev: "#34d399", gemini: "#60a5fa", claude: "#fb923c" };
const LABEL_COLOR: Record<EsciLabel, string> = { Exact: "#34d399", Substitute: "#fbbf24", Complement: "#60a5fa", Irrelevant: "#fb7185" };
const TOP = 10;
const ROW = 62;
const usd = (n: number) => (n < 0.001 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const fixed = (n: number, d = 3) => n.toFixed(d);

type QInfo = { queryId: number; query: string; candidates: number; exact: number };
type Options = { gemini: { default: string; options: { model: string; label: string }[] }; claude: { default: string; options: { model: string; label: string }[] } };

function Card({ c, rank }: { c: Candidate; rank: number }) {
  const col = LABEL_COLOR[c.label];
  return (
    <motion.li layout transition={{ type: "spring", stiffness: 260, damping: 28 }} className="absolute inset-x-0 flex h-[56px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2" style={{ top: 0, borderLeft: `3px solid ${col}` }} animate={{ y: rank * ROW, opacity: rank < TOP ? 1 : 0.0 }}>
      <span className="w-4 shrink-0 text-center font-mono text-[10px] text-white/30">{rank + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[11px] leading-tight text-white/85">{c.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5"><span className="rounded px-1 font-mono text-[9px] font-semibold uppercase" style={{ background: `${col}22`, color: col }}>{c.label}</span>{c.brand && <span className="truncate font-mono text-[9px] text-white/30">{c.brand}</span>}</div>
      </div>
    </motion.li>
  );
}

function Column({ id, title, sub, run, order, state, ndcg, delta, latency, cost }: {
  id: Lane | "baseline"; title: string; sub: string; run: QueryRun; order: number[]; state: React.ReactNode; ndcg?: number; delta?: number; latency?: number; cost?: number;
}) {
  const color = COLOR[id];
  const rank = useMemo(() => { const r = new Map<number, number>(); order.forEach((idx, pos) => r.set(idx, pos)); return r; }, [order]);
  return (
    <div className="glass flex min-w-0 flex-col p-3" style={{ boxShadow: `inset 0 0 0 1px ${color}33` }}>
      <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} /><span className="text-sm font-semibold">{title}</span></div>
      <div className="truncate font-mono text-[10px] text-white/30">{sub}</div>
      <div className="mt-2 flex h-[58px] items-end justify-between rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5">
        {ndcg !== undefined ? (
          <>
            <div><div className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/35">nDCG@10</div><div className="text-2xl leading-none font-semibold tabular-nums">{fixed(ndcg)}</div></div>
            <div className="text-right font-mono text-[10px]">
              {delta !== undefined && <div className={delta >= 0 ? "text-emerald-300" : "text-rose-300"}>{delta >= 0 ? "▲ +" : "▼ "}{fixed(delta)}</div>}
              {latency !== undefined && <div style={{ color }}>{ms(latency)}</div>}
              {cost !== undefined && <div className="text-white/45">{usd(cost)}</div>}
            </div>
          </>
        ) : <div className="self-center text-[11px] text-white/60">{state}</div>}
      </div>
      <ul className="relative mt-2 overflow-hidden" style={{ height: ROW * TOP - 6 }}>
        {run.candidates.map((c, i) => <Card key={c.id} c={c} rank={rank.get(i) ?? i} />)}
      </ul>
    </div>
  );
}

function Scoreboard({ totals, lanes }: { totals: Totals; lanes: LaneMeta[] }) {
  const base = totals.queries ? totals.baseline / totals.queries : 0;
  const rows = lanes.map((l) => {
    const t = totals.lanes[l.id];
    return { l, n: t.n, ndcg: t.n ? t.ndcg / t.n : 0, exact5: t.n ? t.exact5 / t.n : 0, lat: t.n ? t.latency / t.n : 0, cost: t.n ? t.cost / t.n : 0, errors: t.errors };
  });
  const live = rows.filter((r) => r.n > 0);
  const maxLift = Math.max(0.01, ...live.map((r) => Math.abs(r.ndcg - base)));
  const maxLat = Math.max(...live.map((r) => r.lat), 1), minLat = Math.min(...live.map((r) => r.lat), maxLat);
  const maxCost = Math.max(...live.map((r) => r.cost), 1e-12), minCost = Math.min(...live.map((r) => r.cost), maxCost);
  const logW = (v: number, min: number, max: number) => (max <= min ? 100 : Math.max(3, ((Math.log10(v) - Math.log10(min / 2.5)) / (Math.log10(max) - Math.log10(min / 2.5))) * 100));
  const bestLat = live.length ? Math.min(...live.map((r) => r.lat)) : 0, bestCost = live.length ? Math.min(...live.map((r) => r.cost)) : 0, bestLift = live.length ? Math.max(...live.map((r) => r.ndcg)) : 0;
  const Bar = ({ pct, color, label, best }: { pct: number; color: string; label: string; best: boolean }) => (
    <div className="relative h-6 overflow-hidden rounded-md bg-white/5"><motion.div className="h-full rounded-md" animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} style={{ background: color, boxShadow: `0 0 16px ${color}55` }} /><span className="absolute inset-y-0 left-1.5 my-auto h-[18px] rounded bg-black/70 px-1.5 font-mono text-[11px] leading-[18px] font-semibold">{label}{best ? " ▲" : ""}</span></div>
  );
  return (
    <div className="glass grid gap-5 p-4 sm:grid-cols-3 sm:p-5">
      <div>
        <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-semibold">Quality</span><span className="font-mono text-[10px] text-white/35">mean nDCG@10 · baseline {totals.queries ? fixed(base) : "-"}</span></div>
        <div className="space-y-2">{rows.map((r) => <Bar key={r.l.id} pct={r.n ? 4 + (Math.abs(r.ndcg - base) / maxLift) * 96 : 0} color={r.ndcg >= base ? COLOR[r.l.id] : "#fb7185"} label={r.n ? `${fixed(r.ndcg)} (${r.ndcg - base >= 0 ? "+" : ""}${fixed(r.ndcg - base)})` : "-"} best={r.n > 0 && r.ndcg === bestLift && live.length > 1} />)}</div>
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-semibold">Speed</span><span className="font-mono text-[10px] text-white/35">avg latency per search</span></div>
        <div className="space-y-2">{rows.map((r) => <Bar key={r.l.id} pct={r.n ? logW(r.lat, minLat, maxLat) : 0} color={COLOR[r.l.id]} label={r.n ? ms(r.lat) : "-"} best={r.n > 0 && r.lat === bestLat && live.length > 1} />)}</div>
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-semibold">Cost</span><span className="font-mono text-[10px] text-white/35">per 1,000 searches</span></div>
        <div className="space-y-2">{rows.map((r) => <Bar key={r.l.id} pct={r.n ? logW(r.cost, minCost, maxCost) : 0} color={COLOR[r.l.id]} label={r.n ? usd(r.cost * 1000) : "-"} best={r.n > 0 && r.cost === bestCost && live.length > 1} />)}</div>
      </div>
    </div>
  );
}

export function Rerank() {
  const { run, totals, running, error, runBatch, stop } = useRerank();
  const [queries, setQueries] = useState<QInfo[]>([]);
  const [opts, setOpts] = useState<Options | null>(null);
  const [gemini, setGemini] = useState(""), [claude, setClaude] = useState(""), [qid, setQid] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/rerank/queries").then((r) => r.json()).then((d: { queries: QInfo[] }) => { setQueries(d.queries); setQid(d.queries[0]?.queryId ?? null); }).catch(() => {});
    fetch("/api/arena/models").then((r) => r.json()).then((o: Options) => { setOpts(o); setGemini(o.gemini.default); setClaude(o.claude.default); }).catch(() => {});
  }, []);

  const pending = !!run && !run.done && !running ? true : running && !!run && !run.done;
  const now = useNow(pending);
  const defaultLanes: LaneMeta[] = [{ id: "jev", label: "Jev 1.13", model: "typesafe/jev-1.13" }, { id: "gemini", label: "Gemini", model: gemini }, { id: "claude", label: "Claude", model: claude }];
  const lanes = run?.lanes ?? defaultLanes;
  const pickedQuery = queries.find((q) => q.queryId === qid);
  const idle = !run;

  const creditError = (e?: string) => (/requires more credits|exceed your available credits|in-flight/.test(e ?? "") ? "Out of OpenRouter credits. Add ~$5 at openrouter.ai/settings/credits." : e);

  const laneState = (id: Lane): React.ReactNode => {
    if (!run) return "waiting";
    if (run.errors[id]) return <span className="text-rose-300">{creditError(run.errors[id])}</span>;
    if (run.retry[id]) return <span className="text-amber-300">⚠ {run.retry[id]}</span>;
    const p = run.progress[id];
    if (id === "jev") return <span>judging pairs {p ? `${p.done}/${p.total}` : "…"} · {ms(now - run.startedAt)}</span>;
    return <span>reading {run.candidates.length} products · {ms(now - run.startedAt)}</span>;
  };

  return (
    <div className="h-full w-full overflow-y-auto px-4 pt-28 pb-24 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => (running ? stop() : qid !== null && runBatch([qid], gemini, claude))} className={`rounded-full px-4 py-1.5 text-xs font-semibold ${running ? "border border-rose-400/40 bg-rose-400/10 text-rose-200" : "bg-gradient-to-r from-cyan-400 to-fuchsia-400 text-black"}`}>{running ? "Stop" : "Rerank this search"}</button>
          <button disabled={running || !queries.length} onClick={() => runBatch(queries.slice(0, 10).map((q) => q.queryId), gemini, claude)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40">Run 10 searches</button>
          <select disabled={running} value={qid ?? ""} onChange={(e) => setQid(Number(e.target.value))} className="max-w-[220px] rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none">{queries.map((q) => <option key={q.queryId} value={q.queryId} className="bg-neutral-900">{q.query} ({q.candidates})</option>)}</select>
          {opts && (<>
            <select disabled={running} value={gemini} onChange={(e) => setGemini(e.target.value)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none">{opts.gemini.options.map((o) => <option key={o.model} value={o.model} className="bg-neutral-900">{o.label}</option>)}</select>
            <select disabled={running} value={claude} onChange={(e) => setClaude(e.target.value)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none">{opts.claude.options.map((o) => <option key={o.model} value={o.model} className="bg-neutral-900">{o.label}</option>)}</select>
          </>)}
          {totals.queries > 0 && <span className="ml-auto font-mono text-xs text-white/50">{totals.queries} searches reranked</span>}
        </div>
        {error && <div className="rounded-lg border border-rose-400/30 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">{error}</div>}

        <div className="flex items-center gap-3 rounded-full border border-white/15 bg-white/[0.06] px-5 py-3 text-lg shadow-[0_0_40px_rgba(120,160,255,0.08)]">
          <span className="text-white/40">🔍</span><span className="truncate font-medium">{run?.query ?? pickedQuery?.query ?? "search…"}</span>
          {run && <span className="ml-auto font-mono text-[11px] text-white/35">{run.candidates.length} candidates · {run.candidates.filter((c) => c.label === "Exact").length} exact matches (human-judged)</span>}
        </div>

        {idle ? (
          <div className="glass grid place-items-center px-6 py-20 text-center"><div><div className="text-lg text-white/70">Same 15–30 real Amazon products. Four ways to order them.</div><div className="mt-2 text-sm text-white/40">Baseline keyword search, then Jev, Gemini and Claude each rerank. Cards slide into their new positions; green = a human judged it an exact match.</div></div></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Column id="baseline" title="Keyword baseline" sub="BM25 over title + details" run={run} order={run.baseline.order} state="" ndcg={run.baseline.ndcg10} latency={undefined} />
            {lanes.map((l) => {
              const r = run.results[l.id];
              return <Column key={l.id} id={l.id} title={l.label} sub={l.id === "jev" ? "one decision per product, in parallel" : "one listwise ranking call"} run={run} order={r?.order ?? run.baseline.order} state={laneState(l.id)} ndcg={r?.ndcg10} delta={r ? r.ndcg10 - run.baseline.ndcg10 : undefined} latency={r?.latencyMs} cost={r?.costUsd} />;
            })}
          </div>
        )}

        <Scoreboard totals={totals.queries || running || run ? totals : emptyTotals()} lanes={lanes} />
        <p className="text-[11px] leading-relaxed text-white/35">Data: Amazon Shopping Queries (ESCI), human relevance judgments. nDCG@10 uses the ESCI gains (exact 1, substitute 0.1, complement 0.01, irrelevant 0). Jev judges every query/product pair in parallel and ranks by expected relevance; Gemini and Claude each get one listwise ranking call. Latency is wall-clock per search, cost is what OpenRouter billed. Small samples have wide error bars.</p>
      </div>
    </div>
  );
}
