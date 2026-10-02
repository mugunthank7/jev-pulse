import { CATEGORIES, DecisionSchema, type Decision, type Item } from "@jev-pulse/schema";
import type { DecisionBackend } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Label definitions shared with the LLM prompt in compare/openrouter.ts so every model sees the same task. */
export const CLASS_DEFINITIONS = {
  bug: "Reports something that is broken, crashes, or behaves incorrectly",
  feature: "Requests new functionality or an improvement to existing behavior",
  question: "Asks how to do something, or asks for help or clarification",
} as const satisfies Record<(typeof CATEGORIES)[number], string>;

/** The five typed questions Jev Pulse asks about every item. */
export const QUESTIONS = {
  category: { type: "choice", instructions: "What is the reporter of this GitHub issue asking for?", criteria: CLASS_DEFINITIONS },
  urgency: { type: "score", instructions: "How urgent is this issue for the maintainers?", criteria: ["Not urgent", "Low", "Medium", "High", "Critical"] },
  sentiment: { type: "score", instructions: "What is the reporter's tone?", criteria: ["Very negative", "Negative", "Neutral", "Positive", "Very positive"] },
  actionable: { type: "noul", instructions: "Does the issue contain enough detail for a maintainer to act on it?", criteria: { true: "Clear and actionable", false: "Vague or missing information" } },
  spam: { type: "noul", instructions: "Is this issue spam or off-topic?", criteria: { true: "Spam or off-topic", false: "A genuine issue" } },
} as const;

type Answer = { choice?: string; probabilities?: Record<string, number>; confidence?: number; score?: number; noul?: number };

/**
 * Maps OpenRouter's /api/alpha/decisions `answers` into our Decision.
 * Shape verified against a live typesafe/jev-1.13 response (choice: choice+probabilities+confidence;
 * score: probability-weighted position 0..N-1 + confidence; noul: probability of "true").
 */
export function normalise(answers: Record<string, Answer>): Decision {
  const cat = answers.category ?? {};
  const probs = cat.probabilities ?? {};
  const label = (cat.choice ?? Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "question") as (typeof CATEGORIES)[number];
  const scaled = (a: Answer | undefined, lo: number, hi: number) => lo + (clamp(a?.score ?? 0, 0, 4) / 4) * (hi - lo);
  return DecisionSchema.parse({
    category: { label, probs, confidence: clamp(probs[label] ?? cat.confidence ?? 0.5, 0, 1) },
    urgency: { value: scaled(answers.urgency, 0, 100), confidence: clamp(answers.urgency?.confidence ?? 0.5, 0, 1) },
    sentiment: { value: scaled(answers.sentiment, -1, 1), confidence: clamp(answers.sentiment?.confidence ?? 0.5, 0, 1) },
    actionable: { p: clamp(answers.actionable?.noul ?? 0.5, 0, 1) },
    spam: { p: clamp(answers.spam?.noul ?? 0, 0, 1) },
  });
}

/** Real Jev through OpenRouter's decisions endpoint (model typesafe/jev-1.13). */
export class JevBackend implements DecisionBackend {
  readonly name = "jev";
  constructor(
    private apiKey: string,
    private url = "https://openrouter.ai/api/alpha/decisions",
    private model = "typesafe/jev-1.13",
  ) {}

  async decide(item: Item) {
    const started = performance.now();
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, state: { issue: item.text }, questions: QUESTIONS }),
    });
    if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { answers: Record<string, Answer>; usage?: { cost?: number } };
    return { decision: normalise(body.answers), latencyMs: performance.now() - started, costUsd: body.usage?.cost };
  }
}
