# Jev Pulse: can a decision model replace an LLM?

**Real search results, sorted live by Jev, Gemini and Claude, scored against human labels, with latency and cost projected to production scale.**

Each "envelope" carries one real shopper query plus one real Amazon product (Amazon Shopping Queries / ESCI, human-labeled). A source node sends a copy of it to three engines at the same instant: **Jev**, **Gemini 3.8 Flash** and **Claude Sonnet 5.5**. Each engine sorts it into a mind-map branch (**exact / substitute / no match**); every landing is checked against the human label (green ring = right, red = wrong). The right-hand panel shows accuracy, latency and cost per engine, and a volume slider that **projects** monthly cost and processing time from the measured per-item numbers.

> **Demo clip:** coming soon. To see it now, clone the repo and run it (below). The page has a **Record GIF / video** button that exports a clip of the run.

## Run it

```bash
npm install
cp .env.example .env     # add OPENROUTER_API_KEY (an account with credits)
npm run dev              # API :8787, web :5173
```

Open http://localhost:5173 (the **Mind map** tab).

- **Live** mode makes real API calls to all three engines (a 12-item run costs a few cents with the defaults).
- **Replay** mode plays back a recorded real run with each engine's *recorded* latency, so anyone can watch real measurements without spending credits. Create the recording once with `npm run record`. It refuses to save a tape if any engine failed a call.

## Make the GIF

Open http://localhost:5173/?record=1: no chrome, autoplays the replay in a loop. Capture one pass with any screen recorder (macOS: Shift+Cmd+5, or Kap / CleanShot) and export a GIF.

## How the projections work (and their limits)

The panel does not call the API at 1M items. It takes the measured mean latency and mean billed cost per item from the calls above and scales them linearly: monthly cost = per-item cost x volume; queue time = volume x per-item latency / 50 parallel requests. Always read it as a projection from a few measured calls: it ignores caching, batching, rate limits and volume discounts, and a small sample has wide error bars.

## Why reranking

Rerankers score each candidate against the query. That is a bounded decision (exact / substitute / complement / irrelevant), not text generation, so Jev's design fits: typed answers with calibrated probabilities, no prose. Everything is scored in parallel, so latency is that of one call. LLM rerankers are accurate but usually too slow and costly for live traffic.

Where Jev is **not** the right tool: it writes no explanations, is weaker on non-English text and counting, and in independent tests it was level with mid-price LLMs and behind frontier ones. A model trained on your own labels beat it wherever one was tried. Don't use it for security decisions (one independent phishing test had it at 63% vs 81% for Claude Haiku 4.5).

## The data (real, human-judged)

`data/esci-search.json`: **40 queries, 653 products** from the Amazon Shopping Queries Dataset (ESCI), US locale. Every product carries a human label: Exact, Substitute, Complement or Irrelevant. Candidates are represented by title + brand. nDCG@10 uses the ESCI gains (exact 1, substitute 0.1, complement 0.01, irrelevant 0).

Caveats: Irrelevant products are rare (51 of 653) and Substitutes common, which makes ranking harder and baselines high. The baseline is plain BM25 over each query's own candidate pool, not a production hybrid search, so lifts here are not comparable to published ones against stronger baselines.

Rebuild or resize: `pip install pyarrow fsspec aiohttp && TARGET_QUERIES=80 npm run dataset:search`.

## What I measured

Real `typesafe/jev-1.13` calls through OpenRouter, one decision per query/product pair, all 40 queries:

| Metric | Keyword baseline (BM25) | Jev |
|---|---|---|
| nDCG@10 | 0.660 | **0.772** (+0.112, standard error ~0.037) |
| Exact matches in top 5 | 0.525 | 0.590 |
| Per-query result | | better on 27, worse on 13 |
| Latency per search | | 305 ms mean, 277 ms median |
| Cost per search | | $0.00032 (about $0.32 per 1,000 searches) |

**Not measured yet: Claude and Gemini.** They run as one listwise ranking call per search (how LLM reranking is normally deployed) through the same OpenRouter key, but my test account has no credits, so those lanes return a credit error. Add ~$5 at openrouter.ai/settings/credits and the Search rerank tab fills them in. Until then no LLM comparison is claimed. 40 queries is a small sample: re-run with more before quoting numbers.

## Search rerank tab

The second tab reranks each query's whole candidate list with Jev (one decision per product, in parallel) against a keyword baseline, Gemini and Claude (one listwise call each). Press **Rerank this search** or **Run 10 searches**.

## Use it from your agent (MCP)

```bash
claude mcp add jev-pulse -- npx tsx packages/mcp/src/index.ts
```

The `rerank` tool takes a query and up to 100 documents and returns them ordered by Jev's expected relevance, with probabilities. Use it to cut retrieved candidates before spending an LLM on the survivors. Run `npm run dev -w @jev-pulse/api` first, or set `JEV_PULSE_URL`.

## Also in this repo

The first version classified real GitHub issues (bug / feature / question) against maintainer labels: the **Issue arena** and **Issue radar** tabs, with Jev at 78% on 120 issues. Classification is the use case where Jev is weakest relative to LLMs, which is why the project moved to reranking.

## Architecture

```
data/esci-search.json ──> apps/api (Hono) ──SSE /api/rerank──> apps/web (React 19 + Motion)
                              │  Jev: POST openrouter.ai/api/alpha/decisions (typesafe/jev-1.13), one call per pair
                              │  Gemini / Claude: one listwise chat completion each
                              └── POST /api/rank ──> packages/mcp (stdio MCP: rerank, triage_feed, score_items)
packages/schema: shared Zod types
```

Stack: TypeScript, React 19, Vite, Tailwind CSS v4, Motion, Hono, Zod, Vitest, Model Context Protocol SDK, GitHub Actions.

## Scripts

`npm run dev` · `npm run record` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run dataset:search`

## Author

[LinkedIn](https://www.linkedin.com/in/mugunthankesavan/) · [GitHub](https://github.com/mugunthank7)

## License

MIT (code). Product data in `data/` comes from the Amazon Shopping Queries Dataset (Apache-2.0).
