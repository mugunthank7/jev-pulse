/**
 * Arena lanes: Jev vs one Gemini model vs one Claude model, all through ONE OpenRouter key.
 * Cost is the real billed cost OpenRouter returns per call (usage.cost). IDs verified against
 * openrouter.ai/api/v1/models. Pricier models need account credits; the cheap defaults work without much.
 */
export type LaneId = "jev" | "gemini" | "claude";
export type ModelOption = { model: string; label: string };

export const LANE_OPTIONS: Record<Exclude<LaneId, "jev">, { default: string; options: ModelOption[] }> = {
  gemini: {
    default: "google/gemini-3.8-flash",
    options: [
      { model: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { model: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    ],
  },
  claude: {
    default: "anthropic/claude-haiku-4.5",
    options: [
      { model: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
      { model: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
      { model: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
    ],
  },
};

export function resolveModel(lane: Exclude<LaneId, "jev">, requested?: string): ModelOption | undefined {
  const spec = LANE_OPTIONS[lane];
  return spec.options.find((o) => o.model === (requested || spec.default));
}
