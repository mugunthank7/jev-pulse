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
  /** 0 = travelling in from the feed (unsorted), 1 = decided by Jev and flying to its cluster */
  stage: 0 | 1;
  sortedAt: number;
  escalate: boolean;
};

export type Anchor = { x: number; y: number; dx: number; dy: number; label: string; hue: number; count: number };

/** Items enter from the left feed, pass the Jev core, then fan out to their category cluster. */
export class Sim {
  particles: Particle[] = [];
  anchors: Anchor[] = [];
  w = 0; h = 0;
  cx = 0; cy = 0; radius = 0;
  sorted = 0;
  flashes: { t: number; hue: number }[] = [];
  private seen = new Set<string>();

  resize(w: number, h: number) {
    this.w = w; this.h = h;
    const wide = w >= 760;
    // Keep the radar clear of the right-hand HUD/feed column on wide screens.
    this.cx = wide ? (w - 380) / 2 + 40 : w / 2;
    this.cy = wide ? h * 0.56 : h * 0.42;
    this.radius = Math.min(wide ? w - 380 : w, wide ? h * 0.92 : h * 0.8) * 0.31;
    const counts = new Map(this.anchors.map((a) => [a.label, a.count]));
    this.anchors = CATEGORIES.map((label, i) => {
      const a = (i / CATEGORIES.length) * Math.PI * 2 - Math.PI / 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      return { x: this.cx + dx * this.radius, y: this.cy + dy * this.radius, dx, dy, label, hue: CATEGORY_HUE[label]!, count: counts.get(label) ?? 0 };
    });
  }

  add(items: ScoredItem[], now: number) {
    for (const item of items) {
      if (this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      const conf = overallConfidence(item.decision);
      this.particles.push({
        item,
        x: -12, y: this.cy + (Math.random() - 0.5) * this.h * 0.5,
        vx: 0, vy: 0,
        r: 1.6 + (item.decision.urgency.value / 100) * 4.4,
        hue: CATEGORY_HUE[item.decision.category.label]!,
        conf, urgency: item.decision.urgency.value, angle: Math.random() * Math.PI * 2, born: now,
        stage: 0, sortedAt: 0, escalate: conf < ESCALATE_BELOW,
      });
    }
  }

  reset() { this.particles = []; this.seen.clear(); this.sorted = 0; for (const a of this.anchors) a.count = 0; }

  step(dt: number, now: number) {
    const k = Math.min(dt, 0.05);
    for (const p of this.particles) {
      if (p.stage === 0) {
        // fly toward the Jev core
        const dx = this.cx - p.x, dy = this.cy - p.y, d = Math.hypot(dx, dy) || 1;
        const speed = 420 + (p.born % 7) * 20;
        p.x += (dx / d) * speed * k; p.y += (dy / d) * speed * k;
        if (d < 18) {
          p.stage = 1; p.sortedAt = now; this.sorted++;
          p.vx = (Math.random() - 0.5) * 60; p.vy = (Math.random() - 0.5) * 60;
          this.anchors.find((a) => a.label === p.item.decision.category.label)!.count++;
          this.flashes.push({ t: now, hue: p.hue });
          if (this.flashes.length > 24) this.flashes.shift();
        }
        continue;
      }
      const a = this.anchors.find((x) => x.label === p.item.decision.category.label)!;
      // Confident decisions sit tight to the anchor; uncertain ones drift in a wide orbit.
      const orbit = 14 + (1 - p.conf) * this.radius * 0.5;
      p.angle += k * (0.15 + (1 - p.conf) * 0.2);
      const tx = a.x + Math.cos(p.angle) * orbit, ty = a.y + Math.sin(p.angle) * orbit * 0.8;
      p.vx += (tx - p.x) * 14 * k; p.vy += (ty - p.y) * 14 * k;
      p.vx *= 0.86; p.vy *= 0.86;
      p.x += p.vx * k * 9; p.y += p.vy * k * 9;
    }
    this.flashes = this.flashes.filter((f) => now - f.t < 500);
  }
}
