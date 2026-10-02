import { jevCost, type Item } from "@jev-pulse/schema";
import type { DecisionBackend } from "../backends/index.ts";
import { callModel } from "./openrouter.ts";
import { raceModels } from "./models.ts";

export type RaceProgress = {
  id: string; label: string; family: "jev" | "claude" | "gemini" | "other";
  done: number; total: number;
  avgLatencyMs: number; costUsd: number; costPer1k: number;
  correct: number; scored: number; accuracy: number;
  inTokens: number; outTokens: number; errors: number; lastError?: string; finished: boolean;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
type Emit = (p: RaceProgress) => void | Promise<void>;

async function pool<T>(items: T[], concurrency: number, fn: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

function tracker(id: string, label: string, family: RaceProgress["family"], total: number, emit: Emit) {
  let latSum = 0;
  const p: RaceProgress = { id, label, family, done: 0, total, avgLatencyMs: 0, costUsd: 0, costPer1k: 0, correct: 0, scored: 0, accuracy: 0, inTokens: 0, outTokens: 0, errors: 0, finished: false };
  return {
    p,
    async record(latencyMs: number, cost: number, inTok: number, outTok: number, predicted: string, item: Item) {
      p.done++; latSum += latencyMs; p.avgLatencyMs = latSum / p.done;
      p.costUsd += cost; p.costPer1k = (p.costUsd / p.done) * 1000; p.inTokens += inTok; p.outTokens += outTok;
      if (item.label) { p.scored++; if (predicted === item.label) p.correct++; p.accuracy = p.correct / p.scored; }
      await emit({ ...p });
    },
    async fail(err: unknown) { p.done++; p.errors++; p.lastError = err instanceof Error ? err.message : String(err); await emit({ ...p }); },
    async finish() { p.finished = true; await emit({ ...p }); },
  };
}

/** Races Jev against Claude and Gemini on the SAME labeled items; every number is a real API measurement. */
export async function runRace(backend: DecisionBackend, items: Item[], emit: Emit, env = process.env, signal?: AbortSignal) {
  const jevConcurrency = Number(env.RACE_JEV_CONCURRENCY ?? 4);
  const jev = tracker("jev", backend.name === "mock" ? "Jev (offline mock)" : "Jev 1.13", "jev", items.length, emit);
  const runJev = pool(items, jevConcurrency, async (item) => {
    if (signal?.aborted) return;
    try {
      const { decision, latencyMs, costUsd } = await backend.decide(item);
      await jev.record(latencyMs, costUsd ?? jevCost(item.text), 0, 0, decision.category.label, item);
    } catch (e) { await jev.fail(e); }
  }).then(() => jev.finish());

  const key = env.OPENROUTER_API_KEY;
  // New OpenRouter accounts allow ~20 requests/min PER MODEL. Pace each model's calls evenly so none
  // are rejected (rejections would silently shrink the sample); latency below excludes this waiting.
  const gapMs = Number(env.RACE_MIN_INTERVAL_MS ?? 3200);
  const runModel = async (m: ReturnType<typeof raceModels>[number]) => {
    const t = tracker(m.id, m.label, m.family, items.length, emit);
    await emit({ ...t.p });
    let nextSlot = Date.now();
    const slot = () => { const at = Math.max(nextSlot, Date.now()); nextSlot = at + gapMs; return at - Date.now(); };
    await pool(items, 1, async (item) => {
      if (signal?.aborted) return;
      try {
        if (!key) throw new Error("OPENROUTER_API_KEY not set");
        let r;
        for (let attempt = 0; ; attempt++) {
          await sleep(slot());
          try { r = await callModel(m.model, item, key); break; }
          catch (e) {
            // 429 = per-model rpm limit; 402 in_flight_budget_exhausted = account has too many requests in flight
            // for its credit balance. Both are transient: back off and retry the SAME item.
            const transient = e instanceof Error && (/ 429[: ]/.test(e.message) || /in-flight requests|in_flight_budget/.test(e.message));
            if (!transient || attempt >= 4) throw e;
            nextSlot = Math.max(nextSlot, Date.now() + 10_000 * (attempt + 1));
          }
        }
        await t.record(r.latencyMs, r.costUsd, r.inTokens, r.outTokens, r.category, item);
      } catch (e) { await t.fail(e); }
    });
    await t.finish();
  };
  await Promise.all([runJev, ...raceModels(env).map(runModel)]);
}
