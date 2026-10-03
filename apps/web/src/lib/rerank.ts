import { useCallback, useEffect, useRef, useState } from "react";
import type { Candidate } from "@jev-pulse/schema";

export type Lane = "jev" | "gemini" | "claude";
export type LaneMeta = { id: Lane; label: string; model: string };
export type LaneOutcome = { order: number[]; ndcg10: number; exact5: number; latencyMs: number; costUsd: number };
export type QueryRun = {
  queryId: number; query: string; candidates: Candidate[]; lanes: LaneMeta[];
  baseline: { order: number[]; ndcg10: number; exact5: number };
  progress: Partial<Record<Lane, { done: number; total: number }>>;
  results: Partial<Record<Lane, LaneOutcome>>;
  errors: Partial<Record<Lane, string>>;
  retry: Partial<Record<Lane, string>>;
  startedAt: number; done: boolean;
};
export type Totals = { queries: number; baseline: number; lanes: Record<Lane, { n: number; ndcg: number; exact5: number; latency: number; cost: number; errors: number }> };

export const emptyTotals = (): Totals => ({ queries: 0, baseline: 0, lanes: { jev: { n: 0, ndcg: 0, exact5: 0, latency: 0, cost: 0, errors: 0 }, gemini: { n: 0, ndcg: 0, exact5: 0, latency: 0, cost: 0, errors: 0 }, claude: { n: 0, ndcg: 0, exact5: 0, latency: 0, cost: 0, errors: 0 } } });

/** Runs one query at a time over SSE and keeps running totals across queries (for the scoreboard). */
export function useRerank() {
  const [run, setRun] = useState<QueryRun | null>(null);
  const [totals, setTotals] = useState<Totals>(emptyTotals);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);
  const cancelled = useRef(false);

  const runOne = useCallback((queryId: number, gemini: string, claude: string) => new Promise<void>((resolve) => {
    const q = new URLSearchParams({ queryId: String(queryId), gemini, claude });
    const s = new EventSource(`/api/rerank?${q}`);
    es.current = s;
    const on = (name: string, fn: (d: any) => void) => s.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)));
    let baselineNdcg = 0;
    on("start", (d) => { baselineNdcg = d.baseline.ndcg10; setRun({ queryId: d.queryId, query: d.query, candidates: d.candidates, lanes: d.lanes, baseline: d.baseline, progress: {}, results: {}, errors: {}, retry: {}, startedAt: performance.now(), done: false }); });
    on("progress", (d) => setRun((r) => (r ? { ...r, progress: { ...r.progress, [d.lane]: { done: d.done, total: d.total } } } : r)));
    on("retry", (d) => setRun((r) => (r ? { ...r, retry: { ...r.retry, [d.lane]: `${d.reason}, retrying in ${Math.round(d.waitMs / 1000)}s` } } : r)));
    on("lane", (d) => {
      setRun((r) => (r ? { ...r, results: { ...r.results, [d.lane]: { order: d.order, ndcg10: d.ndcg10, exact5: d.exact5, latencyMs: d.latencyMs, costUsd: d.costUsd } }, retry: { ...r.retry, [d.lane]: undefined } } : r));
      setTotals((t) => { const l = t.lanes[d.lane as Lane]; return { ...t, lanes: { ...t.lanes, [d.lane]: { ...l, n: l.n + 1, ndcg: l.ndcg + d.ndcg10, exact5: l.exact5 + d.exact5, latency: l.latency + d.latencyMs, cost: l.cost + d.costUsd } } }; });
    });
    on("lane_error", (d) => {
      setRun((r) => (r ? { ...r, errors: { ...r.errors, [d.lane]: d.error } } : r));
      setTotals((t) => { const l = t.lanes[d.lane as Lane]; return { ...t, lanes: { ...t.lanes, [d.lane]: { ...l, errors: l.errors + 1 } } }; });
    });
    on("done", () => {
      s.close();
      setTotals((t) => ({ ...t, queries: t.queries + 1, baseline: t.baseline + baselineNdcg }));
      setRun((r) => (r ? { ...r, done: true } : r));
      resolve();
    });
    s.onerror = () => { if (s.readyState === EventSource.CLOSED) return; s.close(); setError("Connection lost. Is the API running?"); resolve(); };
  }), []);

  const runBatch = useCallback(async (queryIds: number[], gemini: string, claude: string, gapMs = 3500) => {
    cancelled.current = false; setRunning(true); setError(null); setTotals(emptyTotals());
    for (const id of queryIds) {
      if (cancelled.current) break;
      const t0 = performance.now();
      await runOne(id, gemini, claude);
      // Space queries out so each LLM stays under OpenRouter's new-account request limits.
      const wait = gapMs - (performance.now() - t0);
      if (wait > 0 && !cancelled.current) await new Promise((r) => setTimeout(r, wait));
    }
    setRunning(false);
  }, [runOne]);

  const stop = useCallback(() => { cancelled.current = true; es.current?.close(); setRunning(false); }, []);
  useEffect(() => () => es.current?.close(), []);
  return { run, totals, running, error, runBatch, stop };
}

export function useNow(active: boolean, every = 50) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => { if (!active) return; const id = setInterval(() => setNow(performance.now()), every); return () => clearInterval(id); }, [active, every]);
  return now;
}
