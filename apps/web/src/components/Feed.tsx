import { overallConfidence, ESCALATE_BELOW, type ScoredItem } from "@jev-pulse/schema";
import { CATEGORY_HUE } from "../lib/sim";

export function Feed({ items, hovered }: { items: ScoredItem[]; hovered: ScoredItem | null }) {
  const recent = items.slice(-40).reverse();
  return (
    <div className="glass flex max-h-[42vh] w-full flex-col overflow-hidden sm:max-h-[calc(100vh-8rem)] sm:w-[340px]">
      {hovered ? <Detail item={hovered} /> : (
        <>
          <div className="px-4 pt-3 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">live decisions · hover a dot to inspect</div>
          <ul className="scroll flex-1 overflow-y-auto px-2 pb-2">
            {recent.map((i) => {
              const c = overallConfidence(i.decision);
              return (
                <li key={i.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: `hsl(${CATEGORY_HUE[i.decision.category.label]} 90% 62%)`, boxShadow: `0 0 ${4 + c * 10}px hsl(${CATEGORY_HUE[i.decision.category.label]} 90% 60%)` }} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-white/85">{i.text}</div>
                    <div className="font-mono text-[10px] text-white/40">{i.decision.category.label} · urg {Math.round(i.decision.urgency.value)} · {Math.round(c * 100)}%{c < ESCALATE_BELOW ? " · ⚠ escalate" : ""}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Bar({ label, value, color, text }: { label: string; value: number; color: string; text: string }) {
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex justify-between font-mono text-[10px] text-white/50"><span>{label}</span><span>{text}</span></div>
      <div className="h-1.5 rounded bg-white/10"><div className="h-full rounded" style={{ width: `${Math.max(2, value * 100)}%`, background: color }} /></div>
    </div>
  );
}

function Detail({ item }: { item: ScoredItem }) {
  const d = item.decision;
  const hue = CATEGORY_HUE[d.category.label];
  const probs = Object.entries(d.category.probs).sort((a, b) => b[1] - a[1]);
  return (
    <div className="scroll overflow-y-auto p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{item.source}</div>
      <p className="mt-1 mb-3 text-sm leading-snug">{item.text.slice(0, 220)}</p>
      {probs.map(([k, p]) => <Bar key={k} label={k} value={p} text={`${(p * 100).toFixed(0)}%`} color={`hsl(${CATEGORY_HUE[k]} 85% 60%)`} />)}
      <div className="my-3 border-t border-white/10" />
      <Bar label="urgency" value={d.urgency.value / 100} text={`${Math.round(d.urgency.value)} / 100`} color={`hsl(${hue} 85% 60%)`} />
      <Bar label="sentiment" value={(d.sentiment.value + 1) / 2} text={d.sentiment.value.toFixed(2)} color="linear-gradient(90deg,#f43f5e,#22d3ee)" />
      <Bar label="actionable" value={d.actionable.p} text={`${(d.actionable.p * 100).toFixed(0)}%`} color="#a78bfa" />
      <Bar label="spam" value={d.spam.p} text={`${(d.spam.p * 100).toFixed(0)}%`} color="#fb923c" />
      <div className="mt-3 font-mono text-[10px] text-white/40">{Math.round(item.latencyMs)} ms · {item.backend}</div>
    </div>
  );
}
