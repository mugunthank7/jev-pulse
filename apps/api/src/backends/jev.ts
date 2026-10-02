import { CATEGORIES, DecisionSchema, type Decision, type Item } from "@jev-pulse/schema";
import type { DecisionBackend } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The five typed questions Jev Pulse asks about every item. */
export const QUESTIONS = {
  category: { type: "choice", options: [...CATEGORIES] },
  urgency: { type: "score", min: 0, max: 100 },
  sentiment: { type: "score", min: -1, max: 1 },
  actionable: { type: "noul" },
  spam: { type: "noul" },
} as const;

type Raw = Record<string, any>;

/**
 * Normalises Jev's response into our Decision shape. Written defensively
 * (several field spellings accepted) because the API is in early access and the
 * exact response envelope has not been verified against a live key yet.
 */
export function normalise(raw: Raw): Decision {
  const a = raw.answers ?? raw.results ?? raw;
  const probOf = (q: Raw): number => (typeof q === "number" ? q : (q?.probability ?? q?.p ?? q?.value ?? 0.5));
  const conf = (q: Raw): number => clamp(q?.confidence ?? q?.probability_of_value ?? 0.6, 0, 1);

  const c = a.category ?? {};
  const probs: Record<string, number> = c.probabilities ?? c.probs ?? {};
  const label = (c.value ?? c.choice ?? Object.entries(probs).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "discussion") as never;

  return DecisionSchema.parse({
    category: { label, probs, confidence: clamp(probs[label as string] ?? conf(c), 0, 1) },
    urgency: { value: clamp(a.urgency?.value ?? 0, 0, 100), confidence: conf(a.urgency) },
    sentiment: { value: clamp(a.sentiment?.value ?? 0, -1, 1), confidence: conf(a.sentiment) },
    actionable: { p: clamp(probOf(a.actionable), 0, 1) },
    spam: { p: clamp(probOf(a.spam), 0, 1) },
  });
}

/** Real Jev (or any Jev-compatible endpoint such as a self-hosted Kev). */
export class JevBackend implements DecisionBackend {
  constructor(
    readonly name: string,
    private url: string,
    private apiKey?: string,
    private model = "jev-latest",
  ) {}

  async decide(item: Item) {
    const started = performance.now();
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, state: item.text, questions: QUESTIONS }),
    });
    if (!res.ok) throw new Error(`${this.name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const decision = normalise((await res.json()) as Raw);
    return { decision, latencyMs: performance.now() - started };
  }
}
