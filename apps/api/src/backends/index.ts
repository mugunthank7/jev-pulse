import { JevBackend } from "./jev.ts";
import { MockBackend } from "./mock.ts";
import type { DecisionBackend } from "./types.ts";

/** JEV_BACKEND=jev|mock. Default: real Jev when OPENROUTER_API_KEY is set, otherwise the offline mock. */
export function createBackend(env: Record<string, string | undefined> = process.env): DecisionBackend {
  const want = env.JEV_BACKEND ?? (env.OPENROUTER_API_KEY ? "jev" : "mock");
  if (want === "jev") {
    if (!env.OPENROUTER_API_KEY) throw new Error("JEV_BACKEND=jev requires OPENROUTER_API_KEY");
    return new JevBackend(env.OPENROUTER_API_KEY);
  }
  return new MockBackend();
}
export type { DecisionBackend };
