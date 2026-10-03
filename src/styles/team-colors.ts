// Piece paint for a matchup. Pieces always use team colours, or a team's simple pattern
// (pinstripes). When the two read as the same colour, the user's own team keeps its look and
// the other side switches to its alternate colour.

import table from '../../styles/team-colors/mlb.json' with { type: 'json' };
import type { Side } from '../model/types.ts';

export interface Pinstripe { kind: 'pinstripe'; base: string; stripe: string }
/** A solid colour, or a pattern with a solid fallback for places that cannot draw one. */
export interface Paint { color: string; pattern?: Pinstripe }

interface TeamColour { piece: string; alt: string; pattern?: Pinstripe }
const TEAMS = (table as unknown as { teams: Record<string, TeamColour> }).teams;
const FALLBACK: Record<Side, TeamColour> = {
  away: { piece: '#9AA0AA', alt: '#5A606B' },
  home: { piece: '#5A606B', alt: '#9AA0AA' },
};
/** OKLab distance below which two pieces read as the same team. */
export const CLASH_DISTANCE = 0.12;

/** What a piece looks like from a distance: a pattern's base colour, else its colour. */
export const visualColour = (p: Paint) => p.pattern?.base ?? p.color;

export function teamPaint(abbr: string): Paint {
  const t = TEAMS[abbr];
  if (!t) return { color: FALLBACK.away.piece };
  return t.pattern ? { color: t.piece, pattern: t.pattern } : { color: t.piece };
}

export function piecePaints(away: string, home: string, favourite?: string): Record<Side, Paint> {
  const a = TEAMS[away] ?? FALLBACK.away;
  const h = TEAMS[home] ?? FALLBACK.home;
  const own = (abbr: string, t: TeamColour): Paint => (TEAMS[abbr] ? teamPaint(abbr) : { color: t.piece });
  const pa = own(away, a), ph = own(home, h);
  if (oklabDistance(visualColour(pa), visualColour(ph)) >= CLASH_DISTANCE) return { away: pa, home: ph };
  if (favourite === away) return { away: pa, home: { color: h.alt } };
  return { away: { color: a.alt }, home: ph }; // home team's own look wins when neither is the favourite
}

/** The colour each side reads as; kept for callers that only need a colour. */
export function pieceColours(away: string, home: string, favourite?: string): Record<Side, string> {
  const p = piecePaints(away, home, favourite);
  return { away: visualColour(p.away), home: visualColour(p.home) };
}

/** CSS background for a small round mark. Pinstripes: a 1 px stripe every 3 px, readable down to 9 px. */
export function cssFill(p: Paint): string {
  if (p.pattern?.kind === 'pinstripe') {
    return `repeating-linear-gradient(90deg, ${p.pattern.base} 0 2px, ${p.pattern.stripe} 2px 3px)`;
  }
  return p.color;
}

/** SVG fill and the <pattern> it needs. `id` must be unique in the document. */
export function svgFill(p: Paint, id: string): { defs: string; fill: string } {
  if (p.pattern?.kind !== 'pinstripe') return { defs: '', fill: p.color };
  const { base, stripe } = p.pattern;
  // Shapes are often rotated (base diamonds); rotate the pattern back so stripes stay vertical.
  return {
    defs: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(-45)"><rect width="3" height="3" fill="${base}"/><rect width="1" height="3" fill="${stripe}"/></pattern>`,
    fill: `url(#${id})`,
  };
}

export function oklabDistance(x: string, y: string): number {
  const a = oklab(x), b = oklab(y);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
