// MLB live feed -> normalized timeline. Pure functions, no I/O.
//
// The same function serves replay and live play: a live feed is just a timeline
// that has not ended yet, so a poller rebuilds it and emits the entries it has not seen.

import type {
  BattedBall,
  Base,
  GameEvent,
  GameState,
  GameStatus,
  Hand,
  PitchCall,
  PitchMark,
  PlayerRef,
  RunnerFrom,
  RunnerTo,
  Side,
  TeamRef,
  TimelineEntry,
} from '../../model/types.ts';
import type { MlbFeed, MlbPlay, MlbPlayEvent } from './feed-types.ts';

const BASES: readonly Base[] = ['1B', '2B', '3B'];
const HITS = new Set(['single', 'double', 'triple', 'home_run']);
/** Plate-appearance results that are official at-bats. Walks, HBP, sacrifices,
 *  interference and outs made on the bases while the batter is up are not. */
const AT_BATS = new Set([
  'single', 'double', 'triple', 'home_run',
  'field_out', 'force_out', 'fielders_choice', 'fielders_choice_out', 'field_error',
  'strikeout', 'strikeout_double_play', 'strikeout_triple_play',
  'grounded_into_double_play', 'grounded_into_triple_play', 'double_play', 'triple_play',
]);
/** Non-pitch events worth a timeline entry even when no runner moves. */
const KEPT_ACTIONS = /^(runner_placed|pitching_substitution|stolen_base|caught_stealing|pickoff|wild_pitch|passed_ball|balk|other_advance|defensive_indiff|error)/;

const CALLS: Record<string, PitchCall> = {
  B: 'ball', '*B': 'ball', P: 'ball', I: 'ball', V: 'ball', VB: 'ball',
  C: 'calledStrike', A: 'calledStrike', AC: 'calledStrike',
  S: 'swingingStrike', W: 'swingingStrike', M: 'swingingStrike', Q: 'swingingStrike', T: 'swingingStrike',
  F: 'foul', L: 'foul', R: 'foul',
  X: 'inPlay', D: 'inPlay', E: 'inPlay',
  H: 'hitByPitch',
};

const other = (s: Side): Side => (s === 'away' ? 'home' : 'away');
const isBase = (b: string | null | undefined): b is Base => b === '1B' || b === '2B' || b === '3B';
const hand = (code: string | undefined): Hand => (code === 'L' ? 'L' : 'R');

export function mapStatus(status: MlbFeed['gameData']['status']): GameStatus {
  const abstract = status.abstractGameState ?? '';
  const detailed = (status.detailedState ?? '').toLowerCase();
  if (detailed.includes('postponed')) return 'postponed';
  if (detailed.includes('suspended')) return 'suspended';
  if (abstract === 'Final') return 'final';
  if (abstract === 'Live') return detailed.includes('delay') ? 'delayed' : 'live';
  if (abstract === 'Preview') return detailed.includes('pre-game') || detailed.includes('warmup') ? 'pregame' : 'scheduled';
  return 'unknown';
}

export function teamsOf(feed: MlbFeed): Record<Side, TeamRef> {
  const t = feed.gameData.teams;
  return {
    away: { id: t.away.id, abbr: t.away.abbreviation, name: t.away.name },
    home: { id: t.home.id, abbr: t.home.abbreviation, name: t.home.name },
  };
}

/** State before the first pitch, or of a game with no plays yet. */
export function initialState(feed: MlbFeed): GameState {
  return {
    gamePk: feed.gamePk,
    status: mapStatus(feed.gameData.status),
    teams: teamsOf(feed),
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: {},
    score: { away: 0, home: 0 },
    hits: { away: 0, home: 0 },
    errors: { away: 0, home: 0 },
    linescore: { away: [], home: [] },
    atBat: [],
  };
}

