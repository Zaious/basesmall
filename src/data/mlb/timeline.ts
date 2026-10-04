// MLB live feed -> normalized timeline. Pure functions, no I/O.
//
// The same function serves replay and live play: a live feed is just a timeline
// that has not ended yet, so a poller rebuilds it and emits the entries it has not seen.

import type {
  BattedBall,
  Base,
  BatLine,
  GameEvent,
  GameState,
  Hand,
  PitchLine,
  PitchMark,
  PlayerCard,
  PlayerRef,
  RunnerFrom,
  RunnerTo,
  Side,
  TeamRef,
  TimelineEntry,
} from '../../model/types.ts';
import type { MlbFeed, MlbPlay, MlbPlayEvent } from './feed-types.ts';
import {
  AT_BAT_EVENTS, AUTOMATIC_CALL, BASERUNNING_EVENTS, HIT_EVENTS, NON_AT_BAT_EVENTS, PITCH_CALL, STRIKEOUT_EVENTS, mapStatus,
} from './codes.ts';

export { mapStatus };

const BASES: readonly Base[] = ['1B', '2B', '3B'];
const other = (s: Side): Side => (s === 'away' ? 'home' : 'away');
const isBase = (b: string | null | undefined): b is Base => b === '1B' || b === '2B' || b === '3B';
/** Results that are not outs themselves: any out in the same play is news the result does not tell. */
const SAFE_RESULTS: ReadonlySet<string> = new Set([...HIT_EVENTS, 'walk', 'intent_walk', 'hit_by_pitch', 'field_error', 'catcher_interf']);
const hand = (code: string | undefined): Hand => (code === 'L' ? 'L' : 'R');

export function teamsOf(feed: MlbFeed): Record<Side, TeamRef> {
  const t = feed.gameData.teams;
  return {
    away: { id: t.away.id, abbr: t.away.abbreviation, name: t.away.name },
    home: { id: t.home.id, abbr: t.home.abbreviation, name: t.home.name },
  };
}

/** State before the first pitch, or of a game with no plays yet. */
/** Hover-card facts for everyone in the feed: position, hands, and the league's running totals. */
export function rosterOf(feed: MlbFeed): Record<number, PlayerCard> {
  const type = feed.gameData.game?.type;
  const kind = type === 'R' ? 'season' : type && 'FDLW'.includes(type) ? 'postseason' : undefined;
  const box = feed.liveData.boxscore?.teams;
  const out: Record<number, PlayerCard> = {};
  for (const [key, p] of Object.entries(feed.gameData.players ?? {})) {
    const b = box?.away?.players?.[key] ?? box?.home?.players?.[key];
    const card: PlayerCard = {};
    if (p.fullName) card.name = p.fullName;
    const pos = b?.position?.abbreviation ?? p.primaryPosition?.abbreviation;
    if (pos) card.pos = pos;
    if (p.batSide?.code) card.bats = p.batSide.code === 'S' ? 'S' : hand(p.batSide.code);
    if (p.pitchHand?.code) card.throws = hand(p.pitchHand.code);
    const s = b?.seasonStats;
    if (kind && s) {
      const bat = s.batting, pit = s.pitching;
      card.totals = { kind };
      if (bat && (bat.atBats ?? 0) > 0) card.totals.batting = { avg: bat.avg, hr: bat.homeRuns, rbi: bat.rbi, ops: bat.ops, ab: bat.atBats };
      if (pit && (pit.gamesPlayed ?? 0) > 0) card.totals.pitching = { era: pit.era, ip: pit.inningsPitched, k: pit.strikeOuts, w: pit.wins, l: pit.losses };
    }
    out[p.id] = card;
  }
  return out;
}

export function initialState(feed: MlbFeed): GameState {
  return {
    roster: rosterOf(feed),
    gamePk: feed.gamePk,
    status: mapStatus(feed.gameData.status),
    ...(feed.gameData.status.detailedState ? { statusDetail: feed.gameData.status.detailedState } : {}),
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
    ...(Date.parse(feed.gameData.gameInfo?.firstPitch ?? '') ? { startedAt: Date.parse(feed.gameData.gameInfo!.firstPitch!) } : {}),
  };
}

