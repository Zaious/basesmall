// The strike zone from the catcher's view, with this plate appearance's pitches numbered.
// Returns SVG markup, so it is cheap to redraw and easy to test.

import type { Hand, PitchMark } from '../model/types.ts';
import type { StyleManifest } from '../styles/manifest.ts';
import { alpha } from './colour.ts';

export interface ZoneOptions {
  w: number;
  h: number;
  iso: boolean;
  theme: StyleManifest['theme'];
  batterSide?: Hand | undefined;
  /** Animate the newest pitch in. */
  popLast: boolean;
  /** Shown when the pitches have no location (older games). */
  noData: string;
}

/** Colour of a pitch dot: balls, things put in play, and everything that counts as a strike. */
export function pitchColour(call: PitchMark['call'], theme: StyleManifest['theme']): string {
  return call === 'ball' || call === 'hitByPitch' ? theme.ball : call === 'inPlay' ? theme.out : theme.strike;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function zoneSvg(atBat: readonly PitchMark[], o: ZoneOptions): string {
  const { w: W, h: H, theme } = o;
  if (W < 30 || H < 30) return '';
  const out: string[] = [];
  const line = alpha(theme.text, 0.72), faint = alpha(theme.text, 0.16);
  const s = Math.min((W - 10) / 4.2, (H - 12) / 4.9);
  const cx = W / 2, gy = H - 8;
  const withZone = [...atBat].reverse().find((p) => p.szTop !== undefined && p.szBottom !== undefined);
  const top = withZone?.szTop ?? 3.4, bot = withZone?.szBottom ?? 1.6;
  const hw = 17 / 24; // half the plate, feet
  const X = (x: number) => cx + x * s, Y = (z: number) => gy - z * s;
  const f = (n: number) => n.toFixed(1);

  // Batter's box. Catcher's view: a right-handed batter stands on the left.
  if (o.batterSide) {
    const bx = X((o.batterSide === 'L' ? 1 : -1) * 1.55);
    out.push(`<rect x="${f(bx - 0.32 * s)}" y="${f(Y(4.3))}" width="${f(0.64 * s)}" height="${f(4.3 * s)}" rx="4" fill="${alpha(theme.accent, 0.08)}" stroke="${alpha(theme.accent, 0.5)}"/>`);
    out.push(`<text x="${f(bx)}" y="${f(Y(2.5))}" text-anchor="middle" font-size="${f(Math.max(10, s * 0.5))}" font-weight="600" fill="${theme.accent}" class="mono">${o.batterSide}</text>`);
  }
  if (o.iso) {
    out.push(`<path d="M${f(X(-2.3))},${f(gy)} L${f(X(2.3))},${f(gy)} L${f(X(2))},${f(gy - 0.5 * s)} L${f(X(-2))},${f(gy - 0.5 * s)} Z" fill="${alpha(theme.text, 0.03)}"/>`);
    const vy = Y(top + 2.2), sh = 0.86;
    const back = (x: number, z: number) => [cx + (X(x) - cx) * sh, vy + (Y(z) - vy) * sh] as const;
    const corners = [[-hw, bot], [hw, bot], [hw, top], [-hw, top]] as const;
    out.push(`<polygon points="${corners.map(([x, z]) => back(x, z).map(f).join(',')).join(' ')}" fill="none" stroke="${alpha(theme.text, 0.25)}"/>`);
    for (const [x, z] of corners) {
      const b = back(x, z);
      out.push(`<line x1="${f(X(x))}" y1="${f(Y(z))}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${alpha(theme.text, 0.2)}"/>`);
    }
    out.push(`<path d="M${f(X(-hw))},${f(gy - 2)} L${f(X(hw))},${f(gy - 2)} L${f(X(hw))},${f(gy - 0.18 * s)} L${f(cx)},${f(gy - 0.36 * s)} L${f(X(-hw))},${f(gy - 0.18 * s)} Z" fill="${alpha(theme.text, 0.85)}"/>`);
  } else {
    out.push(`<line x1="4" x2="${W - 4}" y1="${f(gy)}" y2="${f(gy)}" stroke="${theme.border}"/>`);
    out.push(`<rect x="${f(X(-hw))}" y="${f(gy - 3)}" width="${f(2 * hw * s)}" height="4" fill="${alpha(theme.text, 0.85)}"/>`);
  }
  out.push(`<rect x="${f(X(-hw))}" y="${f(Y(top))}" width="${f(2 * hw * s)}" height="${f((top - bot) * s)}" fill="${alpha(theme.text, 0.04)}" stroke="${line}" stroke-width="1.4"/>`);
  for (const k of [1, 2]) {
    const x = X(-hw + (2 * hw * k) / 3), z = Y(bot + ((top - bot) * k) / 3);
    out.push(`<line x1="${f(x)}" x2="${f(x)}" y1="${f(Y(top))}" y2="${f(Y(bot))}" stroke="${faint}" stroke-dasharray="2 3"/>`);
    out.push(`<line x1="${f(X(-hw))}" x2="${f(X(hw))}" y1="${f(z)}" y2="${f(z)}" stroke="${faint}" stroke-dasharray="2 3"/>`);
  }

  const located = atBat.filter((p) => p.x !== undefined && p.z !== undefined);
  if (!located.length && atBat.length) {
    out.push(`<text x="${f(cx)}" y="${f(H / 2)}" text-anchor="middle" font-size="10" fill="${theme.muted}">${esc(o.noData)}</text>`);
  }
  const rad = Math.max(5, Math.min(8, s * 0.2));
  located.forEach((p, i) => {
    const last = i === located.length - 1;
    const x = Math.max(rad, Math.min(W - rad, X(p.x!))), y = Math.max(rad, Math.min(gy - rad, Y(p.z!)));
    const parts: string[] = [];
    if (o.iso) parts.push(`<ellipse cx="0" cy="${f(gy - 3 - y)}" rx="${f(rad * 0.7)}" ry="${f(rad * 0.25)}" fill="rgba(0,0,0,.5)"/>`);
    if (last) parts.push(`<circle r="${f(rad + 2.5)}" fill="none" stroke="${theme.accent}" stroke-width="1.5"/>`);
    parts.push(`<circle r="${f(rad)}" fill="${pitchColour(p.call, theme)}"${last ? '' : ' opacity="0.88"'}/>`);
    if (rad >= 6) parts.push(`<text y="3" text-anchor="middle" font-size="9" font-weight="600" fill="${theme.background}" class="mono">${p.n}</text>`);
    out.push(`<g transform="translate(${f(x)},${f(y)})" data-pitch="${p.n}"><g${last && o.popLast ? ' class="pop"' : ''}>${parts.join('')}</g></g>`);
  });
  return out.join('');
}
