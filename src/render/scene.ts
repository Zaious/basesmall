// The board as data: which pieces stand where, and how one step moves them to the next.
// Pure, so a whole game can be checked against the official state without a screen.
// Renderers draw a Scene and play a Plan; they never work out baseball themselves.

import type { Base, BattedBall, GameEvent, GameState, PlayerRef, Side } from '../model/types.ts';

/** 0 home plate, 1–3 the bases, 4 home again (a run). Fractions lie on the base path. */
export type Spot = number | 'mound';

export interface Piece {
  key: string;
  /** Player id. */
  id: number;
  /** Short name, for the label beside a runner. */
  name?: string;
  side: Side;
  role: 'batter' | 'runner' | 'pitcher';
  spot: Spot;
}
export type Scene = ReadonlyMap<string, Piece>;

export const BASE_SPOT: Record<Base, number> = { '1B': 1, '2B': 2, '3B': 3 };
export const PITCHER_KEY = 'p';
export const runnerKey = (id: number) => `r${id}`;
const OVER = new Set(['final', 'postponed', 'cancelled']);

/** Durations at speed 1, milliseconds. */
export const TIMING = { flight: 750, perBase: 330, fade: 240, out: 420, flip: 560, swap: 460 } as const;

/**
 * The pieces a state puts on the board: runners on their bases, the batter at the plate
 * (unless the plate appearance just ended), the pitcher on the mound. A finished game is empty.
 */
export function sceneOf(state: GameState, events: readonly GameEvent[] = []): Map<string, Piece> {
  const scene = new Map<string, Piece>();
  if (OVER.has(state.status)) return scene;
  const bat: Side = state.half === 'top' ? 'away' : 'home';
  for (const [b, p] of Object.entries(state.bases) as [Base, PlayerRef][]) {
    scene.set(runnerKey(p.id), { key: runnerKey(p.id), id: p.id, name: p.short, side: bat, role: 'runner', spot: BASE_SPOT[b] });
  }
  const paDone = events.some((e) => e.type === 'plateAppearance');
  if (state.batter && !paDone && !scene.has(runnerKey(state.batter.id))) {
    const key = runnerKey(state.batter.id);
    scene.set(key, { key, id: state.batter.id, name: state.batter.short, side: bat, role: 'batter', spot: 0 });
  }
  if (state.pitcher) {
    scene.set(PITCHER_KEY, { key: PITCHER_KEY, id: state.pitcher.id, name: state.pitcher.short, side: bat === 'away' ? 'home' : 'away', role: 'pitcher', spot: 'mound' });
  }
  return scene;
}

export type Track =
  /** Run along the base path; `path` lists every spot touched, so a double from first passes second. */
  | { kind: 'move'; key: string; path: number[]; at: number; dur: number; to: Piece }
  /** Run home, then fade out. `dur` covers both. */
  | { kind: 'score'; key: string; path: number[]; at: number; dur: number }
  /** Put out: drift a little toward `toward`, fading. */
  /** `run`: the base reached safely first, at running speed; then all the way to `toward`, fading. */
  | { kind: 'out'; key: string; from: number; toward: number; at: number; dur: number; run?: number }
  /** Leave without a play: strikeout batter, stranded runner, replaced runner. */
  | { kind: 'leave'; key: string; at: number; dur: number }
  /** Appear. `flipFrom` shows the piece in that side's colour first and turns it over. */
  | { kind: 'enter'; key: string; at: number; dur: number; piece: Piece; flipFrom?: Side }
  /** Turn over to the other side's colour: the pitcher when the half-inning changes. */
  | { kind: 'flip'; key: string; at: number; dur: number; to: Piece }
  /** Same spot, new player: a pitching change. */
  | { kind: 'swap'; key: string; at: number; dur: number; to: Piece };

export interface Plan {
  /** A batted ball with a landing point, drawn before anyone runs. */
  ball?: BattedBall;
  /** How long the ball flies at speed 1; runners start after it. */
  flight: number;
  tracks: Track[];
  /** Milliseconds at speed 1 until everything has settled. */
  total: number;
  /** The scene after the step: always sceneOf(state, events). */
  end: Map<string, Piece>;
  /** Runners whose event-derived path did not end where the state puts them (drawn straight instead). */
  mismatches: string[];
}

/** `outAt`: the spot where the runner was put out, when the league says. */
interface Path { spots: number[]; out: boolean; outAt?: number }

/** Each runner's route in this step, from the runner-advance events, in order. */
function routes(events: readonly GameEvent[]): Map<number, Path> {
  const out = new Map<number, Path>();
  for (const ev of events) {
    if (ev.type !== 'runnerAdvance') continue;
    const from = ev.from === 'batter' ? 0 : BASE_SPOT[ev.from];
    const r = out.get(ev.runner.id) ?? { spots: [from], out: false };
    out.set(ev.runner.id, r);
    let last = r.spots.at(-1)!;
    if (from > last) { r.spots.push(from); last = from; }
    if (ev.to === 'out') { r.out = true; if (ev.outAt) r.outAt = ev.outAt === 'home' ? 4 : BASE_SPOT[ev.outAt]; continue; }
    const target = ev.to === 'home' ? 4 : BASE_SPOT[ev.to];
    for (let s = last + 1; s <= target; s++) r.spots.push(s);
  }
  return out;
}

