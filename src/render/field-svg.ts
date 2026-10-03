// The built-in board renderer: bases, team-coloured pieces and the batted ball, in SVG.
// One class draws both built-in looks: `flat` from straight above with a straight ball line,
// `iso` (2.5D) with squashed ground, pieces with a side, and an arcing ball.
// It draws Scenes and plays Plans (scene.ts); it never reads game events itself.

import type { BattedBall, Side } from '../model/types.ts';
import type { StyleManifest } from '../styles/manifest.ts';
import { svgFill, visualColour, type Paint } from '../styles/team-colors.ts';
import { alpha, shade } from './colour.ts';
import { BASE_PATH, compress, fenceFeet, flight, MOUND, project, spotFeet, toScreen, type Projection } from './geometry.ts';
import { TIMING, type Piece, type Plan, type Scene, type Spot } from './scene.ts';
import { ease, Tweens } from './tween.ts';

export type Background = 'solid' | 'semi' | 'clear';
const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

interface Drawn {
  piece: Piece;
  /** Where it is drawn right now (moves during tweens). */
  spot: Spot;
  side: Side;
  g: SVGGElement;
  flip: SVGGElement;
  opacity: number;
  /** A runner's name beside the piece (inside its group, so it moves and fades with it). */
  label?: { g: SVGGElement; rect: SVGRectElement; text: SVGTextElement; name: string; w: number } | undefined;
}

/** Name labels need room: below this piece radius (px) or board height they are left out. */
const LABEL_MIN_RADIUS = 7, LABEL_MIN_HEIGHT = 90, LABEL_FONT = 9;

export interface Look { style: StyleManifest; background: Background; paints: Record<Side, Paint> }

let instances = 0;

export class FieldRenderer {
  private readonly svg: SVGSVGElement;
  private look: Look;
  private proj: Projection = project(100, 100, true);
  private w = 0;
  private h = 0;
  private readonly uid = `f${++instances}`;
  private readonly defs: SVGDefsElement;
  private readonly gBoard: SVGGElement;
  private readonly gBall: SVGGElement;
  private readonly gRing: SVGGElement;
  private readonly gPieces: SVGGElement;
  private readonly gLabel: SVGGElement;
  private readonly drawn = new Map<string, Drawn>();
  private label: { text: string; ring: boolean } = { text: '', ring: false };
  private lastBall: BattedBall | undefined;
  private settle: (() => void) | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  readonly tweens = new Tweens();

  constructor(svg: SVGSVGElement, look: Look) {
    this.svg = svg;
    this.look = look;
    svg.replaceChildren();
    this.defs = el('defs', {}, svg);
    this.gBoard = el('g', {}, svg);
    this.gBall = el('g', {}, svg);
    this.gRing = el('g', {}, svg);
    this.gPieces = el('g', {}, svg);
    this.gLabel = el('g', {}, svg);
    this.resize();
  }

  private get iso(): boolean { return this.look.style.renderer === 'iso'; }

  setLook(look: Look): void {
    this.finish();
    this.look = look;
    this.resize(true);
  }

