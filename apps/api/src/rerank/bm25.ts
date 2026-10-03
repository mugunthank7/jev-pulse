import type { Candidate } from "@jev-pulse/schema";

const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const text = (c: Candidate) => `${c.title} ${c.brand} ${c.bullets}`;

/**
 * Plain BM25 over the query's own candidate pool (idf computed within the pool). This is the lexical
 * baseline that Jev and the LLMs must beat; deliberately simple and fully reproducible.
 */
export function bm25(query: string, candidates: Candidate[], k1 = 1.2, b = 0.75): number[] {
  const docs = candidates.map((c) => tokenize(text(c)));
  const avgLen = docs.reduce((a, d) => a + d.length, 0) / Math.max(docs.length, 1) || 1;
  const q = [...new Set(tokenize(query))];
  const df = new Map<string, number>();
  for (const t of q) df.set(t, docs.filter((d) => d.includes(t)).length);
  return docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const f = d.filter((x) => x === t).length;
      if (!f) continue;
      const n = df.get(t)!;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen)));
    }
    return score;
  });
}

/** Candidate indexes ordered best-first by score; ties keep the incoming order (stable). */
export function orderByScore(scores: number[]): number[] {
  return scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i);
}
