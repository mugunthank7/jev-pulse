import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CAT_COLOR, CATS, ENGINE_COLOR, ENGINE_ORDER, engineStats, useNow, type Cat, type Cell, type EngineId, type SortState } from "../lib/sort";
const CAT_LABEL: Record<Cat, string> = { exact: "EXACT", substitute: "SUBSTITUTE", not_a_match: "NO MATCH" };

// Scene geometry (viewBox units). Source on the left, engines in the middle, category branches on the right.
const W = 1000, H = 720;
const SRC = { x: 100, y: 370 };
const ENG: Record<EngineId, { x: number; y: number }> = { jev: { x: 430, y: 138 }, gemini: { x: 430, y: 370 }, claude: { x: 430, y: 602 } };
const CAT_X = 835;
const CAT_DY: Record<Cat, number> = { exact: -68, substitute: 0, not_a_match: 68 };
const NODE_W = 176, NODE_H = 76;
type P = { x: number; y: number };
const catPos = (e: EngineId, c: Cat): P => ({ x: CAT_X, y: ENG[e].y + CAT_DY[c] });

const legIn = (e: EngineId): [P, P] => [{ x: SRC.x + 48, y: SRC.y }, { x: ENG[e].x - NODE_W / 2, y: ENG[e].y }];
const legOut = (e: EngineId, c: Cat): [P, P] => [{ x: ENG[e].x + NODE_W / 2, y: ENG[e].y }, { x: catPos(e, c).x - 31, y: catPos(e, c).y }];
const bez = ([a, b]: [P, P], t: number): P => {
  const dx = (b.x - a.x) * 0.55, c1 = { x: a.x + dx, y: a.y }, c2 = { x: b.x - dx, y: b.y }, u = 1 - t;
  return { x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y };
};
const edge = ([a, b]: [P, P]) => { const dx = (b.x - a.x) * 0.55; return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };

const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function EnvelopeShape({ color }: { color: string }) {
  return (
    <g filter="url(#glow)">
      <rect x={-16} y={-11} width={32} height={22} rx={3.5} fill={color} fillOpacity={0.92} stroke="#fff" strokeOpacity={0.9} strokeWidth={1.2} />
      <path d="M-16,-9 L0,3 L16,-9" fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={1.2} />
    </g>
  );
}

type Landed = Record<EngineId, Record<Cat, { n: number; ok: number; lastOk: boolean }>>;
const emptyLanded = (): Landed => Object.fromEntries(ENGINE_ORDER.map((e) => [e, Object.fromEntries(CATS.map((c) => [c, { n: 0, ok: 0, lastOk: true }]))])) as Landed;

