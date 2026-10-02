import { DecisionSchema } from "@jev-pulse/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { MockBackend } from "./backends/mock.ts";
import { normalise } from "./backends/jev.ts";
import { parseCategory } from "./compare/openrouter.ts";
import { labeledIssues } from "./sources/index.ts";

describe("labeled dataset", () => {
  it("is real, class-balanced, reproducible and fully labeled", () => {
    const a = labeledIssues(60), b = labeledIssues(60);
    expect(a).toEqual(b);
    expect(a.every((i) => i.label && i.url?.startsWith("https://github.com/"))).toBe(true);
    for (const c of ["bug", "feature", "question"]) expect(a.filter((i) => i.label === c)).toHaveLength(20);
  });
  it("can be filtered to one repo", () => {
    expect(labeledIssues(30, "pandas-dev/pandas").every((i) => i.source === "pandas-dev/pandas")).toBe(true);
  });
});

describe("mock backend (offline fallback only)", () => {
  it("returns schema-valid, deterministic decisions", async () => {
    const b = new MockBackend();
    const item = { id: "t1", text: "Crash with traceback after upgrade", source: "test" };
    const a = await b.decide(item), c = await b.decide(item);
    expect(DecisionSchema.safeParse(a.decision).success).toBe(true);
    expect(a.decision).toEqual(c.decision);
  });
});

describe("POST /api/score", () => {
  const app = createApp(new MockBackend());
  it("scores a batch and marks correctness against the label", async () => {
    const res = await app.request("/api/score", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "a", text: "how do I fix this?", source: "t", label: "question" }, { id: "b", text: "add support", source: "t" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; correct?: boolean }[] };
    expect(body.items).toHaveLength(2);
    const a = body.items.find((i) => i.id === "a")!;
    expect(typeof a.correct).toBe("boolean");
    expect(body.items.find((i) => i.id === "b")!.correct).toBeUndefined();
  });
  it("rejects bad input", async () => {
    expect((await app.request("/api/score", { method: "POST", body: "{}" })).status).toBe(400);
  });
});

describe("jev normaliser", () => {
  it("maps a real typesafe/jev-1.13 decisions response", () => {
    // Captured from a live OpenRouter /api/alpha/decisions call.
    const d = normalise({
      category: { choice: "bug", probabilities: { question: 0, feature: 0, bug: 1 }, confidence: 1 },
      urgency: { score: 3.89, confidence: 0.91 },
      sentiment: { score: 1, confidence: 0.7 },
      actionable: { noul: 0.21 },
      spam: { noul: 0.01 },
    });
    expect(d.category.label).toBe("bug");
    expect(d.category.confidence).toBe(1);
    expect(d.urgency.value).toBeCloseTo(97.25);
    expect(d.sentiment.value).toBeCloseTo(-0.5);
    expect(d.actionable.p).toBe(0.21);
  });
});

describe("llm output parsing", () => {
  it("extracts the category from JSON, tolerating prose and case", () => {
    expect(parseCategory('Sure! {"category": "Bug", "urgency": 80}')).toBe("bug");
    expect(() => parseCategory("no json here")).toThrow();
  });
});

describe("arena", () => {
  it("sends the same issue to all three lanes each round and reports per-call results", async () => {
    const { runArena } = await import("./compare/arena.ts");
    const items = [
      { id: "a", text: "crash on start", source: "t", label: "bug" as const },
      { id: "b", text: "how do I use this", source: "t", label: "question" as const },
    ];
    const lanes = [
      { id: "jev" as const, label: "Jev", model: "j" },
      { id: "gemini" as const, label: "G", model: "g" },
      { id: "claude" as const, label: "C", model: "c" },
    ];
    const events: { type: string; lane?: string; correct?: boolean; round?: number }[] = [];
    // Stub the LLM call: Gemini always says "bug", Claude fails once with a 429 then succeeds.
    let claudeCalls = 0;
    const call = async (model: string) => {
      if (model === "c" && claudeCalls++ === 0) throw new Error("c 429: rate limited");
      return { category: model === "g" ? "bug" : "question", costUsd: 0.001, inTokens: 10, outTokens: 5, latencyMs: 5 };
    };
    await runArena(new MockBackend(), items, lanes, (e) => void events.push(e), { key: "k", gapMs: 0, call });
    const results = events.filter((e) => e.type === "result");
    expect(results).toHaveLength(6); // 2 rounds x 3 lanes
    expect(events.filter((e) => e.type === "dispatch")).toHaveLength(2);
    expect(events.some((e) => e.type === "retry" && e.lane === "claude")).toBe(true);
    expect(results.filter((r) => r.lane === "gemini").map((r) => r.correct)).toEqual([true, false]);
    expect(events.at(-1)!.type).toBe("done");
  }, 30_000);
});
