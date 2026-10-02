# Jev Pulse

**Real GitHub issues, classified live by [Jev](https://openrouter.ai/docs/guides/community/jev) and raced against Claude and Gemini, scored against what maintainers actually labeled them.**

Jev is TypeSafe AI's "System One" decision model: it doesn't write text, it answers typed questions (`choice`, `score`, yes/no) with calibrated probabilities in one pass. Jev Pulse streams a labeled dataset through it and draws every decision on a live radar: items enter from the feed, pass the Jev core, and land in their cluster. A red ring means Jev disagreed with the maintainer's label.

> Add a hero GIF here: `docs/hero.gif` (record the Radar run, then the Model race).

## The data (not synthetic)

`data/github-issues.json` holds **318 real issues** from `pandas-dev/pandas`, `numpy/numpy`, `scikit-learn/scikit-learn` and `microsoft/vscode`. Ground truth is the label a maintainer applied: `bug`, `feature` (enhancement / feature-request) or `question`. Only issues carrying exactly one of the three classes are kept; PRs are dropped. Rebuild with `npm run dataset` (set `GITHUB_TOKEN` for higher rate limits).

Maintainer labels are noisy (for example, a `BUG:` titled issue filed as a question), so no model reaches 100%. Read accuracy as relative.

## What I measured

Real `typesafe/jev-1.13` calls through OpenRouter on this dataset (cost is the billed amount OpenRouter returns):

| Run | Accuracy vs labels | Avg latency / issue | Billed cost |
|---|---|---|---|
| 120 issues, 5 typed questions each | 78% (94/120) | ~380 ms | $0.0037 (about $0.031 per 1,000 issues) |

Claude and Gemini comparisons run in the **Model race** tab (same issues, same five questions, same label definitions). My early runs were on a credit-less account where several rows were incomplete and samples were small, so I'm not publishing Claude or Gemini numbers yet. Run the race on a funded account with 100+ issues before quoting numbers.

## Quick start

```bash
npm install
cp .env.example .env     # add OPENROUTER_API_KEY
npm run dev              # API :8787, web :5173
```

Open http://localhost:5173. Without a key the API falls back to an **offline mock** (keyword heuristics, clearly labeled in the UI) so the app and tests still run. It is not Jev.

One OpenRouter key powers everything: Jev uses `POST /api/alpha/decisions` (model `typesafe/jev-1.13`), Claude and Gemini use chat completions. New OpenRouter accounts are limited to ~20 requests/min per model and cap in-flight spend by credit balance, so the race paces each model one call at a time and retries transient 429/402s. Rows that still end up with failed calls are shown as **incomplete** and excluded from the headline comparison. Adding ~$5 of credit avoids this.

## Use it from your agent (MCP)

```bash
claude mcp add jev-pulse -- npx tsx packages/mcp/src/index.ts
```

Tools: `triage_feed` (rank a repo's open issues, or the dataset, by urgency x actionability) and `score_items`. Run `npm run dev -w @jev-pulse/api` first, or set `JEV_PULSE_URL`.

## Architecture

```
data/github-issues.json ─┐
live GitHub repo scan ───┴─> apps/api (Hono) ──> DecisionBackend ──> jev (OpenRouter decisions) | mock
                                │  SSE /api/stream   SSE /api/compare   POST /api/score   GET /api/triage
                                ▼
                        apps/web (React 19 + Canvas)      packages/mcp (stdio MCP)
                                ▲
                        packages/schema (Zod: Decision, ScoredItem)
```

Stack: TypeScript, React 19, Vite, Tailwind CSS v4, Hono, Zod, Vitest, Model Context Protocol SDK, GitHub Actions.

## Scripts

`npm run dev` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run dataset`

## Roadmap

- WebGPU renderer with the current Canvas2D path as fallback
- Cloudflare Workers deploy for the API
- Larger, multi-run race with confidence intervals

## Author

[LinkedIn](https://www.linkedin.com/in/mugunthankesavan/) · [GitHub](https://github.com/mugunthank7)

## License

MIT (code). Issue text in `data/` is public GitHub content from the repositories above.
