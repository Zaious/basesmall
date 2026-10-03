import { describe, expect, it } from 'vitest';
import { buildTimeline, repairTimestamps } from '../src/data/mlb/timeline.ts';
import { COMPACT_CAPS, duration, schedule } from '../src/data/replay/pacing.ts';
import { hasFixture, loadFixture } from './fixtures.ts';

const MIN = 60_000;

describe('repairTimestamps', () => {
  it('spreads an out-of-order run between its neighbours and keeps play order', () => {
    const e = [{ t: 0 }, { t: 10 }, { t: 900 }, { t: 910 }, { t: 20 }, { t: 30 }];
    expect(repairTimestamps(e)).toBe(2);
    expect(e.map((x) => x.t)).toEqual([0, 10, 13, 17, 20, 30]);
  });
  it('leaves ordered timestamps alone', () => {
    const e = [{ t: 1 }, { t: 1 }, { t: 5 }];
    expect(repairTimestamps(e)).toBe(0);
    expect(e.map((x) => x.t)).toEqual([1, 1, 5]);
  });
});

describe.skipIf(!hasFixture(849841))('pace modes on 849841', () => {
  const timeline = hasFixture(849841) ? buildTimeline(loadFixture(849841)) : [];

  it('real pace spans the game from first to last event', () => {
    const slots = schedule(timeline, { kind: 'real' });
    expect(slots).toHaveLength(timeline.length);
    expect(duration(slots)).toBe(timeline.at(-1)!.t - timeline[0]!.t);
    // official game time is 183 minutes; first pitch to last pitch is a little shorter
    expect(duration(slots) / MIN).toBeGreaterThan(175);
    expect(duration(slots) / MIN).toBeLessThan(190);
  });

  it('compact pace caps every gap and keeps every entry', () => {
    const slots = schedule(timeline, { kind: 'compact' });
    expect(slots).toHaveLength(timeline.length);
    const maxCap = Math.max(COMPACT_CAPS.withinAtBat, COMPACT_CAPS.betweenAtBats, COMPACT_CAPS.betweenHalves) * 1000;
    for (let i = 1; i < slots.length; i++) {
      const gap = slots[i]!.at - slots[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(COMPACT_CAPS.floor * 1000);
      expect(gap).toBeLessThanOrEqual(maxCap);
    }
    expect(duration(slots)).toBeLessThan(duration(schedule(timeline, { kind: 'real' })));
  });

  it('results pace keeps only plate-appearance results and the game end', () => {
    const slots = schedule(timeline, { kind: 'results' });
    const pas = timeline.filter((e) => e.events.some((ev) => ev.type === 'plateAppearance')).length;
    expect(pas).toBe(87);
    expect(slots).toHaveLength(pas + 1);
    expect(duration(slots)).toBe(pas * 6000);
  });

  it('fixed pace is evenly spaced', () => {
    const slots = schedule(timeline, { kind: 'fixed', seconds: 5 });
    expect(duration(slots)).toBe((timeline.length - 1) * 5000);
  });
});

