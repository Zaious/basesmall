import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import type { GameState } from '../src/model/types.ts';
import { BASE_SPOT, PITCHER_KEY, planStep, runnerKey, sceneOf, settle, TIMING, type Piece, type Scene } from '../src/render/scene.ts';
import { FIXTURES, hasFixture, loadFixture } from './fixtures.ts';

const BASE: GameState = {
  gamePk: 1, status: 'live', teams: { away: { id: 1, abbr: 'AAA', name: 'A' }, home: { id: 2, abbr: 'HHH', name: 'H' } },
  inning: 1, half: 'top', outs: 0, balls: 0, strikes: 0, bases: {}, score: { away: 0, home: 0 },
  hits: { away: 0, home: 0 }, errors: { away: 0, home: 0 }, linescore: { away: [0], home: [] }, atBat: [],
  batter: { id: 10, name: 'Bat Ter', short: 'Ter', side: 'L', today: { ab: 0, h: 0 } },
  pitcher: { id: 99, name: 'Pit Cher', short: 'Cher', hand: 'R', pitches: 0 },
};
const ref = (id: number) => ({ id, name: `P ${id}`, short: `${id}` });

describe('sceneOf', () => {
  it('puts runners on their bases, the batter at the plate and the pitcher on the mound', () => {
    const s = sceneOf({ ...BASE, bases: { '1B': ref(7), '3B': ref(8) } });
    expect(s.get(runnerKey(7))).toMatchObject({ spot: 1, side: 'away', role: 'runner' });
    expect(s.get(runnerKey(8))).toMatchObject({ spot: 3 });
    expect(s.get(runnerKey(10))).toMatchObject({ spot: 0, role: 'batter' });
    expect(s.get(PITCHER_KEY)).toMatchObject({ id: 99, side: 'home', spot: 'mound' });
  });

  it('takes the batter off once the plate appearance is over', () => {
    const s = sceneOf(BASE, [{ type: 'plateAppearance', result: 'strikeout', rbi: 0, batter: ref(10), isOut: true }]);
    expect(s.has(runnerKey(10))).toBe(false);
  });

  it('clears the board when the game is over', () => {
    expect(sceneOf({ ...BASE, status: 'final' }).size).toBe(0);
  });
});

