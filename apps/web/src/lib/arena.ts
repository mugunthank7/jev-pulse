import { useCallback, useEffect, useRef, useState } from "react";

export type LaneId = "jev" | "gemini" | "claude";
export type LaneInfo = { id: LaneId; label: string; model: string };
export type ItemInfo = { id: string; title: string; source: string; label?: string; url?: string };
export type LaneResult = {
  status: "pending" | "done" | "error";
  predicted?: string; correct?: boolean; latencyMs?: number; costUsd?: number; error?: string;
};
export type ArenaState = {
  running: boolean; done: boolean; error: string | null;
  lanes: LaneInfo[]; items: ItemInfo[];
  round: number; dispatchedAt: number | null;
  results: Record<LaneId, Record<number, LaneResult>>;
  retry: Partial<Record<LaneId, string>>;
};
export type ArenaParams = { claude: string; gemini: string; limit: number; repo: string };

const empty = (): ArenaState => ({ running: false, done: false, error: null, lanes: [], items: [], round: -1, dispatchedAt: null, results: { jev: {}, gemini: {}, claude: {} }, retry: {} });

export type LaneStats = { done: number; scored: number; correct: number; accuracy: number; avgLatencyMs: number; costUsd: number; costPer1k: number; errors: number };
export function laneStats(results: Record<number, LaneResult>): LaneStats {
  const rs = Object.values(results);
  const ok = rs.filter((r) => r.status === "done");
  const scored = ok.filter((r) => r.correct !== undefined);
  const correct = scored.filter((r) => r.correct).length;
  const costUsd = ok.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  return {
    done: ok.length, scored: scored.length, correct, accuracy: scored.length ? correct / scored.length : 0,
    avgLatencyMs: ok.length ? ok.reduce((a, r) => a + (r.latencyMs ?? 0), 0) / ok.length : 0,
    costUsd, costPer1k: ok.length ? (costUsd / ok.length) * 1000 : 0, errors: rs.filter((r) => r.status === "error").length,
  };
}

/** Consumes /api/arena (SSE): one event per dispatch and per lane result. */
export function useArena() {
  const [state, setState] = useState<ArenaState>(empty);
  const es = useRef<EventSource | null>(null);

  const stop = useCallback(() => { es.current?.close(); es.current = null; setState((s) => ({ ...s, running: false })); }, []);

  const start = useCallback((p: ArenaParams) => {
    es.current?.close();
    setState({ ...empty(), running: true });
    const q = new URLSearchParams({ claude: p.claude, gemini: p.gemini, limit: String(p.limit), ...(p.repo !== "all" ? { repo: p.repo } : {}) });
    const s = new EventSource(`/api/arena?${q}`);
    es.current = s;
    const on = (name: string, fn: (d: any) => void) => s.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)));
    on("start", (d) => setState((st) => ({ ...st, lanes: d.lanes, items: d.items })));
    on("dispatch", (d) => setState((st) => {
      const results = { ...st.results };
      for (const l of st.lanes) results[l.id] = { ...results[l.id], [d.round]: { status: "pending" } };
      return { ...st, round: d.round, dispatchedAt: performance.now(), results, retry: {} };
    }));
    on("retry", (d) => setState((st) => ({ ...st, retry: { ...st.retry, [d.lane]: `${d.reason}, retrying in ${Math.round(d.waitMs / 1000)}s` } })));
    on("result", (d) => setState((st) => {
      const r: LaneResult = d.error ? { status: "error", error: d.error } : { status: "done", predicted: d.predicted, correct: d.correct, latencyMs: d.latencyMs, costUsd: d.costUsd };
      const retry = { ...st.retry }; delete retry[d.lane as LaneId];
      return { ...st, retry, results: { ...st.results, [d.lane]: { ...st.results[d.lane as LaneId], [d.round]: r } } };
    }));
    on("done", () => { s.close(); setState((st) => ({ ...st, running: false, done: true })); });
    on("fatal", (d) => { s.close(); setState((st) => ({ ...st, running: false, error: d.message })); });
    s.onerror = () => { if (s.readyState === EventSource.CLOSED) return; s.close(); setState((st) => (st.done ? st : { ...st, running: false, error: "Connection lost. Is the API running?" })); };
  }, []);

  useEffect(() => () => es.current?.close(), []);
  return { state, start, stop };
}

/** Ticks while `active`, for live per-lane stopwatches. */
export function useNow(active: boolean, every = 50) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(performance.now()), every);
    return () => clearInterval(id);
  }, [active, every]);
  return now;
}
