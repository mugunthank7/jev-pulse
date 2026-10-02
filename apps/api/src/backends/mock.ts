import { CATEGORIES, type Category, type Decision, type Item } from "@jev-pulse/schema";
import type { DecisionBackend } from "./types.ts";

const KEYWORDS: Record<Category, string[]> = {
  bug: ["bug", "crash", "error", "fail", "broken", "regression", "exception", "fix", "panic"],
  feature: ["feature", "add", "support", "proposal", "request", "implement", "launch", "release"],
  question: ["how", "why", "what", "?", "help", "anyone", "ask hn", "should i"],
  security: ["security", "vulnerab", "cve", "exploit", "leak", "breach", "malware", "auth"],
  discussion: ["show hn", "opinion", "discuss", "thoughts", "essay", "vs", "future"],
  news: ["announce", "raises", "acquires", "report", "study", "new", "introduces"],
};
const NEG = ["crash", "fail", "broken", "bug", "leak", "breach", "vulnerab", "outage", "error", "bad", "worst"];
const POS = ["great", "fast", "love", "launch", "release", "thanks", "faster", "better", "open source", "show hn"];
const URGENT = ["crash", "outage", "security", "cve", "urgent", "regression", "data loss", "breach", "down", "p0"];
const SPAM = ["buy now", "free money", "click here", "promo", "discount", "casino", "airdrop"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16; // avalanche
  return (h >>> 0) / 4294967295;
}
const count = (t: string, words: string[]) => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function softmax(raw: number[]): number[] {
  const m = Math.max(...raw);
  const e = raw.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/**
 * Deterministic stand-in with realistic latency so the demo, tests and CI run
 * without an API key. It is NOT Jev: it exists so the pipeline is runnable.
 */
export class MockBackend implements DecisionBackend {
  readonly name = "mock";

  async decide(item: Item) {
    const t = item.text.toLowerCase();
    const started = performance.now();
    const noise = (k: string) => hash(item.id + k);

    const logits = CATEGORIES.map((c) => count(t, KEYWORDS[c]) * 1.6 + noise(c) * 0.9);
    const probsArr = softmax(logits);
    const probs = Object.fromEntries(CATEGORIES.map((c, i) => [c, probsArr[i]!]));
    const best = probsArr.indexOf(Math.max(...probsArr));

    const urgency = clamp(18 + count(t, URGENT) * 24 + noise("u") * 28, 0, 100);
    const sentiment = clamp((count(t, POS) - count(t, NEG)) * 0.35 + (noise("s") - 0.5) * 0.4, -1, 1);
    const spam = clamp(count(t, SPAM) * 0.45 + noise("sp") * 0.08, 0, 1);
    const actionable = clamp(0.25 + count(t, [...KEYWORDS.bug, ...KEYWORDS.security]) * 0.2 + noise("a") * 0.25, 0, 1);

    const decision: Decision = {
      category: { label: CATEGORIES[best]!, probs, confidence: probsArr[best]! },
      urgency: { value: urgency, confidence: clamp(0.45 + Math.abs(urgency - 50) / 100 + noise("uc") * 0.1, 0, 1) },
      sentiment: { value: sentiment, confidence: clamp(0.4 + Math.abs(sentiment) * 0.5 + noise("sc") * 0.15, 0, 1) },
      actionable: { p: actionable },
      spam: { p: spam },
    };

    // Jev answers in ~70-500 ms; mimic that so the HUD feels honest.
    const target = 70 + noise("lat") * 230;
    await new Promise((r) => setTimeout(r, target));
    return { decision, latencyMs: performance.now() - started };
  }
}
