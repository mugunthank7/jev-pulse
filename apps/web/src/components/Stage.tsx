import { useEffect, useRef, useState } from "react";
import { download, beginRecording, mb, type Recording } from "../lib/recorder";
import { useSortRun } from "../lib/sort";
import { Links } from "./Links";
import { Metrics } from "./Metrics";
import { MindMap } from "./MindMap";

type Options = { gemini: { default: string; options: { model: string; label: string }[] }; claude: { default: string; options: { model: string; label: string }[] } };
const sel = "rounded-full border border-[#e3e5f3] bg-white px-3 py-1.5 text-xs font-medium text-[#4a5575] shadow-sm outline-none disabled:opacity-50";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The whole product on one page: toolbar, 75% scene, 25% metrics. `?record=1` hides the toolbar and loops (for screen capture). */
export function Stage({ loop }: { loop: boolean }) {
  const { state, startLive, startReplay, stop } = useSortRun();
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const [limit, setLimit] = useState(8), [speed, setSpeed] = useState(1);
  const [opts, setOpts] = useState<Options | null>(null);
  const [gemini, setGemini] = useState(""), [claude, setClaude] = useState("");
  const [rec, setRec] = useState<"idle" | "asking" | "recording" | "encoding" | "done">("idle");
  const [recErr, setRecErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ r: Recording; gifUrl: string } | null>(null);
  const hideChrome = loop || rec === "recording";
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return; fetched.current = true;
    fetch("/api/arena/models").then((r) => r.json()).then((o: Options) => { setOpts(o); setGemini(o.gemini.default); setClaude(o.claude.default); }).catch(() => {});
  }, []);

  const play = () => (mode === "live" ? startLive({ gemini, claude, limit, speed }) : startReplay({ speed, limit }));

  // Loop mode (?record=1): replay forever, for an external screen recorder.
  useEffect(() => {
    if (!loop) return;
    let stopped = false;
    const again = () => startReplay({ speed: 1, limit: 8 }, () => { if (!stopped) setTimeout(again, 2500); });
    again();
    return () => { stopped = true; stop(); };
  }, [loop, startReplay, stop]);

  /** One click: ask to share this tab, hide the controls, play the recorded run once, then offer the GIF + video. */
  async function record() {
    setRecErr(null); setRec("asking");
    let session: Awaited<ReturnType<typeof beginRecording>>;
    try { session = await beginRecording({ fps: 10, width: 800 }); }
    catch (e) { setRec("idle"); setRecErr(e instanceof DOMException && e.name === "NotAllowedError" ? "Recording cancelled (the browser needs your OK to share this tab)." : `Could not start recording: ${e instanceof Error ? e.message : e}`); return; }
    setRec("recording");
    await wait(900); // let the hidden toolbar settle out of frame
    await new Promise<void>((resolve) => { void startReplay({ speed: 1, limit }, resolve); });
    await wait(1200);
    setRec("encoding");
    const r = await session.stop();
    setResult({ r, gifUrl: URL.createObjectURL(r.gif) });
    setRec("done");
  }
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.gifUrl); }, [result]);

  return (
    <div className="flex h-full w-full flex-col gap-3 p-3 sm:p-5">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#b9b1ff] to-[#9ed8ff] text-lg shadow-md">✉</div>
          <div><h1 className="text-lg leading-tight font-extrabold tracking-tight">Jev Pulse</h1><p className="text-xs text-[#7a84a3]">Can a decision model replace an LLM? Real search data, three engines, one race.</p></div>
        </div>
        <div className="ml-auto"><Links /></div>
      </header>

      {!hideChrome && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => (state.running ? stop() : play())} className={`rounded-full px-5 py-2 text-xs font-bold text-white shadow-md transition ${state.running ? "bg-[#f08aa0]" : "bg-gradient-to-r from-[#8b7cf0] to-[#6fb1ff] hover:brightness-105"}`}>{state.running ? "■ Stop" : state.done ? "▶ Play again" : "▶ Play"}</button>
          <div className="flex rounded-full border border-[#e3e5f3] bg-white p-0.5 text-xs shadow-sm">
            {(["replay", "live"] as const).map((m) => <button key={m} disabled={state.running} onClick={() => setMode(m)} className={`rounded-full px-3 py-1.5 font-medium capitalize ${mode === m ? "bg-[#ece9ff] text-[#5a4fd0]" : "text-[#7a84a3]"}`}>{m === "replay" ? "Replay (recorded)" : "Live API"}</button>)}
          </div>
          <select aria-label="Items" disabled={state.running} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={sel}>{[6, 8, 12, 20].map((n) => <option key={n} value={n}>{n} items</option>)}</select>
          <select aria-label="Playback speed" disabled={state.running || mode === "live"} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className={sel}>{[0.5, 1, 2].map((n) => <option key={n} value={n}>{n}× speed</option>)}</select>
          {mode === "live" && opts && (<>
            <select aria-label="Gemini model" disabled={state.running} value={gemini} onChange={(e) => setGemini(e.target.value)} className={sel}>{opts.gemini.options.map((o) => <option key={o.model} value={o.model}>{o.label}</option>)}</select>
            <select aria-label="Claude model" disabled={state.running} value={claude} onChange={(e) => setClaude(e.target.value)} className={sel}>{opts.claude.options.map((o) => <option key={o.model} value={o.model}>{o.label}</option>)}</select>
          </>)}
          <button onClick={record} disabled={state.running || rec === "asking" || rec === "encoding"} className="ml-auto rounded-full border border-[#c9c3ff] bg-white px-4 py-2 text-xs font-bold text-[#5a4fd0] shadow-sm transition hover:bg-[#f4f2ff] disabled:opacity-50">{rec === "asking" ? "Choose this tab…" : rec === "encoding" ? "Encoding GIF…" : "⏺ Record GIF / video"}</button>
        </div>
      )}
      {(state.error || recErr) && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{recErr ?? state.error}</div>}

      <main className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <section className="card relative min-h-[420px] flex-[3] overflow-hidden" style={{ background: "linear-gradient(160deg,#fbfaff,#f4f9ff)" }} aria-label="Data flow">
          <MindMap key={state.runId} state={state} speed={state.mode === "replay" ? speed : 1} />
          {!state.items.length && !state.error && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="rounded-2xl bg-white/80 px-6 py-4 text-center shadow-sm"><div className="text-base font-semibold">Press Play</div><div className="mt-1 text-sm text-[#7a84a3]">The same search result goes to Jev, Gemini and Claude at once.</div></div></div>
          )}
        </section>
        <div className="min-h-0 flex-1 lg:min-w-[300px] lg:max-w-[400px]"><Metrics state={state} /></div>
      </main>

      {rec === "recording" && <span className="sr-only">Recording in progress</span>}
      {rec === "done" && result && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#26304d]/30 p-4 backdrop-blur-sm" role="dialog" aria-label="Recording finished">
          <div className="card w-full max-w-lg p-5">
            <h2 className="text-base font-extrabold">Your recording is ready</h2>
            <p className="mt-1 text-xs text-[#7a84a3]">{result.r.seconds.toFixed(0)} seconds captured from this page.</p>
            <img src={result.gifUrl} alt="GIF preview" className="mt-3 w-full rounded-xl border border-[#e3e5f3]" />
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => download(result.r.video, `jev-pulse.${result.r.videoExt}`)} className="rounded-full bg-gradient-to-r from-[#8b7cf0] to-[#6fb1ff] px-4 py-2 text-xs font-bold text-white shadow-md">Download video (.{result.r.videoExt}) · {mb(result.r.video)}</button>
              <button onClick={() => download(result.r.gif, "jev-pulse.gif")} className="rounded-full border border-[#c9c3ff] bg-white px-4 py-2 text-xs font-bold text-[#5a4fd0]">Download GIF · {mb(result.r.gif)}</button>
              <button onClick={() => { setRec("idle"); setResult(null); }} className="ml-auto rounded-full px-3 py-2 text-xs font-medium text-[#7a84a3]">Close</button>
            </div>
            <p className="mt-3 text-[11px] leading-snug text-[#8a93ad]">For LinkedIn, upload the video (smaller and sharper). GIFs are large; use one only where a GIF is required.{result.r.videoExt === "webm" ? " This browser saved WebM; LinkedIn needs MP4, so use Chrome, or convert it (e.g. with ffmpeg)." : ""}</p>
          </div>
        </div>
      )}
    </div>
  );
}
