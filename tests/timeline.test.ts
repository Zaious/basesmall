// M1 acceptance: replaying a recorded game through the adapter reproduces what actually
// happened, checked against MLB's own totals rather than numbers we computed ourselves.

import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import type { GameEvent, Side } from '../src/model/types.ts';
import { FIXTURES, hasFixture, loadFixture, official } from './fixtures.ts';

const SIDES: Side[] = ['away', 'home'];
const RANK: Record<GameEvent['type'], number> = {
  inningChange: 0,
  pitchingChange: 1, runnerPlaced: 1, baserunning: 1,
  pitch: 2, automaticCall: 2,
  ballInPlay: 3,
  runnerAdvance: 4,
  scoreChange: 5,
  plateAppearance: 6,
  gameEnd: 7,
};

for (const fx of FIXTURES) {
  describe.skipIf(!hasFixture(fx.pk))(`${fx.pk}: ${fx.note}`, () => {
    const feed = hasFixture(fx.pk) ? loadFixture(fx.pk) : undefined;
    const timeline = feed ? buildTimeline(feed) : [];
    const plays = feed?.liveData.plays.allPlays ?? [];
    const off = feed ? official(feed) : undefined;
    const final = timeline.at(-1)?.state;

    it('ends with gameEnd and a final status', () => {
      const last = timeline.at(-1)!;
      expect(last.events).toEqual([expect.objectContaining({ type: 'gameEnd' })]);
      expect(last.state.status).toBe('final');
    });

    // The last play-derived entry, before the final entry is reconciled with the official linescore.
    const derived = timeline.filter((e) => e.event >= 0).at(-1)?.state;

    it('runs and hits derived from the plays match the official linescore', () => {
      for (const s of SIDES) {
        expect({ side: s, runs: derived!.score[s], hits: derived!.hits[s] })
          .toEqual({ side: s, ...pick(off!.liveData.linescore.teams[s], ['runs', 'hits']) });
      }
    });

    it('errors derived from the plays never exceed the official count', () => {
      // Some errors (a dropped foul fly) leave no trace in the plays; the final entry fixes them.
      for (const s of SIDES) expect(derived!.errors[s]).toBeLessThanOrEqual(off!.liveData.linescore.teams[s].errors);
    });

    it('runs per inning derived from the plays match every inning the official linescore counts', () => {
      const innings = off!.liveData.linescore.innings;
      for (const s of SIDES) {
        const got = innings.map((i, n) => (i[s]?.runs === undefined ? 'skip' : derived!.linescore[s][n] ?? null));
        const want = innings.map((i) => (i[s]?.runs === undefined ? 'skip' : i[s]!.runs));
        expect(got).toEqual(want);
      }
    });

    it('the final entry carries the official runs, hits, errors and runs per inning', () => {
      const innings = off!.liveData.linescore.innings;
      for (const s of SIDES) {
        expect(pick(final!, ['score', 'hits', 'errors'])).toEqual({
          score: { away: off!.liveData.linescore.teams.away.runs, home: off!.liveData.linescore.teams.home.runs },
          hits: { away: off!.liveData.linescore.teams.away.hits, home: off!.liveData.linescore.teams.home.hits },
          errors: { away: off!.liveData.linescore.teams.away.errors, home: off!.liveData.linescore.teams.home.errors },
        });
        expect(final!.linescore[s]).toEqual(innings.map((i) => i[s]?.runs ?? null));
      }
    });

    it("bases after every plate appearance match MLB's own post-play runners", () => {
      const lastEntryOfPlay = new Map(timeline.filter((e) => e.event >= 0).map((e) => [e.play, e]));
      const mismatches: string[] = [];
      for (const play of plays) {
        if (!play.about.isComplete || play.count.outs >= 3) continue; // the half ends: bases clear
        const entry = lastEntryOfPlay.get(play.about.atBatIndex)!;
        const got = { '1B': entry.state.bases['1B']?.id, '2B': entry.state.bases['2B']?.id, '3B': entry.state.bases['3B']?.id };
        const want = { '1B': play.matchup.postOnFirst?.id, '2B': play.matchup.postOnSecond?.id, '3B': play.matchup.postOnThird?.id };
        if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`PA ${play.about.atBatIndex}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      }
      expect(mismatches).toEqual([]);
    });

    it('outs at the end of every plate appearance match the play count', () => {
      const lastEntryOfPlay = new Map(timeline.filter((e) => e.event >= 0).map((e) => [e.play, e]));
      for (const play of plays.filter((p) => p.about.isComplete)) {
        expect([play.about.atBatIndex, lastEntryOfPlay.get(play.about.atBatIndex)!.state.outs])
          .toEqual([play.about.atBatIndex, play.count.outs]);
      }
    });

    it('pitch count of every pitcher matches the boxscore', () => {
      const counted = new Map<number, number>();
      for (const e of timeline) {
        const n = e.events.filter((ev) => ev.type === 'pitch').length;
        if (n) counted.set(e.state.pitcher!.id, (counted.get(e.state.pitcher!.id) ?? 0) + n);
      }
      const diffs: string[] = [];
      for (const s of SIDES) {
        for (const p of Object.values(off!.liveData.boxscore.teams[s].players)) {
          const want = p.stats.pitching?.numberOfPitches;
          if (want === undefined) continue;
          const got = counted.get(p.person.id) ?? 0;
          if (got !== want) diffs.push(`pitcher ${p.person.id}: got ${got} want ${want}`);
        }
      }
      expect(diffs).toEqual([]);
    });

    it("every batter's at-bats and hits match the boxscore", () => {
      const tally = new Map<number, { ab: number; h: number }>();
      for (const e of timeline) {
        if (e.events.some((ev) => ev.type === 'plateAppearance')) tally.set(e.state.batter!.id, e.state.batter!.today);
      }
      const diffs: string[] = [];
      for (const s of SIDES) {
        for (const p of Object.values(off!.liveData.boxscore.teams[s].players)) {
          const b = p.stats.batting;
          if (b?.atBats === undefined) continue;
          const got = tally.get(p.person.id) ?? { ab: 0, h: 0 };
          if (got.ab !== b.atBats || got.h !== (b.hits ?? 0)) diffs.push(`batter ${p.person.id}: got ${got.h}-${got.ab} want ${b.hits}-${b.atBats}`);
        }
      }
      expect(diffs).toEqual([]);
    });

    it('events inside each entry are in causal order', () => {
      const bad = timeline.filter((e) => e.events.some((ev, i) => i > 0 && RANK[ev.type] < RANK[e.events[i - 1]!.type]));
      expect(bad.map((e) => `${e.play}/${e.event}: ${e.events.map((ev) => ev.type).join(',')}`)).toEqual([]);
    });

    it('announces every half-inning exactly once, before anything else in it', () => {
      const halves = new Set(plays.map((p) => `${p.about.inning}${p.about.halfInning}`));
      const changes = timeline.flatMap((e) => e.events.filter((ev) => ev.type === 'inningChange'));
      expect(changes).toHaveLength(halves.size);
      for (const e of timeline) {
        const i = e.events.findIndex((ev) => ev.type === 'inningChange');
        if (i >= 0) expect(i).toBe(0);
      }
    });

    it('timestamps never go backwards', () => {
      const back = timeline.filter((e, i) => i > 0 && e.t < timeline[i - 1]!.t);
      expect(back.map((e) => `${e.play}/${e.event}`)).toEqual([]);
    });
  });
}

describe.skipIf(!hasFixture(824624))('automatic runner in regular-season extra innings', () => {
  it('puts the runner on second before the first pitch of each extra half-inning', () => {
    const feed = loadFixture(824624);
    const timeline = buildTimeline(feed);
    const extraHalves = [...new Set(timeline.filter((e) => e.state.inning > 9).map((e) => `${e.state.inning}${e.state.half}`))];
    expect(extraHalves.length).toBeGreaterThan(0);
    for (const key of extraHalves) {
      const firstPitch = timeline.find((e) => `${e.state.inning}${e.state.half}` === key && e.events.some((ev) => ev.type === 'pitch'))!;
      const placed = timeline.find((e) => `${e.state.inning}${e.state.half}` === key && e.events.some((ev) => ev.type === 'runnerPlaced'))!;
      expect(placed, key).toBeDefined();
      expect(timeline.indexOf(placed)).toBeLessThan(timeline.indexOf(firstPitch));
      expect(placed.state.bases['2B'], key).toBeDefined();
    }
  });
});

describe.skipIf(!hasFixture(23885))('games before pitch tracking', () => {
  it('still produce pitches, just without locations', () => {
    const timeline = buildTimeline(loadFixture(23885));
    const pitches = timeline.flatMap((e) => e.events.flatMap((ev) => (ev.type === 'pitch' ? [ev.pitch] : [])));
    expect(pitches.length).toBeGreaterThan(200);
    expect(pitches.filter((p) => p.x !== undefined)).toHaveLength(0);
  });
});

describe.skipIf(!hasFixture(849841))('pitch locations where tracking exists', () => {
  it('every pitch of 849841 has a location and a strike zone', () => {
    const pitches = buildTimeline(loadFixture(849841)).flatMap((e) => e.events.flatMap((ev) => (ev.type === 'pitch' ? [ev.pitch] : [])));
    expect(pitches).toHaveLength(297);
    expect(pitches.every((p) => p.x !== undefined && p.z !== undefined && p.szTop !== undefined)).toBe(true);
    expect(pitches.filter((p) => p.call === 'other').map((p) => p.callCode)).toEqual([]);
  });
});

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;
}

describe.skipIf(!hasFixture(849841))('final state', () => {
  it('clears runners and the count so the board reads as over', () => {
    const end = buildTimeline(loadFixture(849841)).at(-1)!.state;
    expect(end).toMatchObject({ status: 'final', bases: {}, balls: 0, strikes: 0, atBat: [] });
  });
});

describe.skipIf(!hasFixture(849841))('game clock', () => {
  it('knows when the game started, when each moment was, and how long it lasted', () => {
    const timeline = buildTimeline(loadFixture(849841));
    const first = timeline[0]!.state, end = timeline.at(-1)!.state;
    expect(first.startedAt).toBe(Date.parse('2026-09-30T18:16:00.000Z'));
    expect(timeline.every((e) => e.state.at === e.t)).toBe(true);
    expect(end.durationMinutes).toBe(183);
  });
});

// The hover card's lines are counted from the timeline, so a replay never shows more than has
// happened. At the end of a game they must equal the official box score, player by player.
describe('player lines', () => {
  for (const { pk, note } of FIXTURES) {
    it.skipIf(!hasFixture(pk))(`${pk} (${note}): every batting and pitching line matches the box score`, () => {
      const feed = loadFixture(pk) as unknown as { liveData: { boxscore?: { teams?: Record<Side, { players?: Record<string, BoxPlayer> }> } } };
      const end = buildTimeline(loadFixture(pk)).at(-1)!.state;
      const wrong: string[] = [];
      for (const side of ['away', 'home'] as const) {
        for (const [key, p] of Object.entries(feed.liveData.boxscore?.teams?.[side].players ?? {})) {
          const id = Number(key.slice(2)), b = p.stats?.batting, q = p.stats?.pitching;
          if (b && (b.plateAppearances ?? 0) > 0) {
            const l = end.batLines?.[id];
            const got = [l?.pa, l?.ab, l?.h, l?.hr, l?.rbi, l?.bb, l?.k], want = [b.plateAppearances, b.atBats, b.hits, b.homeRuns, b.rbi, b.baseOnBalls, b.strikeOuts];
            if (got.join() !== want.join()) wrong.push(`${key} bat ${got.join()} != ${want.join()}`);
          }
          if (q && (q.numberOfPitches ?? 0) > 0) {
            const l = end.pitchLines?.[id];
            const got = [l?.pitches, l?.outs, l?.h, l?.bb, l?.k], want = [q.numberOfPitches, q.outs, q.hits, q.baseOnBalls, q.strikeOuts];
            if (got.join() !== want.join()) wrong.push(`${key} pitch ${got.join()} != ${want.join()}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});

interface BoxPlayer {
  stats?: {
    batting?: { plateAppearances?: number; atBats?: number; hits?: number; homeRuns?: number; rbi?: number; baseOnBalls?: number; strikeOuts?: number };
    pitching?: { numberOfPitches?: number; outs?: number; hits?: number; baseOnBalls?: number; strikeOuts?: number };
  };
}
