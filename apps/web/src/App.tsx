import { useCallback, useState } from "react";
import type { ScoredItem } from "@jev-pulse/schema";
import { Feed } from "./components/Feed";
import { Hud } from "./components/Hud";
import { Links } from "./components/Links";
import { Arena } from "./components/Arena";
import { Radar } from "./components/Radar";
import { useJevStream, type StreamParams } from "./lib/stream";

const PRESETS: { label: string; params: StreamParams }[] = [
  { label: "Labeled issues · 120", params: { source: "dataset", limit: 120 } },
  { label: "pandas", params: { source: "dataset", repo: "pandas-dev/pandas", limit: 60 } },
  { label: "scikit-learn", params: { source: "dataset", repo: "scikit-learn/scikit-learn", limit: 60 } },
  { label: "VS Code", params: { source: "dataset", repo: "microsoft/vscode", limit: 60 } },
];

export default function App() {
  const { state, start, stop } = useJevStream();
  const [view, setView] = useState<"radar" | "arena">("radar");
  const [hovered, setHovered] = useState<ScoredItem | null>(null);
  const [active, setActive] = useState(0);
  const [repo, setRepo] = useState("");
  const onHover = useCallback((i: ScoredItem | null) => setHovered(i), []);

  const run = (i: number) => { setActive(i); start(PRESETS[i]!.params); };

  return (
    <div className="relative h-full w-full overflow-hidden">
      {view === "radar" && <Radar items={state.items} running={state.running} onHover={onHover} />}
      {view === "arena" && <Arena />}
      <header className="pointer-events-none absolute top-0 left-0 z-10 flex w-full flex-col gap-3 p-4 sm:p-6">
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Jev <span className="bg-gradient-to-r from-cyan-300 to-fuchsia-300 bg-clip-text text-transparent">Pulse</span></h1>
          <span className="hidden text-xs text-white/40 md:inline">real labeled GitHub issues, classified by Jev</span>
          <div className="flex rounded-full border border-white/10 bg-white/5 p-0.5 text-xs">
            {(["radar", "arena"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 capitalize transition ${view === v ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>{v === "arena" ? "Live arena" : "Radar"}</button>
            ))}
          </div>
          <div className="ml-auto"><Links /></div>
        </div>
        {view === "arena" ? null : (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {PRESETS.map((p, i) => (
            <button key={p.label} onClick={() => run(i)} className={`rounded-full border px-3 py-1.5 text-xs transition ${active === i && state.startedAt ? "border-white/40 bg-white/15" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>{p.label}</button>
          ))}
          <form className="flex" onSubmit={(e) => { e.preventDefault(); if (repo.trim()) { setActive(-1); start({ source: "github", repo: repo.trim(), limit: 200 }); } }}>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="live: owner/repo" className="w-32 rounded-l-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none placeholder:text-white/30 focus:border-white/30" />
            <button className="rounded-r-full border border-l-0 border-white/10 bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20">Scan live</button>
          </form>
          {state.running && <button onClick={stop} className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-200">Stop</button>}
        </div>
        )}
        {view === "radar" && state.error && <div className="pointer-events-auto max-w-md rounded-lg border border-rose-400/30 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">{state.error}</div>}
      </header>

      {view === "radar" && !state.startedAt && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="text-center">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/30">system one · idle</div>
            <div className="mt-2 text-lg text-white/60">Pick a source to watch Jev decide.</div>
          </div>
        </div>
      )}

      {view === "radar" && (
      <aside className="absolute right-0 bottom-0 z-10 flex w-full flex-col gap-3 p-4 sm:top-24 sm:w-auto sm:p-6">
        <Hud state={state} />
        <Feed items={state.items} hovered={hovered} />
      </aside>
      )}
    </div>
  );
}
