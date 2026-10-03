// MLB schedule -> game cards: one game's who, when, score, situation and series. Used by the
// scoreboard, the game list, following the user's team, and the postseason view. Pure.
// Fields verified against real responses: scripts/probe/11-postseason.mjs (2026-10-03).

import type { Base, GameStatus, Half, Side } from '../../model/types.ts';
import { mapStatus } from './codes.ts';

/** The schedule endpoint, as far as we read it (hydrate=team,linescore,seriesStatus,probablePitcher). */
export interface MlbScheduleGame {
  gamePk: number;
  gameType?: string;
  gameDate: string;
  officialDate: string;
  status: { abstractGameState?: string; codedGameState?: string; detailedState?: string };
  teams: Record<Side, {
    team: { id: number; abbreviation?: string; name: string };
    score?: number;
    isWinner?: boolean;
    probablePitcher?: { id: number; fullName: string; lastName?: string };
  }>;
  linescore?: {
    currentInning?: number;
    isTopInning?: boolean;
    outs?: number;
    offense?: { first?: unknown; second?: unknown; third?: unknown };
  };
  seriesStatus?: {
    gameNumber?: number; totalGames?: number; wins?: number; losses?: number;
    isTied?: boolean; isOver?: boolean; shortName?: string; shortDescription?: string; result?: string;
    winningTeam?: { id: number }; losingTeam?: { id: number };
  };
}
export interface MlbSchedule { dates?: { date: string; games: MlbScheduleGame[] }[] }

export interface CardTeam {
  id: number;
  abbr: string;
  name: string;
  runs?: number;
  /** Probable starter's short name, before the game. */
  probable?: string;
}

export interface Series {
  /** MLB's short name: "ALDS", "NL Wild Card Series". Display labels come from i18n. */
  name: string;
  /** 'AL', 'NL', or '' for the World Series. */
  league: 'AL' | 'NL' | '';
  game: number;
  of: number;
  /** Wins by side, from the series status (after this game when it is final). */
  wins: Record<Side, number>;
  over: boolean;
  /** The side that won the series, once it is over. */
  winner?: Side;
}

export interface GameCard {
  gamePk: number;
  /** R regular season, F Wild Card, D Division Series, L League Championship, W World Series, S spring. */
  gameType: string;
  postseason: boolean;
  /** US Eastern date the game belongs to. */
  officialDate: string;
  /** Scheduled first pitch, epoch ms. */
  start: number;
  status: GameStatus;
  detail?: string;
  away: CardTeam;
  home: CardTeam;
  inning?: number;
  half?: Half;
  outs?: number;
  /** Occupied bases, when the schedule says (live games only). */
  bases?: Base[];
  series?: Series;
}

const POSTSEASON = new Set(['F', 'D', 'L', 'W']);

export function cardOf(g: MlbScheduleGame): GameCard {
  const status = mapStatus(g.status);
  const team = (side: Side): CardTeam => {
    const t = g.teams[side];
    return {
      id: t.team.id, abbr: t.team.abbreviation ?? '?', name: t.team.name,
      ...(t.score !== undefined ? { runs: t.score } : {}),
      ...(t.probablePitcher ? { probable: t.probablePitcher.lastName ?? t.probablePitcher.fullName.split(' ').at(-1)! } : {}),
    };
  };
  const away = team('away'), home = team('home');
  const ls = g.linescore;
  const card: GameCard = {
    gamePk: g.gamePk,
    gameType: g.gameType ?? 'R',
    postseason: POSTSEASON.has(g.gameType ?? ''),
    officialDate: g.officialDate,
    start: Date.parse(g.gameDate),
    status,
    ...(g.status.detailedState ? { detail: g.status.detailedState } : {}),
    away, home,
  };
  if (ls?.currentInning && status !== 'scheduled' && status !== 'pregame') {
    card.inning = ls.currentInning;
    card.half = ls.isTopInning ? 'top' : 'bottom';
    if (ls.outs !== undefined) card.outs = ls.outs;
    if (ls.offense) card.bases = (['first', 'second', 'third'] as const).filter((b) => ls.offense![b]).map((b) => ({ first: '1B', second: '2B', third: '3B' } as const)[b]);
  }
  const ss = g.seriesStatus;
  if (card.postseason && ss?.gameNumber && ss.totalGames) {
    // The status gives the leader's wins and losses; who leads is in winningTeam / losingTeam.
    const lead: Side | undefined = ss.winningTeam?.id === away.id ? 'away' : ss.winningTeam?.id === home.id ? 'home' : undefined;
    const w = ss.wins ?? 0, l = ss.losses ?? 0;
    const wins: Record<Side, number> = lead === 'away' ? { away: w, home: l } : lead === 'home' ? { away: l, home: w } : { away: w, home: w };
    const name = ss.shortName ?? '';
    card.series = {
      name, league: /^AL/.test(name) ? 'AL' : /^NL/.test(name) ? 'NL' : '',
      game: ss.gameNumber, of: ss.totalGames, wins, over: !!ss.isOver,
      ...(ss.isOver && lead ? { winner: lead } : {}),
    };
  }
  return card;
}

export function cardsOf(s: MlbSchedule): GameCard[] {
  return (s.dates ?? []).flatMap((d) => d.games).map(cardOf);
}

/** Games in progress (the scoreboard's and the tension pick's pool). */
export const isLive = (c: GameCard) => c.status === 'live' || c.status === 'delayed' || c.status === 'review';
export const isUpcoming = (c: GameCard) => c.status === 'scheduled' || c.status === 'pregame';
export const sideOf = (c: GameCard, teamId: number): Side | undefined => (c.away.id === teamId ? 'away' : c.home.id === teamId ? 'home' : undefined);
