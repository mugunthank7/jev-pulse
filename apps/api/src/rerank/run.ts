import type { Candidate, EsciLabel, SearchQuery } from "@jev-pulse/schema";
import { bm25, orderByScore } from "./bm25.ts";
import { jevScoreAll, type JevPairResult } from "./jev.ts";
import { llmRerank, type LlmRank } from "./llm.ts";
import { exactAtK, ndcg } from "./metrics.ts";

export type RerankLane = "jev" | "gemini" | "claude";
export type LaneMeta = { id: RerankLane; label: string; model: string };

export type RerankEvent =
  | { type: "start"; queryId: number; query: string; candidates: Candidate[]; baseline: { order: number[]; ndcg10: number; exact5: number }; lanes: LaneMeta[] }
  | { type: "progress"; lane: RerankLane; done: number; total: number }
  | { type: "retry"; lane: RerankLane; reason: string; waitMs: number }
  | { type: "lane"; lane: RerankLane; order: number[]; ndcg10: number; exact5: number; latencyMs: number; costUsd: number; detail?: { probs: Record<EsciLabel, number>[] } }
  | { type: "lane_error"; lane: RerankLane; error: string }
  | { type: "done" };

export type Deps = {
  jevScoreAll: typeof jevScoreAll;
  llmRerank: typeof llmRerank;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const transient = (e: unknown) => e instanceof Error && (/ 429[: ]/.test(e.message) || /in-flight requests|in_flight_budget/.test(e.message));

/**
 * One query, three rerankers started at the same instant on the SAME candidates:
 *  - Jev: one decision per (query, product) pair, all in parallel; rank by expected relevance.
 *  - Gemini / Claude: one listwise call returning the full ordering (how LLM reranking is deployed).
 * Latency is what a user would wait: wall-clock from request to final ordering.
 */
export async function runRerank(
  sq: SearchQuery, lanes: LaneMeta[], emit: (e: RerankEvent) => void | Promise<void>,
  opts: { key?: string; deps?: Partial<Deps>; signal?: AbortSignal } = {},
) {
  const { key, signal } = opts;
  const deps: Deps = { jevScoreAll, llmRerank, ...opts.deps };
  const cs = sq.candidates;
  const baseOrder = orderByScore(bm25(sq.query, cs));
  // Candidates are sent to the UI in BASELINE order so "before" is what the shopper would see without reranking.
  const display = baseOrder.map((i) => cs[i]!);
  // Everything downstream indexes into `disp` (baseline order).
  const disp = display;
  const baselineOrder = disp.map((_, i) => i);
  await emit({ type: "start", queryId: sq.queryId, query: sq.query, candidates: disp, lanes, baseline: { order: baselineOrder, ndcg10: ndcg(disp, baselineOrder), exact5: exactAtK(disp, baselineOrder) } });

  await Promise.all(lanes.map(async (lane) => {
    try {
      if (!key) throw new Error("OPENROUTER_API_KEY not set");
      if (lane.id === "jev") {
        const started = performance.now();
        const results: JevPairResult[] = await deps.jevScoreAll(sq.query, disp, key, (done, total) => void emit({ type: "progress", lane: "jev", done, total }));
        const latencyMs = performance.now() - started;
        // Rank by expected relevance; ties fall back to the baseline order (stable).
        const order = orderByScore(results.map((r) => r.utility));
        await emit({ type: "lane", lane: "jev", order, ndcg10: ndcg(disp, order), exact5: exactAtK(disp, order), latencyMs, costUsd: results.reduce((a, r) => a + r.costUsd, 0), detail: { probs: results.map((r) => r.probs) } });
        return;
      }
      let r: LlmRank | undefined;
      for (let attempt = 0; !r; attempt++) {
        try { r = await deps.llmRerank(lane.model, sq.query, disp, key); }
        catch (e) {
          if (!transient(e) || attempt >= 3 || signal?.aborted) throw e;
          const waitMs = 8000 * (attempt + 1);
          await emit({ type: "retry", lane: lane.id, reason: / 429/.test((e as Error).message) ? "rate limited" : "credit/in-flight limit", waitMs });
          await sleep(waitMs);
        }
      }
      await emit({ type: "lane", lane: lane.id, order: r.order, ndcg10: ndcg(disp, r.order), exact5: exactAtK(disp, r.order), latencyMs: r.latencyMs, costUsd: r.costUsd });
    } catch (e) {
      await emit({ type: "lane_error", lane: lane.id, error: e instanceof Error ? e.message.slice(0, 240) : String(e) });
    }
  }));
  await emit({ type: "done" });
}
