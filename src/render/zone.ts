// The strike zone from the catcher's view, with this plate appearance's pitches numbered.
// Returns SVG markup, so it is cheap to redraw and easy to test.
//
// Marks (PRD §3.2.4): taken pitches are solid (ball blue, called strike red), a swing and miss is
// a hollow red ring, a foul a dashed red ring, a ball put in play the out colour. The newest pitch
// gets an accent ring. Balls are drawn about 1.2 times real size, so the centre is the location.

import type { PitchMark } from '../model/types.ts';
import type { StyleManifest } from '../styles/manifest.ts';
import { alpha } from './colour.ts';

type Theme = StyleManifest['theme'];

export interface ZoneOptions {
  w: number;
  h: number;
  iso: boolean;
  theme: Theme;
  /** Which side the batter stands on, and its label ("右打"). */
  batter?: { side: 'L' | 'R'; label: string } | undefined;
  /** Animate the newest pitch in. */
  popLast: boolean;
  /** Shown when the pitches have no location (older games). */
  noData: string;
}

export type PitchMarkKind = 'solid' | 'ring' | 'dashed';

/** How a pitch is drawn: its colour, and whether the dot is solid, a ring (swing and miss) or dashed (foul). */
export function pitchMark(call: PitchMark['call'], theme: Theme): { colour: string; kind: PitchMarkKind } {
  switch (call) {
    case 'ball': case 'hitByPitch': return { colour: theme.ball, kind: 'solid' };
    case 'calledStrike': return { colour: theme.strike, kind: 'solid' };
    case 'swingingStrike': return { colour: theme.strike, kind: 'ring' };
    case 'foul': return { colour: theme.strike, kind: 'dashed' };
    case 'inPlay': return { colour: theme.out, kind: 'solid' };
    default: return { colour: theme.muted, kind: 'solid' };
  }
}

/** Kept for callers that only need a colour. */
export const pitchColour = (call: PitchMark['call'], theme: Theme) => pitchMark(call, theme).colour;

/** Real baseball radius in feet (2.9 in diameter), drawn a little larger so the number fits. */
const BALL_RADIUS_FT = 0.145;
/** What the panel shows, feet: either side of the plate's centre, and from the knees' lower edge up
 *  past the letters. Pitches outside sit on the edge. */