describe('planStep', () => {
  it('a double with a runner on first: ball flies, runner scores along the bases, batter goes to second', () => {
    const prev = sceneOf({ ...BASE, bases: { '1B': ref(7) } });
    const plan = planStep(prev, { ...BASE, bases: { '2B': ref(10) } }, [
      { type: 'pitch', pitch: { n: 1, call: 'inPlay', callCode: 'X' } },
      { type: 'ballInPlay', ball: { coordX: 60, coordY: 80, distance: 380, trajectory: 'line_drive' } },
      { type: 'runnerAdvance', runner: ref(10), from: 'batter', to: '2B', cause: 'double' },
      { type: 'runnerAdvance', runner: ref(7), from: '1B', to: '2B', cause: 'double' },
      { type: 'runnerAdvance', runner: ref(7), from: '2B', to: '3B', cause: 'double' },
      { type: 'runnerAdvance', runner: ref(7), from: '3B', to: 'home', cause: 'double' },
      { type: 'plateAppearance', result: 'double', rbi: 1, batter: ref(10), isOut: false },
    ]);
    expect(plan.flight).toBe(TIMING.flight);
    expect(plan.tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'score', key: runnerKey(7), path: [1, 2, 3, 4], at: TIMING.flight }),
      expect.objectContaining({ kind: 'move', key: runnerKey(10), path: [0, 1, 2], at: TIMING.flight }),
    ]));
    expect(plan.mismatches).toEqual([]);
    expect(settle(prev, plan)).toEqual(plan.end);
  });

  it('a first-pitch home run: the batter appears at the plate, then circles the bases', () => {
    const prev = sceneOf(BASE, [{ type: 'plateAppearance', result: 'field_out', rbi: 0, batter: ref(9), isOut: true }]);
    expect(prev.has(runnerKey(10))).toBe(false);
    const plan = planStep(prev, { ...BASE, score: { away: 1, home: 0 } }, [
      { type: 'pitch', pitch: { n: 1, call: 'inPlay', callCode: 'X' } },
      { type: 'ballInPlay', ball: { coordX: 40, coordY: 40, distance: 410, trajectory: 'fly_ball', launchAngle: 28 } },
      { type: 'runnerAdvance', runner: ref(10), from: 'batter', to: 'home', cause: 'home_run' },
      { type: 'scoreChange', side: 'away', runs: 1, score: { away: 1, home: 0 } },
      { type: 'plateAppearance', result: 'home_run', rbi: 1, batter: ref(10), isOut: false },
    ]);
    expect(plan.tracks[0]).toMatchObject({ kind: 'enter', key: runnerKey(10), at: 0 });
    expect(plan.tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'score', key: runnerKey(10), path: [0, 1, 2, 3, 4], at: TIMING.flight }),
    ]));
    expect(plan.total).toBe(TIMING.flight + 4 * TIMING.perBase + TIMING.fade);
    expect(settle(prev, plan)).toEqual(plan.end);
  });

  it('turns the pitcher over and flips the new batter in when the half-inning changes', () => {
    const prev = sceneOf({ ...BASE, bases: { '2B': ref(7) } }, [{ type: 'plateAppearance', result: 'field_out', rbi: 0, batter: ref(10), isOut: true }]);
    const next: GameState = { ...BASE, half: 'bottom', batter: { ...BASE.batter!, id: 20 }, pitcher: { ...BASE.pitcher!, id: 98 } };
    const plan = planStep(prev, next, [{ type: 'inningChange', inning: 1, half: 'bottom' }]);
    expect(plan.tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'flip', key: PITCHER_KEY }),
      expect.objectContaining({ kind: 'leave', key: runnerKey(7), at: 0 }),
      expect.objectContaining({ kind: 'enter', key: runnerKey(20), flipFrom: 'away' }),
    ]));
    expect(settle(prev, plan)).toEqual(plan.end);
  });
});

// The acceptance check for the board: play every recorded game step by step and make sure the
// pieces end each step exactly where the official state puts them, moving only forward.
describe('every recorded game, step by step', () => {
  for (const { pk, note } of FIXTURES) {
    it.skipIf(!hasFixture(pk))(`${pk} (${note})`, () => {
      const timeline = buildTimeline(loadFixture(pk));
      let scene: Scene = new Map();
      const mismatches: string[] = [];
      for (const [i, entry] of timeline.entries()) {
        const plan = planStep(scene, entry.state, entry.events);
        const after = settle(scene, plan);
        expect(after, `entry ${i}`).toEqual(plan.end);

        // the board agrees with the state
        const runners = [...after.values()].filter((p) => p.role === 'runner');
        expect(runners.map((p) => p.spot).sort(), `entry ${i} bases`)
          .toEqual(Object.keys(entry.state.bases).map((b) => BASE_SPOT[b as keyof typeof BASE_SPOT]).sort());
        expect([...after.values()].filter((p) => p.role === 'batter').length, `entry ${i} batter`).toBeLessThanOrEqual(1);

        for (const t of plan.tracks) {
          if (t.kind !== 'move' && t.kind !== 'score') continue;
          const entered = plan.tracks.find((x) => x.kind === 'enter' && x.key === t.key);
          const was = (scene.get(t.key)?.spot ?? (entered?.kind === 'enter' ? entered.piece.spot : undefined)) as number;
          expect(t.path[0], `entry ${i} ${t.key} starts where it stood`).toBe(was);
          expect([...t.path].sort((a, b) => a - b), `entry ${i} ${t.key} only runs forward`).toEqual(t.path);
        }
        mismatches.push(...plan.mismatches.map((k) => `${i}:${k}`));
        scene = after;
      }
      expect(mismatches).toEqual([]);
    });
  }
});

export type { Piece };
