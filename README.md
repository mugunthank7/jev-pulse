# Jev Pulse

**Watch thousands of typed, calibrated AI decisions light up a live radar.**

Jev Pulse streams a feed (Hacker News, any GitHub repo's issues, or a 1,000-item synthetic firehose) through [Jev](https://www.datacamp.com/blog/system-one-models-jev), TypeSafe AI's "System One" decision model, and renders every answer as a glowing particle. Position is the category, size is urgency, and glow and orbit tightness are the model's calibrated confidence. A HUD tracks decisions, throughput, latency and cost against a frontier LLM.

> Add a hero GIF here: `docs/hero.gif` (record the **Burst · 1,000 items** preset).

## Why Jev?

Jev does not write text. Given some state and typed questions (`choice`, `score`, `noul` = yes/no) it returns calibrated probabilities in one parallel pass. According to TypeSafe's published figures that is roughly 70-500 ms and about $0.0004 per decision, around 76x cheaper than a frontier LLM, with no schema errors. That makes it a fit for the high-volume "which of these 10,000 things matters?" layer in front of an LLM. Jev Pulse makes that scale visible, and flags low-confidence items to **escalate to an LLM**.

Those numbers are the vendor's own and were not independently reproduced here.

## Quick start (no API key needed)

```bash
npm install
npm run dev        # API on :8787, web on :5173
```

Open http://localhost:5173 and click **Burst · 1,000 items**. By default the `mock` backend is used: a deterministic stand-in with Jev-like latency, so the demo and CI run anywhere. **It is not Jev**; its probabilities are heuristics.

### Use real Jev

```bash
cp .env.example .env
# JEV_BACKEND=jev
# TYPESAFE_API_KEY=...   (Jev is in early access)
```

`apps/api/src/backends/jev.ts` posts `{ model: "jev-latest", state, questions }` to `https://api.typesafe.ai/v1/systemone`. The response mapping (`normalise`) is written defensively because it has not yet been verified against a live key. If your response shape differs, that function and its test are the only places to change. Any Jev-compatible endpoint (for example a self-hosted open Kev) works with `JEV_BACKEND=kev` and `KEV_URL`.

## Use it from your agent (MCP)

The repo ships an MCP server so Claude Code, Cursor or Codex can triage feeds with Jev:

```bash
claude mcp add jev-pulse -- npx tsx packages/mcp/src/index.ts
```

Tools: `triage_feed` (rank a HN or GitHub feed by urgency x actionability) and `score_items` (score any text). Start `npm run dev -w @jev-pulse/api` first, or set `JEV_PULSE_URL`.

## Architecture

```
HN / GitHub / synthetic ──> apps/api (Hono) ──> DecisionBackend ──> mock | jev | kev
                               │  SSE /api/stream   POST /api/score   GET /api/triage
                               ▼
                       apps/web (React 19 + Canvas)   packages/mcp (stdio MCP)
                               ▲
                       packages/schema (Zod: Decision, ScoredItem)
```

Stack: TypeScript, React 19, Vite, Tailwind CSS v4, Hono, Zod, Vitest, Model Context Protocol SDK, GitHub Actions.

## Scripts

`npm run dev` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build`

## Roadmap

- WebGPU renderer (instanced, compute-driven) with the current Canvas2D path as fallback
- Cloudflare Workers deploy for the API
- Paste / CSV upload mode

## License

MIT
