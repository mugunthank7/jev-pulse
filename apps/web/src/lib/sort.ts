import { useCallback, useEffect, useRef, useState } from "react";

export type Cat = "exact" | "substitute" | "not_a_match";
export type EngineId = "jev" | "gemini" | "claude";
export const ENGINE_ORDER: EngineId[] = ["jev", "gemini", "claude"];
export const CATS: Cat[] = ["exact", "substitute", "not_a_match"];
export const ENGINE_COLOR: Record<EngineId, string> = { jev: "#34d399", gemini: "#60a5fa", claude: "#fb923c" };
export const CAT_COLOR: Record<Cat, string> = { exact: "#34d399", substitute: "#fbbf24", not_a_match: "#fb7185" };
export type EngineMeta = { id: EngineId; label: string; model: string };
export type PairItem = { id: string; query: string; title: string; brand: string; label: Cat };
export type Cell = { status: "pending" | "done" | "error"; predicted?: Cat; correct?: boolean; latencyMs?: number; costUsd?: number; error?: string };

/** Wire format shared with the API (SSE) and the recorded tape. */
export type SortEvent =
  | { type: "start"; lanes: EngineMeta[]; items: PairItem[] }
  | { type: "dispatch"; round: number; itemId: string }
  | { type: "retry"; round: number; lane: EngineId; reason: string; waitMs: number }
  | { type: "result"; round: number; itemId: string; lane: EngineId; predicted?: Cat; correct?: boolean; latencyMs?: number; costUsd?: number; error?: string }
  | { type: "done" };

export type Tape = { meta: { recordedAt: string; synthetic?: boolean; note?: string }; events: SortEvent[] };

export type SortState = {
  runId: number; mode: "live" | "replay"; running: boolean; done: boolean; error: string | null; synthetic: boolean; recordedAt: string | null;
  engines: EngineMeta[]; items: PairItem[]; round: number; dispatchedAt: number | null;
  cells: Record<EngineId, Record<number, Cell>>; retry: Partial<Record<EngineId, string>>;
};

const blank = (): SortState => ({ runId: 0, mode: "replay", running: false, done: false, error: null, synthetic: false, recordedAt: null, engines: [], items: [], round: -1, dispatchedAt: null, cells: { jev: {}, gemini: {}, claude: {} }, retry: {} });

function reduce(st: SortState, e: SortEvent): SortState {
  switch (e.type) {
    case "start": return { ...st, engines: e.lanes, items: e.items };
    case "dispatch": {
      const cells = { ...st.cells };
      for (const l of st.engines) cells[l.id] = { ...cells[l.id], [e.round]: { status: "pending" } };
      return { ...st, round: e.round, dispatchedAt: performance.now(), cells, retry: {} };
    }
    case "retry": return { ...st, retry: { ...st.retry, [e.lane]: `${e.reason}, retrying in ${Math.round(e.waitMs / 1000)}s` } };
    case "result": {
      const cell: Cell = e.error ? { status: "error", error: e.error } : { status: "done", predicted: e.predicted, correct: e.correct, latencyMs: e.latencyMs, costUsd: e.costUsd };
      const retry = { ...st.retry }; delete retry[e.lane];
      return { ...st, retry, cells: { ...st.cells, [e.lane]: { ...st.cells[e.lane], [e.round]: cell } } };
    }
    case "done": return { ...st, running: false, done: true };
  }
}

export type EngineStats = { n: number; scored: number; correct: number; accuracy: number; avgLatencyMs: number; p50LatencyMs: number; avgCostUsd: number; totalCostUsd: number; errors: number };
export function engineStats(cells: Record<number, Cell>): EngineStats {
  const all = Object.values(cells);
  const ok = all.filter((c) => c.status === "done");
  const lat = ok.map((c) => c.latencyMs ?? 0).sort((a, b) => a - b);
  const correct = ok.filter((c) => c.correct).length;
  const total = ok.reduce((a, c) => a + (c.costUsd ?? 0), 0);
  return { n: ok.length, scored: ok.length, correct, accuracy: ok.length ? correct / ok.length : 0, avgLatencyMs: ok.length ? lat.reduce((a, b) => a + b, 0) / ok.length : 0, p50LatencyMs: lat.length ? lat[Math.floor(lat.length / 2)]! : 0, avgCostUsd: ok.length ? total / ok.length : 0, totalCostUsd: total, errors: all.filter((c) => c.status === "error").length };
}

