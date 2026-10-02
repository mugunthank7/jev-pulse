import { jevCost, type Item } from "@jev-pulse/schema";
import type { DecisionBackend } from "../backends/index.ts";
import { callModel, type LlmResult } from "./openrouter.ts";
import type { LaneId } from "./models.ts";

export type ArenaLane = { id: LaneId; label: string; model: string };

export type ArenaEvent =
  | { type: "start"; lanes: ArenaLane[]; items: { id: string; title: string; source: string; label?: string; url?: string }[] }
  | { type: "dispatch"; round: number; itemId: string; at: number }
  | { type: "retry"; round: number; lane: LaneId; reason: string; waitMs: number }
  | { type: "result"; round: number; itemId: string; lane: LaneId; predicted?: string; correct?: boolean; latencyMs?: number; costUsd?: number; error?: string }
  | { type: "done" };

type Call = (model: string, item: Item, key: string) => Promise<LlmResult>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** 429 = per-model rpm limit; 402 "in-flight" = too many requests in flight for the account's credit balance. */
const transient = (e: unknown) => e instanceof Error && (/ 429[: ]/.test(e.message) || /in-flight requests|in_flight_budget/.test(e.message));

/**
 * Round-based race. Every round sends the SAME issue to all three lanes at the same instant; each lane
 * reports back when ITS call finishes, with its own wall-clock latency and billed cost. Rounds start at
 * least `gapMs` apart, which keeps each model under OpenRouter's ~20 requests/min new-account limit
 * without inflating any measured latency (waiting happens between rounds, never inside a timed call).
 */
export async function runArena(
  backend: DecisionBackend,
  items: Item[],
  lanes: ArenaLane[],
  emit: (e: ArenaEvent) => void | Promise<void>,
  opts: { key?: string; gapMs?: number; signal?: AbortSignal; call?: Call } = {},
) {
  const { key, gapMs = 3200, signal, call = callModel } = opts;
  await emit({ type: "start", lanes, items: items.map((i) => ({ id: i.id, title: i.text.split("\n")[0]!.slice(0, 140), source: i.source, label: i.label, url: i.url })) });

  for (let round = 0; round < items.length; round++) {
    if (signal?.aborted) return;
    const item = items[round]!;
    const roundStart = Date.now();
    await emit({ type: "dispatch", round, itemId: item.id, at: roundStart });

    await Promise.all(lanes.map(async (lane) => {
      try {
        let predicted: string, latencyMs: number, costUsd: number;
        if (lane.id === "jev") {
          const r = await backend.decide(item);
          predicted = r.decision.category.label; latencyMs = r.latencyMs; costUsd = r.costUsd ?? jevCost(item.text);
        } else {
          if (!key) throw new Error("OPENROUTER_API_KEY not set");
          let r: LlmResult | undefined;
          for (let attempt = 0; !r; attempt++) {
            try { r = await call(lane.model, item, key); }
            catch (e) {
              if (!transient(e) || attempt >= 3 || signal?.aborted) throw e;
              const waitMs = 8000 * (attempt + 1);
              await emit({ type: "retry", round, lane: lane.id, reason: e instanceof Error && / 429/.test(e.message) ? "rate limited" : "credit/in-flight limit", waitMs });
              await sleep(waitMs);
            }
          }
          predicted = r.category; latencyMs = r.latencyMs; costUsd = r.costUsd;
        }
        await emit({ type: "result", round, itemId: item.id, lane: lane.id, predicted, correct: item.label ? predicted === item.label : undefined, latencyMs, costUsd });
      } catch (e) {
        await emit({ type: "result", round, itemId: item.id, lane: lane.id, error: e instanceof Error ? e.message.slice(0, 240) : String(e) });
      }
    }));

    if (round < items.length - 1) await sleep(roundStart + gapMs - Date.now());
  }
  await emit({ type: "done" });
}
