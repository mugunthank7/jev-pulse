import { DecisionSchema } from "@jev-pulse/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { MockBackend } from "./backends/mock.ts";
import { normalise } from "./backends/jev.ts";

describe("mock backend", () => {
  it("returns schema-valid, deterministic decisions", async () => {
    const b = new MockBackend();
    const item = { id: "t1", text: "Auth service crashes with security vulnerability", source: "test" };
    const a = await b.decide(item);
    const c = await b.decide(item);
    expect(DecisionSchema.safeParse(a.decision).success).toBe(true);
    expect(a.decision).toEqual(c.decision);
    expect(a.decision.urgency.value).toBeGreaterThan(40);
  });
});

describe("POST /api/score", () => {
  const app = createApp(new MockBackend());
  it("scores a batch", async () => {
    const res = await app.request("/api/score", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "a", text: "how do I fix this?", source: "t" }, { id: "b", text: "launch of new release", source: "t" }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].costUsd).toBeGreaterThan(0);
  });
  it("rejects bad input", async () => {
    const res = await app.request("/api/score", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
  });
});

describe("jev normaliser", () => {
  it("maps an answers envelope into a Decision", () => {
    const d = normalise({ answers: {
      category: { value: "bug", probabilities: { bug: 0.8, feature: 0.2 } },
      urgency: { value: 90, confidence: 0.7 }, sentiment: { value: -0.5, confidence: 0.6 },
      actionable: { probability: 0.9 }, spam: { probability: 0.02 },
    } });
    expect(d.category.label).toBe("bug");
    expect(d.category.confidence).toBeCloseTo(0.8);
    expect(d.actionable.p).toBe(0.9);
  });
});