function pitchMark(e: MlbPlayEvent, n: number): PitchMark {
  const code = e.details?.call?.code ?? e.details?.code ?? '';
  const pd = e.pitchData;
  const mark: PitchMark = { n, call: PITCH_CALL[code] ?? 'other', callCode: code };
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
  const line = new Map<number, BatLine>();
  const pitchCount = new Map<number, number>();
  // Pitchers' lines apart from the pitch count, and the outs already credited in this half-inning.
  const pitching = new Map<number, Omit<PitchLine, 'pitches'>>();
  let creditedOuts = 0;
  const zeroBat = (): BatLine => ({ pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0 });
  const pitcherLine = (id: number) => pitching.get(id) ?? { outs: 0, h: 0, bb: 0, k: 0 };
  const snapshot = () => ({
    batLines: Object.fromEntries(line),
    pitchLines: Object.fromEntries([...new Set([...pitchCount.keys(), ...pitching.keys()])]
      .map((id) => [id, { ...pitcherLine(id), pitches: pitchCount.get(id) ?? 0 }])),
  });
  const lastPitcher: Partial<Record<Side, number>> = {};
  let bases = new Map<Base, number>();
  let lastHalf = '';
  let lastT = 0;

  const entries: TimelineEntry[] = [];
  const plays = feed.liveData.plays.allPlays;
  const gameOver = mapStatus(feed.gameData.status) === 'final';

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
      creditedOuts = 0;
      pendingInning = true;
      runsByInning[bat][inning - 1] ??= 0;
    }

    // Who is pitching before any substitution inside this plate appearance.
    const subInPlay = play.playEvents.some((e) => e.details?.eventType === 'pitching_substitution');
    let pitcherId = subInPlay ? (lastPitcher[field] ?? play.matchup.pitcher.id) : play.matchup.pitcher.id;
    lastPitcher[field] = pitcherId;

    const batter = ref(play.matchup.batter.id, play.matchup.batter.fullName);
    const entriesBefore = entries.length;
    const atBat: PitchMark[] = [];
    const lastIndex = play.playEvents.at(-1)?.index;

    for (const e of play.playEvents) {
      const kind = e.details?.eventType ?? '';
      const moves = play.runners.filter((r) => r.details.playIndex === e.index);
      const code = e.details?.call?.code ?? e.details?.code ?? '';
      const automatic = !e.isPitch ? AUTOMATIC_CALL[code] : undefined;
      const isLast = play.about.isComplete && e.index === lastIndex;
      const replaced = e.replacedPlayer?.id;
      const pinchRunner = kind === 'offensive_substitution' && e.player !== undefined && replaced !== undefined
        && [...bases.values()].includes(replaced);
      const baserunning = BASERUNNING_EVENTS.has(kind);
      const keep = e.isPitch || automatic !== undefined || pinchRunner || baserunning
        || kind === 'runner_placed' || kind === 'pitching_substitution' || moves.length > 0 || isLast;
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
      } else if (baserunning) {
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
        events.push({ type: 'automaticCall', call: automatic, description: e.details?.description ?? '' });
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
      const putOut: { runner: PlayerRef; at?: Base | 'home' }[] = [];
      for (const r of moves) {
        const { start, end, isOut } = r.movement;
        const from: RunnerFrom = isBase(start) ? start : 'batter';
        const to: RunnerTo | undefined = isOut ? 'out' : end === 'score' ? 'home' : isBase(end) ? end : undefined;
        const ob = r.movement.outBase;
        const outAt = isOut ? (isBase(ob) ? ob : ob === '4B' || ob === 'score' ? 'home' as const : undefined) : undefined;
        const runner = ref(r.details.runner.id, r.details.runner.fullName);
        if (to) events.push({ type: 'runnerAdvance', runner, from, to, cause: r.details.eventType ?? kind, ...(outAt ? { outAt } : {}) });
        if (isOut) putOut.push({ runner, ...(outAt ? { at: outAt } : {}) });
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

      let today = line.get(batter.id) ?? zeroBat();
      let outs = e.count.outs;
      if (isLast) {
        const result = play.result.eventType ?? 'unknown';
        const walk = result === 'walk' || result === 'intent_walk', k = STRIKEOUT_EVENTS.has(result);
        today = {
          pa: today.pa + (AT_BAT_EVENTS.has(result) || NON_AT_BAT_EVENTS.has(result) ? 1 : 0), ab: today.ab + (AT_BAT_EVENTS.has(result) ? 1 : 0), h: today.h + (HIT_EVENTS.has(result) ? 1 : 0),
          hr: today.hr + (result === 'home_run' ? 1 : 0), rbi: today.rbi + (play.result.rbi ?? 0),
          bb: today.bb + (walk ? 1 : 0), k: today.k + (k ? 1 : 0),
        };
        if (HIT_EVENTS.has(result)) hits[bat]++;
        line.set(batter.id, today);
        const pl = pitcherLine(pitcherId);
        pitching.set(pitcherId, { ...pl, h: pl.h + (HIT_EVENTS.has(result) ? 1 : 0), bb: pl.bb + (walk ? 1 : 0), k: pl.k + (k ? 1 : 0) });
        // Pitch-level outs are recorded before the play's outs; the play-level count is after.
        outs = play.count.outs;
        const last = e.isPitch ? battedBall(e) : undefined;
        // Outs on the bases that the result does not already say (a double, then out going for third).
        const extraOuts = SAFE_RESULTS.has(result) ? putOut : [];
        events.push({
          type: 'plateAppearance', result, rbi: play.result.rbi ?? 0, batter, isOut: !!play.result.isOut,
          ...(last ? { ball: last } : {}), ...(extraOuts.length ? { outsOnBases: extraOuts } : {}),
        });
      }

      if (outs > creditedOuts) {
        const pl = pitcherLine(pitcherId);
        pitching.set(pitcherId, { ...pl, outs: pl.outs + (outs - creditedOuts) });
        creditedOuts = outs;
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
          batter: { ...batter, side: hand(play.matchup.batSide?.code), today: { ab: today.ab, h: today.h } },
          pitcher: { ...ref(pitcherId), hand: hand(play.matchup.pitchHand?.code), pitches: pc },
          atBat: atBat.map((m) => ({ ...m })),
          teams,
          ...snapshot(),
        },
      });
    }

    // Live: a new batter is up but nothing has happened yet. Without this entry the board
    // would still show the previous plate appearance (or the previous half-inning).
    if (!gameOver && entries.length === entriesBefore && play === plays.at(-1) && !play.about.isComplete) {
      const today = line.get(batter.id) ?? zeroBat();
      entries.push({
        t: Math.max(lastT, Date.parse(play.about.startTime ?? '') || lastT),
        play: play.about.atBatIndex,
        event: -2,
        events: pendingInning ? [{ type: 'inningChange', inning, half }] : [],
        state: {
          ...base,
          status: 'live',
          inning,
          half,
          outs: play.count.outs,
          balls: play.count.balls,
          strikes: play.count.strikes,
          bases: Object.fromEntries([...bases].map(([b, id]) => [b, ref(id)])),
          score: { ...score },
          hits: { ...hits },
          errors: { ...errors },
          linescore: snapshotLinescore(runsByInning),
          batter: { ...batter, side: hand(play.matchup.batSide?.code), today: { ab: today.ab, h: today.h } },
          pitcher: { ...ref(pitcherId), hand: hand(play.matchup.pitchHand?.code), pitches: pitchCount.get(pitcherId) ?? 0 },
          atBat: [],
          teams,
          ...snapshot(),
        },
      });
    }
  }

  repairTimestamps(entries);
  const firstT = entries[0]?.t;
  for (const e of entries) {
    e.state.at = e.t;
    // No firstPitch in the feed yet (it can lag the first pitch): fall back to the first event.
    if (e.state.startedAt === undefined && firstT !== undefined) e.state.startedAt = firstT;
  }
  const status = mapStatus(feed.gameData.status);
  const detail = feed.gameData.status.detailedState;
  const last = entries.at(-1);
  if (last) {
    if (status === 'final') {
      last.state.status = 'live';
      // Game over: clear the board (stranded runners, the last count) so a glance reads "final".
      const minutes = feed.gameData.gameInfo?.gameDurationMinutes;
      const end = reconcile({ ...last.state, status: 'final', ...(detail ? { statusDetail: detail } : {}), ...(minutes ? { durationMinutes: minutes } : {}), bases: {}, balls: 0, strikes: 0, atBat: [] }, feed);
      const winner: Side | 'tie' = end.score.away === end.score.home ? 'tie' : end.score.away > end.score.home ? 'away' : 'home';
      entries.push({ t: last.t, play: last.play, event: -1, events: [{ type: 'gameEnd', winner, score: { ...end.score } }], state: end });
    } else {
      // Live: the last entry is "now", and the feed's linescore is the authority for now.
      last.state = reconcile({ ...last.state, status, ...(detail ? { statusDetail: detail } : {}) }, feed);
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

/**
 * Overwrite runs, hits, errors and runs per inning with the feed's own linescore.
 * Play-by-play cannot see everything: some errors (a dropped foul fly) have no play, and when
 * a game is called mid-inning the unfinished half does not count. Applied only to the entry
 * that represents the feed's present moment.
 */
export function reconcile(state: GameState, feed: MlbFeed): GameState {
  const ls = feed.liveData.linescore;
  if (!ls?.teams) return state;
  const sides: Side[] = ['away', 'home'];
  const pick = (k: 'runs' | 'hits' | 'errors', fallback: Record<Side, number>) =>
    Object.fromEntries(sides.map((s) => [s, ls.teams?.[s]?.[k] ?? fallback[s]])) as Record<Side, number>;
  const innings = ls.innings ?? [];
  return {
    ...state,
    score: pick('runs', state.score),
    hits: pick('hits', state.hits),
    errors: pick('errors', state.errors),
    linescore: innings.length
      ? Object.fromEntries(sides.map((s) => [s, innings.map((i) => i[s]?.runs ?? null)])) as Record<Side, (number | null)[]>
      : state.linescore,
  };
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