function pitchMark(e: MlbPlayEvent, n: number): PitchMark {
  const code = e.details?.call?.code ?? e.details?.code ?? '';
  const pd = e.pitchData;
  const mark: PitchMark = { n, call: CALLS[code] ?? 'other', callCode: code };
  const set = <K extends keyof PitchMark>(k: K, v: PitchMark[K] | undefined) => { if (v !== undefined && v !== null) mark[k] = v; };
  set('x', pd?.coordinates?.pX);
  set('z', pd?.coordinates?.pZ);
  set('szTop', pd?.strikeZoneTop);
  set('szBottom', pd?.strikeZoneBottom);
  set('zone', pd?.zone);
  set('type', e.details?.type?.code);
  set('speed', pd?.startSpeed);
  return mark;
}

function battedBall(e: MlbPlayEvent): BattedBall | undefined {
  const h = e.hitData;
  if (!h) return undefined;
  const ball: BattedBall = {};
  const set = <K extends keyof BattedBall>(k: K, v: BattedBall[K] | undefined) => { if (v !== undefined && v !== null) ball[k] = v; };
  set('location', h.location);
  set('trajectory', h.trajectory);
  set('hardness', h.hardness);
  set('coordX', h.coordinates?.coordX);
  set('coordY', h.coordinates?.coordY);
  set('launchSpeed', h.launchSpeed);
  set('launchAngle', h.launchAngle);
  set('distance', h.totalDistance);
  return ball;
}

