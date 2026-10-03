import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPatch, PatchError, type PatchOp } from '../src/data/mlb/json-patch.ts';
import { MlbLiveSource } from '../src/data/mlb/live-source.ts';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import type { MlbFeed } from '../src/data/mlb/feed-types.ts';
import type { GameEvent, GameState } from '../src/model/types.ts';
import { FakeClock } from './fake-clock.ts';
import { hasFixture, loadFixture } from './fixtures.ts';

/** A response recorded by the probe's request cache, looked up by URL. */
function recorded(urlPart: string): unknown {
  const dir = 'fixtures/mlb/raw';
  if (!existsSync(dir)) return undefined;
  for (const f of readdirSync(dir)) {
    const r = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { meta: { url: string }; body: unknown };
    if (r.meta.url.includes(urlPart)) return r.body;
  }
  return undefined;
}

const A = '849841/feed/live?timecode=20260930_192709';
const B = '849841/feed/live?timecode=20260930_192800';
const AB = 'diffPatch?startTimecode=20260930_192709&endTimecode=20260930_192800';
const haveAB = () => recorded(A) !== undefined && recorded(B) !== undefined && recorded(AB) !== undefined;
const flush = () => new Promise((r) => setTimeout(r, 0));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('applyPatch', () => {
  it('handles add, remove, replace, copy, move and test, with pointer escapes', () => {
    const doc = { a: [1, 2], 'x/y': { '~k': 1 }, b: { c: 1 } };
    const out = applyPatch(clone(doc), [
      { op: 'add', path: '/a/-', value: 3 },
      { op: 'add', path: '/a/0', value: 0 },
      { op: 'remove', path: '/a/1' },
      { op: 'replace', path: '/x~1y/~0k', value: 2 },
      { op: 'copy', from: '/b', path: '/d' },
      { op: 'move', from: '/b/c', path: '/e' },
      { op: 'test', path: '/e', value: 1 },
    ]);
    expect(out).toEqual({ a: [0, 2, 3], 'x/y': { '~k': 2 }, b: {}, d: { c: 1 }, e: 1 });
  });

  it('throws PatchError on a missing path, so the caller can start over', () => {
    expect(() => applyPatch({ a: 1 }, [{ op: 'replace', path: '/nope/x', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch({ a: [] }, [{ op: 'remove', path: '/a/0' }])).toThrow(PatchError);
  });

  it.skipIf(!haveAB())("turns MLB's feed at one timecode into its feed at the next", () => {
    const steps = recorded(AB) as { diff: PatchOp[] }[];
    let doc = clone(recorded(A));
    for (const step of steps) doc = applyPatch(doc, step.diff);
    expect(doc).toEqual(recorded(B));
  });
});

describe.skipIf(!haveAB())('MlbLiveSource', () => {
  const feedA = recorded(A) as MlbFeed;
  const feedB = recorded(B) as MlbFeed;
  const patchAB = recorded(AB);
  // A skipped describe still runs its body to collect tests, so this must not throw without fixtures.
  const tsA = feedA?.metaData?.timeStamp ?? '', tsB = feedB?.metaData?.timeStamp ?? '';
  const beat = (ts: string) => () => ({ metaData: { timeStamp: ts, wait: 10 } });

  function harness(responses: ((path: string) => unknown)[]) {
    const clock = new FakeClock();
    const paths: string[] = [];
    const fetchJson = async (path: string) => {
      paths.push(path);
      const r = responses.shift();
      if (!r) throw new Error('no more responses');
      return r(path);
    };
    const source = new MlbLiveSource(fetchJson, { clock, random: () => 0.5 });
    const events: GameEvent[] = [];
    const states: GameState[] = [];
    const errors: unknown[] = [];
    const off = source.subscribe(849841, {
      onEvent: (e) => events.push(e),
      onState: (s) => states.push(s),
      onError: (e) => errors.push(e),
    });
    return { clock, paths, source, events, states, errors, off };
  }

  it('first load shows the current state without replaying the game', async () => {
    const h = harness([() => clone(feedA)]);
    await flush();
    expect(h.paths).toEqual(['/api/v1.1/game/849841/feed/live']);
    expect(h.events).toEqual([]);
    expect(h.states).toHaveLength(1);
    expect(h.states[0]!.inning).toBe(5);
    expect(h.clock.nextIn).toBe(10_000); // metaData.wait
    h.off();
  });

  it('then sends a heartbeat, and on a new timecode asks for exactly that diff', async () => {
    const h = harness([() => clone(feedA), beat(tsB), () => clone(patchAB)]);
    await flush();
    h.clock.advance(10_000);
    await flush();
    expect(h.paths.slice(1)).toEqual([
      '/api/v1.1/game/849841/feed/live?fields=metaData,timeStamp,wait',
      `/api/v1.1/game/849841/feed/live/diffPatch?startTimecode=${tsA}&endTimecode=${tsB}`,
    ]);

    const seen = new Set(buildTimeline(feedA).map((e) => `${e.play}:${e.event}`));
    const fresh = buildTimeline(feedB).filter((e) => !seen.has(`${e.play}:${e.event}`));
    expect(fresh.length).toBeGreaterThan(0);
    // The 5th was already announced at first load (its first batter was up at A).
    const announcedAtA = (ev: GameEvent) => ev.type === 'inningChange' && ev.inning === 5 && ev.half === 'top';
    expect(h.events).toEqual(fresh.flatMap((e) => e.events).filter((ev) => !announcedAtA(ev)));
    expect(h.states.at(-1)).toEqual(buildTimeline(feedB).at(-1)!.state);
    expect(h.source.status(849841)).toMatchObject({ connected: true, requests: 3, corrections: 0 });
    h.off();
  });

  it('an unchanged timecode costs one heartbeat and nothing else', async () => {
    const h = harness([() => clone(feedA), beat(tsA)]);
    await flush();
    h.clock.advance(10_000);
    await flush();
    expect(h.paths).toHaveLength(2);
    expect(h.events).toEqual([]);
    expect(h.states).toHaveLength(1);
    expect(h.clock.nextIn).toBe(10_000);
    h.off();
  });

  it('a revised play updates the state without events', async () => {
    const revise = [{ diff: [{ op: 'replace', path: '/liveData/plays/allPlays/0/result/eventType', value: 'field_error' }] }];
    const h = harness([() => clone(feedA), beat(tsB), () => revise]);
    await flush();
    h.clock.advance(10_000);
    await flush();
    expect(h.events).toEqual([]);
    expect(h.source.status(849841)!.corrections).toBe(1);
    h.off();
  });

  it('backs off after a failure and recovers', async () => {
    const h = harness([() => { throw new Error('offline'); }, () => clone(feedA)]);
    await flush();
    expect(h.errors).toHaveLength(1);
    expect(h.source.status(849841)).toMatchObject({ connected: false, failures: 1 });
    expect(h.clock.nextIn).toBe(10_000); // 5 s floor x 2^1, jitter factor 1.0 at random 0.5
    h.clock.advance(10_000);
    await flush();
    expect(h.source.status(849841)).toMatchObject({ connected: true, failures: 0 });
    expect(h.states).toHaveLength(1);
    h.off();
  });

  it('starts over with the whole feed when a diff does not apply', async () => {
    const bad = [{ diff: [{ op: 'replace', path: '/no/such/path', value: 1 }] }];
    const h = harness([() => clone(feedA), beat(tsB), () => bad, () => clone(feedB)]);
    await flush();
    h.clock.advance(10_000);
    await flush();
    expect(h.errors[0]).toBeInstanceOf(PatchError);
    h.clock.advance(h.clock.nextIn!);
    await flush();
    expect(h.paths.at(-1)).toBe('/api/v1.1/game/849841/feed/live');
    expect(h.states.at(-1)).toEqual(buildTimeline(feedB).at(-1)!.state);
    h.off();
  });

  it('polls three times slower in the background', async () => {
    const h = harness([() => clone(feedA)]);
    h.source.setBackground(true);
    await flush();
    expect(h.clock.nextIn).toBe(30_000);
    h.off();
  });

  it('stops polling after unsubscribe', async () => {
    const h = harness([() => clone(feedA)]);
    await flush();
    h.off();
    expect(h.clock.pending).toBe(0);
  });
});

describe.skipIf(!hasFixture(849841))('MlbLiveSource on a finished game', () => {
  it('delivers the final state once and stops polling', async () => {
    const clock = new FakeClock();
    let calls = 0;
    const source = new MlbLiveSource(async () => { calls++; return loadFixture(849841); }, { clock });
    const states: GameState[] = [];
    source.subscribe(849841, { onEvent: () => {}, onState: (s) => states.push(s) });
    await flush();
    clock.advance(60 * 60 * 1000);
    await flush();
    expect(calls).toBe(1);
    expect(states).toHaveLength(1);
    expect(states[0]!.status).toBe('final');
    expect(source.status(849841)!.stopped).toBe(true);
  });
});

describe.skipIf(!haveAB())('MlbLiveSource across a half-inning change', () => {
  it('announces the new half-inning once, even when its batter was up before the first pitch', async () => {
    // A ends after the third out of the 4th with the 5th's first batter up; B has his first pitches.
    const feedA = recorded(A) as MlbFeed;
    const atA = buildTimeline(feedA).at(-1)!;
    expect(atA.event).toBe(-2);
    expect(atA.state).toMatchObject({ inning: 5, half: 'top', outs: 0, balls: 0, strikes: 0 });

    const clock = new FakeClock();
    const tsB = (recorded(B) as MlbFeed).metaData!.timeStamp!;
    const responses = [() => clone(feedA), () => ({ metaData: { timeStamp: tsB, wait: 10 } }), () => clone(recorded(AB))];
    const source = new MlbLiveSource(async () => responses.shift()!(), { clock, random: () => 0.5 });
    const events: GameEvent[] = [];
    source.subscribe(849841, { onEvent: (e) => events.push(e), onState: () => {} });
    await flush();
    clock.advance(10_000);
    await flush();
    expect(events.filter((e) => e.type === 'inningChange')).toHaveLength(0); // announced at first load
    expect(events.some((e) => e.type === 'pitch')).toBe(true);
  });
});
