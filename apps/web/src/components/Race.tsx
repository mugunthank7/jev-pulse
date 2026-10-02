import { useState } from "react";
import type { RaceRow } from "../lib/race";

const COLORS: Record<string, string> = { jev: "#34d399", claude: "#fb923c", gemini: "#60a5fa", other: "#c084fc" };
const usd = (n: number) => (n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);

function scale(v: number, max: number, min: number, log: boolean) {
  if (v <= 0) return 0;
  if (!log || max <= min) return Math.max(1.5, (v / max) * 100);
  const lo = Math.log10(min / 2), hi = Math.log10(max);
  return Math.max(2, ((Math.log10(v) - lo) / (hi - lo)) * 100);
}

function Bar({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div className="relative h-6 overflow-hidden rounded-md bg-white/5">
      <div className="h-full rounded-md transition-[width] duration-300" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 18px ${color}55` }} />
      <span className="absolute inset-y-0 left-1.5 my-auto h-[18px] rounded bg-black/70 px-1.5 font-mono text-[11px] leading-[18px] font-semibold text-white">{label}</span>
    </div>
  );
}

export function Race({ rows, running, total }: { rows: Record<string, RaceRow>; running: boolean; total: number }) {
  const [log, setLog] = useState(true);
  const list = Object.values(rows).filter((r) => r.family === "jev" || r.done > 0).sort((a, b) => (a.family === "jev" ? -1 : b.family === "jev" ? 1 : a.costPer1k - b.costPer1k));
  // A row only counts toward comparisons if >=90% of its calls succeeded; otherwise its sample is too thin.
  const complete = (r: RaceRow) => r.total > 0 && r.done - r.errors >= 0.9 * r.total;
  const ok = list.filter((r) => r.done > r.errors); // anything with a success, for bar scaling
  const jev = rows["jev"];
  const rivals = list.filter((r) => r.family !== "jev" && r.finished && complete(r));
  const maxLat = Math.max(...ok.map((r) => r.avgLatencyMs), 1), minLat = Math.min(...ok.map((r) => r.avgLatencyMs), maxLat);
  const maxCost = Math.max(...ok.map((r) => r.costPer1k), 1e-9), minCost = Math.min(...ok.map((r) => r.costPer1k), maxCost);

  const cheapest = rivals.length ? rivals.reduce((a, b) => (b.costPer1k < a.costPer1k ? b : a)) : null;
  const priciest = rivals.length ? rivals.reduce((a, b) => (b.costPer1k > a.costPer1k ? b : a)) : null;
  const ready = jev && complete(jev) && jev.finished && cheapest && priciest;
  const x = (n: number) => (n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1));

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto px-4 pt-32 pb-24 sm:px-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Model Race</h2>
        <p className="mt-1 text-sm text-white/50">The same {total || "N"} real GitHub issues, the same five questions, scored against the maintainers&apos; labels. Every number is a live API call billed through OpenRouter.</p>
      </div>

      {ready && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass p-4"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">latency vs {priciest.label}</div><div className="mt-1 text-3xl font-semibold text-emerald-300">{x(priciest.avgLatencyMs / Math.max(jev.avgLatencyMs, 1))}× faster</div></div>
          <div className="glass p-4"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">cost vs {priciest.label}</div><div className="mt-1 text-3xl font-semibold text-emerald-300">{x(priciest.costPer1k / Math.max(jev.costPer1k, 1e-12))}× cheaper</div></div>
          <div className="glass p-4"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">cost vs cheapest rival ({cheapest.label})</div><div className="mt-1 text-3xl font-semibold text-emerald-300">{x(cheapest.costPer1k / Math.max(jev.costPer1k, 1e-12))}× cheaper</div></div>
        </div>
      )}

      <div className="glass p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">accuracy · avg latency per issue · cost per 1,000 issues</div>
          <button onClick={() => setLog((l) => !l)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10">{log ? "log scale" : "linear scale"}</button>
        </div>
        {!list.length && <div className="py-10 text-center text-sm text-white/40">{running ? "Warming up the models…" : "Press “Start race” to run every model on the same issues."}</div>}
        <div className="flex flex-col gap-5">
          {list.map((r) => {
            const c = COLORS[r.family]!;
            const failed = r.done > 0 && r.errors === r.done;
            return (
              <div key={r.id}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 10px ${c}` }} />{r.label}</div>
                  <div className="font-mono text-[10px] text-white/40">{r.done}/{r.total}{r.errors ? ` · ${r.errors} err` : ""}</div>
                </div>
                {!failed && r.finished && !complete(r) && <div className="mb-1 font-mono text-[11px] text-amber-300">incomplete: {r.errors}/{r.total} calls failed, so these numbers use only {r.done - r.errors} issues and are excluded from the headline comparison</div>}
                {failed ? <div className="font-mono text-[11px] text-rose-300/80">{r.lastError}</div> : (
                  <div className="grid gap-1.5 sm:grid-cols-3 sm:gap-3">
                    <Bar pct={r.accuracy * 100} color={c} label={`${Math.round(r.accuracy * 100)}% acc (${r.correct}/${r.scored})`} />
                    <Bar pct={scale(r.avgLatencyMs, maxLat, minLat, log)} color={c} label={`${ms(r.avgLatencyMs)} / issue`} />
                    <Bar pct={scale(r.costPer1k, maxCost, minCost, log)} color={c} label={`${usd(r.costPer1k)} / 1k`} />
                  </div>
                )}
                {!failed && r.lastError && <div className="mt-1 truncate font-mono text-[10px] text-rose-300/80">{r.lastError}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1 text-[11px] leading-relaxed text-white/40">
        <p>Ground truth is the label a maintainer applied (bug / feature / question) on pandas, NumPy, scikit-learn and VS Code issues. Maintainer labels are noisy, so no model can reach 100%; read accuracy as relative, not absolute.</p>
        <p>Latency is wall-clock per call under light concurrency (Jev 4, each LLM 1 at a time, paced to stay under OpenRouter's new-account limits), so treat it as indicative. Claude and Gemini run at low reasoning effort on this simple task. Small samples give wide error bars: re-run with more issues before quoting numbers.</p>
        <p>Cost is the billed amount OpenRouter reports per call, including reasoning tokens.</p>
      </div>
    </div>
  );
}
