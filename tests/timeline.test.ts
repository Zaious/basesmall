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

    it('final runs, hits and errors match the official linescore', () => {
      for (const s of SIDES) {
        expect({ side: s, runs: final!.score[s], hits: final!.hits[s], errors: final!.errors[s] })
          .toEqual({ side: s, ...pick(off!.liveData.linescore.teams[s], ['runs', 'hits', 'errors']) });
      }
    });

    it('runs per inning match the official linescore', () => {
      const innings = off!.liveData.linescore.innings;
      for (const s of SIDES) {
        const want = innings.map((i) => i[s]?.runs ?? null);
        expect(final!.linescore[s].slice(0, want.length)).toEqual(want);
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
