import { ESCI_GAINS, ESCI_LABELS, type Candidate, type EsciLabel } from "@jev-pulse/schema";

/** One Jev question per (query, product) pair. The relationship definitions follow the ESCI paper. */
export const RELATIONSHIP_QUESTION = {
  relationship: {
    type: "choice",
    instructions: "How does this product relate to the shopper's search query?",
    criteria: {
      exact: "The product is what the shopper asked for and satisfies every attribute in the query",
      substitute: "The product is not exactly what was asked for, but a shopper could use it instead",
      complement: "The product is an accessory or companion to what was asked for, not the item itself",
      irrelevant: "The product does not match what the shopper asked for",
    },
  },
} as const;

const CLASS_BY_KEY: Record<string, EsciLabel> = { exact: "Exact", substitute: "Substitute", complement: "Complement", irrelevant: "Irrelevant" };

export type JevPairResult = { utility: number; probs: Record<EsciLabel, number>; costUsd: number; latencyMs: number };

/** Expected relevance = sum over classes of P(class) x gain(class). A real ranking signal, not just a label. */
export function expectedUtility(probabilities: Record<string, number>): { utility: number; probs: Record<EsciLabel, number> } {
  const probs = { Exact: 0, Substitute: 0, Complement: 0, Irrelevant: 0 } as Record<EsciLabel, number>;
  for (const [k, p] of Object.entries(probabilities)) { const l = CLASS_BY_KEY[k]; if (l) probs[l] = p; }
  const utility = ESCI_LABELS.reduce((a, l) => a + probs[l] * ESCI_GAINS[l], 0);
  return { utility, probs };
}

export async function judgePair(query: string, c: Candidate, apiKey: string, url = "https://openrouter.ai/api/alpha/decisions"): Promise<JevPairResult> {
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "typesafe/jev-1.13",
      state: { search_query: query, product: { title: c.title, brand: c.brand || undefined, details: c.bullets.slice(0, 200) || undefined } },
      questions: RELATIONSHIP_QUESTION,
    }),
  });
  if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { answers: { relationship: { probabilities?: Record<string, number>; choice?: string } }; usage?: { cost?: number } };
  const a = body.answers.relationship;
  const { utility, probs } = expectedUtility(a.probabilities ?? (a.choice ? { [a.choice]: 1 } : {}));
  return { utility, probs, costUsd: body.usage?.cost ?? 0, latencyMs: performance.now() - started };
}

/** Scores every candidate in parallel (bounded). Calls onProgress after each pair so the UI can animate. */
export async function jevScoreAll(query: string, candidates: Candidate[], apiKey: string, onProgress: (done: number, total: number) => void, concurrency = 16) {
  const out: JevPairResult[] = new Array(candidates.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (next < candidates.length) {
      const i = next++;
      out[i] = await judgePair(query, candidates[i]!, apiKey);
      onProgress(++done, candidates.length);
    }
  }));
  return out;
}
