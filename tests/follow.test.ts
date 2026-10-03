import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardsOf, type GameCard, type MlbSchedule } from '../src/data/mlb/schedule.ts';
import { decide } from '../src/follow/decide.ts';
import { isBigMoment, mostTense, tension } from '../src/follow/tension.ts';

const fx = (name: string) => `fixtures/mlb/${name}.json`;
const has = (name: string) => existsSync(fx(name));
const load = (name: string) => cardsOf(JSON.parse(readFileSync(fx(name), 'utf8')) as MlbSchedule);

describe.skipIf(!has('schedule-2026-10-03'))('schedule cards (recorded 2026-10-03)', () => {
  it('reads the Division Series day: types, series, starters', () => {
    const cards = load('schedule-2026-10-03');
    expect(cards).toHaveLength(4);
    const nyy = cards.find((c) => c.away.abbr === 'NYY')!;
    expect(nyy).toMatchObject({ gamePk: 849835, gameType: 'D', postseason: true, status: 'scheduled', home: { abbr: 'TB', probable: 'Rasmussen' }, away: { probable: 'Cole' } });
    expect(nyy.series).toEqual({ name: 'ALDS', league: 'AL', game: 1, of: 5, wins: { away: 0, home: 0 }, over: false });
    expect(nyy.inning).toBeUndefined();
  });

  it.skipIf(!has('team-143-2026-10-03'))('a finished series knows who won it', () => {
    const g3 = load('team-143-2026-10-03').find((c) => c.gamePk === 849844)!;
    expect(g3.series).toMatchObject({ name: 'NL Wild Card Series', game: 3, over: true, winner: 'home', wins: { away: 1, home: 2 } });
  });
});

describe('following the user\'s team', () => {
  it.skipIf(!has('team-147-2026-10-03'))('NYY on 2026-10-03: ALDS Game 1 later today, the Wild Card clincher as the last game', () => {
    const d = decide(147, load('team-147-2026-10-03'), '2026-10-03');
    expect(d.kind).toBe('today');
    if (d.kind !== 'today') return;
    expect(d.game.gamePk).toBe(849835);
    expect(d.last?.gamePk).toBe(849848);
  });

  it.skipIf(!has('team-147-2026-10-03'))('the day after: the next game, not today', () => {
    const cards = load('team-147-2026-10-03').map((c) => (c.gamePk === 849835 ? { ...c, status: 'final' as const } : c));
    const d = decide(147, cards, '2026-10-04');
    expect(d).toMatchObject({ kind: 'next', game: { gamePk: 849839 }, last: { gamePk: 849835 } });
  });

  it.skipIf(!has('team-143-2026-10-03'))('PHI lost the Wild Card: eliminated', () => {
    expect(decide(143, load('team-143-2026-10-03'), '2026-10-03')).toMatchObject({ kind: 'over', how: 'eliminated', last: { gamePk: 849844 } });
  });

  it.skipIf(!has('team-108-2026-10-03'))('LAA missed the postseason', () => {
    expect(decide(108, load('team-108-2026-10-03'), '2026-10-03')).toMatchObject({ kind: 'over', how: 'missed' });
  });

  it('a live game wins over everything, and an empty window is the offseason', () => {
    const live = card({ gamePk: 1, status: 'live', inning: 3 });
    const later = card({ gamePk: 2, status: 'scheduled' });
    expect(decide(10, [later, live], '2026-10-03')).toMatchObject({ kind: 'live', game: { gamePk: 1 } });
    expect(decide(10, [], '2026-10-03')).toEqual({ kind: 'none' });
  });

  it('won the series, next round not scheduled yet: advanced; won the World Series: champion', () => {
    const won = card({ gamePk: 3, status: 'final', gameType: 'D', postseason: true, series: { name: 'ALDS', league: 'AL', game: 4, of: 5, wins: { away: 3, home: 1 }, over: true, winner: 'away' } });
    expect(decide(10, [won], '2026-10-09')).toMatchObject({ kind: 'over', how: 'advanced' });
    expect(decide(10, [{ ...won, gameType: 'W' }], '2026-10-30')).toMatchObject({ kind: 'over', how: 'champion' });
  });
});

describe('tension', () => {
  it('later and closer is more tense; a blowout is not', () => {
    const t = (o: Partial<GameCard>) => tension(card({ status: 'live', ...o }));
    expect(t({ inning: 9, half: 'bottom', away: team(10, 3), home: team(11, 2) })).toBeGreaterThan(t({ inning: 3, away: team(10, 3), home: team(11, 2) }));
    expect(t({ inning: 9, away: team(10, 3), home: team(11, 3) })).toBeGreaterThan(t({ inning: 9, away: team(10, 8), home: team(11, 1) }));
    expect(t({ inning: 8, away: team(10, 2), home: team(11, 2), bases: ['1B', '2B', '3B'] })).toBeGreaterThan(t({ inning: 8, away: team(10, 2), home: team(11, 2) }));
    expect(tension(card({ status: 'final', inning: 9 }))).toBe(0);
  });

  it('picks the most tense live game and flags late, close moments', () => {
    const a = card({ gamePk: 1, status: 'live', inning: 4, away: team(10, 0), home: team(11, 0) });
    const b = card({ gamePk: 2, status: 'live', inning: 9, half: 'bottom', away: team(12, 4), home: team(13, 3) });
    expect(mostTense([a, b])?.gamePk).toBe(2);
    expect(mostTense([a, b], 2)?.gamePk).toBe(1);
    expect(isBigMoment(b)).toBe(true);
    expect(isBigMoment(a)).toBe(false);
  });
});

function team(id: number, runs?: number) { return { id, abbr: `T${id}`, name: `Team ${id}`, ...(runs !== undefined ? { runs } : {}) }; }
function card(o: Partial<GameCard>): GameCard {
  return { gamePk: 0, gameType: 'R', postseason: false, officialDate: '2026-10-03', start: Date.parse('2026-10-03T23:00:00Z'), status: 'scheduled', away: team(10), home: team(11), ...o };
}
