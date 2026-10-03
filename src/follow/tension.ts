// How tense a live game is, from one schedule request with linescores (PRD §3.3): the later the
// inning and the closer the score, the more; runners on, the postseason and a game that can end a
// series add to it. Used to pick "the most tense game" and to point out another game's big moment.

import { isLive, type GameCard } from '../data/mlb/schedule.ts';

const CLOSENESS = [1, 0.8, 0.55, 0.3];

export function tension(c: GameCard): number {
  if (!isLive(c) || !c.inning) return 0;
  const diff = Math.abs((c.away.runs ?? 0) - (c.home.runs ?? 0));
  // The bottom half of an inning is a little later in the game than its top.
  const progress = c.inning + (c.half === 'bottom' ? 0.5 : 0);
  const late = progress >= 9 ? 1 + 0.12 * (progress - 9) : progress / 9;
  const close = CLOSENESS[diff] ?? 0.1;
  const runners = 1 + 0.08 * (c.bases?.length ?? 0);
  const post = c.postseason ? 1.2 : 1;
  const s = c.series;
  const need = s ? Math.floor(s.of / 2) + 1 : 0;
  const decisive = s && (s.wins.away === need - 1 || s.wins.home === need - 1) ? 1.15 : 1;
  return late * close * runners * post * decisive;
}

/** The most tense live game, if any is live. */
export function mostTense(cards: readonly GameCard[], exclude?: number): GameCard | undefined {
  let best: GameCard | undefined, score = 0;
  for (const c of cards) {
    if (c.gamePk === exclude) continue;
    const t = tension(c);
    if (t > score) { best = c; score = t; }
  }
  return best;
}

/** A moment worth a bubble while watching another game: eighth inning or later, within a run. */
export function isBigMoment(c: GameCard): boolean {
  if (!isLive(c) || !c.inning || c.inning < 8) return false;
  return Math.abs((c.away.runs ?? 0) - (c.home.runs ?? 0)) <= 1;
}
