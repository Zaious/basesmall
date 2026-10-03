// What the main window should show for the user's team right now (ARCHITECTURE 4.2.1, PRD §3.3).
// Input is one schedule request for the team (ten days back, twenty ahead). Pure.
// Never switches mid-game: the caller only asks again when nothing is being followed, or when the
// game on screen has ended.

import { isLive, isUpcoming, sideOf, type GameCard } from '../data/mlb/schedule.ts';

export type Decision =
  /** The team is playing now: follow it. */
  | { kind: 'live'; game: GameCard }
  /** A game later today: countdown and probable starters. */
  | { kind: 'today'; game: GameCard; last?: GameCard }
  /** No game today: when and against whom the next one is. */
  | { kind: 'next'; game: GameCard; last?: GameCard }
  /**
   * No more games scheduled. `eliminated`: lost a postseason series. `missed`: the regular season
   * ended without a postseason. `champion`: won the World Series. `advanced`: won a series and the
   * next round is not on the schedule yet.
   */
  | { kind: 'over'; how: 'eliminated' | 'missed' | 'champion' | 'advanced'; last: GameCard }
  /** Nothing in the window at all (the offseason). */
  | { kind: 'none' };

export function decide(teamId: number, cards: readonly GameCard[], today: string): Decision {
  const mine = cards.filter((c) => sideOf(c, teamId)).sort((a, b) => a.start - b.start);
  const live = mine.find(isLive);
  if (live) return { kind: 'live', game: live };
  const last = [...mine].reverse().find((c) => c.status === 'final');
  const next = mine.find((c) => isUpcoming(c));
  const withLast = last ? { last } : {};
  if (next) return next.officialDate === today ? { kind: 'today', game: next, ...withLast } : { kind: 'next', game: next, ...withLast };
  if (!last) return { kind: 'none' };
  if (!last.postseason) return { kind: 'over', how: 'missed', last };
  const side = sideOf(last, teamId)!;
  const s = last.series;
  if (s?.over && s.winner && s.winner !== side) return { kind: 'over', how: 'eliminated', last };
  if (s?.over && s.winner === side) return { kind: 'over', how: last.gameType === 'W' ? 'champion' : 'advanced', last };
  // A postseason game that left the series open, and nothing scheduled: treat as waiting.
  return { kind: 'over', how: 'advanced', last };
}

/** A key that changes once per season and team, so the elimination card shows only once. */
export const seasonKey = (teamAbbr: string, card: GameCard) => `${card.officialDate.slice(0, 4)}:${teamAbbr}`;
