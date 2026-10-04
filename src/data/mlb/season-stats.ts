// Regular-season totals for the players in one game, for the hover card in the postseason (the box
// score then carries postseason totals only). One request per game: /people with a stats hydrate.
// Checked 2026-10-04 on 640 players: one split per player and group; a player who changed teams has
// one split per team plus a combined one first, the only one with numTeams. The fields filter cut a
// 52-player game from 133,061 bytes to 12,623 and keeps numTeams.

import type { Totals } from '../../model/types.ts';

const FIELDS = 'people,id,stats,group,displayName,splits,numTeams,stat,atBats,avg,homeRuns,rbi,ops,gamesPlayed,era,inningsPitched,strikeOuts,wins,losses';

/** The statsapi path (for FetchJson). */
export function seasonStatsPath(ids: readonly number[], season: string): string {
  return `/api/v1/people?personIds=${ids.join(',')}&hydrate=stats(group=[hitting,pitching],type=[season],season=${season},gameType=R)&fields=${FIELDS}`;
}

interface Split {
  numTeams?: number;
  stat?: {
    atBats?: number; avg?: string; homeRuns?: number; rbi?: number; ops?: string;
    gamesPlayed?: number; era?: string; inningsPitched?: string; strikeOuts?: number; wins?: number; losses?: number;
  };
}
interface PeopleResponse {
  people?: { id: number; stats?: { group?: { displayName?: string }; splits?: Split[] }[] }[];
}

/** Totals by player id. A player with no regular-season games is left out. */
export function seasonTotals(json: unknown): Record<number, Totals> {
  const out: Record<number, Totals> = {};
  for (const p of (json as PeopleResponse)?.people ?? []) {
    const t: Totals = { kind: 'season' };
    for (const g of p.stats ?? []) {
      const splits = g.splits ?? [];
      const s = (splits.find((x) => x.numTeams) ?? splits[0])?.stat;
      if (!s) continue;
      if (g.group?.displayName === 'hitting' && (s.atBats ?? 0) > 0) {
        t.batting = { avg: s.avg, hr: s.homeRuns, rbi: s.rbi, ops: s.ops, ab: s.atBats };
      } else if (g.group?.displayName === 'pitching' && (s.gamesPlayed ?? 0) > 0) {
        t.pitching = { era: s.era, ip: s.inningsPitched, k: s.strikeOuts, w: s.wins, l: s.losses };
      }
    }
    if (t.batting || t.pitching) out[p.id] = t;
  }
  return out;
}
