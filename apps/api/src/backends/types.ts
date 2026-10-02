import type { Decision, Item } from "@jev-pulse/schema";

export interface DecisionBackend {
  readonly name: string;
  decide(item: Item): Promise<{ decision: Decision; latencyMs: number }>;
}