/** Linear projection from measured per-item numbers. Deliberately simple and always labeled as a projection. */
export function project(s: EngineStats, volume: number, concurrency: number) {
  return { costUsd: s.avgCostUsd * volume, queueSeconds: (s.avgLatencyMs / 1000) * volume / concurrency };
}

export type RunParams = { gemini: string; claude: string; limit: number; speed: number; gapMs: number };

/**
 * One state machine, two sources. LIVE streams SSE from /api/sort (real API calls, needs keys).
 * REPLAY re-plays a recorded real run: each envelope is dispatched on a fixed beat and each engine answers after
 * its RECORDED latency, so Jev's speed advantage is exactly what was measured.
 */
export function useSortRun() {
  const [state, setState] = useState<SortState>(blank);
  const es = useRef<EventSource | null>(null);
  const timers = useRef<number[]>([]);
  const runId = useRef(0);

  const clear = useCallback(() => { es.current?.close(); es.current = null; timers.current.forEach(clearTimeout); timers.current = []; }, []);
  const stop = useCallback(() => { clear(); setState((s) => ({ ...s, running: false })); }, [clear]);

  const startLive = useCallback((p: RunParams) => {
    clear(); const id = ++runId.current;
    setState({ ...blank(), runId: id, mode: "live", running: true });
    const q = new URLSearchParams({ gemini: p.gemini, claude: p.claude, limit: String(p.limit) });
    const s = new EventSource(`/api/sort?${q}`);
    es.current = s;
    for (const t of ["start", "dispatch", "retry", "result", "done"] as const) s.addEventListener(t, (ev) => setState((st) => reduce(st, JSON.parse((ev as MessageEvent).data) as SortEvent)));
    s.onerror = () => { if (s.readyState === EventSource.CLOSED) return; s.close(); setState((st) => (st.done ? st : { ...st, running: false, error: "Connection lost. Is the API running?" })); };
  }, [clear]);

  const startReplay = useCallback(async (p: Pick<RunParams, "speed" | "gapMs" | "limit">, onEnd?: () => void) => {
    clear(); const id = ++runId.current;
    let tape: Tape;
    try {
      let res = await fetch("/runs/sort.json", { cache: "no-store" });
      // A real recording wins. The synthetic dev fixture (gitignored) is only a fallback while building the UI.
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) res = await fetch("/runs/sort.dev.json", { cache: "no-store" });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("no recorded run");
      tape = (await res.json()) as Tape;
    } catch {
      setState({ ...blank(), runId: id, error: "No recorded run found. Run `npm run record` (needs an OpenRouter key with credits), or use Live mode." });
      return;
    }
    const start = tape.events.find((e): e is Extract<SortEvent, { type: "start" }> => e.type === "start")!;
    const items = start.items.slice(0, p.limit);
    const results = tape.events.filter((e): e is Extract<SortEvent, { type: "result" }> => e.type === "result");
    setState({ ...blank(), runId: id, mode: "replay", running: true, synthetic: !!tape.meta.synthetic, recordedAt: tape.meta.recordedAt });
    const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms / p.speed)); };
    at(0, () => setState((st) => reduce(st, { type: "start", lanes: start.lanes, items })));
    items.forEach((item, round) => {
      const t0 = 400 + round * p.gapMs;
      at(t0, () => setState((st) => reduce(st, { type: "dispatch", round, itemId: item.id })));
      for (const r of results.filter((x) => x.round === round)) at(t0 + (r.latencyMs ?? 600), () => setState((st) => reduce(st, r)));
    });
    const end = 400 + items.length * p.gapMs + 2500;
    at(end, () => { setState((st) => reduce(st, { type: "done" })); onEnd?.(); });
  }, [clear]);

  useEffect(() => clear, [clear]);
  return { state, startLive, startReplay, stop };
}

export function useNow(active: boolean, every = 40) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => { if (!active) return; const id = setInterval(() => setNow(performance.now()), every); return () => clearInterval(id); }, [active, every]);
  return now;
}
