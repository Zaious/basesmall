import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import { halfInnings, playHalfInning } from '../src/data/replay/innings.ts';
import { ReplayPlayer } from '../src/data/replay/player.ts';
import { FakeClock } from './fake-clock.ts';
import { FIXTURES, hasFixture, loadFixture } from './fixtures.ts';

describe('half-innings of a timeline', () => {
  it('match the official line score and tile the timeline, every fixture', () => {
    let checked = 0;
    for (const { pk } of FIXTURES.filter((f) => hasFixture(f.pk))) {
      const feed = loadFixture(pk);
      const t = buildTimeline(feed);
      if (!t.length) continue;
      const halves = halfInnings(t);
      // As many halves as the line score has innings with a run count (a bottom ninth not played has none).
      // A game stopped early (rain) can end inside a half that does not count: it was played, so the
      // replay keeps it, but only as the last half and without its third out.
      const innings = feed.liveData.linescore?.innings ?? [];
      const played = innings.filter((i) => i.away?.runs !== undefined).length + innings.filter((i) => i.home?.runs !== undefined).length;
      if (halves.length === played + 1) {
        const last = t[halves.at(-1)!.end]!;
        expect(last.state.status, `game ${pk}: an extra half only at a final`).toBe('final');
        expect(last.state.outs, `game ${pk}: the uncounted half has no third out`).toBeLessThan(3);
      } else expect(halves.length, `game ${pk}`).toBe(played);
      // Contiguous, in order, covering every entry.
      expect(halves[0]!.start).toBe(0);
      expect(halves.at(-1)!.end).toBe(t.length - 1);
      for (let i = 1; i < halves.length; i++) expect(halves[i]!.start, `game ${pk} half ${i}`).toBe(halves[i - 1]!.end + 1);
      // Each half opens with the inning change, and the one before it ended on three outs.
      for (const h of halves) {
        expect(t[h.start]!.events.some((e) => e.type === 'inningChange'), `game ${pk} ${h.inning}${h.half}`).toBe(true);
        if (h.start > 0) expect(t[h.start - 1]!.state.outs, `game ${pk} before ${h.inning}${h.half}`).toBe(3);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasFixture(849841))('playing one half-inning', () => {
  const timeline = hasFixture(849841) ? buildTimeline(loadFixture(849841)) : [];

  it('starts from the end of the half before, plays the half and stops after its last entry', () => {
    const clock = new FakeClock();
    const player = new ReplayPlayer(timeline, { clock, pace: { kind: 'fixed', seconds: 1 } });
    const h = halfInnings(timeline).find((x) => x.inning === 3 && x.half === 'top')!;
    const seen: [number, boolean][] = [];
    player.onEntry((_, info) => seen.push([info.index, info.snap]));
    let done = 0;
    playHalfInning(player, h, () => done++);
    clock.advance(10 * 60 * 1000);
    expect(seen[0]).toEqual([h.start - 1, true]);
    expect(seen.slice(1).map(([i]) => i)).toEqual(Array.from({ length: h.end - h.start + 1 }, (_, k) => h.start + k));
    expect(seen.slice(1).every(([, snap]) => !snap)).toBe(true);
    expect(done).toBe(1);
    expect(player.playing).toBe(false);
    expect(player.position).toBe(h.end);
  });

  it('lets go when the user goes elsewhere', () => {
    const clock = new FakeClock();
    const player = new ReplayPlayer(timeline, { clock, pace: { kind: 'fixed', seconds: 1 } });
    const halves = halfInnings(timeline);
    const h = halves.find((x) => x.inning === 3 && x.half === 'top')!;
    let done = 0;
    playHalfInning(player, h, () => done++);
    clock.advance(2_000);
    const later = halves.find((x) => x.inning === 6 && x.half === 'top')!;
    player.seek(later.start);
    clock.advance(30_000);
    expect(done).toBe(0);
    expect(player.playing).toBe(true);
    expect(player.position).toBeGreaterThan(later.start);
  });

  it('the first half of the game starts at the first entry', () => {
    const clock = new FakeClock();
    const player = new ReplayPlayer(timeline, { clock, pace: { kind: 'fixed', seconds: 1 } });
    const h = halfInnings(timeline)[0]!;
    let done = 0;
    playHalfInning(player, h, () => done++);
    clock.advance(10 * 60 * 1000);
    expect(done).toBe(1);
    expect(player.position).toBe(h.end);
  });
});
