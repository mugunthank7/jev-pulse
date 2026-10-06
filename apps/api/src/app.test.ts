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

describe("rerank", () => {
  it("bm25 + ndcg: a perfect ordering scores 1, a reversed one scores lower", async () => {
    const { ndcg } = await import("./rerank/metrics.ts");
    const cs = [
      { id: "a", title: "a", brand: "", bullets: "", label: "Irrelevant" as const },
      { id: "b", title: "b", brand: "", bullets: "", label: "Exact" as const },
      { id: "c", title: "c", brand: "", bullets: "", label: "Substitute" as const },
    ];
    expect(ndcg(cs, [1, 2, 0])).toBeCloseTo(1);
    expect(ndcg(cs, [0, 2, 1])).toBeLessThan(1);
  });

  it("expected utility ranks exact > substitute > irrelevant", async () => {
    const { expectedUtility } = await import("./rerank/jev.ts");
    const u = (p: Record<string, number>) => expectedUtility(p).utility;
    expect(u({ exact: 0.9, substitute: 0.1 })).toBeGreaterThan(u({ exact: 0.1, substitute: 0.8, irrelevant: 0.1 }));
    expect(u({ substitute: 0.5, irrelevant: 0.5 })).toBeGreaterThan(u({ irrelevant: 1 }));
  });

  it("parses LLM rankings, tolerating prose, duplicates and omissions", async () => {
    const { parseRanking } = await import("./rerank/llm.ts");
    expect(parseRanking('Here: {"ranking":[3,1,1,9,2]}', 3)).toEqual([2, 0, 1]);
    expect(parseRanking('{"ranking":[2]}', 3)).toEqual([1]);
    expect(() => parseRanking("nope", 3)).toThrow();
  });

  it("runs three lanes on the same candidates and reports metrics per lane", async () => {
    const { runRerank } = await import("./rerank/run.ts");
    const sq = {
      queryId: 1, query: "red mug",
      candidates: [
        { id: "1", title: "blue plate", brand: "", bullets: "", label: "Irrelevant" as const },
        { id: "2", title: "red mug large", brand: "", bullets: "", label: "Exact" as const },
        { id: "3", title: "red cup", brand: "", bullets: "", label: "Substitute" as const },
      ],
    };
    const events: { type: string; lane?: string; ndcg10?: number }[] = [];
    await runRerank(sq, [{ id: "jev", label: "J", model: "j" }, { id: "gemini", label: "G", model: "g" }, { id: "claude", label: "C", model: "c" }], (e) => void events.push(e), {
      key: "k",
      deps: {
        jevScoreAll: async (_q, cs, _k, onProgress) => cs.map((c, i) => { onProgress(i + 1, cs.length); return { utility: c.label === "Exact" ? 1 : c.label === "Substitute" ? 0.1 : 0, probs: { Exact: 0, Substitute: 0, Complement: 0, Irrelevant: 1 }, costUsd: 0.00001, latencyMs: 5 }; }),
        llmRerank: async (model, _q, cs) => { if (model === "c") throw new Error("c 400: boom"); return { order: cs.map((_, i) => i), costUsd: 0.002, latencyMs: 9, inTokens: 1, outTokens: 1, missing: 0 }; },
      },
    });
    const lane = (id: string) => events.find((e) => e.type === "lane" && e.lane === id);
    expect(lane("jev")!.ndcg10).toBeCloseTo(1);
    expect(lane("gemini")).toBeDefined();
    expect(events.find((e) => e.type === "lane_error" && e.lane === "claude")).toBeDefined();
    expect(events.at(-1)!.type).toBe("done");
  });
});

describe("mind-map sort", () => {
  it("builds class-balanced real pairs with human labels, reproducibly", async () => {
    const { sortItems } = await import("./sort/items.ts");
    const a = sortItems(30), b = sortItems(30);
    expect(a).toEqual(b);
    for (const k of ["exact", "substitute", "not_a_match"]) expect(a.filter((i) => i.label === k)).toHaveLength(10);
    expect(a.every((i) => i.query && i.title)).toBe(true);
  });

  it("parses LLM category output, tolerating prose and spacing", async () => {
    const { parseCategory } = await import("./sort/judges.ts");
    expect(parseCategory('Sure {"category": "Not a match"}')).toBe("not_a_match");
    expect(parseCategory('{"category":"EXACT"}')).toBe("exact");
    expect(() => parseCategory('{"category":"weird"}')).toThrow();
  });

  it("lets each engine take its next item as soon as it finishes (independent lanes)", async () => {
    const { runSort } = await import("./sort/run.ts");
    const items = [1, 2, 3, 4].map((n) => ({ id: String(n), query: "q", title: `t${n}`, brand: "", label: "exact" as const }));
    const lanes = [{ id: "jev" as const, label: "J", model: "j" }, { id: "claude" as const, label: "C", model: "c" }];
    const events: { type: string; lane?: string; round?: number; t?: number; correct?: boolean }[] = [];
    // Jev answers in ~5 ms, Claude in ~60 ms.
    await runSort(items, lanes, async (lane) => { await new Promise((r) => setTimeout(r, lane.id === "jev" ? 5 : 60)); return { predicted: "exact", latencyMs: lane.id === "jev" ? 5 : 60, costUsd: 0.001 }; }, (e) => void events.push(e));
    const dispatches = (l: string) => events.filter((e) => e.type === "dispatch" && e.lane === l);
    expect(dispatches("jev")).toHaveLength(4);
    expect(dispatches("claude")).toHaveLength(4);
    // Jev has pulled its LAST item before Claude has finished its FIRST result.
    const jevLastDispatch = dispatches("jev").at(-1)!.t!;
    const claudeFirstResult = events.find((e) => e.type === "result" && e.lane === "claude")!.t!;
    expect(jevLastDispatch).toBeLessThan(claudeFirstResult);
    expect(events.filter((e) => e.type === "result" && e.correct)).toHaveLength(8);
    expect(events.at(-1)!.type).toBe("done");
  }, 30_000);

  it("retries a transient 429 on one lane without blocking the others", async () => {
    const { runSort } = await import("./sort/run.ts");
    const items = [{ id: "1", query: "q", title: "t", brand: "", label: "exact" as const }];
    const lanes = [{ id: "jev" as const, label: "J", model: "j" }, { id: "claude" as const, label: "C", model: "c" }];
    const events: { type: string; lane?: string }[] = [];
    let calls = 0;
    await runSort(items, lanes, async (lane) => { if (lane.id === "claude" && calls++ === 0) throw new Error("c 429: slow down"); return { predicted: "exact", latencyMs: 1, costUsd: 0 }; }, (e) => void events.push(e));
    expect(events.some((e) => e.type === "retry" && e.lane === "claude")).toBe(true);
    expect(events.filter((e) => e.type === "result")).toHaveLength(2);
  }, 30_000);
});
