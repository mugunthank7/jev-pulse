import { ESCI_GAINS, type Candidate } from "@jev-pulse/schema";

const gain = (c: Candidate) => ESCI_GAINS[c.label];

/** nDCG@k with ESCI gains. `order` is a list of candidate indexes, best first. */
export function ndcg(candidates: Candidate[], order: number[], k = 10): number {
  const dcg = (gs: number[]) => gs.slice(0, k).reduce((a, g, i) => a + (2 ** g - 1) / Math.log2(i + 2), 0);
  const actual = dcg(order.map((i) => gain(candidates[i]!)));
  const ideal = dcg(candidates.map(gain).sort((a, b) => b - a));
  return ideal === 0 ? 0 : actual / ideal;
}

/** Share of the top-k that are Exact matches. */
export function exactAtK(candidates: Candidate[], order: number[], k = 5): number {
  const top = order.slice(0, k);
  return top.filter((i) => candidates[i]!.label === "Exact").length / Math.max(Math.min(k, top.length), 1);
}
