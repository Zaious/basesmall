import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import { soundsFor } from '../src/audio/cues.ts';
import type { GameEvent, GameState } from '../src/model/types.ts';
import { hasFixture, loadFixture } from './fixtures.ts';

const S = { balls: 0, strikes: 0, batter: { id: 1, name: 'B', short: 'B', side: 'R', today: { ab: 0, h: 0 } } } as unknown as GameState;
const at = (balls: number, strikes: number) => ({ ...S, balls, strikes });
const pitch = (call: 'ball' | 'calledStrike' | 'swingingStrike' | 'foul'): GameEvent => ({ type: 'pitch', pitch: { n: 1, call, callCode: '' } });
const ref = { id: 1, name: 'B', short: 'B' };

describe('which sound a step gets', () => {
  it('a home run is the home run sound before the hit sound', () => {
    expect(soundsFor(S, S, [pitch('foul'), { type: 'plateAppearance', result: 'home_run', rbi: 1, batter: ref, isOut: false }])).toEqual(['homeRun']);
    expect(soundsFor(S, S, [{ type: 'plateAppearance', result: 'double', rbi: 0, batter: ref, isOut: false }])).toEqual(['hit']);
  });

  it('the pitch that makes it 3-2 is the full-count cue first, then the strike', () => {
    expect(soundsFor(at(3, 1), at(3, 2), [pitch('calledStrike')])).toEqual(['fullCount', 'strike']);
    expect(soundsFor(at(2, 2), at(3, 2), [pitch('ball')])).toEqual(['fullCount']);
    // A foul at 3-2 keeps the count: no new cue.
    expect(soundsFor(at(3, 2), at(3, 2), [pitch('foul')])).toEqual([]);
  });

  it('strikeouts and bunts', () => {
    expect(soundsFor(at(1, 2), at(1, 3), [pitch('swingingStrike'), { type: 'plateAppearance', result: 'strikeout', rbi: 0, batter: ref, isOut: true }])).toEqual(['strikeout']);
    expect(soundsFor(S, S, [{ type: 'ballInPlay', ball: { trajectory: 'bunt_grounder' } }, { type: 'plateAppearance', result: 'sac_bunt', rbi: 0, batter: ref, isOut: true }])).toEqual(['bunt']);
  });
});

describe.skipIf(!hasFixture(849841))('a whole game', () => {
  it('has a home run or hit sound for every hit, and never more than one sound per step', () => {
    const tl = buildTimeline(loadFixture(849841));
    let prev: GameState | undefined;
    let hits = 0, hitSounds = 0;
    for (const e of tl) {
      const c = soundsFor(prev, e.state, e.events);
      const pa = e.events.find((x) => x.type === 'plateAppearance');
      if (pa?.type === 'plateAppearance' && ['single', 'double', 'triple', 'home_run'].includes(pa.result)) hits++;
      if (c[0] === 'hit' || c[0] === 'homeRun') hitSounds++;
      prev = e.state;
    }
    expect(hitSounds).toBe(hits);
    expect(hits).toBeGreaterThan(0);
  });
});
