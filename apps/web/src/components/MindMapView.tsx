import { useEffect, useMemo, useState } from "react";
import { useSortRun } from "../lib/sort";
import { Metrics } from "./Metrics";
import { MindMap } from "./MindMap";

type Options = { gemini: { default: string; options: { model: string; label: string }[] }; claude: { default: string; options: { model: string; label: string }[] } };
const sel = "rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none disabled:opacity-50";

/** 75% mind map + 25% live metrics. `?record=1` hides the chrome and loops the replay: made for screen capture. */
export function MindMapView({ record }: { record: boolean }) {
  const { state, startLive, startReplay, stop } = useSortRun();
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const [limit, setLimit] = useState(12), [speed, setSpeed] = useState(1);
  const [opts, setOpts] = useState<Options | null>(null);
  const [gemini, setGemini] = useState(""), [claude, setClaude] = useState("");

  useEffect(() => { fetch("/api/arena/models").then((r) => r.json()).then((o: Options) => { setOpts(o); setGemini(o.gemini.default); setClaude(o.claude.default); }).catch(() => {}); }, []);

  const play = useMemo(() => () => (mode === "live" ? startLive({ gemini, claude, limit, speed, gapMs: 3200 }) : startReplay({ speed, gapMs: 1500, limit })), [mode, startLive, startReplay, gemini, claude, limit, speed]);

  // Record mode: autoplay and loop forever so a screen recorder can grab one clean pass.
  useEffect(() => {
    if (!record) return;
    let stopped = false;
    const loop = () => startReplay({ speed: 1, gapMs: 1500, limit: 12 }, () => { if (!stopped) setTimeout(loop, 2500); });
    loop();
    return () => { stopped = true; stop(); };
  }, [record, startReplay, stop]);

  return (
    <div className="flex h-full w-full flex-col lg:flex-row">
      <section className="relative min-h-[60vh] flex-[3] lg:min-h-0" aria-label="Mind map">
        {!record && (
          <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 px-4 pt-[4.5rem] sm:px-6">
            <button onClick={() => (state.running ? stop() : play())} className={`rounded-full px-4 py-1.5 text-xs font-semibold ${state.running ? "border border-rose-400/40 bg-rose-400/10 text-rose-200" : "bg-gradient-to-r from-cyan-400 to-fuchsia-400 text-black"}`}>{state.running ? "Stop" : state.done ? "Play again" : "Play"}</button>
            <div className="flex rounded-full border border-white/10 bg-white/5 p-0.5 text-xs">
              {(["replay", "live"] as const).map((m) => <button key={m} disabled={state.running} onClick={() => setMode(m)} className={`rounded-full px-3 py-1 capitalize ${mode === m ? "bg-white/15" : "text-white/50 hover:text-white"}`}>{m}</button>)}
            </div>
            <select aria-label="Items" disabled={state.running} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={sel}>{[6, 12, 20, 30].map((n) => <option key={n} value={n} className="bg-neutral-900">{n} items</option>)}</select>
            <select aria-label="Playback speed" disabled={state.running || mode === "live"} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className={sel}>{[1, 2, 4].map((n) => <option key={n} value={n} className="bg-neutral-900">{n}× speed</option>)}</select>
            {mode === "live" && opts && (<>
              <select aria-label="Gemini model" disabled={state.running} value={gemini} onChange={(e) => setGemini(e.target.value)} className={sel}>{opts.gemini.options.map((o) => <option key={o.model} value={o.model} className="bg-neutral-900">{o.label}</option>)}</select>
              <select aria-label="Claude model" disabled={state.running} value={claude} onChange={(e) => setClaude(e.target.value)} className={sel}>{opts.claude.options.map((o) => <option key={o.model} value={o.model} className="bg-neutral-900">{o.label}</option>)}</select>
            </>)}
            {state.error && <span className="max-w-md rounded-lg border border-rose-400/30 bg-rose-950/60 px-3 py-1.5 text-xs text-rose-200">{state.error}</span>}
          </div>
        )}
        <div className="h-full w-full pt-0"><MindMap key={state.runId} state={state} speed={state.mode === "replay" ? speed : 1} /></div>
        {!state.items.length && !state.error && <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center"><div className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/30">idle</div><div className="mt-2 text-lg text-white/60">Press Play: the same search result goes to Jev, Gemini and Claude at once.</div></div></div>}
      </section>
      <div className="min-h-0 flex-1 border-t border-white/10 lg:min-w-[300px] lg:max-w-[420px] lg:border-t-0 lg:border-l"><Metrics state={state} pad={!record} /></div>
    </div>
  );
}
