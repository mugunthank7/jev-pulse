import { useState } from "react";
import { Arena } from "./components/Arena";
import { Links } from "./components/Links";
import { MindMapView } from "./components/MindMapView";
import { Rerank } from "./components/Rerank";

type View = "map" | "rerank" | "issues";
const TABS: { id: View; label: string }[] = [{ id: "map", label: "Mind map" }, { id: "rerank", label: "Search rerank" }, { id: "issues", label: "Issue arena" }];

export default function App() {
  const record = new URLSearchParams(window.location.search).has("record");
  const [view, setView] = useState<View>("map");

  return (
    <div className="relative h-full w-full overflow-hidden">
      {!record && (
        <header className="pointer-events-none absolute top-0 left-0 z-20 flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-6">
          <h1 className="pointer-events-auto text-xl font-semibold tracking-tight">Jev <span className="bg-gradient-to-r from-cyan-300 to-fuchsia-300 bg-clip-text text-transparent">Pulse</span></h1>
          <div className="pointer-events-auto flex rounded-full border border-white/10 bg-black/40 p-0.5 text-xs backdrop-blur">
            {TABS.map((t) => <button key={t.id} onClick={() => setView(t.id)} className={`rounded-full px-3 py-1 transition ${view === t.id ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>{t.label}</button>)}
          </div>
          <span className="pointer-events-auto hidden text-xs text-white/40 lg:inline">Can a decision model replace an LLM? Real data, real calls.</span>
          <div className="pointer-events-auto ml-auto"><Links /></div>
        </header>
      )}
      {view === "map" && <MindMapView record={record} />}
      {view === "rerank" && !record && <Rerank />}
      {view === "issues" && !record && <Arena />}
    </div>
  );
}
