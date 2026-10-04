import type { EsciLabel } from "@jev-pulse/schema";
import { getQueries } from "../rerank/data.ts";

/** The three folders every engine sorts into. Complement + Irrelevant both mean "not what the shopper wanted". */
export const SORT_CATEGORIES = ["exact", "substitute", "not_a_match"] as const;
export type SortCategory = (typeof SORT_CATEGORIES)[number];

export const SORT_DEFINITIONS: Record<SortCategory, string> = {
  exact: "The product is what the shopper asked for and satisfies every attribute in the query",
  substitute: "Not exactly what was asked for, but a shopper could use it instead",
  not_a_match: "An accessory, a different kind of item, or otherwise not what the shopper asked for",
};

export const goldCategory = (l: EsciLabel): SortCategory => (l === "Exact" ? "exact" : l === "Substitute" ? "substitute" : "not_a_match");

export type SortItem = { id: string; query: string; title: string; brand: string; label: SortCategory };

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Real (query, product) pairs with their HUMAN ESCI label, class-balanced across the three folders and
 * shuffled with a fixed seed so every run (and every recording) is reproducible.
 */
export function sortItems(limit: number, seed = 5): SortItem[] {
  const rnd = mulberry32(seed);
  const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const byClass: Record<SortCategory, SortItem[]> = { exact: [], substitute: [], not_a_match: [] };
  for (const q of getQueries()) for (const c of q.candidates) {
    const label = goldCategory(c.label);
    byClass[label].push({ id: `${q.queryId}:${c.id}`, query: q.query, title: c.title, brand: c.brand, label });
  }
  const lists = SORT_CATEGORIES.map((k) => shuffle(byClass[k]));
  const out: SortItem[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i] && out.length < limit) out.push(l[i]!);
  return shuffle(out);
}