  /** Measure the SVG and redraw everything at the new size. */
  resize(force = false): void {
    const r = this.svg.getBoundingClientRect();
    const w = Math.max(40, Math.round(r.width)), h = Math.max(40, Math.round(r.height));
    if (!force && w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.proj = project(w, h, this.iso);
    this.drawDefs();
    this.drawBoard();
    for (const d of this.drawn.values()) this.rebuild(d);
    this.sortZ();
    this.drawLabel();
    this.drawBall(this.lastBall, false, 1);
  }

  /** Show a scene as it is, no animation. */
  show(scene: Scene): void {
    this.finish();
    for (const key of [...this.drawn.keys()]) if (!scene.has(key)) this.remove(key);
    for (const p of scene.values()) {
      const d = this.drawn.get(p.key) ?? this.add(p);
      d.piece = p; d.spot = p.spot; d.side = p.side; d.opacity = 1;
      d.g.style.opacity = '1';
      d.flip.removeAttribute('transform');
      this.paint(d, p.side);
      this.place(d);
    }
    this.sortZ();
  }

  /** Play one step. Resolves when it has settled (or when `finish` cuts it short). */
  play(plan: Plan, speed: number): Promise<void> {
    this.finish();
    const s = Math.max(0.05, speed);
    this.drawBall(plan.ball, !!plan.ball, s);
    for (const t of plan.tracks) {
      const at = t.at / s, dur = Math.max(1, t.dur / s);
      switch (t.kind) {
        case 'move': {
          const d = this.drawn.get(t.key) ?? this.add(t.to);
          const from = t.path[0]!, to = t.path.at(-1)!;
          d.piece = t.to;
          if (t.dur === 0 || to === from) { d.spot = to; this.place(d); if (d.side !== t.to.side) this.flipTo(d, t.to.side, TIMING.flip / s, at); break; }
          this.tweens.add(dur, (u) => { d.spot = from + (to - from) * ease(u); this.place(d); }, () => this.sortZ(), at);
          break;
        }
        case 'score': {
          const d = this.drawn.get(t.key);
          if (!d) break;
          const from = t.path[0]!, run = Math.max(1, ((4 - from) * TIMING.perBase) / s);
          this.tweens.add(run, (u) => { d.spot = from + (4 - from) * ease(u); this.place(d); },
            () => this.fade(d, 0, TIMING.fade / s, 0, () => this.remove(t.key)), at);
          break;
        }
        case 'out': {
          const d = this.drawn.get(t.key);
          if (!d) break;
          this.tweens.add(dur, (u) => {
            d.spot = t.from + (t.toward - t.from) * 0.6 * ease(u);
            this.place(d);
            this.setOpacity(d, 1 - u);
          }, () => this.remove(t.key), at);
          break;
        }
        case 'leave': {
          const d = this.drawn.get(t.key);
          if (d) this.fade(d, 0, dur, at, () => this.remove(t.key));
          break;
        }
        case 'enter': {
          const d = this.drawn.get(t.key) ?? this.add(t.piece);
          d.piece = t.piece; d.spot = t.piece.spot;
          this.place(d);
          if (t.flipFrom) {
            this.paint(d, t.flipFrom);
            this.setOpacity(d, 1);
            this.flipTo(d, t.piece.side, dur, at);
          } else {
            this.paint(d, t.piece.side);
            this.setOpacity(d, 0);
            this.fade(d, 1, dur, at);
          }
          break;
        }
        case 'flip': {
          const d = this.drawn.get(t.key) ?? this.add(t.to);
          d.piece = t.to;
          this.flipTo(d, t.to.side, dur, at);
          break;
        }
        case 'swap': {
          const d = this.drawn.get(t.key) ?? this.add(t.to);
          this.fade(d, 0, dur / 2, at, () => { d.piece = t.to; this.paint(d, t.to.side); this.fade(d, 1, dur / 2, 0); });
          break;
        }
      }
    }
    this.sortZ();
    return new Promise((resolve) => {
      this.settle = resolve;
      this.settleTimer = setTimeout(() => this.finish(), plan.total / s + 30);
    });
  }

  /** Jump every running animation to its end and release whoever waits on `play`. */
  finish(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.tweens.finish();
    this.sortZ();
    const done = this.settle;
    this.settle = null;
    done?.();
  }

  /** Batter's name under the plate, and the ring that marks the plate appearance in progress. */
  setLabel(text: string, ring: boolean): void {
    if (text === this.label.text && ring === this.label.ring) return;
    this.label = { text, ring };
    this.drawLabel();
  }

  /** The pieces as drawn, for the self-check: key -> spot and side. */
  drawnScene(): Map<string, { spot: Spot; side: Side; id: number }> {
    return new Map([...this.drawn].map(([k, d]) => [k, { spot: d.spot, side: d.side, id: d.piece.id }]));
  }

  dispose(): void {
    this.finish();
    this.svg.replaceChildren();
    this.drawn.clear();
  }

  // ---------- drawing ----------

  private colours() {
    const { theme, board } = this.look.style;
    const clear = this.look.background === 'clear';
    return {
      theme,
      clear,
      boardFill: clear ? alpha(theme.panel, 0.72) : this.iso ? board.fill : board.fill,
      boardLine: clear ? alpha(theme.text, 0.45) : board.lines,
      foul: clear ? alpha(theme.text, 0.22) : alpha(board.lines, 0.75),
      fence: clear ? alpha(theme.text, 0.35) : alpha(board.lines, 0.85),
      base: theme.border,
      baseLine: theme.muted,
      rim: alpha(theme.text, 0.78),
    };
  }

  private drawDefs(): void {
    const { paints } = this.look;
    const parts = (['away', 'home'] as Side[]).map((s) => svgFill(paints[s], `${this.uid}-${s}`, 0).defs).join('');
    this.defs.innerHTML = parts;
  }

  private fillOf(side: Side): string {
    return svgFill(this.look.paints[side], `${this.uid}-${side}`, 0).fill;
  }

  private drawBoard(): void {
    const g = this.gBoard;
    g.replaceChildren();
    const c = this.colours();
    const P = (fx: number, fy: number) => toScreen(this.proj, fx, fy);
    const pts = [0, 1, 2, 3].map((i) => P(BASE_PATH[i]![0], BASE_PATH[i]![1]));
    const far = 420 / Math.SQRT2;
    for (const s of [1, -1]) {
      const [x, y] = P(s * far, far);
      el('line', { x1: pts[0]![0], y1: pts[0]![1], x2: x, y2: y, stroke: c.foul, 'stroke-width': 1 }, g);
    }
    if (this.iso) {
      const fence: string[] = [];
      for (let deg = -45; deg <= 45; deg += 5) {
        const r = compress(fenceFeet(deg)), a = (deg * Math.PI) / 180;
        fence.push(P(r * Math.sin(a), r * Math.cos(a)).map((v) => v.toFixed(1)).join(','));
      }
      el('polyline', { points: fence.join(' '), fill: 'none', stroke: c.fence, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }, g);
    }
    el('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: c.boardFill, stroke: c.boardLine, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, g);
    const [mx, my] = P(MOUND[0], MOUND[1]);
    const v = this.iso ? 0.5 : 1;
    el('ellipse', { cx: mx, cy: my, rx: this.proj.k * 9, ry: this.proj.k * 9 * v, fill: c.clear ? alpha(c.base, 0.8) : c.base, stroke: c.boardLine }, g);
    const bs = Math.max(3, this.proj.k * 3.2);
    for (const i of [1, 2, 3]) {
      const [x, y] = pts[i]!;
      el('polygon', { points: `${x},${y - bs * v} ${x + bs},${y} ${x},${y + bs * v} ${x - bs},${y}`, fill: c.base, stroke: c.baseLine, 'stroke-width': 1.2 }, g);
    }
    const [hx, hy] = pts[0]!;
    el('polygon', { points: `${hx - bs},${hy - bs * v} ${hx + bs},${hy - bs * v} ${hx + bs},${hy} ${hx},${hy + bs * v} ${hx - bs},${hy}`, fill: c.baseLine }, g);
  }

  private drawLabel(): void {
    this.gRing.replaceChildren();
    this.gLabel.replaceChildren();
    const c = this.colours();
    const [hx, hy] = toScreen(this.proj, 0, 0);
    if (this.label.ring) {
      const R = this.proj.r + 4;
      el('ellipse', { cx: hx, cy: hy, rx: R, ry: R * (this.iso ? 0.5 : 1), fill: 'none', stroke: c.theme.accent, 'stroke-width': 1.6 }, this.gRing);
    }
    if (!this.label.text || this.h < 70) return;
    // A small capsule like every other piece of text, so it reads on any wallpaper.
    const bg = el('rect', { rx: 7, fill: this.look.background === 'solid' ? 'transparent' : alpha(c.theme.panel, 0.88) }, this.gLabel);
    const below = this.iso ? this.proj.r * 0.5 + 4 : this.proj.r + 4; // bottom edge of the batter's piece
    const t = el('text', { x: hx, y: Math.min(this.h - 4, hy + below + 10), 'text-anchor': 'middle', 'font-size': 10, fill: c.theme.muted }, this.gLabel);
    t.textContent = this.label.text;
    try {
      const bb = t.getBBox();
      bg.setAttribute('x', String(bb.x - 6)); bg.setAttribute('y', String(bb.y - 2));
      bg.setAttribute('width', String(bb.width + 12)); bg.setAttribute('height', String(bb.height + 4));
    } catch { /* not laid out yet */ }
  }

  private drawBall(ball: BattedBall | undefined, animate: boolean, speed: number): void {
    this.lastBall = ball;
    const g = this.gBall;
    g.replaceChildren();
    if (!ball) return;
    const f = flight(ball, this.proj, this.w, this.h);
    if (!f) return;
    const c = this.colours();
    const line = (pts: [number, number][]) => `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')}`;
    if (this.iso) el('path', { d: line(f.ground), fill: 'none', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 2 }, g);
    el('path', { d: line(f.air), fill: 'none', stroke: alpha(c.theme.text, 0.6), 'stroke-width': 1.4, 'stroke-dasharray': '3 3' }, g);
    const end = f.air.at(-1)!, prev = f.air.at(-2)!;
    if (f.clipped) {
      const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0]), a = 6;
      el('path', { d: `M${end[0]},${end[1]} L${end[0] - a * Math.cos(ang - 0.5)},${end[1] - a * Math.sin(ang - 0.5)} M${end[0]},${end[1]} L${end[0] - a * Math.cos(ang + 0.5)},${end[1] - a * Math.sin(ang + 0.5)}`, stroke: alpha(c.theme.text, 0.8), 'stroke-width': 1.4, fill: 'none' }, g);
    } else {
      el('circle', { cx: end[0], cy: end[1], r: 3.5, fill: 'none', stroke: alpha(c.theme.text, 0.8), 'stroke-width': 1.2 }, g);
    }
    const dot = el('circle', { r: 3.2, fill: c.theme.out, stroke: c.theme.accent, 'stroke-width': 1.2 }, g);
    const shadow = this.iso ? el('ellipse', { rx: 3, ry: 1.5, fill: 'rgba(0,0,0,.55)' }, g) : null;
    const put = (u: number) => {
      const k = u * (f.air.length - 1), i = Math.min(f.air.length - 2, Math.floor(k)), v = k - i;
      const lerp = (A: [number, number][]) => [A[i]![0] + (A[i + 1]![0] - A[i]![0]) * v, A[i]![1] + (A[i + 1]![1] - A[i]![1]) * v];
      const p = lerp(f.air);
      dot.setAttribute('cx', String(p[0])); dot.setAttribute('cy', String(p[1]));
      if (shadow) { const q = lerp(f.ground); shadow.setAttribute('cx', String(q[0])); shadow.setAttribute('cy', String(q[1])); }
    };
    if (animate) { put(0); this.tweens.add(TIMING.flight / speed, put); } else put(1);
  }