/** One envelope: source -> engine (waits there for the engine's real answer) -> its chosen category. */
function Envelope({ engine, cell, speed, onLand, onGone }: { engine: EngineId; cell: Cell | undefined; speed: number; onLand: (c: Cat, ok: boolean) => void; onGone: () => void }) {
  const color = ENGINE_COLOR[engine];
  const t = useMotionValue(0);
  const leg = useRef<[P, P]>(legIn(engine));
  const [phase, setPhase] = useState<"in" | "wait" | "out" | "fail">("in");
  const x = useTransform(t, (v) => bez(leg.current, v).x);
  const y = useTransform(t, (v) => bez(leg.current, v).y);

  // Motion drives the visual movement; the state machine runs on timers so it never depends on animation frames
  // (browsers pause rAF in background tabs, which would otherwise freeze envelopes mid-flight).
  useEffect(() => {
    const a = animate(t, 1, { duration: 0.4 / speed, ease: [0.4, 0, 0.2, 1] });
    const id = window.setTimeout(() => setPhase("wait"), 400 / speed);
    return () => { a.stop(); clearTimeout(id); };
  }, [t, speed]);

  // Once the engine has answered, decide where the envelope goes. (Kept separate from the animation below:
  // an effect's cleanup runs when its deps change, which would otherwise cancel the flight we just started.)
  const target = useRef<{ cat: Cat; ok: boolean } | null>(null);
  useEffect(() => {
    if (phase !== "wait" || !cell || cell.status === "pending") return;
    if (cell.status === "error" || !cell.predicted) { setPhase("fail"); return; }
    target.current = { cat: cell.predicted, ok: !!cell.correct };
    leg.current = legOut(engine, cell.predicted); t.set(0); setPhase("out");
  }, [phase, cell, engine, t]);

  useEffect(() => {
    if (phase === "fail") { const id = window.setTimeout(onGone, 1500); return () => clearTimeout(id); }
    if (phase !== "out" || !target.current) return;
    const { cat, ok } = target.current;
    const a = animate(t, 1, { duration: 0.5 / speed, ease: [0.4, 0, 0.2, 1] });
    const id = window.setTimeout(() => { onLand(cat, ok); onGone(); }, 500 / speed);
    return () => { a.stop(); clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <motion.g style={{ x, y }}>
      <motion.g animate={phase === "wait" ? { rotate: [-9, 9, -9], scale: [1, 1.12, 1] } : { rotate: 0, scale: 1 }} transition={phase === "wait" ? { repeat: Infinity, duration: 0.5 } : { duration: 0.1 }}>
        <EnvelopeShape color={phase === "fail" ? "#f43f5e" : color} />
      </motion.g>
      {phase === "fail" && <text y={-18} textAnchor="middle" fontSize={15} fill="#fb7185" fontWeight={700}>✗ error</text>}
    </motion.g>
  );
}

export function MindMap({ state, speed }: { state: SortState; speed: number }) {
  const [envs, setEnvs] = useState<{ key: string; engine: EngineId; round: number }[]>([]);
  const [landed, setLanded] = useState<Landed>(emptyLanded);
  const seen = useRef(new Set<string>());
  const current = state.items[state.round];

  // New round -> launch one envelope per engine, all at the same instant.
  useEffect(() => {
    if (state.round < 0) return;
    const fresh = ENGINE_ORDER.filter((e) => state.engines.some((m) => m.id === e)).map((e) => ({ key: `${state.runId}-${state.round}-${e}`, engine: e, round: state.round })).filter((x) => !seen.current.has(x.key));
    if (!fresh.length) return;
    fresh.forEach((f) => seen.current.add(f.key));
    setEnvs((cur) => [...cur, ...fresh]);
  }, [state.round, state.runId, state.engines]);

  const pending = ENGINE_ORDER.some((e) => state.cells[e][state.round]?.status === "pending");
  const now = useNow(pending);
  const stats = Object.fromEntries(ENGINE_ORDER.map((e) => [e, engineStats(state.cells[e])])) as Record<EngineId, ReturnType<typeof engineStats>>;
  const meta = (e: EngineId) => state.engines.find((m) => m.id === e);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Mind map: search-result envelopes are sorted by Jev, Gemini and Claude into exact, substitute and no-match">
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <radialGradient id="bg" cx="40%" cy="50%" r="75%"><stop offset="0%" stopColor="#12172a" /><stop offset="100%" stopColor="#05060b" /></radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#bg)" />

      {/* column captions */}
      {[["SOURCE", SRC.x], ["ENGINES", 430], ["SORTED INTO", CAT_X]].map(([t, x]) => <text key={t as string} x={x as number} y={20} textAnchor="middle" fontSize={11} letterSpacing={3} fill="#ffffff55" fontFamily="ui-monospace, monospace">{t}</text>)}

      {/* branches */}
      {ENGINE_ORDER.map((e) => (
        <g key={e}>
          <path d={edge(legIn(e))} fill="none" stroke={ENGINE_COLOR[e]} strokeOpacity={0.22} strokeWidth={2} />
          {CATS.map((c) => <path key={c} d={edge(legOut(e, c))} fill="none" stroke={CAT_COLOR[c]} strokeOpacity={0.2} strokeWidth={2} />)}
        </g>
      ))}

      {/* source */}
      <g transform={`translate(${SRC.x},${SRC.y})`}>
        <circle r={62} fill="#7aa2ff" fillOpacity={0.06} />
        <circle r={46} fill="#0d1226" stroke="#9db6ff" strokeOpacity={0.8} strokeWidth={2} />
        <path d="M-17,-4 L-9,-18 H9 L17,-4 V12 a4,4 0 0 1 -4,4 H-13 a4,4 0 0 1 -4,-4 Z M-17,-4 H-6 L-3,2 H3 L6,-4 H17" fill="none" stroke="#c7d5ff" strokeWidth={2} strokeLinejoin="round" />
        <text y={64} textAnchor="middle" fontSize={13} fontWeight={600} fill="#e7ebf5">Search results</text>
        <text y={80} textAnchor="middle" fontSize={10} fill="#ffffff66" fontFamily="ui-monospace, monospace">Amazon ESCI · human-labeled</text>
        <text y={96} textAnchor="middle" fontSize={11} fill="#9db6ff" fontFamily="ui-monospace, monospace">{state.round >= 0 ? `item ${state.round + 1} / ${state.items.length}` : "idle"}</text>
      </g>
      {current && (
        <g transform={`translate(${SRC.x - 82},${SRC.y + 112})`}>
          <rect width={164} height={96} rx={10} fill="#0d1226" stroke="#ffffff22" />
          <text x={10} y={20} fontSize={10} fill="#9db6ff" fontFamily="ui-monospace, monospace">🔍 {clip(current.query, 22)}</text>
          <text x={10} y={40} fontSize={10.5} fill="#e7ebf5">{clip(current.title, 25)}</text>
          <text x={10} y={54} fontSize={10.5} fill="#e7ebf5">{clip(current.title.slice(25), 25)}</text>
          <text x={10} y={82} fontSize={10} fill="#ffffff77" fontFamily="ui-monospace, monospace">human label: <tspan fill={CAT_COLOR[current.label]} fontWeight={700}>{CAT_LABEL[current.label].toLowerCase()}</tspan></text>
        </g>
      )}

      {/* engines + their three branches */}
      {ENGINE_ORDER.map((e) => {
        const m = meta(e), cell = state.cells[e][state.round], st = stats[e], busy = cell?.status === "pending";
        const shown = busy ? now - (state.dispatchedAt ?? now) : cell?.status === "done" ? (cell.latencyMs ?? 0) : null;
        const color = ENGINE_COLOR[e], { x, y } = ENG[e];
        return (
          <g key={e}>
            <g transform={`translate(${x},${y})`}>
              {busy && <motion.rect x={-NODE_W / 2 - 6} y={-NODE_H / 2 - 6} width={NODE_W + 12} height={NODE_H + 12} rx={20} fill="none" stroke={color} strokeWidth={2} animate={{ opacity: [0.2, 0.9, 0.2] }} transition={{ repeat: Infinity, duration: 0.9 }} />}
              <rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx={16} fill="#0d1226" stroke={color} strokeWidth={2} style={{ filter: `drop-shadow(0 0 14px ${color}55)` }} />
              <text x={-NODE_W / 2 + 14} y={-14} fontSize={15} fontWeight={700} fill={color}>{m?.label ?? e}</text>
              <text x={-NODE_W / 2 + 14} y={2} fontSize={9} fill="#ffffff55" fontFamily="ui-monospace, monospace">{clip(m?.model ?? "", 26)}</text>
              <text x={-NODE_W / 2 + 14} y={26} fontSize={19} fontWeight={700} fill="#fff" fontFamily="ui-monospace, monospace">{shown === null ? "—" : ms(shown)}</text>
              <text x={NODE_W / 2 - 12} y={26} textAnchor="end" fontSize={11} fill="#ffffff88" fontFamily="ui-monospace, monospace">{st.n ? `${st.correct}/${st.n} ✓` : ""}</text>
            </g>
            {state.retry[e] && <text x={x} y={y + 58} textAnchor="middle" fontSize={10} fill="#fbbf24">⚠ {state.retry[e]}</text>}
            {cell?.status === "error" && <text x={x} y={y + 58} textAnchor="middle" fontSize={10} fill="#fb7185">{/credits/i.test(cell.error ?? "") ? "out of OpenRouter credits" : "request failed"}</text>}

            {CATS.map((c) => {
              const p = catPos(e, c), l = landed[e][c];
              return (
                <g key={c} transform={`translate(${p.x},${p.y})`}>
                  <circle r={31} fill={CAT_COLOR[c]} fillOpacity={0.1} stroke={CAT_COLOR[c]} strokeOpacity={0.7} strokeWidth={1.8} />
                  {l.n > 0 && <motion.circle key={`ring-${l.n}`} r={31} fill="none" stroke={l.lastOk ? "#34d399" : "#fb7185"} strokeWidth={3} initial={{ scale: 1, opacity: 0.95 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 0.7 }} />}
                  <text y={-10} textAnchor="middle" fontSize={7.5} letterSpacing={0.5} fill={CAT_COLOR[c]} fontWeight={700}>{CAT_LABEL[c]}</text>
                  <motion.text key={`num-${l.n}`} y={11} textAnchor="middle" fontSize={21} fontWeight={700} fill="#fff" initial={{ scale: 1.5 }} animate={{ scale: 1 }}>{l.n}</motion.text>
                  <text y={25} textAnchor="middle" fontSize={8.5} fill="#ffffff88" fontFamily="ui-monospace, monospace">{l.n ? `${l.ok}✓ ${l.n - l.ok}✗` : ""}</text>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* envelopes in flight */}
      {envs.map((en) => (
        <Envelope key={en.key} engine={en.engine} speed={speed} cell={state.cells[en.engine][en.round]}
          onLand={(c, ok) => setLanded((cur) => ({ ...cur, [en.engine]: { ...cur[en.engine], [c]: { n: cur[en.engine][c].n + 1, ok: cur[en.engine][c].ok + (ok ? 1 : 0), lastOk: ok } } }))}
          onGone={() => setEnvs((cur) => cur.filter((x) => x.key !== en.key))} />
      ))}
    </svg>
  );
}
