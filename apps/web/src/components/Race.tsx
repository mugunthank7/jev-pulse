import { useState } from "react";
import type { RaceRow } from "../lib/race";

const COLORS: Record<string, string> = { jev: "#34d399", claude: "#fb923c", gemini: "#60a5fa" };
const ORDER = ["jev", "haiku", "sonnet", "opus", "gemini-fast", "gemini-pro"];
const usd = (n: number) => (n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);

function scale(v: number, max: number, min: number, log: boolean) {
  if (v <= 0) return 0;
  if (!log) return Math.max(1.5, (v / max) * 100);
  const lo = Math.log10(Math.max(min / 2, 1e-9)), hi = Math.log10(max);
  return Math.max(2, ((Math.log10(v) - lo) / (hi - lo)) * 100);
}

function Bar({ pct, color, label, hatched }: { pct: number; color: string; label: string; hatched: boolean }) {
  return (
    <div className="relative h-6 overflow-hidden rounded-md bg-white/5">
      <div className="h-full rounded-md transition-[width] duration-300" style={{ width: `${pct}%`, background: hatched ? `repeating-linear-gradient(135deg, ${color}, ${color} 6px, ${color}99 6px, ${color}99 12px)` : color, boxShadow: `0 0 18px ${color}55` }} />
      <span className="absolute inset-y-0 left-1.5 my-auto h-[18px] rounded bg-black/70 px-1.5 font-mono text-[11px] leading-[18px] font-semibold text-white">{label}</span>
    </div>
  );
}

export function Race({ rows, running, total }: { rows: Record<string, RaceRow>; running: boolean; total: number }) {
  const [log, setLog] = useState(true);
  const list = ORDER.map((id) => rows[id]).filter((r): r is RaceRow => !!r && r.done > 0);
  const jev = rows["jev"];
  const others = list.filter((r) => r.id !== "jev");
  const maxLat = Math.max(...list.map((r) => r.avgLatencyMs), 1), minLat = Math.min(...list.map((r) => r.avgLatencyMs), maxLat);
  const maxCost = Math.max(...list.map((r) => r.costPer1k), 1e-9), minCost = Math.min(...list.map((r) => r.costPer1k), maxCost);
  const anyModeled = list.some((r) => r.mode === "modeled");
  const anyMeasured = list.some((r) => r.mode === "measured" && r.family !== "jev");

  const best = others.length && jev && jev.done ? others.reduce((a, b) => (b.costPer1k > a.costPer1k ? b : a)) : null;
  const speedX = best && jev ? best.avgLatencyMs / Math.max(jev.avgLatencyMs, 1) : 0;
  const costX = best && jev ? best.costPer1k / Math.max(jev.costPer1k, 1e-12) : 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto px-4 pt-32 pb-24 sm:px-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Model Race</h2>
        <p className="mt-1 text-sm text-white/50">Same {total || "N"} items, same five questions (category, urgency, sentiment, actionable, spam). Jev vs Claude vs Gemini.</p>
      </div>

      {best && jev && jev.done > 2 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="glass p-4"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">latency vs {best.label}{best.mode === "modeled" ? " (modeled)" : ""}</div><div className="mt-1 text-3xl font-semibold text-emerald-300">{speedX >= 10 ? Math.round(speedX) : speedX.toFixed(1)}× faster</div></div>
          <div className="glass p-4"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">cost vs {best.label}{best.mode === "modeled" ? " (modeled)" : ""}</div><div className="mt-1 text-3xl font-semibold text-emerald-300">{costX >= 10 ? Math.round(costX).toLocaleString() : costX.toFixed(1)}× cheaper</div></div>
        </div>
      )}

      <div className="glass p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">avg latency per item · cost per 1,000 items</div>
          <button onClick={() => setLog((l) => !l)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10">{log ? "log scale" : "linear scale"}</button>
        </div>
        {!list.length && <div className="py-10 text-center text-sm text-white/40">{running ? "Warming up the models…" : "Press “Start race” to run every model on the same items."}</div>}
        <div className="flex flex-col gap-5">
          {list.map((r) => {
            const c = COLORS[r.family]!;
            return (
              <div key={r.id}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 10px ${c}` }} />{r.label}
                    <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${r.mode === "measured" ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300"}`}>{r.mode}</span>
                  </div>
                  <div className="font-mono text-[10px] text-white/40">{r.done}/{r.total}{r.errors ? ` · ${r.errors} err` : ""}</div>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
                  <Bar pct={scale(r.avgLatencyMs, maxLat, minLat, log)} color={c} hatched={r.mode === "modeled"} label={`${ms(r.avgLatencyMs)} / item`} />
                  <Bar pct={scale(r.costPer1k, maxCost, minCost, log)} color={c} hatched={r.mode === "modeled"} label={`${usd(r.costPer1k)} / 1k items`} />
                </div>
                {r.lastError && <div className="mt-1 truncate font-mono text-[10px] text-rose-300/80">{r.lastError}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1 text-[11px] leading-relaxed text-white/40">
        {anyModeled && <p><span className="text-amber-300">Modeled</span> rows (hatched) have no API key configured, so latency and tokens are typical values, not measurements. Add <code>ANTHROPIC_API_KEY</code> / <code>GEMINI_API_KEY</code> to the API's <code>.env</code> to measure them live.</p>}
        {anyMeasured && <p><span className="text-emerald-300">Measured</span> rows are real API calls: wall-clock latency and billed tokens (Gemini thinking tokens count as output).</p>}
        {jev?.mode === "simulated" && <p><span className="text-amber-300">Jev (mock)</span> is the local stand-in, so its numbers are simulated until <code>JEV_BACKEND=jev</code> is set. Jev's cost uses its published $0.042/M input rate.</p>}
        <p>Prices are per-token list prices at build time; verify before quoting them.</p>
      </div>
    </div>
  );
}