  // ---------- pieces ----------

  private add(p: Piece): Drawn {
    const d: Drawn = { piece: p, spot: p.spot, side: p.side, g: el('g', {}), flip: el('g', {}), opacity: 1 };
    this.drawn.set(p.key, d);
    this.rebuild(d);
    return d;
  }

  private remove(key: string): void {
    const d = this.drawn.get(key);
    if (!d) return;
    d.g.remove();
    this.drawn.delete(key);
  }

  /** (Re)create a piece's shapes at the current size and style. */
  private rebuild(d: Drawn): void {
    const { piece: shape } = this.look.style;
    const c = this.colours();
    const R = this.proj.r * (shape.shape === 'dot' ? 0.7 : 1);
    const g = el('g', { 'data-key': d.piece.key });
    const flip = el('g', {}, g);
    // Several team colours are near black, so a light rim keeps them visible; always on a clear background.
    const rim: Record<string, string> = shape.rim || c.clear ? { stroke: c.rim } : {};
    if (this.iso) {
      const th = shape.shape === 'dot' ? 0 : R * shape.thickness;
      if (shape.shadow === 'soft') el('ellipse', { cx: 0, cy: 1.5, rx: R * 1.08, ry: R * 0.56, fill: 'rgba(0,0,0,.45)' }, flip);
      if (th > 0) el('path', { d: `M${-R},${-th} L${-R},0 A${R},${R * 0.5} 0 0 0 ${R},0 L${R},${-th} Z`, class: 'side', 'stroke-width': 0.8, ...rim }, flip);
      el('ellipse', { cx: 0, cy: -th, rx: R, ry: R * 0.5, class: 'top', 'stroke-width': 1.2, ...rim }, flip);
    } else {
      if (shape.shadow === 'soft') el('circle', { cx: 0.8, cy: 1.4, r: R, fill: 'rgba(0,0,0,.35)' }, flip);
      el('circle', { r: R, class: 'top', 'stroke-width': 1.5, ...rim }, flip);
    }
    g.style.opacity = String(d.opacity);
    if (d.g.parentNode) d.g.replaceWith(g); else this.gPieces.appendChild(g);
    d.g = g; d.flip = flip;
    d.label = undefined; // rebuilt with the piece, at the new size and style
    this.paint(d, d.side);
    this.place(d);
  }

