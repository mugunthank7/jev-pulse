/**
 * Models that race Jev on the same task.
 * Prices are USD per 1M tokens. Claude prices come from Anthropic's published
 * table; Gemini prices and model IDs move quickly, so verify them against
 * ai.google.dev/pricing and override the IDs with GEMINI_FAST_MODEL / GEMINI_PRO_MODEL.
 */
export type Provider = "anthropic" | "google";

export type RaceModel = {
  id: string;
  label: string;
  provider: Provider;
  model: string;
  inPerM: number;
  outPerM: number;
  /** Typical end-to-end latency (ms) for a short classification, used only in "modeled" mode. */
  modeledLatencyMs: number;
  /** Rough output tokens for the JSON answer incl. any reasoning overhead, used only in "modeled" mode. */
  modeledOutTokens: number;
  /** Anthropic models that accept (and benefit from) low effort for a simple task. */
  lowEffort?: boolean;
};

export function raceModels(env: Record<string, string | undefined> = process.env): RaceModel[] {
  return [
    { id: "haiku", label: "Claude Haiku 4.5", provider: "anthropic", model: "claude-haiku-4-5", inPerM: 1, outPerM: 5, modeledLatencyMs: 1100, modeledOutTokens: 90 },
    { id: "sonnet", label: "Claude Sonnet 5.5", provider: "anthropic", model: "claude-sonnet-5-5", inPerM: 2, outPerM: 10, modeledLatencyMs: 2200, modeledOutTokens: 220, lowEffort: true },
    { id: "opus", label: "Claude Opus 5.5", provider: "anthropic", model: "claude-opus-5-5", inPerM: 4, outPerM: 20, modeledLatencyMs: 3200, modeledOutTokens: 260, lowEffort: true },
    { id: "gemini-fast", label: "Gemini Flash", provider: "google", model: env.GEMINI_FAST_MODEL || "gemini-3.5-flash", inPerM: 1.5, outPerM: 9, modeledLatencyMs: 1500, modeledOutTokens: 250 },
    { id: "gemini-pro", label: "Gemini Pro", provider: "google", model: env.GEMINI_PRO_MODEL || "gemini-3.1-pro", inPerM: 2, outPerM: 12, modeledLatencyMs: 4200, modeledOutTokens: 420 },
  ];
}

export const hasKey = (m: RaceModel, env: Record<string, string | undefined> = process.env) =>
  m.provider === "anthropic" ? !!env.ANTHROPIC_API_KEY : !!(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY);

export const priceOf = (m: RaceModel, inTok: number, outTok: number) => (inTok * m.inPerM + outTok * m.outPerM) / 1_000_000;
