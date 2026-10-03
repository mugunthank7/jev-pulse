import type { Candidate } from "@jev-pulse/schema";

/** How LLM reranking is actually deployed: ONE listwise call that returns the full ordering. */
export const rankPrompt = (query: string, cs: Candidate[]) =>
  `You are the ranking stage of a shopping search engine. Rank ALL products below from most to least relevant to the shopper's query.
Rank exact matches first (right item, every attribute satisfied), then substitutes (usable instead), then complements (accessories), then irrelevant items last.

Query: ${query}

Products:
${cs.map((c, i) => `[${i + 1}] ${c.title}${c.brand ? ` | ${c.brand}` : ""}${c.bullets ? ` | ${c.bullets.slice(0, 120)}` : ""}`).join("\n")}

Respond with ONLY a JSON object listing every product number, best first: {"ranking":[...]}`;

/** Parses the ranking, tolerating prose, dupes and omissions. Returns 0-based indexes covering all candidates. */
export function parseRanking(raw: string, n: number): number[] {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in model output");
  const list = (JSON.parse(m[0]) as { ranking?: unknown }).ranking;
  if (!Array.isArray(list)) throw new Error("no ranking array");
  const seen = new Set<number>(), order: number[] = [];
  for (const v of list) { const i = Number(v) - 1; if (Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)) { seen.add(i); order.push(i); } }
  return order;
}

export type LlmRank = { order: number[]; costUsd: number; latencyMs: number; inTokens: number; outTokens: number; missing: number };

export async function llmRerank(model: string, query: string, cs: Candidate[], apiKey: string): Promise<LlmRank> {
  const started = performance.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, max_tokens: 500, usage: { include: true }, reasoning: { effort: "low" },
      messages: [{ role: "user", content: rankPrompt(query, cs) }],
    }),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
  if (body.error) throw new Error(`${model}: ${body.error.message}`);
  const latencyMs = performance.now() - started;
  const ranked = parseRanking(body.choices?.[0]?.message?.content ?? "", cs.length);
  // Anything the model forgot goes last, in the original order (it is NOT silently rescued by a better signal).
  const missing = cs.length - ranked.length;
  const rest = cs.map((_, i) => i).filter((i) => !ranked.includes(i));
  return { order: [...ranked, ...rest], costUsd: body.usage?.cost ?? 0, latencyMs, inTokens: body.usage?.prompt_tokens ?? 0, outTokens: body.usage?.completion_tokens ?? 0, missing };
}