export function planStep(prevScene: Scene, state: GameState, events: readonly GameEvent[]): Plan {
  const end = sceneOf(state, events);
  const ballEv = events.find((e): e is Extract<GameEvent, { type: 'ballInPlay' }> => e.type === 'ballInPlay');
  const ball = ballEv?.ball.coordX !== undefined && ballEv.ball.coordY !== undefined ? ballEv.ball : undefined;
  const flight = ball ? TIMING.flight : 0;
  const paths = routes(events);
  const tracks: Track[] = [];
  const mismatches: string[] = [];

  // A batter who ends the plate appearance on its first pitch was never shown at the plate.
  // Put him there as the pitch is thrown, so he can run (or walk off) like anyone else.
  let prev = prevScene;
  const b = state.batter;
  const thrown = events.some((e) => e.type === 'pitch' || e.type === 'automaticCall');
  if (b && thrown && !prev.has(runnerKey(b.id)) && paths.get(b.id)?.spots[0] !== undefined) {
    const piece: Piece = { key: runnerKey(b.id), id: b.id, name: b.short, side: state.half === 'top' ? 'away' : 'home', role: 'batter', spot: 0 };
    prev = new Map(prev).set(piece.key, piece);
    tracks.push({ kind: 'enter', key: piece.key, at: 0, dur: TIMING.fade, piece });
  }
  const halfChange = events.some((e) => e.type === 'inningChange')
    || (prev.get(PITCHER_KEY) !== undefined && end.get(PITCHER_KEY) !== undefined && prev.get(PITCHER_KEY)!.side !== end.get(PITCHER_KEY)!.side);

  let movesEnd = flight;
  for (const key of new Set([...prev.keys(), ...end.keys()])) {
    const p = prev.get(key), n = end.get(key);
    if (key === PITCHER_KEY) {
      if (p && n && p.side !== n.side) tracks.push({ kind: 'flip', key, at: 0, dur: TIMING.flip, to: n });
      else if (p && n && p.id !== n.id) tracks.push({ kind: 'swap', key, at: 0, dur: TIMING.swap, to: n });
      else if (!p && n) tracks.push({ kind: 'enter', key, at: 0, dur: TIMING.fade, piece: n });
      else if (p && !n) tracks.push({ kind: 'leave', key, at: 0, dur: TIMING.fade });
      continue;
    }
    const route = paths.get(Number(key.slice(1)));
    const from = typeof p?.spot === 'number' ? p.spot : 0;
    if (p && n) {
      const to = n.spot as number;
      if (to === from) {
        if (p.role !== n.role || p.side !== n.side) tracks.push({ kind: 'move', key, path: [from], at: flight, dur: 0, to: n });
        continue;
      }
      let path = route && !route.out && route.spots.at(-1) === to ? route.spots.filter((s) => s >= from) : undefined;
      if (path && path[0] !== from) path.unshift(from);
      if (!path) { path = [from, to]; mismatches.push(key); }
      const dur = Math.max(0, to - from) * TIMING.perBase;
      tracks.push({ kind: 'move', key, path, at: flight, dur, to: n });
      movesEnd = Math.max(movesEnd, flight + dur);
    } else if (p && !n) {
      if (route && !route.out && route.spots.at(-1) === 4) {
        const path = route.spots.filter((s) => s >= from);
        if (path[0] !== from) path.unshift(from);
        const run = (4 - from) * TIMING.perBase;
        tracks.push({ kind: 'score', key, path, at: flight, dur: run + TIMING.fade });
        movesEnd = Math.max(movesEnd, flight + run);
      } else if (route?.out && route.outAt !== undefined) {
        // Ran to the last base reached safely, then was put out at the next: run there, go down at the bag.
        // Without this a batter thrown out going for third faded away between first and second.
        const safe = Math.max(from, route.spots.at(-1)!);
        const run = (safe - from) * TIMING.perBase;
        tracks.push({ kind: 'out', key, from, run: safe, toward: Math.min(3.9, Math.max(safe, route.outAt - 0.1)), at: flight, dur: run + TIMING.out });
        movesEnd = Math.max(movesEnd, flight + run);
      } else if (route?.out) {
        const last = route.spots.at(-1)!;
        tracks.push({ kind: 'out', key, from, toward: Math.min(3.9, Math.max(from, last) + 0.5), at: flight, dur: TIMING.out });
      } else {
        tracks.push({ kind: 'leave', key, at: halfChange ? 0 : flight, dur: TIMING.fade });
      }
    }
  }
  // New pieces appear once the runners have arrived, so the board never shows two on a base.
  for (const [key, n] of end) {
    if (key === PITCHER_KEY || prev.has(key)) continue;
    if (n.role === 'batter' && halfChange) {
      tracks.push({ kind: 'enter', key, at: 120, dur: TIMING.flip, piece: n, flipFrom: n.side === 'away' ? 'home' : 'away' });
    } else {
      const replacing = events.some((e) => e.type === 'runnerPlaced' && e.replaces && e.runner.id === n.id);
      tracks.push({ kind: 'enter', key, at: replacing ? TIMING.fade : movesEnd, dur: TIMING.fade, piece: n });
    }
  }
  const total = Math.max(flight, ...tracks.map((t) => t.at + t.dur));
  return { ...(ball ? { ball } : {}), flight, tracks, total, end, mismatches };
}

/** Apply a plan's tracks to a scene, as a renderer does when it finishes. Used to check plans. */
export function settle(prev: Scene, plan: Plan): Map<string, Piece> {
  const out = new Map([...prev].map(([k, v]) => [k, { ...v }]));
  for (const t of plan.tracks) {
    switch (t.kind) {
      case 'move': out.set(t.key, { ...t.to, spot: t.path.at(-1)! }); break;
      case 'flip': case 'swap': out.set(t.key, { ...t.to }); break;
      case 'enter': out.set(t.key, { ...t.piece }); break;
      default: out.delete(t.key);
    }
  }
  return out;
}
