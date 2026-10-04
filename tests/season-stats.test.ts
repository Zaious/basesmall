import { describe, expect, it } from 'vitest';
import { seasonStatsPath, seasonTotals } from '../src/data/mlb/season-stats.ts';

// Shaped like the responses checked on 2026-10-04 (with the fields filter): one split per group, or
// for a player who changed teams the combined split first, the only one carrying numTeams.
const response = {
  people: [
    { id: 1, stats: [{ group: { displayName: 'hitting' }, splits: [{ stat: { gamesPlayed: 66, atBats: 237, avg: '.241', homeRuns: 18, rbi: 40, ops: '.871' } }] }] },
    { id: 2, stats: [{ group: { displayName: 'hitting' }, splits: [
      { stat: { gamesPlayed: 140, atBats: 484, avg: '.221', homeRuns: 12, rbi: 40, ops: '.636' }, numTeams: 2 },
      { stat: { gamesPlayed: 41, atBats: 151, avg: '.172', homeRuns: 5, rbi: 14, ops: '.535' } },
      { stat: { gamesPlayed: 99, atBats: 333, avg: '.243', homeRuns: 7, rbi: 26, ops: '.682' } },
    ] }] },
    { id: 3, stats: [{ group: { displayName: 'pitching' }, splits: [{ stat: { gamesPlayed: 22, era: '3.40', inningsPitched: '130.1', strikeOuts: 131, wins: 9, losses: 6 } }] }] },
    { id: 4 },
    { id: 5, stats: [{ group: { displayName: 'hitting' }, splits: [{ stat: { gamesPlayed: 3, atBats: 0 } }] }] },
  ],
};

describe('regular-season totals', () => {
  it('maps hitting and pitching, takes the combined line for a player who changed teams', () => {
    const t = seasonTotals(response);
    expect(t[1]).toEqual({ kind: 'season', batting: { avg: '.241', hr: 18, rbi: 40, ops: '.871', ab: 237 } });
    expect(t[2]?.batting?.ab).toBe(484);
    expect(t[3]).toEqual({ kind: 'season', pitching: { era: '3.40', ip: '130.1', k: 131, w: 9, l: 6 } });
  });

  it('leaves out a player with no regular-season line, and survives a broken response', () => {
    const t = seasonTotals(response);
    expect(t).not.toHaveProperty('4');
    expect(t).not.toHaveProperty('5');
    expect(seasonTotals(null)).toEqual({});
    expect(seasonTotals({ people: 'x' })).toEqual({});
  });

  it('one request for the whole game, filtered to the fields it reads', () => {
    const path = seasonStatsPath([1, 2, 3], '2026');
    expect(path).toMatch(/^\/api\/v1\/people\?personIds=1,2,3&/);
    expect(path).toContain('season=2026,gameType=R');
    expect(path).toContain('&fields=');
    expect(path).toContain('numTeams');
  });
});
