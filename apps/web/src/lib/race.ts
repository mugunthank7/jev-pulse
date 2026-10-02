import { useCallback, useEffect, useRef, useState } from "react";

export type RaceRow = {
  id: string; label: string; family: "jev" | "claude" | "gemini";
  mode: "measured" | "modeled" | "simulated"; done: number; total: number;
  avgLatencyMs: number; costUsd: number; costPer1k: number; inTokens: number; outTokens: number;
  errors: number; lastError?: string; finished: boolean;
};

export function useRace() {
  const [rows, setRows] = useState<Record<string, RaceRow>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const es = useRef<EventSource | null>(null);
  const pending = useRef<Record<string, RaceRow>>({});

  const start = useCallback((source: string, limit: number, repo?: string) => {
    es.current?.close();
    pending.current = {};
    setRows({}); setError(null); setRunning(true);
    const q = new URLSearchParams({ source, limit: String(limit), ...(repo ? { repo } : {}) });
    const s = new EventSource(`/api/compare?${q}`);
    es.current = s;
    s.addEventListener("start", (e) => setTotal(JSON.parse((e as MessageEvent).data).total));
    s.addEventListener("progress", (e) => { const r: RaceRow = JSON.parse((e as MessageEvent).data); pending.current[r.id] = r; });
    s.addEventListener("done", () => { s.close(); setRunning(false); });
    s.addEventListener("error", (e) => {
      const d = (e as MessageEvent).data; s.close(); setRunning(false);
      setError(d ? JSON.parse(d).message : "Connection lost. Is the API running?");
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const p = pending.current;
      if (!Object.keys(p).length) return;
      pending.current = {};
      setRows((r) => ({ ...r, ...p }));
    }, 90);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => es.current?.close(), []);
  return { rows, running, error, total, start };
}
