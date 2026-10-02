import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_HUE } from "../lib/sim";
import { laneStats, useArena, useNow, type LaneId, type LaneInfo, type LaneResult, type LaneStats } from "../lib/arena";

const LANE_COLOR: Record<LaneId, string> = { jev: "#34d399", gemini: "#60a5fa", claude: "#fb923c" };
const LANE_ORDER: LaneId[] = ["jev", "gemini", "claude"];
const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const classColor = (c?: string) => (c && CATEGORY_HUE[c] !== undefined ? `hsl(${CATEGORY_HUE[c]} 85% 62%)` : "#94a3b8");

type Options = { gemini: { default: string; options: { model: string; label: string }[] }; claude: { default: string; options: { model: string; label: string }[] } };
type Flyer = { key: string; lane: LaneId; fromX: number; fromY: number; toX: number; toY: number };

function Chip({ cls }: { cls?: string }) {
  return <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase" style={{ background: `${classColor(cls)}22`, color: classColor(cls), border: `1px solid ${classColor(cls)}55` }}>{cls ?? "?"}</span>;
}

function Pop({ value, children }: { value: string | number; children: React.ReactNode }) {
  return <motion.span key={String(value)} initial={{ scale: 1.22, y: -2 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 500, damping: 18 }} className="inline-block">{children}</motion.span>;
}

