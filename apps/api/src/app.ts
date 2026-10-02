import { ESCALATE_BELOW, jevCost, overallConfidence, ScoreRequestSchema, type Item, type ScoredItem } from "@jev-pulse/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createBackend, type DecisionBackend } from "./backends/index.ts";
import { githubIssues, hackerNews, synthetic } from "./sources/index.ts";

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
        const { decision, latencyMs } = await backend.decide(item);
        await onScored({ ...item, decision, latencyMs, costUsd: jevCost(item.text), backend: backend.name });
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

  /** Server-sent events: fetch a source, score every item, stream results as they land. */
  app.get("/api/stream", (c) => {
    const source = c.req.query("source") ?? "hn";
    const limit = Math.min(Number(c.req.query("limit") ?? 120) || 120, 1000);
    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      try {
        const items =
          source === "github" ? await githubIssues(c.req.query("repo") ?? "", limit)
          : source === "synthetic" ? synthetic(limit)
          : await hackerNews(limit);
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

  /** Ranked triage: score a source and return the top N by urgency x actionability. */
  app.get("/api/triage", async (c) => {
    const source = c.req.query("source") ?? "hn";
    const limit = Math.min(Number(c.req.query("limit") ?? 60) || 60, 500);
    const top = Math.min(Number(c.req.query("top") ?? 10) || 10, 50);
    try {
      const items =
        source === "github" ? await githubIssues(c.req.query("repo") ?? "", limit)
        : source === "synthetic" ? synthetic(limit)
        : await hackerNews(limit);
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