export function buildTimeline(feed: MlbFeed): TimelineEntry[] {
  const players = feed.gameData.players ?? {};
  const ref = (id: number, fallback?: string): PlayerRef => {
    const p = players['ID' + id];
    const name = p?.fullName ?? fallback ?? String(id);
    return { id, name, short: p?.lastName ?? p?.boxscoreName ?? name.split(' ').at(-1) ?? name };
  };

  const base = initialState(feed);
  const teams = base.teams;
  const score: Record<Side, number> = { away: 0, home: 0 };
  const hits: Record<Side, number> = { away: 0, home: 0 };
  const errors: Record<Side, number> = { away: 0, home: 0 };
  const runsByInning: Record<Side, (number | null)[]> = { away: [], home: [] };
  const line = new Map<number, { ab: number; h: number }>();
  const pitchCount = new Map<number, number>();
  const lastPitcher: Partial<Record<Side, number>> = {};
  let bases = new Map<Base, number>();
  let lastHalf = '';
  let lastT = 0;

  const entries: TimelineEntry[] = [];
  const plays = feed.liveData.plays.allPlays;

  for (const play of plays) {
    const { inning } = play.about;
    const half = play.about.isTopInning ? 'top' : 'bottom';
    const bat: Side = half === 'top' ? 'away' : 'home';
    const field = other(bat);
    const halfKey = `${inning}${half}`;
    let pendingInning = false;
    if (halfKey !== lastHalf) {
      bases = new Map();
      lastHalf = halfKey;
      pendingInning = true;
      runsByInning[bat][inning - 1] ??= 0;
    }

    // Who is pitching before any substitution inside this plate appearance.
    const subInPlay = play.playEvents.some((e) => e.details?.eventType === 'pitching_substitution');
    let pitcherId = subInPlay ? (lastPitcher[field] ?? play.matchup.pitcher.id) : play.matchup.pitcher.id;
    lastPitcher[field] = pitcherId;

    const batter = ref(play.matchup.batter.id, play.matchup.batter.fullName);
    const atBat: PitchMark[] = [];
    const lastIndex = play.playEvents.at(-1)?.index;
    let prevCount = { balls: 0, strikes: 0 };

    for (const e of play.playEvents) {
      const kind = e.details?.eventType ?? '';
      const moves = play.runners.filter((r) => r.details.playIndex === e.index);
      const countChanged = e.count.balls !== prevCount.balls || e.count.strikes !== prevCount.strikes;
      const automatic = e.type === 'no_pitch' && countChanged && (e.details?.isBall || e.details?.isStrike);
      const isLast = play.about.isComplete && e.index === lastIndex;
      const replaced = e.replacedPlayer?.id;
      const pinchRunner = kind === 'offensive_substitution' && e.player !== undefined && replaced !== undefined
        && [...bases.values()].includes(replaced);
      const keep = e.isPitch || automatic || pinchRunner || KEPT_ACTIONS.test(kind) || moves.length > 0 || isLast;
      prevCount = { balls: e.count.balls, strikes: e.count.strikes };
      if (!keep) continue;

      const events: GameEvent[] = [];
      if (pendingInning) {
        events.push({ type: 'inningChange', inning, half });
        pendingInning = false;
      }

      if (kind === 'pitching_substitution' && e.player) {
        pitcherId = e.player.id;
        lastPitcher[field] = pitcherId;
        events.push({ type: 'pitchingChange', side: field, pitcher: ref(pitcherId) });
      } else if (kind === 'runner_placed' && e.player) {
        const b = `${e.base ?? 2}B`;
        if (isBase(b)) {
          for (const [k, v] of bases) if (v === e.player.id) bases.delete(k);
          bases.set(b, e.player.id);
          events.push({ type: 'runnerPlaced', runner: ref(e.player.id), base: b });
        }
      } else if (pinchRunner && e.player && replaced !== undefined) {
        for (const [b, id] of bases) {
          if (id !== replaced) continue;
          bases.set(b, e.player.id);
          events.push({ type: 'runnerPlaced', runner: ref(e.player.id), base: b, replaces: ref(replaced) });
        }
      } else if (!e.isPitch && !automatic && KEPT_ACTIONS.test(kind)) {
        const who = e.player?.id ?? moves[0]?.details.runner.id;
        events.push(who !== undefined ? { type: 'baserunning', kind, runner: ref(who) } : { type: 'baserunning', kind });
      }

      if (e.isPitch) {
        pitchCount.set(pitcherId, (pitchCount.get(pitcherId) ?? 0) + 1);
        const mark = pitchMark(e, atBat.length + 1);
        atBat.push(mark);
        events.push({ type: 'pitch', pitch: mark });
        const ball = e.details?.isInPlay ? battedBall(e) : undefined;
        if (ball) events.push({ type: 'ballInPlay', ball });
      } else if (automatic) {
        events.push({ type: 'automaticCall', call: e.details?.isBall ? 'ball' : 'strike', description: e.details?.description ?? '' });
      }

      // Runner movements. A runner can have several segments in one event (1B->2B, then
      // 2B->3B), and the list often starts with the batter, so placing segment by segment
      // would overwrite a runner who has not moved yet. Lift every mover first, then put
      // each one where their last segment ends.
      let runs = 0;
      const movers = new Set(moves.map((r) => r.details.runner.id));
      for (const r of moves) {
        const start = r.movement.start;
        // Someone else on the base this runner starts from was replaced without us seeing it.
        if (isBase(start) && bases.has(start) && !movers.has(bases.get(start)!)) bases.delete(start);
      }
      for (const [k, v] of bases) if (movers.has(v)) bases.delete(k);
      const finalSegment = new Map(moves.map((r) => [r.details.runner.id, r]));
      for (const [id, r] of finalSegment) {
        const { end, isOut } = r.movement;
        if (isOut) continue;
        if (end === 'score') runs++;
        else if (isBase(end)) bases.set(end, id);
      }
      for (const r of moves) {
        const { start, end, isOut } = r.movement;
        const from: RunnerFrom = isBase(start) ? start : 'batter';
        const to: RunnerTo | undefined = isOut ? 'out' : end === 'score' ? 'home' : isBase(end) ? end : undefined;
        if (to) events.push({ type: 'runnerAdvance', runner: ref(r.details.runner.id, r.details.runner.fullName), from, to, cause: r.details.eventType ?? kind });
        for (const c of r.credits ?? []) if (c.credit.includes('error')) errors[field]++;
      }

      if (isLast) {
        // The play's own score is authoritative; it also covers runs our movements missed.
        const official = { away: play.result.awayScore ?? score.away, home: play.result.homeScore ?? score.home };
        runs = Math.max(runs, official[bat] - score[bat]);
      }
      if (runs > 0) {
        score[bat] += runs;
        runsByInning[bat][inning - 1] = (runsByInning[bat][inning - 1] ?? 0) + runs;
        events.push({ type: 'scoreChange', side: bat, runs, score: { ...score } });
      }

      const today = line.get(batter.id) ?? { ab: 0, h: 0 };
      let outs = e.count.outs;
      if (isLast) {
        const result = play.result.eventType ?? 'unknown';
        if (AT_BATS.has(result)) today.ab++;
        if (HITS.has(result)) { today.h++; hits[bat]++; }
        line.set(batter.id, today);
        // Pitch-level outs are recorded before the play's outs; the play-level count is after.
        outs = play.count.outs;
        const last = e.isPitch ? battedBall(e) : undefined;
        events.push({
          type: 'plateAppearance', result, rbi: play.result.rbi ?? 0, batter, isOut: !!play.result.isOut,
          ...(last ? { ball: last } : {}),
        });
      }

      const stamped = Date.parse(e.startTime ?? play.about.startTime ?? '');
      // Replays start at the 2023 season (current rules era), where every event is stamped;
      // a missing stamp just inherits the previous one.
      const t = Number.isNaN(stamped) ? lastT : stamped;
      lastT = t;
      const pc = pitchCount.get(pitcherId) ?? 0;
      entries.push({
        t,
        play: play.about.atBatIndex,
        event: e.index,
        events,
        state: {
          ...base,
          status: 'live',
          inning,
          half,
          outs,
          balls: isLast ? play.count.balls : e.count.balls,
          strikes: isLast ? play.count.strikes : e.count.strikes,
          bases: Object.fromEntries([...bases].map(([b, id]) => [b, ref(id)])),
          score: { ...score },
          hits: { ...hits },
          errors: { ...errors },
          linescore: snapshotLinescore(runsByInning),
          batter: { ...batter, side: hand(play.matchup.batSide?.code), today: { ...today } },
          pitcher: { ...ref(pitcherId), hand: hand(play.matchup.pitchHand?.code), pitches: pc },
          atBat: atBat.map((m) => ({ ...m })),
          teams,
        },
      });
    }
  }

  repairTimestamps(entries);
  const status = mapStatus(feed.gameData.status);
  const last = entries.at(-1);
  if (last) {
    last.state.status = status === 'final' ? 'live' : status;
    if (status === 'final') {
      const winner: Side | 'tie' = score.away === score.home ? 'tie' : score.away > score.home ? 'away' : 'home';
      entries.push({
        t: last.t,
        play: last.play,
        event: -1,
        events: [{ type: 'gameEnd', winner, score: { ...score } }],
        state: { ...last.state, status: 'final' },
      });
    }
  }
  return entries;
}

