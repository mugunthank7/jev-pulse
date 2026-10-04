import { SORT_CATEGORIES, SORT_DEFINITIONS, type SortCategory, type SortItem } from "./items.ts";

export type Judgment = { predicted: SortCategory; latencyMs: number; costUsd: number };
const isCategory = (s: string): s is SortCategory => (SORT_CATEGORIES as readonly string[]).includes(s);

/** Jev: one typed `choice` decision per (query, product) pair. */
export async function jevJudge(item: SortItem, apiKey: string, url = "https://openrouter.ai/api/alpha/decisions"): Promise<Judgment> {
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "typesafe/jev-1.13",
      state: { search_query: item.query, product: { title: item.title, brand: item.brand || undefined } },
      questions: { match: { type: "choice", instructions: "How does this product relate to the shopper's search query?", criteria: SORT_DEFINITIONS } },
    }),
  });
  if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { answers: { match: { choice?: string; probabilities?: Record<string, number> } }; usage?: { cost?: number } };
  const m = body.answers.match;
  const choice = m.choice ?? Object.entries(m.probabilities ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  if (!isCategory(choice)) throw new Error(`jev returned unknown category "${choice}"`);
  return { predicted: choice, latencyMs: performance.now() - started, costUsd: body.usage?.cost ?? 0 };
}

/** The identical task for an LLM: same query, same product, same three definitions. */
export const llmPrompt = (item: SortItem) =>
  `You are the relevance judge of a shopping search engine. Decide how the product relates to the shopper's query.

Query: ${item.query}
Product: ${item.title}${item.brand ? ` (brand: ${item.brand})` : ""}

Categories:
${SORT_CATEGORIES.map((c) => `- ${c}: ${SORT_DEFINITIONS[c]}`).join("\n")}

Respond with ONLY a JSON object: {"category": "exact" | "substitute" | "not_a_match"}`;

export function parseCategory(raw: string): SortCategory {
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) throw new Error("no JSON in model output");
  const c = String((JSON.parse(m[0]) as { category?: string }).category ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!isCategory(c)) throw new Error(`unknown category "${c}"`);
  return c;
}

export async function llmJudge(model: string, item: SortItem, apiKey: string): Promise<Judgment> {
  const started = performance.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 300, usage: { include: true }, reasoning: { effort: "low" }, messages: [{ role: "user", content: llmPrompt(item) }] }),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number }; error?: { message?: string } };
  if (body.error) throw new Error(`${model}: ${body.error.message}`);
  const latencyMs = performance.now() - started;
  return { predicted: parseCategory(body.choices?.[0]?.message?.content ?? ""), latencyMs, costUsd: body.usage?.cost ?? 0 };
}
