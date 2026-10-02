import type { Decision, Item } from "@jev-pulse/schema";

export interface DecisionBackend {
  readonly name: string;
  /** costUsd is set when the provider reports the real billed cost; otherwise callers estimate it. */
  decide(item: Item): Promise<{ decision: Decision; latencyMs: number; costUsd?: number }>;
}