function LaneCard({ lane, results, stats, round, now, dispatchedAt, retry, truth, setRef, running }: {
  lane: LaneInfo; results: Record<number, LaneResult>; stats: LaneStats; round: number; now: number; dispatchedAt: number | null;
  retry?: string; truth?: string; setRef: (el: HTMLDivElement | null) => void; running: boolean;
}) {
  const color = LANE_COLOR[lane.id];
  const cur = results[round];
  const live = cur?.status === "pending" && dispatchedAt ? now - dispatchedAt : 0;
  const strip = Object.entries(results).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <motion.div layout className="glass relative overflow-hidden p-3 sm:p-4" style={{ boxShadow: `inset 0 0 0 1px ${color}33, 0 0 40px ${color}10` }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} /><span className="text-sm font-semibold">{lane.label}</span></div>
        <span className="hidden font-mono text-[10px] text-white/30 sm:inline">{lane.model}</span>
      </div>

      {/* the "inbox" slot where the flying issue lands */}
      <div ref={setRef} className="relative h-[74px] overflow-hidden rounded-lg border border-white/10 bg-black/30 px-3 py-2">
        {cur?.status === "pending" && (
          <>
            <motion.div className="absolute inset-y-0 w-16" style={{ background: `linear-gradient(90deg, transparent, ${color}33, transparent)` }} initial={{ left: "-20%" }} animate={{ left: "110%" }} transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }} />
            <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color }}>{retry ? `⚠ ${retry}` : "classifying…"}</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{ms(live)}</div>
          </>
        )}
        {cur?.status === "done" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex h-full items-center justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-white/50">said <Chip cls={cur.predicted} /></div>
              <div className="flex items-center gap-1.5 text-[11px] text-white/50">truth <Chip cls={truth} /></div>
            </div>
            <div className="text-right">
              <motion.div initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 400, damping: 14 }} className={`text-3xl font-bold ${cur.correct ? "text-emerald-300" : "text-rose-400"}`}>{cur.correct ? "✓" : "✗"}</motion.div>
              <div className="font-mono text-xs tabular-nums" style={{ color }}>{ms(cur.latencyMs ?? 0)}</div>
            </div>
          </motion.div>
        )}
        {cur?.status === "error" && (
          <div className="font-mono text-[10px] leading-snug text-rose-300/90">
            {/requires more credits|exceed your available credits|in-flight/.test(cur.error ?? "") ? "Out of OpenRouter credits. Add ~$5 at openrouter.ai/settings/credits to run this lane." : cur.error}
          </div>
        )}
        {!cur && <div className="grid h-full place-items-center text-xs text-white/25">{running ? "waiting for next issue" : "idle"}</div>}
      </div>

      {/* per-issue history strip */}
      <div className="mt-2 flex h-4 flex-wrap items-center gap-[3px]">
        {strip.map(([r, v]) => (
          <motion.span key={r} initial={{ scale: 0 }} animate={{ scale: 1 }} title={v.status === "done" ? `#${Number(r) + 1}: ${ms(v.latencyMs ?? 0)}` : v.status} className="h-2.5 w-2.5 rounded-[3px]"
            style={{ background: v.status === "done" ? (v.correct === false ? "#fb7185" : "#34d399") : v.status === "error" ? "#f59e0b" : "#ffffff22", opacity: v.status === "pending" ? 0.6 : 1 }} />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
        <div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">accuracy</div><div className="text-xl font-semibold tabular-nums"><Pop value={stats.correct}>{stats.scored ? `${Math.round(stats.accuracy * 100)}%` : "-"}</Pop></div><div className="font-mono text-[10px] text-white/35">{stats.correct}/{stats.scored}</div></div>
        <div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">avg speed</div><div className="text-xl font-semibold tabular-nums"><Pop value={stats.done}>{stats.done ? ms(stats.avgLatencyMs) : "-"}</Pop></div><div className="font-mono text-[10px] text-white/35">per issue</div></div>
        <div><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">spent</div><div className="text-xl font-semibold tabular-nums"><Pop value={stats.done}>{stats.done ? usd(stats.costUsd) : "-"}</Pop></div><div className="font-mono text-[10px] text-white/35">{stats.done ? `${usd(stats.costPer1k)}/1k` : ""}{stats.errors ? ` · ${stats.errors} err` : ""}</div></div>
      </div>
    </motion.div>
  );
}

function Scoreboard({ lanes, stats, finished }: { lanes: LaneInfo[]; stats: Record<LaneId, LaneStats>; finished: boolean }) {
  const metrics: { key: string; title: string; hint: string; value: (s: LaneStats) => number; fmt: (n: number) => string; lowerIsBetter: boolean }[] = [
    { key: "speed", title: "Speed", hint: "avg latency, lower wins", value: (s) => s.avgLatencyMs, fmt: ms, lowerIsBetter: true },
    { key: "cost", title: "Cost", hint: "per 1,000 issues, lower wins", value: (s) => s.costPer1k, fmt: usd, lowerIsBetter: true },
    { key: "acc", title: "Accuracy", hint: "vs maintainer labels, higher wins", value: (s) => s.accuracy, fmt: (n) => `${Math.round(n * 100)}%`, lowerIsBetter: false },
  ];
  return (
    <div className="glass grid gap-5 p-4 sm:grid-cols-3 sm:p-5">
      {metrics.map((m) => {
        const active = lanes.filter((l) => stats[l.id].done > 0);
        const vals = active.map((l) => m.value(stats[l.id]));
        const max = Math.max(...vals, 1e-9), min = Math.min(...vals, max);
        const best = vals.length ? (m.lowerIsBetter ? min : max) : null;
        // bars: logarithmic for speed/cost (they span orders of magnitude), linear for accuracy
        const width = (v: number) => (m.key === "acc" ? Math.max(2, v * 100) : max <= min ? 100 : Math.max(3, ((Math.log10(v) - Math.log10(min / 2.5)) / (Math.log10(max) - Math.log10(min / 2.5))) * 100));
        return (
          <div key={m.key}>
            <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-semibold">{m.title}</span><span className="font-mono text-[10px] text-white/35">{m.hint}</span></div>
            <div className="space-y-2">
              {lanes.map((l) => {
                const s = stats[l.id]; const v = m.value(s); const has = s.done > 0;
                const isBest = has && best !== null && v === best && active.length > 1;
                return (
                  <div key={l.id} className="relative h-6 overflow-hidden rounded-md bg-white/5">
                    <motion.div className="h-full rounded-md" animate={{ width: `${has ? width(v) : 0}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} style={{ background: LANE_COLOR[l.id], boxShadow: `0 0 16px ${LANE_COLOR[l.id]}55` }} />
                    <span className="absolute inset-y-0 left-1.5 my-auto h-[18px] rounded bg-black/70 px-1.5 font-mono text-[11px] leading-[18px] font-semibold">{has ? m.fmt(v) : "-"}{isBest ? (finished ? " 🏆" : " ▲") : ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Arena() {
  const { state, start, stop } = useArena();
  const [opts, setOpts] = useState<Options | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [claude, setClaude] = useState(""), [gemini, setGemini] = useState(""), [limit, setLimit] = useState(20), [repo, setRepo] = useState("all");
  const [flyers, setFlyers] = useState<Flyer[]>([]);

  const root = useRef<HTMLDivElement>(null), source = useRef<HTMLDivElement>(null);
  const laneEls = useRef<Partial<Record<LaneId, HTMLDivElement | null>>>({});

  useEffect(() => {
    fetch("/api/arena/models").then((r) => r.json()).then((o: Options) => { setOpts(o); setClaude(o.claude.default); setGemini(o.gemini.default); }).catch(() => {});
    fetch("/api/repos").then((r) => r.json()).then((d: { repos: string[] }) => setRepos(d.repos)).catch(() => {});
  }, []);

  const lanes = useMemo<LaneInfo[]>(() => LANE_ORDER.map((id) => state.lanes.find((l) => l.id === id)).filter((l): l is LaneInfo => !!l), [state.lanes]);
  const shown: LaneInfo[] = lanes.length ? lanes : [{ id: "jev", label: "Jev 1.13", model: "typesafe/jev-1.13" }, { id: "gemini", label: "Gemini", model: gemini }, { id: "claude", label: "Claude", model: claude }];
  const pending = Object.values(state.results).some((r) => r[state.round]?.status === "pending");
  const now = useNow(pending);
  const stats = { jev: laneStats(state.results.jev), gemini: laneStats(state.results.gemini), claude: laneStats(state.results.claude) };
  const item = state.items[state.round];
  const upcoming = state.items.slice(state.round + 1, state.round + 5);

  // Launch three copies of the current issue from the stream toward each lane's inbox slot.
  useLayoutEffect(() => {
    if (state.round < 0 || !root.current || !source.current) return;
    const base = root.current.getBoundingClientRect(), from = source.current.getBoundingClientRect();
    const next: Flyer[] = LANE_ORDER.flatMap((lane) => {
      const el = laneEls.current[lane]; if (!el) return [];
      const to = el.getBoundingClientRect();
      return [{ key: `${state.round}-${lane}`, lane, fromX: from.left - base.left + 8, fromY: from.top - base.top + 8, toX: to.left - base.left + 12, toY: to.top - base.top + 10 }];
    });
    setFlyers(next);
    const t = setTimeout(() => setFlyers([]), 900);
    return () => clearTimeout(t);
  }, [state.round]);

  const finished = state.done;
  const jev = stats.jev;
  const headline = (id: Exclude<LaneId, "jev">) => {
    const o = stats[id];
    if (!finished || !jev.done || !o.done) return null;
    return { speed: o.avgLatencyMs / Math.max(jev.avgLatencyMs, 1), cost: o.costPer1k / Math.max(jev.costPer1k, 1e-12) };
  };
  const x = (n: number) => (n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1));

  return (
    <div ref={root} className="relative h-full w-full overflow-y-auto px-4 pt-28 pb-24 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => (state.running ? stop() : start({ claude, gemini, limit, repo }))} className={`rounded-full px-4 py-1.5 text-xs font-semibold ${state.running ? "border border-rose-400/40 bg-rose-400/10 text-rose-200" : "bg-gradient-to-r from-cyan-400 to-fuchsia-400 text-black"}`}>{state.running ? "Stop" : state.done ? "Run again" : "Start the race"}</button>
          {opts && (
            <>
              <select disabled={state.running} value={gemini} onChange={(e) => setGemini(e.target.value)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none">{opts.gemini.options.map((o) => <option key={o.model} value={o.model} className="bg-neutral-900">{o.label}</option>)}</select>
              <select disabled={state.running} value={claude} onChange={(e) => setClaude(e.target.value)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none">{opts.claude.options.map((o) => <option key={o.model} value={o.model} className="bg-neutral-900">{o.label}</option>)}</select>
            </>
          )}
          <select disabled={state.running} value={repo} onChange={(e) => setRepo(e.target.value)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none"><option value="all" className="bg-neutral-900">all repos</option>{repos.map((r) => <option key={r} value={r} className="bg-neutral-900">{r}</option>)}</select>
          <select disabled={state.running} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none">{[10, 20, 40].map((n) => <option key={n} value={n} className="bg-neutral-900">{n} issues</option>)}</select>
          {state.items.length > 0 && <span className="ml-auto font-mono text-xs text-white/50">issue {Math.max(state.round + 1, 0)} / {state.items.length}</span>}
        </div>
        {state.error && <div className="rounded-lg border border-rose-400/30 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">{state.error}</div>}

        {/* stream + lanes */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div className="glass flex flex-col p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">incoming · real GitHub issues</div>
            <div ref={source} className="relative mt-3 min-h-[130px] rounded-xl border border-white/15 bg-black/40 p-3">
              <AnimatePresence mode="popLayout">
                {item ? (
                  <motion.div key={item.id} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                    <div className="flex items-center gap-2 font-mono text-[10px] text-white/40"><span>📄</span><span className="truncate">{item.source}</span></div>
                    <div className="mt-1.5 text-sm leading-snug">{item.title}</div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/45">maintainer label <Chip cls={item.label} /></div>
                  </motion.div>
                ) : <div className="grid h-full min-h-[104px] place-items-center text-center text-xs text-white/30">{state.running ? "loading dataset…" : "Press Start: the same issue is sent to all three at once."}</div>}
              </AnimatePresence>
            </div>
            <div className="mt-3 space-y-1.5">
              {upcoming.map((u, i) => <div key={u.id} className="truncate rounded-md border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-white/45" style={{ opacity: 1 - i * 0.2 }}>📄 {u.title}</div>)}
            </div>
            <p className="mt-auto pt-4 text-[10px] leading-relaxed text-white/30">Dataset: 318 issues from pandas, NumPy, scikit-learn and VS Code. Truth = the label a maintainer applied. Maintainer labels are noisy, so read accuracy as relative.</p>
          </div>

          <div className="flex flex-col gap-3">
            {shown.map((l) => (
              <LaneCard key={l.id} lane={l} results={state.results[l.id]} stats={stats[l.id]} round={state.round} now={now} dispatchedAt={state.dispatchedAt} retry={state.retry[l.id]} truth={item?.label}
                setRef={(el) => { laneEls.current[l.id] = el; }} running={state.running} />
            ))}
          </div>
        </div>

        <Scoreboard lanes={shown} stats={stats} finished={finished} />

        {finished && (["gemini", "claude"] as const).map((id) => {
          const h = headline(id); const l = shown.find((s) => s.id === id)!;
          return h ? <div key={id} className="glass flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3 text-sm"><span className="font-semibold">Jev vs {l.label}</span><span className="text-emerald-300"><b>{x(h.speed)}×</b> faster</span><span className="text-emerald-300"><b>{x(h.cost)}×</b> cheaper</span><span className="text-white/50">accuracy {Math.round(stats.jev.accuracy * 100)}% vs {Math.round(stats[id].accuracy * 100)}%</span></div> : null;
        })}
        <p className="text-[11px] leading-relaxed text-white/35">Every number is a real call billed through OpenRouter; speed is each call&apos;s wall-clock time and cost is what OpenRouter charged (including reasoning tokens). Calls are spaced a few seconds apart to respect new-account rate limits, which never counts toward latency. Small samples have wide error bars.</p>
      </div>

      {/* flying files */}
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
        {flyers.map((f) => (
          <motion.div key={f.key} className="absolute left-0 top-0 flex h-9 w-44 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium backdrop-blur"
            style={{ borderColor: `${LANE_COLOR[f.lane]}aa`, background: `${LANE_COLOR[f.lane]}22`, color: LANE_COLOR[f.lane], boxShadow: `0 0 24px ${LANE_COLOR[f.lane]}66` }}
            initial={{ x: f.fromX, y: f.fromY, opacity: 0, scale: 0.9 }} animate={{ x: f.toX, y: f.toY, opacity: [0, 1, 1, 0], scale: [0.9, 1, 1, 0.7] }} transition={{ duration: 0.75, ease: [0.22, 0.8, 0.3, 1], times: [0, 0.15, 0.8, 1] }}>
            📄 <span className="truncate">{state.items[state.round]?.title}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
