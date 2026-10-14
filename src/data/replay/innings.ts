// Single half-inning replay: where each half-inning lies in a timeline, and playing just one.
// Each half is one run of entries: it opens with the inningChange entry and ends with the entry of
// its third out (or the game's end), so the next half starts right after.

import type { Half, TimelineEntry, Unsubscribe } from '../../model/types.ts';
import type { ReplayPlayer } from './player.ts';

export interface HalfInning {
  inning: number;
  half: Half;
  /** First and last entry of the half, inclusive. */
  start: number;
  end: number;
}

/** The half-innings of a timeline, in order. */
export function halfInnings(timeline: readonly TimelineEntry[]): HalfInning[] {
  const out: HalfInning[] = [];
  timeline.forEach((e, i) => {
    const last = out.at(-1);
    if (last && last.inning === e.state.inning && last.half === e.state.half) last.end = i;
    else out.push({ inning: e.state.inning, half: e.state.half, start: i, end: i });
  });
  return out;
}

/**
 * Play one half-inning and stop after its last entry. It starts from the end of the half before,
 * so its first pitch animates instead of appearing as a jump. Playing anything outside the half
 * (the user seeks elsewhere, or presses next) ends the single-half mode without pausing.
 * Returns a function that cancels it.
 */
export function playHalfInning(player: ReplayPlayer, h: HalfInning, done: () => void): Unsubscribe {
  player.pause();
  player.seek(Math.max(0, h.start - 1));
  const off = player.onEntry((_, info) => {
    if (info.index < h.start - 1 || info.index > h.end) { off(); return; }
    if (info.index === h.end && !info.snap) { player.pause(); off(); done(); }
  });
  player.play();
  return off;
}
