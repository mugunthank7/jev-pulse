import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, type Item } from "@jev-pulse/schema";
import type { RaceModel } from "./models.ts";

export const PROMPT = (text: string) =>
  `Classify this item. Respond with ONLY a JSON object, no prose:
{"category": one of ${JSON.stringify(CATEGORIES)}, "urgency": number 0-100, "sentiment": number -1..1, "actionable": boolean, "spam": boolean}

Item: ${text}`;

export type LlmResult = { category: string; inTokens: number; outTokens: number; latencyMs: number };

function parseCategory(raw: string): string {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in model output");
  const j = JSON.parse(m[0]) as { category?: string };
  return String(j.category ?? "");
}

let anthropic: Anthropic | undefined;

/** One real classification call. Latency is wall-clock for the full response. */
export async function callModel(m: RaceModel, item: Item, env = process.env): Promise<LlmResult> {
  const started = performance.now();
  if (m.provider === "anthropic") {
    anthropic ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: m.model,
      max_tokens: 1024,
      // Keep reasoning cheap: this is a simple bounded task. Haiku 4.5 does not take `effort`.
      ...(m.lowEffort ? { output_config: { effort: "low" } } : {}),
      messages: [{ role: "user", content: PROMPT(item.text) }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { category: parseCategory(text), inTokens: res.usage.input_tokens, outTokens: res.usage.output_tokens, latencyMs: performance.now() - started };
  }
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY!;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT(item.text) }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)} (set GEMINI_FAST_MODEL / GEMINI_PRO_MODEL if the model id changed)`);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const u = body.usageMetadata ?? {};
  // Thinking tokens are billed as output.
  return { category: parseCategory(text), inTokens: u.promptTokenCount ?? 0, outTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), latencyMs: performance.now() - started };
}
