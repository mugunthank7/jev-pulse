import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CATS, ENGINE_ORDER, engineStats, useNow, type Cat, type Cell, type EngineId, type SortState } from "../lib/sort";
import { CAT_THEME, ENGINE_THEME, RIGHT, WRONG } from "../lib/theme";

// Scene geometry (viewBox units): source on the left, three engine "data flow lines", category branches on the right.
const W = 1000, H = 720;
const SRC = { x: 98, y: 360 };
const ENG: Record<EngineId, { x: number; y: number }> = { jev: { x: 440, y: 130 }, gemini: { x: 440, y: 360 }, claude: { x: 440, y: 590 } };
const CAT_X = 850;
const CAT_DY: Record<Cat, number> = { exact: -66, substitute: 0, not_a_match: 66 };
const NODE_W = 190, NODE_H = 80, BUBBLE = 31;
/** Only used for the very first envelope of a run, before an engine's real latency is known. */
const FIRST_GUESS_MS: Record<EngineId, number> = { jev: 500, gemini: 1500, claude: 2200 };

type P = { x: number; y: number };
const catPos = (e: EngineId, c: Cat): P => ({ x: CAT_X, y: ENG[e].y + CAT_DY[c] });
const legIn = (e: EngineId): [P, P] => [{ x: SRC.x + 50, y: SRC.y }, { x: ENG[e].x - NODE_W / 2, y: ENG[e].y }];
const legOut = (e: EngineId, c: Cat): [P, P] => [{ x: ENG[e].x + NODE_W / 2, y: ENG[e].y }, { x: catPos(e, c).x - BUBBLE, y: catPos(e, c).y }];
const bez = ([a, b]: [P, P], t: number): P => {
  const dx = (b.x - a.x) * 0.55, c1 = { x: a.x + dx, y: a.y }, c2 = { x: b.x - dx, y: b.y }, u = 1 - t;
  return { x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y };
};
const edge = ([a, b]: [P, P]) => { const dx = (b.x - a.x) * 0.55; return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${a.y === b.y ? a.y : b.y} ${b.x},${b.y}`; };
const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function EnvelopeShape({ color, fill = "#fff" }: { color: string; fill?: string }) {
  return (
    <g style={{ filter: "drop-shadow(0 3px 5px rgba(60,70,110,0.28))" }}>
      <rect x={-17} y={-12} width={34} height={24} rx={4} fill={fill} stroke={color} strokeWidth={2.2} />
      <path d="M-17,-10 L0,3 L17,-10" fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
    </g>
  );
}

type Landed = Record<EngineId, Record<Cat, { n: number; ok: number; lastOk: boolean }>>;
const emptyLanded = (): Landed => Object.fromEntries(ENGINE_ORDER.map((e) => [e, Object.fromEntries(CATS.map((c) => [c, { n: 0, ok: 0, lastOk: true }]))])) as Landed;

/**
 * One envelope on one engine's data-flow line. Its travel to the engine is paced by that engine's real latency
 * (it creeps toward the engine at the speed the model is actually answering), then it snaps to the engine when
 * the answer lands and flies on to the category the engine chose. The state machine runs on timers, not animation
 * frames, so it stays correct in background tabs; Motion only draws the movement.
 */
function Envelope({ engine, cell, expectedMs, speed, onLand, onGone }: { engine: EngineId; cell: Cell | undefined; expectedMs: number; speed: number; onLand: (c: Cat, ok: boolean) => void; onGone: () => void }) {
  const theme = ENGINE_THEME[engine];
  const t = useMotionValue(0);
  const leg = useRef<[P, P]>(legIn(engine));
  const [phase, setPhase] = useState<"flying" | "arrive" | "out" | "fail">("flying");
  const x = useTransform(t, (v) => bez(leg.current, v).x);
  const y = useTransform(t, (v) => bez(leg.current, v).y);
  const target = useRef<{ cat: Cat; ok: boolean } | null>(null);

  // Creep toward the engine at the model's own pace (never quite arriving until it answers).
  useEffect(() => {
    const a = animate(t, 0.93, { duration: Math.max(0.25, expectedMs / 1000) / speed, ease: "linear" });
    return () => a.stop();
  }, [t, expectedMs, speed]);

  useEffect(() => {
    if (phase !== "flying" || !cell || cell.status === "pending") return;
    if (cell.status === "error" || !cell.predicted) { setPhase("fail"); return; }
    target.current = { cat: cell.predicted, ok: !!cell.correct };
    animate(t, 1, { duration: 0.12 / speed, ease: "easeOut" });
    setPhase("arrive");
  }, [phase, cell, t, speed]);

  useEffect(() => {
    if (phase !== "arrive") return;
    const id = window.setTimeout(() => { leg.current = legOut(engine, target.current!.cat); t.set(0); setPhase("out"); }, 130 / speed);
    return () => clearTimeout(id);
  }, [phase, engine, t, speed]);

  useEffect(() => {
    if (phase === "fail") { const id = window.setTimeout(onGone, 1600); return () => clearTimeout(id); }
    if (phase !== "out" || !target.current) return;
    const { cat, ok } = target.current;
    const a = animate(t, 1, { duration: 0.45 / speed, ease: [0.4, 0, 0.2, 1] });
    const id = window.setTimeout(() => { onLand(cat, ok); onGone(); }, 450 / speed);
    return () => { a.stop(); clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <motion.g style={{ x, y }}>
      <motion.g animate={phase === "arrive" ? { scale: [1, 1.3, 1] } : { scale: 1 }} transition={{ duration: 0.2 }}>
        <EnvelopeShape color={phase === "fail" ? WRONG : theme.line} fill={phase === "fail" ? "#ffe4e9" : "#fff"} />
      </motion.g>
      {phase === "fail" && <text y={-20} textAnchor="middle" fontSize={14} fill={WRONG} fontWeight={700}>✗ failed</text>}
    </motion.g>
  );
}

export function MindMap({ state, speed }: { state: SortState; speed: number }) {
  const [envs, setEnvs] = useState<{ key: string; engine: EngineId; round: number; expectedMs: number }[]>([]);
  const [landed, setLanded] = useState<Landed>(emptyLanded);
  const seen = useRef(new Set<string>());
  const stats = Object.fromEntries(ENGINE_ORDER.map((e) => [e, engineStats(state.cells[e])])) as Record<EngineId, ReturnType<typeof engineStats>>;
  const total = state.items.length;

  // Each engine takes its NEXT inbox item the instant it finishes the previous one, so a fast engine launches a new
  // envelope right away. Launch one envelope whenever an engine's current item changes, paced to its measured speed.
  const laneKey = ENGINE_ORDER.map((e) => state.laneRound[e]).join(",");
  useEffect(() => {
    const fresh = ENGINE_ORDER.filter((e) => state.laneRound[e] >= 0)
      .map((e) => ({ key: `${state.runId}-${e}-${state.laneRound[e]}`, engine: e, round: state.laneRound[e], expectedMs: stats[e].n ? stats[e].avgLatencyMs : FIRST_GUESS_MS[e] }))
      .filter((x) => !seen.current.has(x.key));
    if (!fresh.length) return;
    fresh.forEach((f) => seen.current.add(f.key));
    setEnvs((cur) => [...cur, ...fresh]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneKey, state.runId]);

  const pending = ENGINE_ORDER.some((e) => state.cells[e][state.laneRound[e]]?.status === "pending");
  const now = useNow(pending);
  const meta = (e: EngineId) => state.engines.find((m) => m.id === e);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Search-result envelopes travel along three lines, one per engine (Jev, Gemini, Claude), and are sorted into exact, substitute or no-match">
      <defs>
        <style>{`@keyframes flow{to{stroke-dashoffset:-22}} .flow{animation:flow 1.1s linear infinite}`}</style>
      </defs>

      {/* three data-flow lanes */}
      {ENGINE_ORDER.map((e) => <rect key={e} x={196} y={ENG[e].y - 100} width={782} height={200} rx={28} fill={ENGINE_THEME[e].soft} fillOpacity={0.5} />)}

      <g fontSize={11} letterSpacing={2.5} fill="#8a93ad" fontWeight={600} textAnchor="middle">
        <text x={SRC.x} y={22}>SOURCE</text><text x={ENG.jev.x} y={22}>ENGINE</text><text x={CAT_X} y={22}>SORTED INTO</text>
      </g>

      {/* the lines */}
      {ENGINE_ORDER.map((e) => (
        <g key={e}>
          <path d={edge(legIn(e))} fill="none" stroke={ENGINE_THEME[e].line} strokeWidth={3.5} strokeOpacity={0.35} />
          <path d={edge(legIn(e))} fill="none" stroke={ENGINE_THEME[e].line} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 20" className="flow" />
          {CATS.map((c) => <path key={c} d={edge(legOut(e, c))} fill="none" stroke={CAT_THEME[c].line} strokeWidth={2.5} strokeOpacity={0.5} />)}
        </g>
      ))}

      {/* source */}
      <g transform={`translate(${SRC.x},${SRC.y})`}>
        <circle r={66} fill="#e8e6ff" fillOpacity={0.6} />
        <circle r={48} fill="#fff" stroke="#b7b2f5" strokeWidth={2.5} style={{ filter: "drop-shadow(0 6px 14px rgba(110,100,200,0.25))" }} />
        <path d="M-18,-5 L-10,-19 H10 L18,-5 V13 a4,4 0 0 1 -4,4 H-14 a4,4 0 0 1 -4,-4 Z M-18,-5 H-6 L-3,2 H3 L6,-5 H18" fill="none" stroke="#7b72e0" strokeWidth={2.4} strokeLinejoin="round" />
        <text y={72} textAnchor="middle" fontSize={15} fontWeight={700} fill="#26304d">Inbox</text>
        <text y={90} textAnchor="middle" fontSize={11.5} fill="#7a84a3">{total ? `${total} search results` : "waiting to start"}</text>
        <text y={106} textAnchor="middle" fontSize={10.5} fill="#9aa3bd">each engine takes the next</text>
        <text y={120} textAnchor="middle" fontSize={10.5} fill="#9aa3bd">one as soon as it is free</text>
      </g>
      {/* engines + their three branches */}
      {ENGINE_ORDER.map((e) => {
        const m = meta(e), r = state.laneRound[e], cell = r >= 0 ? state.cells[e][r] : undefined, st = stats[e], busy = cell?.status === "pending", th = ENGINE_THEME[e];
        const shown = busy ? now - (state.laneStartedAt[e] ?? now) : cell?.status === "done" ? (cell.latencyMs ?? 0) : null;
        const item = r >= 0 ? state.items[r] : undefined, doneCount = st.n + st.errors;
        const { x, y } = ENG[e];
        return (
          <g key={e}>
            <g transform={`translate(${x},${y})`}>
              {busy && <motion.rect x={-NODE_W / 2 - 7} y={-NODE_H / 2 - 7} width={NODE_W + 14} height={NODE_H + 14} rx={24} fill="none" stroke={th.line} strokeWidth={3} animate={{ opacity: [0.15, 0.8, 0.15] }} transition={{ repeat: Infinity, duration: 0.9 }} />}
              <rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx={20} fill="#fff" stroke={th.line} strokeWidth={2.5} style={{ filter: "drop-shadow(0 8px 16px rgba(60,70,110,0.16))" }} />
              <rect x={-NODE_W / 2} y={-NODE_H / 2} width={9} height={NODE_H} rx={4.5} fill={th.line} />
              <text x={-NODE_W / 2 + 22} y={-14} fontSize={17} fontWeight={800} fill={th.ink}>{m?.label ?? e}</text>
              <text x={-NODE_W / 2 + 22} y={2} fontSize={10} fill="#8a93ad">{clip(m?.model ?? "", 30)}</text>
              <text x={-NODE_W / 2 + 22} y={27} fontSize={21} fontWeight={800} fill="#26304d" style={{ fontVariantNumeric: "tabular-nums" }}>{shown === null ? "—" : ms(shown)}</text>
              {st.n > 0 && <text x={NODE_W / 2 - 14} y={27} textAnchor="end" fontSize={12} fontWeight={700} fill={th.ink}>{st.correct}/{st.n} right</text>}
              {total > 0 && <text x={NODE_W / 2 - 14} y={-14} textAnchor="end" fontSize={12} fontWeight={800} fill="#26304d" style={{ fontVariantNumeric: "tabular-nums" }}>{doneCount}/{total}</text>}
              {total > 0 && <g><rect x={-NODE_W / 2 + 22} y={NODE_H / 2 - 11} width={NODE_W - 44} height={5} rx={2.5} fill="#eef0f8" /><rect x={-NODE_W / 2 + 22} y={NODE_H / 2 - 11} width={Math.max(0, ((NODE_W - 44) * doneCount) / total)} height={5} rx={2.5} fill={th.line} /></g>}
            </g>
            {item && (
              <g transform={`translate(${x - NODE_W / 2},${y + NODE_H / 2 + 8})`}>
                <text x={0} y={11} fontSize={10.5} fill="#7b72e0" fontWeight={700}>🔍 {clip(item.query, 24)}</text>
                <text x={0} y={25} fontSize={10.5} fill="#5b6685">{clip(item.title, 34)}</text>
              </g>
            )}
            {state.retry[e] && <text x={x} y={y + 78} textAnchor="middle" fontSize={11} fill="#b7860b">⚠ {state.retry[e]}</text>}
            {cell?.status === "error" && <text x={x} y={y + 78} textAnchor="middle" fontSize={11} fill={WRONG}>{/credits/i.test(cell.error ?? "") ? "out of OpenRouter credits" : "request failed"}</text>}

            {CATS.map((c) => {
              const p = catPos(e, c), l = landed[e][c], ct = CAT_THEME[c];
              return (
                <g key={c} transform={`translate(${p.x},${p.y})`}>
                  <circle r={BUBBLE} fill="#fff" stroke={ct.line} strokeWidth={2.5} style={{ filter: "drop-shadow(0 4px 8px rgba(60,70,110,0.12))" }} />
                  <circle r={BUBBLE - 4} fill={ct.soft} fillOpacity={0.7} />
                  {l.n > 0 && <motion.circle key={`ring-${l.n}`} r={BUBBLE} fill="none" stroke={l.lastOk ? RIGHT : WRONG} strokeWidth={4} initial={{ scale: 1, opacity: 0.95 }} animate={{ scale: 1.55, opacity: 0 }} transition={{ duration: 0.7 }} />}
                  <text y={-9} textAnchor="middle" fontSize={7.5} letterSpacing={0.4} fill={ct.ink} fontWeight={800}>{ct.label}</text>
                  <motion.text key={`num-${l.n}`} y={12} textAnchor="middle" fontSize={22} fontWeight={800} fill="#26304d" initial={{ scale: 1.5 }} animate={{ scale: 1 }}>{l.n}</motion.text>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* envelopes in flight */}
      {envs.map((en) => (
        <Envelope key={en.key} engine={en.engine} speed={speed} expectedMs={en.expectedMs} cell={state.cells[en.engine][en.round]}
          onLand={(c, ok) => setLanded((cur) => ({ ...cur, [en.engine]: { ...cur[en.engine], [c]: { n: cur[en.engine][c].n + 1, ok: cur[en.engine][c].ok + (ok ? 1 : 0), lastOk: ok } } }))}
          onGone={() => setEnvs((cur) => cur.filter((x) => x.key !== en.key))} />
      ))}
    </svg>
  );
}