  private paint(d: Drawn, side: Side): void {
    d.side = side;
    d.flip.querySelector('.top')?.setAttribute('fill', this.fillOf(side));
    d.flip.querySelector('.side')?.setAttribute('fill', shade(visualColour(this.look.paints[side]), 0.55));
  }

  private place(d: Drawn): void {
    const [fx, fy] = spotFeet(d.spot);
    const [x, y] = toScreen(this.proj, fx, fy);
    d.g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    this.placeLabel(d, fx);
  }

  /**
   * A runner's short name, above the piece (toward the open outfield). First and third sit near the
   * board's edges, so their labels grow inward: right-aligned at first, left-aligned at third.
   * Only runners: the batter has the label under the plate, the pitcher is in the capsules.
   */
  private placeLabel(d: Drawn, fx: number): void {
    const name = d.piece.role === 'runner' ? d.piece.name : undefined;
    if (!name || this.proj.r < LABEL_MIN_RADIUS || this.h < LABEL_MIN_HEIGHT) {
      d.label?.g.remove();
      d.label = undefined;
      return;
    }
    if (!d.label || d.label.name !== name) {
      d.label?.g.remove();
      const c = this.colours();
      const g = el('g', { class: 'runner-name' }, d.g);
      const rect = el('rect', { rx: 3, fill: alpha(c.theme.panel, 0.85) }, g);
      const text = el('text', { 'font-size': LABEL_FONT, fill: alpha(c.theme.text, 0.9) }, g);
      text.textContent = name;
      let w = name.length * LABEL_FONT * 0.6;
      try { w = text.getBBox().width; } catch { /* not laid out: keep the estimate */ }
      d.label = { g, rect, text, name, w };
    }
    const R = this.proj.r;
    const top = this.iso ? R * 0.5 + R * this.look.style.piece.thickness : R;
    const where = fx > 15 ? 'first' : fx < -15 ? 'third' : 'middle';
    const tx = where === 'first' ? R + 2 : where === 'third' ? -(R + 2) : 0;
    const ty = -(top + 4);
    const anchor = where === 'first' ? 'end' : where === 'third' ? 'start' : 'middle';
    const { rect, text, w } = d.label;
    text.setAttribute('x', tx.toFixed(1));
    text.setAttribute('y', ty.toFixed(1));
    text.setAttribute('text-anchor', anchor);
    const left = anchor === 'start' ? tx : anchor === 'end' ? tx - w : tx - w / 2;
    rect.setAttribute('x', (left - 3).toFixed(1));
    rect.setAttribute('y', (ty - LABEL_FONT + 1).toFixed(1));
    rect.setAttribute('width', (w + 6).toFixed(1));
    rect.setAttribute('height', String(LABEL_FONT + 3));
  }

