// Which steps of a game deserve a notification, and what it says. Pure: state and events in,
// at most one notice out, so a busy play (a two-run double) is one notice, not three.

import type { GameEvent, GameState, Side } from '../model/types.ts';
import { eventLine, STRINGS, type Lang } from '../i18n/index.ts';
import { NOTIFY_KINDS, type NotifyKind } from '../settings/schema.ts';

export interface Notice {
  kind: NotifyKind;
  gamePk: number;
  /** "Home run", "Out · 2 out". */
  title: string;
  /** "Stowers solo HR to LCF · Top 6". */
  detail: string;
  away: { abbr: string; runs: number };
  home: { abbr: string; runs: number };
  /** "Top 6 · 2 out", for the ticker's score block. */
  situation: string;
  /** From a replay, so it is labelled and never mistaken for a live game. */
  replay: boolean;
}

/** When several apply to one step, the first one the user switched on wins. */
const PRIORITY: readonly NotifyKind[] = ['game', 'hr', 'run', 'half', 'hit', 'walk', 'k', 'sb', 'out', 'pchange'];
const HITS = new Set(['single', 'double', 'triple']);
const WALKS = new Set(['walk', 'intent_walk', 'hit_by_pitch']);
const STRIKEOUTS = new Set(['strikeout', 'strike_out', 'strikeout_double_play', 'strikeout_triple_play']);

type PA = Extract<GameEvent, { type: 'plateAppearance' }>;

/** Every kind this step counts as. */
export function kindsOf(prev: GameState | undefined, state: GameState, events: readonly GameEvent[]): Set<NotifyKind> {
  const out = new Set<NotifyKind>();
  const pa = events.find((e): e is PA => e.type === 'plateAppearance');
  for (const e of events) {
    if (e.type === 'gameEnd') out.add('game');
    if (e.type === 'inningChange' && e.inning === 1 && e.half === 'top') out.add('game');
    if (e.type === 'scoreChange') out.add('run');
    if (e.type === 'pitchingChange') out.add('pchange');
    if (e.type === 'baserunning' && /^(stolen_base|caught_stealing)/.test(e.kind)) out.add('sb');
  }
  if (pa?.result === 'home_run') out.add('hr');
  if (pa && HITS.has(pa.result)) out.add('hit');
  if (pa && WALKS.has(pa.result)) out.add('walk');
  if (pa && STRIKEOUTS.has(pa.result)) out.add('k');
  const sameHalf = prev !== undefined && prev.inning === state.inning && prev.half === state.half;
  const before = sameHalf ? prev.outs : 0;
  if (state.status !== 'final' && state.outs > before) {
    out.add('out');
    if (state.outs >= 3) out.add('half');
  }
  return out;
}

const DETAIL_PRIORITY: GameEvent['type'][] = ['plateAppearance', 'baserunning', 'pitchingChange'];

export function noticeFor(
  prev: GameState | undefined,
  state: GameState,
  events: readonly GameEvent[],
  enabled: Readonly<Record<NotifyKind, boolean>>,
  lang: Lang,
  replay: boolean,
): Notice | null {
  const kinds = kindsOf(prev, state, events);
  const kind = PRIORITY.find((k) => kinds.has(k) && enabled[k]);
  if (!kind) return null;
  const S = STRINGS[lang];
  const inning = S.inning(state.inning, state.half);
  const ended = events.some((e) => e.type === 'gameEnd');
  const title = kind === 'game' ? (ended ? S.notify.gameEnd : S.notify.gameStart)
    : kind === 'out' ? `${S.notify.out} · ${S.outs(Math.min(3, state.outs))}`
    : kind === 'half' ? S.notify.halfOver(inning)
    : S.notify[kind];
  // The most telling line of the step: the plate appearance, else the baserunning or pitching change.
  let line: { who?: string; text: string } | null = null;
  for (const type of DETAIL_PRIORITY) {
    const ev = events.find((e) => e.type === type);
    line = ev ? eventLine(ev, lang) : null;
    if (line) break;
  }
  const said = line ? `${line.who ? `${line.who} ` : ''}${line.text}` : '';
  const detail = kind === 'game' && !said ? `${state.teams.away.abbr} @ ${state.teams.home.abbr}`
    : [said, ended ? '' : inning].filter(Boolean).join(' · ');
  return {
    kind, gamePk: state.gamePk, title, detail, replay,
    away: { abbr: state.teams.away.abbr, runs: state.score.away },
    home: { abbr: state.teams.home.abbr, runs: state.score.home },
    situation: ended ? S.notify.gameEnd : `${inning} · ${S.outs(Math.min(3, state.outs))}`,
  };
}

// ---------- other games, from the schedule ----------

/** What the schedule says about one game: enough to notice a start, a run, a final. */
export interface GameSnap {
  gamePk: number;
  phase: 'pre' | 'live' | 'final' | 'other';
  away: string;
  home: string;
  runs: Record<Side, number>;
  inning?: number;
  half?: 'top' | 'bottom';
}

export type ScheduleChange =
  | { kind: 'start' | 'end'; snap: GameSnap }
  | { kind: 'run'; snap: GameSnap; side: Side; runs: number };

/** Changes between two polls. The first poll only sets the baseline. */
export function diffSchedule(before: ReadonlyMap<number, GameSnap> | null, now: readonly GameSnap[]): ScheduleChange[] {
  if (!before) return [];
  const out: ScheduleChange[] = [];
  for (const g of now) {
    const was = before.get(g.gamePk);
    if (!was) continue;
    if (was.phase === 'pre' && g.phase === 'live') out.push({ kind: 'start', snap: g });
    for (const side of ['away', 'home'] as Side[]) {
      const runs = g.runs[side] - was.runs[side];
      if (runs > 0 && (g.phase === 'live' || g.phase === 'final')) out.push({ kind: 'run', snap: g, side, runs });
    }
    if (was.phase === 'live' && g.phase === 'final') out.push({ kind: 'end', snap: g });
  }
  return out;
}

/** A notice for another game's change; only score, start and final are known for those. */
export function scheduleNotice(c: ScheduleChange, enabled: Readonly<Record<NotifyKind, boolean>>, lang: Lang): Notice | null {
  const kind: NotifyKind = c.kind === 'run' ? 'run' : 'game';
  if (!enabled[kind]) return null;
  const S = STRINGS[lang];
  const g = c.snap;
  const inning = g.inning && g.half ? S.inning(g.inning, g.half) : '';
  const title = c.kind === 'start' ? S.notify.gameStart : c.kind === 'end' ? S.notify.gameEnd : S.notify.run;
  const detail = c.kind === 'run'
    ? [`${c.side === 'away' ? g.away : g.home} +${c.runs}`, inning].filter(Boolean).join(' · ')
    : `${g.away} @ ${g.home}`;
  return {
    kind, gamePk: g.gamePk, title, detail, replay: false,
    away: { abbr: g.away, runs: g.runs.away },
    home: { abbr: g.home, runs: g.runs.home },
    situation: c.kind === 'end' ? S.notify.gameEnd : inning,
  };
}

export { NOTIFY_KINDS };