const HALF_SPAN = 1.7, Z_LOW = 0.5, Z_HIGH = 4.2;
/** Smallest dot that still holds a readable number, px. */
const MIN_RADIUS = 4.5;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function zoneSvg(atBat: readonly PitchMark[], o: ZoneOptions): string {
  const { w: W, h: H, theme } = o;
  if (W < 30 || H < 30) return '';
  const out: string[] = [];
  const f = (n: number) => n.toFixed(1);
  const s = Math.min((W - 8) / (2 * HALF_SPAN), (H - 10) / (Z_HIGH - Z_LOW));
  const cx = W / 2, gy = H - 6;
  const X = (x: number) => cx + x * s, Y = (z: number) => gy - (z - Z_LOW) * s;
  const withZone = [...atBat].reverse().find((p) => p.szTop !== undefined && p.szBottom !== undefined);
  const top = withZone?.szTop ?? 3.4, bot = withZone?.szBottom ?? 1.6;
  const hw = 17 / 24; // half the plate, feet

  // Batter's box: chalk on the ground on the batter's side (catcher's view: a right-handed
  // batter stands on the left), with a small label. Not a standing figure.
  if (o.batter) {
    const side = o.batter.side === 'L' ? 1 : -1;
    const inner = X(side * (hw + 0.5)), outer = side > 0 ? W - 3 : 3;
    const lean = o.iso ? 3 * side : 0;
    const y0 = gy, y1 = gy - (o.iso ? 9 : 7);
    out.push(`<path d="M${f(inner)},${f(y0)} L${f(outer)},${f(y0)} L${f(outer - lean)},${f(y1)} L${f(inner + lean)},${f(y1)} Z" fill="none" stroke="${alpha(theme.accent, 0.5)}" stroke-width="1"/>`);
    out.push(`<text x="${f((inner + outer) / 2)}" y="${f(y1 - 3)}" text-anchor="middle" font-size="9" fill="${theme.accent}">${esc(o.batter.label)}</text>`);
  }

  // The zone, the plate, and in 2.5D the zone's back face.
  if (o.iso) {
    const vy = Y(top + 2.2), sh = 0.86;
    const back = (x: number, z: number) => [cx + (X(x) - cx) * sh, vy + (Y(z) - vy) * sh] as const;
    const corners = [[-hw, bot], [hw, bot], [hw, top], [-hw, top]] as const;
    out.push(`<polygon points="${corners.map(([x, z]) => back(x, z).map(f).join(',')).join(' ')}" fill="none" stroke="${alpha(theme.text, 0.22)}"/>`);
    for (const [x, z] of corners) {
      const b = back(x, z);
      out.push(`<line x1="${f(X(x))}" y1="${f(Y(z))}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${alpha(theme.text, 0.18)}"/>`);
    }
    out.push(`<path d="M${f(X(-hw))},${f(gy - 1)} L${f(X(hw))},${f(gy - 1)} L${f(X(hw))},${f(gy - 3.5)} L${f(cx)},${f(gy - 7.5)} L${f(X(-hw))},${f(gy - 3.5)} Z" fill="${alpha(theme.text, 0.85)}"/>`);
  } else {
    out.push(`<rect x="${f(X(-hw))}" y="${f(gy - 3)}" width="${f(2 * hw * s)}" height="3" fill="${alpha(theme.text, 0.85)}"/>`);
  }
  out.push(`<rect x="${f(X(-hw))}" y="${f(Y(top))}" width="${f(2 * hw * s)}" height="${f((top - bot) * s)}" fill="${alpha(theme.text, 0.04)}" stroke="${alpha(theme.text, 0.72)}" stroke-width="1.2"/>`);
  const faint = alpha(theme.text, 0.16);
  for (const k of [1, 2]) {
    const x = X(-hw + (2 * hw * k) / 3), z = Y(bot + ((top - bot) * k) / 3);
    out.push(`<line x1="${f(x)}" x2="${f(x)}" y1="${f(Y(top))}" y2="${f(Y(bot))}" stroke="${faint}" stroke-dasharray="2 3"/>`);
    out.push(`<line x1="${f(X(-hw))}" x2="${f(X(hw))}" y1="${f(z)}" y2="${f(z)}" stroke="${faint}" stroke-dasharray="2 3"/>`);
  }

  const located = atBat.filter((p) => p.x !== undefined && p.z !== undefined);
  if (!located.length && atBat.length) {
    out.push(`<text x="${f(cx)}" y="${f(H / 2)}" text-anchor="middle" font-size="10" fill="${theme.muted}">${esc(o.noData)}</text>`);
  }
  const r = Math.max(MIN_RADIUS, BALL_RADIUS_FT * s);
  const font = Math.max(6.5, r * 1.45);
  located.forEach((p, i) => {
    const last = i === located.length - 1;
    // Far-off pitches sit on the edge, so the panel never loses one.
    const x = Math.max(r + 1, Math.min(W - r - 1, X(p.x!))), y = Math.max(r + 1, Math.min(gy - r - 1, Y(p.z!)));
    const m = pitchMark(p.call, theme);
    const parts: string[] = [];
    if (o.iso) parts.push(`<ellipse cx="0" cy="${f(gy - 2 - y)}" rx="${f(r * 0.6)}" ry="${f(r * 0.22)}" fill="rgba(0,0,0,.45)"/>`);
    if (last) parts.push(`<circle r="${f(r + 2.4)}" fill="none" stroke="${theme.accent}" stroke-width="1.4"/>`);
    if (m.kind === 'solid') {
      parts.push(`<circle r="${f(r)}" fill="${m.colour}"/>`);
    } else {
      const dash = m.kind === 'dashed' ? ` stroke-dasharray="${f(r * 0.5)} ${f(r * 0.32)}"` : '';
      parts.push(`<circle r="${f(r - 0.7)}" fill="${theme.panel}" stroke="${m.colour}" stroke-width="1.4"${dash}/>`);
    }
    parts.push(`<text y="${f(font * 0.36)}" text-anchor="middle" font-size="${f(font)}" font-weight="600" fill="${m.kind === 'solid' ? theme.background : m.colour}" class="mono">${p.n}</text>`);
    out.push(`<g transform="translate(${f(x)},${f(y)})" data-pitch="${p.n}" data-mark="${m.kind}"${last ? '' : ' opacity="0.9"'}><g${last && o.popLast ? ' class="pop"' : ''}>${parts.join('')}</g></g>`);
  });
  return out.join('');
}
