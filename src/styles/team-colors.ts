// Piece colours for a matchup. Pieces always use team colours; when the two are too close,
// the user's own team keeps its colour and the other side switches to its alternate.

import table from '../../styles/team-colors/mlb.json' with { type: 'json' };
import type { Side } from '../model/types.ts';

interface TeamColour { piece: string; alt: string }
const TEAMS = (table as { teams: Record<string, TeamColour> }).teams;
const FALLBACK: Record<Side, TeamColour> = {
  away: { piece: '#9AA0AA', alt: '#5A606B' },
  home: { piece: '#5A606B', alt: '#9AA0AA' },
};
/** OKLab distance below which two piece colours read as the same team. */
export const CLASH_DISTANCE = 0.12;

export function pieceColours(away: string, home: string, favourite?: string): Record<Side, string> {
  const a = TEAMS[away] ?? FALLBACK.away;
  const h = TEAMS[home] ?? FALLBACK.home;
  if (oklabDistance(a.piece, h.piece) >= CLASH_DISTANCE) return { away: a.piece, home: h.piece };
  if (favourite === away) return { away: a.piece, home: h.alt };
  return { away: a.alt, home: h.piece }; // home team's own colour wins when neither is the favourite
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
