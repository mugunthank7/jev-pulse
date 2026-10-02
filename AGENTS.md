# AGENTS.md

Jev Pulse: a live radar of Jev (TypeSafe AI "System One") decisions.

- `apps/api`: Hono server. `src/backends/` holds `DecisionBackend` implementations (`mock`, `jev`, `kev`), chosen by `JEV_BACKEND`. `src/sources/` fetches HN / GitHub issues / synthetic items.
- `apps/web`: React 19 + Vite + Tailwind v4. `src/lib/sim.ts` is the particle simulation, `src/components/Radar.tsx` the canvas renderer.
- `packages/schema`: Zod types shared by everything (the single source of truth for a `Decision`).
- `packages/mcp`: stdio MCP server exposing `triage_feed` and `score_items`; it calls the API over HTTP.

Commands: `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

Rules: never commit `.env`; keep the mock backend deterministic (tests depend on it); the real Jev response mapping in `backends/jev.ts` is unverified against a live key, so keep `normalise()` defensive and covered by tests.
