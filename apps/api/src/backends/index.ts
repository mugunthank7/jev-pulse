import { JevBackend } from "./jev.ts";
import { MockBackend } from "./mock.ts";
import type { DecisionBackend } from "./types.ts";

export function createBackend(env: Record<string, string | undefined> = process.env): DecisionBackend {
  switch (env.JEV_BACKEND ?? "mock") {
    case "jev":
      if (!env.TYPESAFE_API_KEY) throw new Error("JEV_BACKEND=jev requires TYPESAFE_API_KEY");
      return new JevBackend("jev", "https://api.typesafe.ai/v1/systemone", env.TYPESAFE_API_KEY);
    case "kev":
      if (!env.KEV_URL) throw new Error("JEV_BACKEND=kev requires KEV_URL");
      return new JevBackend("kev", env.KEV_URL);
    default:
      return new MockBackend();
  }
}
export type { DecisionBackend };
