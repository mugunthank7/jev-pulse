import { CATEGORIES, ESCALATE_BELOW, overallConfidence, type ScoredItem } from "@jev-pulse/schema";

export const CATEGORY_HUE: Record<string, number> = {
  bug: 350, feature: 160, question: 205, security: 28, discussion: 275, news: 52,
};

export type Particle = {
  item: ScoredItem;
  x: number; y: number; vx: number; vy: number;
  r: number; hue: number; conf: number; urgency: number;
  angle: number;
  born: number;
  escalate: boolean;
};

export type Anchor = { x: number; y: number; label: string; hue: number; count: number };

/** Lays category anchors on a ring and pulls each particle toward its own. */
export class Sim {
  particles: Particle[] = [];
  anchors: Anchor[] = [];
  w = 0; h = 0;
  private seen = new Set<string>();

  resize(w: number, h: number) {
    this.w = w; this.h = h;
    const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.3;
    const counts = new Map(this.anchors.map((a) => [a.label, a.count]));
    this.anchors = CATEGORIES.map((label, i) => {
      const a = (i / CATEGORIES.length) * Math.PI * 2 - Math.PI / 2;
      return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad, label, hue: CATEGORY_HUE[label]!, count: counts.get(label) ?? 0 };
    });
  }

  add(items: ScoredItem[], now: number) {
    for (const item of items) {
      if (this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      const conf = overallConfidence(item.decision);
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        item, x: this.w / 2 + Math.cos(a) * 20, y: this.h / 2 + Math.sin(a) * 20,
        vx: Math.cos(a) * 4, vy: Math.sin(a) * 4,
        r: 1.6 + (item.decision.urgency.value / 100) * 4.4,
        hue: CATEGORY_HUE[item.decision.category.label]!,
        conf, urgency: item.decision.urgency.value, angle: Math.random() * Math.PI * 2, born: now,
        escalate: conf < ESCALATE_BELOW,
      });
    }
    this.recount();
  }

  reset() { this.particles = []; this.seen.clear(); this.recount(); }

  private recount() {
    for (const a of this.anchors) a.count = 0;
    for (const p of this.particles) this.anchors.find((a) => a.label === p.item.decision.category.label)!.count++;
  }

  step(dt: number) {
    const k = Math.min(dt, 0.05);
    for (const p of this.particles) {
      const a = this.anchors.find((x) => x.label === p.item.decision.category.label)!;
      // Confident decisions sit tight to the anchor; uncertain ones drift in a wide orbit.
      const orbit = 14 + (1 - p.conf) * Math.min(this.w, this.h) * 0.16;
      p.angle += k * (0.15 + (1 - p.conf) * 0.2);
      const tx = a.x + Math.cos(p.angle) * orbit, ty = a.y + Math.sin(p.angle) * orbit * 0.8;
      p.vx += (tx - p.x) * 14 * k; p.vy += (ty - p.y) * 14 * k;
      p.vx *= 0.86; p.vy *= 0.86;
      p.x += p.vx * k * 9; p.y += p.vy * k * 9;
    }
  }
}
