import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import { duration, schedule } from '../src/data/replay/pacing.ts';
import { MlbReplaySource } from '../src/data/replay/mlb-replay-source.ts';
import { ReplayPlayer, type Clock } from '../src/data/replay/player.ts';
import { GameStore } from '../src/model/store.ts';
import type { GameEvent } from '../src/model/types.ts';
import { hasFixture, loadFixture } from './fixtures.ts';

/** Virtual clock: timers fire in time order when the test advances time. */
class FakeClock implements Clock {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, fn }); return id; }
  clearTimeout(id: unknown) { this.timers.delete(id as number); }
  /** Advance time, firing timers in order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
  get pending() { return this.timers.size; }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe.skipIf(!hasFixture(849841))('ReplayPlayer on 849841', () => {
  const timeline = hasFixture(849841) ? buildTimeline(loadFixture(849841)) : [];

  it('plays every entry in order and finishes exactly when the schedule says', () => {
    const clock = new FakeClock();
    const player = new ReplayPlayer(timeline, { clock });
    const seen: number[] = [];
    let ended = -1;
    player.onEntry((_, info) => seen.push(info.index));
    player.onEnd(() => { ended = clock.now(); });
    player.play();
    clock.advance(10 * 60 * 60 * 1000);
    expect(seen).toEqual(timeline.map((_, i) => i));
    expect(ended).toBe(duration(schedule(timeline, { kind: 'compact' })));
  });

  it('pause stops delivery and play resumes where it left off', () => {
    const clock = new FakeClock();
    const player = new ReplayPlayer(timeline, { clock, pace: { kind: 'fixed', seconds: 1 } });
    const seen: number[] = [];
    player.onEntry((_, info) => seen.push(info.index));
    player.play();
    clock.advance(10_500); // entries 0..10
    player.pause();
    clock.advance(60_000);
    expect(seen).toEqual([...Array(11).keys()]);
    player.play();
    clock.advance(1_000);
    expect(seen.at(-1)).toBe(11);
  });

  it('seek delivers a snap and continues from there', () => {
    const clock = new FakeClock();
    const player = new ReplayPlayer(timeline, { clock, pace: { kind: 'fixed', seconds: 1 } });
    const seen: [number, boolean][] = [];
    player.onEntry((_, info) => seen.push([info.index, info.snap]));
    player.play();
    player.seek(200);
    clock.advance(1_000);
    expect(seen).toEqual([[200, true], [201, false]]);
  });

  it('speed 4x plays a fixed 4 s pace one entry per second', () => {
    const clock = new FakeClock();
    const player = new ReplayPlayer(timeline, { clock, pace: { kind: 'fixed', seconds: 4 }, speed: 4 });
    let count = 0;
    player.onEntry(() => count++);
    player.play();
    clock.advance(5_000);
    expect(count).toBe(6); // t = 0,1,2,3,4,5
  });
});

describe.skipIf(!hasFixture(849841))('MlbReplaySource through GameStore', () => {
  it('delivers every event of the game and ends on the final state', async () => {
    const clock = new FakeClock();
    const source = new MlbReplaySource(async (pk) => loadFixture(pk), { clock, pace: { kind: 'fixed', seconds: 1 } });
    const store = new GameStore(10_000);
    const types: GameEvent['type'][] = [];
    store.subscribe({ onEvent: (ev) => types.push(ev.type) });
    store.follow(source, 849841);
    await flush();
    clock.advance(24 * 60 * 60 * 1000);

    const timeline = buildTimeline(loadFixture(849841));
    expect(types).toEqual(timeline.flatMap((e) => e.events.map((ev) => ev.type)));
    expect(store.current).toEqual(timeline.at(-1)!.state);
    expect(store.current!.status).toBe('final');
    expect(store.current!.score).toEqual({ away: 4, home: 3 });
    store.stop();
  });

  it('a snap after seeking updates state without replaying its events', async () => {
    const clock = new FakeClock();
    const source = new MlbReplaySource(async (pk) => loadFixture(pk), { clock, pace: { kind: 'fixed', seconds: 1 } });
    const events: GameEvent[] = [];
    const states: number[] = [];
    source.subscribe(849841, { onEvent: (ev) => events.push(ev), onState: (s) => states.push(s.inning) });
    await flush();
    source.player(849841)!.seek(250);
    expect(events).toHaveLength(0);
    expect(states).toHaveLength(1);
  });

  it('reports a load failure instead of throwing', async () => {
    const source = new MlbReplaySource(async () => { throw new Error('offline'); });
    const errors: unknown[] = [];
    source.subscribe(1, { onEvent: () => {}, onState: () => {}, onError: (e) => errors.push(e) });
    await flush();
    expect(errors).toHaveLength(1);
  });
});
