import { readFileSync } from "node:fs";
import type { Category, Item } from "@jev-pulse/schema";

const UA = { "user-agent": "jev-pulse (portfolio demo)" };

type DatasetRow = { id: string; repo: string; url: string; title: string; body: string; label: Category };
let cache: DatasetRow[] | undefined;

function load(): DatasetRow[] {
  cache ??= (JSON.parse(readFileSync(new URL("../../../../data/github-issues.json", import.meta.url), "utf8")) as { items: DatasetRow[] }).items;
  return cache;
}

/** Small deterministic PRNG so the same seed gives the same sample (reproducible demos and races). */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const datasetRepos = () => [...new Set(load().map((r) => r.repo))];

/**
 * Real, maintainer-labeled GitHub issues. Class-balanced and shuffled (seeded) so labels interleave.
 * repo = "all" or an owner/name present in the dataset.
 */
export function labeledIssues(limit: number, repo = "all", seed = 7): Item[] {
  const rnd = mulberry32(seed);
  const pool = load().filter((r) => repo === "all" || r.repo === repo);
  const byClass = new Map<Category, DatasetRow[]>();
  for (const r of pool) byClass.set(r.label, [...(byClass.get(r.label) ?? []), r]);
  const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const lists = [...byClass.values()].map(shuffle);
  const out: DatasetRow[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i] && out.length < limit) out.push(l[i]!);
  return shuffle(out).map((r) => ({ id: r.id, text: `${r.title}\n\n${r.body}`.slice(0, 1500), url: r.url, source: r.repo, label: r.label }));
}

/** Live (unlabeled) open issues for any public repo ("owner/name"). Unauthenticated: 60 req/h. */
export async function githubIssues(repo: string, limit: number): Promise<Item[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repo must look like owner/name");
  const headers: Record<string, string> = { ...UA, ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const out: Item[] = [];
  for (let page = 1; out.length < limit && page <= 10; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${repo}`);
    const rows = (await res.json()) as { number: number; title: string; body?: string | null; html_url: string; pull_request?: unknown }[];
    if (!rows.length) break;
    for (const r of rows) if (!r.pull_request) out.push({ id: `gh-${repo}-${r.number}`, text: `${r.title}\n\n${(r.body ?? "").slice(0, 800)}`, url: r.html_url, source: repo });
  }
  return out.slice(0, limit);
}

export type SourceName = "dataset" | "github";
export async function loadSource(q: (k: string) => string | undefined, defaultLimit: number, max: number): Promise<Item[]> {
  const limit = Math.min(Number(q("limit") ?? defaultLimit) || defaultLimit, max);
  return q("source") === "github" ? githubIssues(q("repo") ?? "", limit) : labeledIssues(limit, q("repo") ?? "all");
}
