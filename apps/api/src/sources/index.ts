import type { Item } from "@jev-pulse/schema";

const UA = { "user-agent": "jev-pulse (portfolio demo)" };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...UA, ...init?.headers } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Hacker News: top stories, no API key needed. */
export async function hackerNews(limit: number): Promise<Item[]> {
  const ids = await json<number[]>("https://hacker-news.firebaseio.com/v0/topstories.json");
  const stories = await Promise.all(
    ids.slice(0, limit).map((id) => json<{ id: number; title?: string; url?: string; text?: string }>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)),
  );
  return stories
    .filter((s): s is NonNullable<typeof s> => !!s?.title)
    .map((s) => ({
      id: `hn-${s.id}`,
      text: (s.title + (s.text ? `. ${s.text.replace(/<[^>]+>/g, " ")}` : "")).slice(0, 1500),
      url: s.url ?? `https://news.ycombinator.com/item?id=${s.id}`,
      source: "Hacker News",
    }));
}

/** GitHub issues + PRs for any public repo ("owner/name"). Unauthenticated: 60 req/h. */
export async function githubIssues(repo: string, limit: number): Promise<Item[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repo must look like owner/name");
  const headers: Record<string, string> = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const out: Item[] = [];
  for (let page = 1; out.length < limit && page <= 10; page++) {
    const rows = await json<{ number: number; title: string; body?: string | null; html_url: string }[]>(
      `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`,
      { headers },
    );
    if (!rows.length) break;
    for (const r of rows) out.push({ id: `gh-${repo}-${r.number}`, text: `${r.title}. ${(r.body ?? "").slice(0, 800)}`, url: r.html_url, source: repo });
  }
  return out.slice(0, limit);
}

/** Synthetic firehose for burst mode / offline demos. */
export function synthetic(limit: number): Item[] {
  const subjects = ["Auth service", "Payment API", "Search index", "Mobile app", "CI pipeline", "Billing page", "Docs site", "Export job", "Webhook handler", "Admin panel"];
  const events = [
    "crashes with null pointer on startup", "request: add dark mode support", "how do I configure rate limits?",
    "possible security vulnerability in token refresh", "thanks, the new release is much faster", "outage: users cannot log in, urgent",
    "discussion: should we migrate to a monorepo?", "announces new open source release", "regression after upgrading dependencies",
    "buy now free money click here", "error: timeout when exporting large files", "proposal: support streaming responses",
  ];
  return Array.from({ length: limit }, (_, i) => ({
    id: `syn-${i}`,
    text: `${subjects[i % subjects.length]} ${events[(i * 7 + (i >> 3)) % events.length]}`,
    source: "Synthetic firehose",
  }));
}
