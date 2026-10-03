// Every code in MLB's own catalogues must be classified on purpose, and the classification
// must agree with the flags MLB publishes. Catalogues come from scripts/probe/08-meta.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AT_BAT_EVENTS, AUTOMATIC_CALL, BASERUNNING_EVENTS, HANDLED_ACTIONS, HIT_EVENTS, IGNORED_EVENTS,
  NON_AT_BAT_EVENTS, NON_PITCH_CODES, PITCH_CALL, mapStatus,
} from '../src/data/mlb/codes.ts';

const meta = (name: string) => `fixtures/mlb/meta/${name}.json`;
const load = <T>(name: string): T => JSON.parse(readFileSync(meta(name), 'utf8')) as T;
const has = (name: string) => existsSync(meta(name));

interface EventType { code: string; plateAppearance: boolean; hit: boolean; baseRunningEvent: boolean }
interface PitchCode { code: string; pitchStatus: boolean; ballStatus: boolean; strikeStatus: boolean; contactStatus: boolean; swingContactStatus: boolean }
interface Status { abstractGameState: string; codedGameState: string; detailedState: string }

describe.skipIf(!has('eventTypes'))('event types', () => {
  const types = has('eventTypes') ? load<EventType[]>('eventTypes') : [];
  const groups = { AT_BAT_EVENTS, NON_AT_BAT_EVENTS, BASERUNNING_EVENTS, HANDLED_ACTIONS, IGNORED_EVENTS };

  it('every code is in exactly one group', () => {
    const problems = types.flatMap((t) => {
      const inGroups = Object.entries(groups).filter(([, set]) => set.has(t.code)).map(([n]) => n);
      return inGroups.length === 1 ? [] : [`${t.code}: ${inGroups.join(', ') || 'unclassified'}`];
    });
    expect(problems).toEqual([]);
  });

  it('no group lists a code MLB does not have', () => {
    const known = new Set(types.map((t) => t.code));
    const stray = Object.values(groups).flatMap((set) => [...set].filter((c) => !known.has(c)));
    expect(stray).toEqual([]);
  });

  it('hits are exactly the codes MLB flags as hits', () => {
    expect([...HIT_EVENTS].sort()).toEqual(types.filter((t) => t.hit).map((t) => t.code).sort());
  });

  it('codes MLB flags as base-running are base-running events', () => {
    expect(types.filter((t) => t.baseRunningEvent && !BASERUNNING_EVENTS.has(t.code)).map((t) => t.code)).toEqual([]);
  });

  it('codes MLB flags as plate-appearance results count as at-bat or not, never neither', () => {
    const pa = types.filter((t) => t.plateAppearance).map((t) => t.code);
    expect(pa.filter((c) => !AT_BAT_EVENTS.has(c) && !NON_AT_BAT_EVENTS.has(c))).toEqual([]);
  });
});

describe.skipIf(!has('pitchCodes'))('pitch codes', () => {
  const codes = has('pitchCodes') ? load<PitchCode[]>('pitchCodes') : [];

  it('every code is a pitch, an automatic call, or a non-pitch, exactly once', () => {
    const problems = codes.flatMap((p) => {
      const n = Number(p.code in PITCH_CALL) + Number(p.code in AUTOMATIC_CALL) + Number(NON_PITCH_CODES.has(p.code));
      return n === 1 ? [] : [`${p.code}: in ${n} tables`];
    });
    expect(problems).toEqual([]);
  });

  it('real pitches are exactly the codes MLB marks as pitches', () => {
    expect(Object.keys(PITCH_CALL).sort()).toEqual(codes.filter((p) => p.pitchStatus).map((p) => p.code).sort());
  });

  it('each pitch call agrees with MLB ball / strike / contact flags', () => {
    const wrong = codes.filter((p) => p.pitchStatus).flatMap((p) => {
      const call = PITCH_CALL[p.code]!;
      const ok = p.ballStatus ? call === 'ball' || call === 'hitByPitch'
        : p.swingContactStatus ? call === 'inPlay'
        : p.contactStatus ? call === 'foul'
        : call === 'calledStrike' || call === 'swingingStrike';
      return ok ? [] : [`${p.code} -> ${call}`];
    });
    expect(wrong).toEqual([]);
  });

  it('automatic calls agree with MLB ball / strike flags', () => {
    const wrong = codes.filter((p) => p.code in AUTOMATIC_CALL)
      .filter((p) => (AUTOMATIC_CALL[p.code] === 'ball') !== p.ballStatus || (AUTOMATIC_CALL[p.code] === 'strike') !== p.strikeStatus)
      .map((p) => p.code);
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!has('gameStatus'))('game statuses', () => {
  const statuses = has('gameStatus') ? load<Status[]>('gameStatus') : [];
  const label = (s: Status) => `${s.abstractGameState}/${s.codedGameState} ${s.detailedState}`;

  it('only the status MLB itself calls Unknown maps to unknown', () => {
    expect(statuses.filter((s) => mapStatus(s) === 'unknown').map(label)).toEqual(['Other/X Unknown']);
  });

  it('maps each family as expected', () => {
    const expectFamily = (pred: (s: Status) => boolean, want: string) =>
      expect(statuses.filter(pred).filter((s) => mapStatus(s) !== want).map(label), want).toEqual([]);
    expectFamily((s) => s.detailedState.startsWith('Postponed'), 'postponed');
    expectFamily((s) => s.detailedState.startsWith('Cancelled'), 'cancelled');
    expectFamily((s) => s.detailedState.startsWith('Suspended') && s.abstractGameState === 'Live', 'suspended');
    expectFamily((s) => /^(Manager challenge|Umpire review)/.test(s.detailedState), 'review');
    expectFamily((s) => s.abstractGameState === 'Live' && s.detailedState.startsWith('Delayed'), 'delayed');
    expectFamily((s) => s.detailedState.startsWith('Delayed Start'), 'delayed');
    expectFamily((s) => /^(Final|Game Over|Completed Early|Forfeit)/.test(s.detailedState), 'final');
    expectFamily((s) => s.detailedState === 'In Progress', 'live');
    expectFamily((s) => s.detailedState === 'Pre-Game' || s.detailedState === 'Warmup', 'pregame');
  });
});
