/**
 * Records ONE real run of the mind map to apps/web/public/runs/sort.json.
 *
 *   npm run record                 (needs OPENROUTER_API_KEY with credits in .env)
 *   RECORD_ITEMS=20 npm run record
 *
 * The app's "Replay" mode (and `?record=1`) then plays this tape back with each engine's RECORDED latency,
 * so a visitor sees real measurements without anyone spending API credits. The tape is refused if any engine
 * failed a call, so a half-broken recording can't be committed by accident.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { LANE_OPTIONS } from "../apps/api/src/compare/models.ts";
import { sortItems } from "../apps/api/src/sort/items.ts";
import { jevJudge, llmJudge } from "../apps/api/src/sort/judges.ts";
import { runSort, type SortEvent, type SortLane } from "../apps/api/src/sort/run.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("OPENROUTER_API_KEY is not set (add it to .env)."); process.exit(1); }

const n = Number(process.env.RECORD_ITEMS ?? 12);
const gemini = LANE_OPTIONS.gemini.options.find((o) => o.model === (process.env.RECORD_GEMINI ?? LANE_OPTIONS.gemini.default));
const claude = LANE_OPTIONS.claude.options.find((o) => o.model === (process.env.RECORD_CLAUDE ?? LANE_OPTIONS.claude.default));
if (!gemini || !claude) { console.error("Unknown RECORD_GEMINI / RECORD_CLAUDE model."); process.exit(1); }

const lanes: SortLane[] = [
  { id: "jev", label: "Jev", model: "typesafe/jev-1.13" },
  { id: "gemini", label: gemini.label, model: gemini.model },
  { id: "claude", label: claude.label, model: claude.model },
];
const events: SortEvent[] = [];
let errors = 0;
await runSort(sortItems(n), lanes, (lane, item) => (lane.id === "jev" ? jevJudge(item, key) : llmJudge(lane.model, item, key)), (e) => {
  events.push(e);
  if (e.type === "result") { if (e.error) { errors++; console.error(`  ${e.lane} round ${e.round}: ${e.error}`); } else console.log(`${e.lane.padEnd(6)} item ${e.round + 1}/${n} -> ${e.predicted} ${e.correct ? "ok" : "WRONG"} ${Math.round(e.latencyMs ?? 0)} ms (t=${(e.t / 1000).toFixed(1)}s)`); }
}, { minIntervalMs: (l) => (l.id === "jev" ? 0 : Number(process.env.RACE_LLM_INTERVAL_MS ?? 3100)) });

if (errors && !process.env.ALLOW_ERRORS) {
  console.error(`\n${errors} call(s) failed (usually credits or rate limits). Not writing an incomplete tape. Fix and rerun, or set ALLOW_ERRORS=1.`);
  process.exit(1);
}
mkdirSync(new URL("../apps/web/public/runs/", import.meta.url), { recursive: true });
writeFileSync(new URL("../apps/web/public/runs/sort.json", import.meta.url), JSON.stringify({ meta: { recordedAt: new Date().toISOString(), note: "Real run: OpenRouter, Jev + Gemini + Claude, same items." }, events }));
console.log(`\nwrote apps/web/public/runs/sort.json (${n} items, ${lanes.map((l) => l.label).join(" / ")})`);
