import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import type { GameEvent, GameState } from '../src/model/types.ts';
import { diffSchedule, kindsOf, noticeFor, scheduleNotice, type GameSnap } from '../src/notify/rules.ts';
import { DEFAULTS, NOTIFY_KINDS, type NotifyKind } from '../src/settings/schema.ts';
import { hasFixture, loadFixture } from './fixtures.ts';

const ALL = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, true])) as Record<NotifyKind, boolean>;
const NONE = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, false])) as Record<NotifyKind, boolean>;
const ref = (id: number, short = `P${id}`) => ({ id, name: short, short });
const STATE: GameState = {
  gamePk: 1, status: 'live', teams: { away: { id: 1, abbr: 'NYY', name: 'Yankees' }, home: { id: 2, abbr: 'TB', name: 'Rays' } },
  inning: 7, half: 'top', outs: 1, balls: 0, strikes: 0, bases: {}, score: { away: 5, home: 2 },
  hits: { away: 8, home: 4 }, errors: { away: 0, home: 0 }, linescore: { away: [], home: [] }, atBat: [],
};

describe('which kind a step is', () => {
  it('a two-run homer is a home run first, then a run', () => {
    const events: GameEvent[] = [
      { type: 'scoreChange', side: 'away', runs: 2, score: { away: 5, home: 2 } },
      { type: 'plateAppearance', result: 'home_run', rbi: 2, batter: ref(9, 'Judge'), isOut: false, ball: { location: '7' } },
    ];
    expect(kindsOf({ ...STATE, score: { away: 3, home: 2 } }, STATE, events)).toEqual(new Set(['run', 'hr']));
    const zh = noticeFor({ ...STATE, score: { away: 3, home: 2 } }, STATE, events, ALL, 'zh-Hant', false)!;
    expect(zh).toMatchObject({ kind: 'hr', title: '全壘打', away: { abbr: 'NYY', runs: 5 }, home: { abbr: 'TB', runs: 2 } });
    expect(zh.detail).toBe('Judge 左外野兩分砲 · 7 局上');
    // Home runs switched off: the same step still tells about the run.
    expect(noticeFor(undefined, STATE, events, { ...ALL, hr: false }, 'en', false)!.kind).toBe('run');
  });

  it('outs count within the half; the third out ends it', () => {
    const before = { ...STATE, outs: 1 };
    const pa: GameEvent = { type: 'plateAppearance', result: 'field_out', rbi: 0, batter: ref(3), isOut: true, ball: { location: '6', trajectory: 'ground_ball' } };
    expect(noticeFor(before, { ...STATE, outs: 2 }, [pa], ALL, 'zh-Hant', false)).toMatchObject({ kind: 'out', title: '出局 · 2 出局' });
    expect(noticeFor(before, { ...STATE, outs: 3 }, [pa], ALL, 'zh-Hant', false)).toMatchObject({ kind: 'half', title: '7 局上結束' });
    // A new half starts at zero outs: that is not an out.
    expect(kindsOf({ ...STATE, half: 'bottom', inning: 6, outs: 3 }, { ...STATE, outs: 0 }, [])).toEqual(new Set());
  });

  it('nothing the user switched off, and replays say so', () => {
    const k: GameEvent = { type: 'plateAppearance', result: 'strikeout', rbi: 0, batter: ref(3), isOut: true };
    expect(noticeFor({ ...STATE, outs: 0 }, STATE, [k], NONE, 'en', false)).toBeNull();
    expect(noticeFor({ ...STATE, outs: 0 }, STATE, [k], { ...NONE, k: true }, 'en', true)).toMatchObject({ kind: 'k', title: 'Strikeout', replay: true });
  });

  it('first pitch and final', () => {
    expect(noticeFor(undefined, { ...STATE, inning: 1 }, [{ type: 'inningChange', inning: 1, half: 'top' }], ALL, 'en', false))
      .toMatchObject({ kind: 'game', title: 'First pitch', detail: 'NYY @ TB' });
    expect(noticeFor(STATE, { ...STATE, status: 'final' }, [{ type: 'gameEnd', winner: 'away', score: { away: 5, home: 2 } }], ALL, 'zh-Hant', false))
      .toMatchObject({ kind: 'game', title: '終場', situation: '終場' });
  });
});

describe.skipIf(!hasFixture(849841))('a whole game with the default events', () => {
  it('notifies far fewer steps than there are, and every run is in a notice', () => {
    const tl = buildTimeline(loadFixture(849841));
    let prev: GameState | undefined;
    const kinds: string[] = [];
    let runsNotified = 0;
    for (const e of tl) {
      const n = noticeFor(prev, e.state, e.events, DEFAULTS.notify.events, 'en', false);
      if (n) kinds.push(n.kind);
      if (n && e.events.some((x) => x.type === 'scoreChange')) runsNotified++;
      prev = e.state;
    }
    const scoring = tl.filter((e) => e.events.some((x) => x.type === 'scoreChange')).length;
    expect(runsNotified).toBe(scoring);
    expect(kinds.length).toBeLessThan(tl.length / 2);
    expect(kinds[0]).toBe('game');
    expect(kinds.at(-1)).toBe('game');
  });
});

describe('other games, from the schedule', () => {
  const snap = (pk: number, phase: GameSnap['phase'], away: number, home: number): GameSnap =>
    ({ gamePk: pk, phase, away: 'NYY', home: 'TB', runs: { away, home }, inning: 5, half: 'bottom' });

  it('the first poll is only a baseline', () => {
    expect(diffSchedule(null, [snap(1, 'live', 1, 0)])).toEqual([]);
  });

  it('notices a start, runs on either side, and a final', () => {
    const before = new Map([[1, snap(1, 'pre', 0, 0)], [2, snap(2, 'live', 2, 2)], [3, snap(3, 'live', 4, 1)]]);
    const changes = diffSchedule(before, [snap(1, 'live', 0, 0), snap(2, 'live', 2, 4), snap(3, 'final', 4, 1)]);
    expect(changes.map((c) => [c.kind, c.snap.gamePk, 'side' in c ? c.side : '', 'runs' in c ? c.runs : 0]))
      .toEqual([['start', 1, '', 0], ['run', 2, 'home', 2], ['end', 3, '', 0]]);
    const run = scheduleNotice(changes[1]!, ALL, 'zh-Hant')!;
    expect(run).toMatchObject({ kind: 'run', title: '得分', detail: 'TB +2 · 5 局下', home: { runs: 4 } });
    expect(scheduleNotice(changes[1]!, { ...ALL, run: false }, 'en')).toBeNull();
  });
});
