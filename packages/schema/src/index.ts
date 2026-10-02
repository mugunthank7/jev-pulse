import { z } from "zod";

/** The categories Jev Pulse asks Jev to choose between. */
export const CATEGORIES = ["bug", "feature", "question", "security", "discussion", "news"] as const;
export type Category = (typeof CATEGORIES)[number];

/** A raw item pulled from a source (HN, GitHub, pasted text...). */
export const ItemSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(4000),
  url: z.string().optional(),
  source: z.string(),
});
export type Item = z.infer<typeof ItemSchema>;

const unit = z.number().min(0).max(1);

/**
 * Jev-style typed decision: every answer carries a calibrated probability.
 * `confidence` is always "how sure is the model about the value it returned".
 */
export const DecisionSchema = z.object({
  category: z.object({ label: z.enum(CATEGORIES), probs: z.record(z.string(), unit), confidence: unit }),
  urgency: z.object({ value: z.number().min(0).max(100), confidence: unit }),
  sentiment: z.object({ value: z.number().min(-1).max(1), confidence: unit }),
  actionable: z.object({ p: unit }),
  spam: z.object({ p: unit }),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const ScoredItemSchema = ItemSchema.extend({
  decision: DecisionSchema,
  latencyMs: z.number(),
  costUsd: z.number(),
  backend: z.string(),
});
export type ScoredItem = z.infer<typeof ScoredItemSchema>;

export const ScoreRequestSchema = z.object({ items: z.array(ItemSchema).min(1).max(2000) });
export type ScoreRequest = z.infer<typeof ScoreRequestSchema>;

/** Overall confidence of a decision, used for the glow ring and escalation. */
export function overallConfidence(d: Decision): number {
  return (d.category.confidence + d.urgency.confidence + d.sentiment.confidence) / 3;
}

/** Items below this confidence are flagged "escalate to an LLM". */
export const ESCALATE_BELOW = 0.55;

/** Public price used for the cost counter (USD per 1M input tokens). */
export const JEV_USD_PER_M_TOKENS = 0.042;
/** Reference LLM decision cost/latency from TypeSafe's published comparison. */
export const LLM_REF = { costUsd: 0.0304, latencyMs: 10_000 } as const;

/** Rough token estimate (~4 chars/token) plus the question-schema overhead. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4) + 120;
}
export function jevCost(text: string): number {
  return (estimateTokens(text) * JEV_USD_PER_M_TOKENS) / 1_000_000;
}
