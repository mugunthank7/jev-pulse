import type { SortCategory, SortItem } from "./items.ts";
import type { Judgment } from "./judges.ts";

export type SortLane = { id: "jev" | "gemini" | "claude"; label: string; model: string };
/** `t` = milliseconds since the run started, so a recording can be replayed with its true timing. */
export type SortEvent =
  | { type: "start"; lanes: SortLane[]; items: SortItem[] }
  | { type: "dispatch"; lane: SortLane["id"]; round: number; itemId: string; t: number }
  | { type: "retry"; lane: SortLane["id"]; round: number; reason: string; waitMs: number; t: number }
  | { type: "result"; lane: SortLane["id"]; round: number; itemId: string; predicted?: SortCategory; correct?: boolean; latencyMs?: number; costUsd?: number; error?: string; t: number }
  | { type: "done" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
/** 429 = per-model rpm limit; 402 "in-flight" = too many requests in flight for the credit balance. */
const transient = (e: unknown) => e instanceof Error && (/ 429[: ]/.test(e.message) || /in-flight requests|in_flight_budget/.test(e.message));

/**
 * Independent lanes over one shared inbox. Every engine works through the SAME ordered list of items, but each
 * takes its next item the instant it finishes the previous one: a fast engine races ahead through the inbox
 * while a slow one is still on item 3. `minIntervalMs(lane)` optionally spaces a lane's calls (OpenRouter's
 * new-account limit is ~20 requests/min per model); that waiting happens between calls, never inside a timed
 * call, so it never inflates a latency. With a higher rate limit set it to 0 and every lane runs flat out.
 */
export async function runSort(
  items: SortItem[], lanes: SortLane[], judge: (lane: SortLane, item: SortItem) => Promise<Judgment>,
  emit: (e: SortEvent) => void | Promise<void>, opts: { minIntervalMs?: (lane: SortLane) => number; signal?: AbortSignal } = {},
) {
  const { minIntervalMs = () => 0, signal } = opts;
  const t0 = Date.now();
  const now = () => Date.now() - t0;
  await emit({ type: "start", lanes, items });

  await Promise.all(lanes.map(async (lane) => {
    for (let round = 0; round < items.length; round++) {
      if (signal?.aborted) return;
      const item = items[round]!;
      const started = Date.now();
      await emit({ type: "dispatch", lane: lane.id, round, itemId: item.id, t: now() });
      try {
        let j: Judgment | undefined;
        for (let attempt = 0; !j; attempt++) {
          try { j = await judge(lane, item); }
          catch (e) {
            if (!transient(e) || attempt >= 3 || signal?.aborted) throw e;
            const waitMs = 8000 * (attempt + 1);
            await emit({ type: "retry", lane: lane.id, round, reason: / 429/.test((e as Error).message) ? "rate limited" : "credit/in-flight limit", waitMs, t: now() });
            await sleep(waitMs);
          }
        }
        await emit({ type: "result", lane: lane.id, round, itemId: item.id, predicted: j.predicted, correct: j.predicted === item.label, latencyMs: j.latencyMs, costUsd: j.costUsd, t: now() });
      } catch (e) {
        await emit({ type: "result", lane: lane.id, round, itemId: item.id, error: e instanceof Error ? e.message.slice(0, 240) : String(e), t: now() });
      }
      if (round < items.length - 1) await sleep(started + minIntervalMs(lane) - Date.now());
    }
  }));
  await emit({ type: "done" });
}
