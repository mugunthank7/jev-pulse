/**
 * Models that race Jev, all called through ONE OpenRouter key.
 * Cost is the real billed cost OpenRouter returns per call (usage.cost), not an estimate.
 * IDs verified against openrouter.ai/api/v1/models; override with RACE_MODELS (comma list of "id=Label").
 */
export type RaceModel = { id: string; label: string; model: string; family: "claude" | "gemini" | "other" };

const DEFAULTS: RaceModel[] = [
  { id: "haiku", label: "Claude Haiku 4.5", model: "anthropic/claude-haiku-4.5", family: "claude" },
  { id: "sonnet", label: "Claude Sonnet 5.5", model: "anthropic/claude-sonnet-5.5", family: "claude" },
  { id: "opus", label: "Claude Opus 5.5", model: "anthropic/claude-opus-5.5", family: "claude" },
  { id: "gemini-flash", label: "Gemini 3.8 Flash", model: "google/gemini-3.8-flash", family: "gemini" },
  { id: "gemini-pro", label: "Gemini 3.1 Pro", model: "google/gemini-3.1-pro-preview", family: "gemini" },
];

export function raceModels(env: Record<string, string | undefined> = process.env): RaceModel[] {
  if (!env.RACE_MODELS) return DEFAULTS;
  return env.RACE_MODELS.split(",").map((s, i) => {
    const [model, label] = s.split("=");
    return { id: `m${i}`, label: label ?? model!, model: model!, family: model!.startsWith("anthropic/") ? "claude" : model!.startsWith("google/") ? "gemini" : "other" } as RaceModel;
  });
}
