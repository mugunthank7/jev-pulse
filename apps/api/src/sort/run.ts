import type { SortItem, SortCategory } from "./items.ts";
import type { Judgment } from "./judges.ts";

export type SortLane = { id: "jev" | "gemini" | "claude"; label: string; model: string };
export type SortEvent =
  | { type: "start"; lanes: SortLane[]; items: SortItem[] }
  | { type: "dispatch"; round: number; itemId: string }
  | { type: "retry"; round: number; lane: SortLane["id"]; reason: string; waitMs: number }
  | { type: "result"; round: number; itemId: string; lane: SortLane["id"]; predicted?: SortCategory; correct?: boolean; latencyMs?: number; costUsd?: number; error?: string }
  | { type: "done" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
/** 429 = per-model rpm limit; 402 "in-flight" = too many requests in flight for the credit balance. */
const transient = (e: unknown) => e instanceof Error && (/ 429[: ]/.test(e.message) || /in-flight requests|in_flight_budget/.test(e.message));

/**
 * Round-based: every round sends the SAME (query, product) envelope to all engines at the same instant; each
 * engine reports its own wall-clock latency and billed cost when ITS call lands. Rounds start >= gapMs apart
 * (OpenRouter's new-account limit is ~20 requests/min per model); waiting happens between rounds, never inside
 * a timed call, so it never inflates any latency.
 */
export async function runSort(
  items: SortItem[], lanes: SortLane[], judge: (lane: SortLane, item: SortItem) => Promise<Judgment>,
  emit: (e: SortEvent) => void | Promise<void>, opts: { gapMs?: number; signal?: AbortSignal } = {},
) {
  const { gapMs = 3200, signal } = opts;
  await emit({ type: "start", lanes, items });
  for (let round = 0; round < items.length; round++) {
    if (signal?.aborted) return;
    const item = items[round]!;
    const roundStart = Date.now();
    await emit({ type: "dispatch", round, itemId: item.id });
    await Promise.all(lanes.map(async (lane) => {
      try {
        let j: Judgment | undefined;
        for (let attempt = 0; !j; attempt++) {
          try { j = await judge(lane, item); }
          catch (e) {
            if (!transient(e) || attempt >= 3 || signal?.aborted) throw e;
            const waitMs = 8000 * (attempt + 1);
            await emit({ type: "retry", round, lane: lane.id, reason: / 429/.test((e as Error).message) ? "rate limited" : "credit/in-flight limit", waitMs });
            await sleep(waitMs);
          }
        }
        await emit({ type: "result", round, itemId: item.id, lane: lane.id, predicted: j.predicted, correct: j.predicted === item.label, latencyMs: j.latencyMs, costUsd: j.costUsd });
      } catch (e) {
        await emit({ type: "result", round, itemId: item.id, lane: lane.id, error: e instanceof Error ? e.message.slice(0, 240) : String(e) });
      }
    }));
    if (round < items.length - 1) await sleep(roundStart + gapMs - Date.now());
  }
  await emit({ type: "done" });
}