/**
 * Make timestamps non-decreasing. Some feeds carry a run of events stamped later than the
 * plays that follow them (a 2015 game has four plate appearances 27 minutes ahead). Play
 * order is trusted; the out-of-order run is spread evenly between its neighbours.
 */
export function repairTimestamps(entries: { t: number }[]): number {
  let repaired = 0;
  for (let i = 1; i < entries.length; i++) {
    const hi = entries[i]!.t;
    if (hi >= entries[i - 1]!.t) continue;
    let j = i - 1;
    while (j > 0 && entries[j - 1]!.t > hi) j--;
    const lo = j > 0 ? entries[j - 1]!.t : hi - (i - j) * 1000;
    const step = (hi - lo) / (i - j + 1);
    for (let k = j; k < i; k++) entries[k]!.t = Math.round(lo + step * (k - j + 1));
    repaired += i - j;
  }
  return repaired;
}

function snapshotLinescore(runs: Record<Side, (number | null)[]>): Record<Side, (number | null)[]> {
  const n = Math.max(runs.away.length, runs.home.length);
  const fill = (a: (number | null)[]) => Array.from({ length: n }, (_, i) => a[i] ?? null);
  return { away: fill(runs.away), home: fill(runs.home) };
}

/** Current state of a feed: the last timeline entry, or the pre-game state. */
export function stateOf(feed: MlbFeed, timeline = buildTimeline(feed)): GameState {
  return timeline.at(-1)?.state ?? initialState(feed);
}

export type { MlbFeed, MlbPlay };
