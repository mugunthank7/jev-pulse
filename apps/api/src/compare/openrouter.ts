import { CATEGORIES, type Item } from "@jev-pulse/schema";
import { CLASS_DEFINITIONS } from "../backends/jev.ts";

/** Same task Jev gets: the same class definitions and the same five questions. */
export const PROMPT = (text: string) =>
  `You triage GitHub issues. Answer five questions about the issue below.
Respond with ONLY a JSON object, no prose:
{"category": one of ${JSON.stringify(CATEGORIES)}, "urgency": number 0-100, "sentiment": number -1..1, "actionable": boolean, "spam": boolean}

category definitions:
${CATEGORIES.map((c) => `- ${c}: ${CLASS_DEFINITIONS[c]}`).join("\n")}

Issue:
${text}`;

export type LlmResult = { category: string; costUsd: number; inTokens: number; outTokens: number; latencyMs: number };

export function parseCategory(raw: string): string {
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) throw new Error("no JSON in model output");
  return String((JSON.parse(m[0]) as { category?: string }).category ?? "").toLowerCase().trim();
}

/** One real classification call through OpenRouter chat/completions. Latency = full wall-clock. */
export async function callModel(model: string, item: Item, apiKey: string): Promise<LlmResult> {
  const started = performance.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 400, // the JSON answer needs ~60; a small cap also keeps OpenRouter's in-flight budget reservation low
      usage: { include: true },
      reasoning: { effort: "low" }, // simple bounded task: keep thinking cheap and the comparison fair
      messages: [{ role: "user", content: PROMPT(item.text) }],
    }),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  };
  if (body.error) throw new Error(`${model}: ${body.error.message}`);
  const text = body.choices?.[0]?.message?.content ?? "";
  return { category: parseCategory(text), costUsd: body.usage?.cost ?? 0, inTokens: body.usage?.prompt_tokens ?? 0, outTokens: body.usage?.completion_tokens ?? 0, latencyMs: performance.now() - started };
}
