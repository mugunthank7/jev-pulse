import { estimateTokens, jevCost, type Item } from "@jev-pulse/schema";
import type { DecisionBackend } from "../backends/index.ts";
import { callModel } from "./llm.ts";
import { hasKey, priceOf, raceModels, type RaceModel } from "./models.ts";

export type RaceMode = "measured" | "modeled" | "simulated";
export type RaceProgress = {
  id: string; label: string; family: "jev" | "claude" | "gemini";
  mode: RaceMode; done: number; total: number;
  avgLatencyMs: number; totalLatencyMs: number; costUsd: number; costPer1k: number;
  inTokens: number; outTokens: number; errors: number; lastError?: string; finished: boolean;
};

type Emit = (p: RaceProgress) => void | Promise<void>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number, seed: number) => ms * (0.75 + 0.5 * ((Math.sin(seed * 9301 + 49297) + 1) / 2));

async function pool<T>(items: T[], concurrency: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i]!, i); }
  }));
}

function tracker(id: string, label: string, family: RaceProgress["family"], mode: RaceMode, total: number, emit: Emit) {
  const p: RaceProgress = { id, label, family, mode, done: 0, total, avgLatencyMs: 0, totalLatencyMs: 0, costUsd: 0, costPer1k: 0, inTokens: 0, outTokens: 0, errors: 0, finished: false };
  return {
    p,
    async record(latencyMs: number, cost: number, inTok: number, outTok: number) {
      p.done++; p.totalLatencyMs += latencyMs; p.avgLatencyMs = p.totalLatencyMs / p.done;
      p.costUsd += cost; p.costPer1k = (p.costUsd / p.done) * 1000; p.inTokens += inTok; p.outTokens += outTok;
      await emit({ ...p });
    },
    async fail(err: unknown) {
      p.done++; p.errors++; p.lastError = err instanceof Error ? err.message : String(err);
      await emit({ ...p });
    },
    async finish() { p.finished = true; await emit({ ...p }); },
  };
}

/** Races Jev against Claude and Gemini models on the SAME items; emits progress as each call lands. */
export async function runRace(backend: DecisionBackend, items: Item[], emit: Emit, env = process.env, signal?: AbortSignal) {
  const jevMode: RaceMode = backend.name === "mock" ? "simulated" : "measured";
  const jev = tracker("jev", backend.name === "mock" ? "Jev (mock)" : "Jev", "jev", jevMode, items.length, emit);
  const runJev = pool(items, 16, async (item) => {
    if (signal?.aborted) return;
    try { const { latencyMs } = await backend.decide(item); await jev.record(latencyMs, jevCost(item.text), estimateTokens(item.text), 0); }
    catch (e) { await jev.fail(e); }
  }).then(() => jev.finish());

  const runModel = async (m: RaceModel) => {
    const live = hasKey(m, env);
    const t = tracker(m.id, m.label, m.provider === "anthropic" ? "claude" : "gemini", live ? "measured" : "modeled", items.length, emit);
    await emit({ ...t.p });
    await pool(items, 4, async (item, i) => {
      if (signal?.aborted) return;
      try {
        if (live) {
          const r = await callModel(m, item, env);
          await t.record(r.latencyMs, priceOf(m, r.inTokens, r.outTokens), r.inTokens, r.outTokens);
        } else {
          // Modeled: no key, so latency/tokens are typical values, NOT measurements.
          const inTok = estimateTokens(item.text) + 110, outTok = m.modeledOutTokens;
          const lat = jitter(m.modeledLatencyMs, i + m.id.length);
          await sleep(Math.min(lat, 400)); // compress wall-clock so the race is watchable; reported latency stays modeled
          await t.record(lat, priceOf(m, inTok, outTok), inTok, outTok);
        }
      } catch (e) { await t.fail(e); }
    });
    await t.finish();
  };

  await Promise.all([runJev, ...raceModels(env).map(runModel)]);
}
