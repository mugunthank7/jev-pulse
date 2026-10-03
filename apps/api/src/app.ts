import { ESCALATE_BELOW, jevCost, overallConfidence, ScoreRequestSchema, type Item, type ScoredItem } from "@jev-pulse/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createBackend, type DecisionBackend } from "./backends/index.ts";
import { runArena, type ArenaLane } from "./compare/arena.ts";
import { LANE_OPTIONS, resolveModel } from "./compare/models.ts";
import { datasetRepos, loadSource } from "./sources/index.ts";
import { getQuery, listQueries, searchSource } from "./rerank/data.ts";
import { runRerank, type LaneMeta } from "./rerank/run.ts";
import { orderByScore } from "./rerank/bm25.ts";
import { jevScoreAll } from "./rerank/jev.ts";

/** Scores items with bounded concurrency; calls onScored as each finishes. */
export async function scoreAll(
  backend: DecisionBackend,
  items: Item[],
  onScored: (s: ScoredItem) => Promise<void> | void,
  concurrency = 16,
  signal?: AbortSignal,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal?.aborted) {
      const item = items[next++]!;
      try {
        const { decision, latencyMs, costUsd } = await backend.decide(item);
        await onScored({ ...item, decision, latencyMs, costUsd: costUsd ?? jevCost(item.text), backend: backend.name, correct: item.label ? decision.category.label === item.label : undefined });
      } catch (err) {
        console.error(`[score] ${item.id}:`, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export function createApp(backend: DecisionBackend = createBackend()) {
  const app = new Hono();
  app.use("/api/*", cors());

  app.get("/api/health", (c) => c.json({ ok: true, backend: backend.name }));
  app.get("/api/repos", (c) => c.json({ repos: datasetRepos() }));

  /** Server-sent events: fetch a source, score every item, stream results as they land. */
  app.get("/api/stream", (c) => {
    const source = c.req.query("source") ?? "dataset";
    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      try {
        const items = await loadSource((k) => c.req.query(k), 120, 400);
        await stream.writeSSE({ event: "start", data: JSON.stringify({ total: items.length, backend: backend.name, source }) });
        await scoreAll(backend, items, (s) => stream.writeSSE({ event: "item", data: JSON.stringify(s) }), 16, ac.signal);
        await stream.writeSSE({ event: "done", data: "{}" });
      } catch (err) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: err instanceof Error ? err.message : String(err) }) });
      }
    });
  });

  /** One-shot scoring (used by the MCP server and paste mode). */
  app.post("/api/score", async (c) => {
    const parsed = ScoreRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    const out: ScoredItem[] = [];
    await scoreAll(backend, parsed.data.items, (s) => void out.push(s));
    return c.json({ backend: backend.name, items: out });
  });

  /** Rerank arbitrary documents for a query with Jev (one decision per pair, in parallel). Used by the MCP tool. */
  app.post("/api/rank", async (c) => {
    const body = await c.req.json().catch(() => null) as { query?: string; documents?: { id?: string; text?: string }[] } | null;
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return c.json({ error: "OPENROUTER_API_KEY not set" }, 503);
    if (!body?.query || !Array.isArray(body.documents) || body.documents.length < 1 || body.documents.length > 100) return c.json({ error: "need query and 1-100 documents" }, 400);
    const docs = body.documents.map((d, i) => ({ id: d.id ?? String(i), title: String(d.text ?? "").slice(0, 400), brand: "", bullets: "", label: "Irrelevant" as const }));
    const started = performance.now();
    const results = await jevScoreAll(body.query, docs, key, () => {});
    const order = orderByScore(results.map((r) => r.utility));
    return c.json({
      latencyMs: Math.round(performance.now() - started), costUsd: results.reduce((a, r) => a + r.costUsd, 0),
      ranking: order.map((i, rank) => ({ rank: rank + 1, id: docs[i]!.id, text: docs[i]!.title, relevance: +results[i]!.utility.toFixed(3), probabilities: results[i]!.probs })),
    });
  });

  /** Search reranking: the human-judged ESCI queries available to run. */
  app.get("/api/rerank/queries", (c) => c.json({ source: searchSource(), queries: listQueries() }));

  /** One query, three rerankers (Jev / Gemini / Claude) started together; events stream as each lane finishes. */
  app.get("/api/rerank", (c) => {
    const sq = getQuery(Number(c.req.query("queryId")));
    const gemini = resolveModel("gemini", c.req.query("gemini")), claude = resolveModel("claude", c.req.query("claude"));
    if (!sq) return c.json({ error: "unknown queryId" }, 404);
    if (!gemini || !claude) return c.json({ error: "unknown model" }, 400);
    const lanes: LaneMeta[] = [
      { id: "jev", label: "Jev 1.13", model: "typesafe/jev-1.13" },
      { id: "gemini", label: gemini.label, model: gemini.model },
      { id: "claude", label: claude.label, model: claude.model },
    ];
    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      await runRerank(sq, lanes, (e) => stream.writeSSE({ event: e.type, data: JSON.stringify(e) }), { key: process.env.OPENROUTER_API_KEY, signal: ac.signal });
    });
  });

  /** Which models each lane can use (single source of truth for the UI's pickers). */
  app.get("/api/arena/models", (c) => c.json({ ...LANE_OPTIONS, jev: { label: backend.name === "mock" ? "Jev (offline mock)" : "Jev 1.13", backend: backend.name } }));

  /** Live arena: the same labeled issues go to Jev, Gemini and Claude at once; events stream per call. */
  app.get("/api/arena", (c) => {
    const gemini = resolveModel("gemini", c.req.query("gemini")), claude = resolveModel("claude", c.req.query("claude"));
    if (!gemini || !claude) return c.json({ error: "unknown model" }, 400);
    const lanes: ArenaLane[] = [
      { id: "jev", label: backend.name === "mock" ? "Jev (offline mock)" : "Jev 1.13", model: "typesafe/jev-1.13" },
      { id: "gemini", label: gemini.label, model: gemini.model },
      { id: "claude", label: claude.label, model: claude.model },
    ];
    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      try {
        const items = await loadSource((k) => (k === "source" ? "dataset" : c.req.query(k)), 20, 60);
        await runArena(backend, items, lanes, (e) => stream.writeSSE({ event: e.type, data: JSON.stringify(e) }), {
          key: process.env.OPENROUTER_API_KEY, gapMs: Number(process.env.RACE_MIN_INTERVAL_MS ?? 3200), signal: ac.signal,
        });
      } catch (err) {
        await stream.writeSSE({ event: "fatal", data: JSON.stringify({ message: err instanceof Error ? err.message : String(err) }) });
      }
    });
  });

  /** Ranked triage: score a source and return the top N by urgency x actionability. */
  app.get("/api/triage", async (c) => {
    const top = Math.min(Number(c.req.query("top") ?? 10) || 10, 50);
    try {
      const items = await loadSource((k) => c.req.query(k), 60, 500);
      const scored: ScoredItem[] = [];
      await scoreAll(backend, items, (s) => void scored.push(s));
      const rank = (s: ScoredItem) => (s.decision.urgency.value / 100) * s.decision.actionable.p * (1 - s.decision.spam.p);
      scored.sort((a, b) => rank(b) - rank(a));
      return c.json({
        backend: backend.name, scored: scored.length,
        totalCostUsd: scored.reduce((a, s) => a + s.costUsd, 0),
        top: scored.slice(0, top).map((s) => ({ title: s.text.slice(0, 160), url: s.url, category: s.decision.category.label, urgency: Math.round(s.decision.urgency.value), actionable: +s.decision.actionable.p.toFixed(2), confidence: +overallConfidence(s.decision).toFixed(2), escalate: overallConfidence(s.decision) < ESCALATE_BELOW })),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return app;
}
