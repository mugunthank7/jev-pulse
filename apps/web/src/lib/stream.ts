import { useCallback, useEffect, useRef, useState } from "react";
import type { ScoredItem } from "@jev-pulse/schema";

export type StreamState = {
  items: ScoredItem[];
  total: number;
  running: boolean;
  backend: string;
  error: string | null;
  startedAt: number | null;
  elapsedMs: number;
};
export type StreamParams = { source: "hn" | "github" | "synthetic"; repo?: string; limit: number };

const initial: StreamState = { items: [], total: 0, running: false, backend: "-", error: null, startedAt: null, elapsedMs: 0 };

/** Subscribes to /api/stream (SSE) and accumulates scored items. */
export function useJevStream() {
  const [state, setState] = useState<StreamState>(initial);
  const es = useRef<EventSource | null>(null);
  const buffer = useRef<ScoredItem[]>([]);
  const t0 = useRef(0);

  const stop = useCallback(() => {
    es.current?.close();
    es.current = null;
    setState((s) => ({ ...s, running: false }));
  }, []);

  const start = useCallback((p: StreamParams) => {
    es.current?.close();
    buffer.current = [];
    t0.current = performance.now();
    setState({ ...initial, running: true, startedAt: Date.now() });
    const q = new URLSearchParams({ source: p.source, limit: String(p.limit), ...(p.repo ? { repo: p.repo } : {}) });
    const source = new EventSource(`/api/stream?${q}`);
    es.current = source;
    source.addEventListener("start", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setState((s) => ({ ...s, total: d.total, backend: d.backend }));
    });
    source.addEventListener("item", (e) => buffer.current.push(JSON.parse((e as MessageEvent).data)));
    source.addEventListener("done", () => {
      source.close();
      setState((s) => ({ ...s, running: false, elapsedMs: performance.now() - t0.current }));
    });
    source.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      source.close();
      setState((s) => ({ ...s, running: false, error: data ? JSON.parse(data).message : "Connection lost. Is the API running?" }));
    });
  }, []);

  // Flush buffered items to React state ~12x/s so a 1000-item burst doesn't thrash renders.
  useEffect(() => {
    const id = setInterval(() => {
      if (!buffer.current.length) return;
      const batch = buffer.current.splice(0);
      setState((s) => ({ ...s, items: [...s.items, ...batch], elapsedMs: s.running ? performance.now() - t0.current : s.elapsedMs }));
    }, 80);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => es.current?.close(), []);
  return { state, start, stop };
}