  private setOpacity(d: Drawn, o: number): void {
    d.opacity = o;
    d.g.style.opacity = String(o);
  }

  private fade(d: Drawn, to: number, dur: number, delay: number, done?: () => void): void {
    let from = d.opacity;
    let started = false;
    this.tweens.add(dur, (u) => { if (!started) { started = true; from = d.opacity; } this.setOpacity(d, from + (to - from) * u); }, done, delay);
  }

  /** Turn a piece over like a reversi disc, changing colour at the halfway point. */
  private flipTo(d: Drawn, side: Side, dur: number, delay: number): void {
    const th = this.iso ? this.proj.r * this.look.style.piece.thickness : 0;
    let swapped = false;
    this.tweens.add(dur, (u) => {
      if (!swapped && u >= 0.5) { swapped = true; this.paint(d, side); }
      const k = Math.max(0.04, Math.abs(Math.cos(Math.PI * u)));
      d.flip.setAttribute('transform', this.iso ? `translate(0,${-th / 2}) scale(1,${k}) translate(0,${th / 2})` : `scale(${k},1)`);
    }, () => { if (!swapped) this.paint(d, side); d.flip.removeAttribute('transform'); }, delay);
  }

  private sortZ(): void {
    const ys = new Map([...this.drawn.values()].map((d) => [d, toScreen(this.proj, ...spotFeet(d.spot))[1]]));
    [...this.drawn.values()].sort((a, b) => ys.get(a)! - ys.get(b)!).forEach((d) => this.gPieces.appendChild(d.g));
  }
}
