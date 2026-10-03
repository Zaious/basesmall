// When each timeline entry should play during a replay. Default is compact.

import type { TimelineEntry } from '../../model/types.ts';

export type PaceMode =
  /** The game's own timestamps. */
  | { kind: 'real' }
  /** Real timestamps, with dead time capped. Pitch-to-pitch rhythm stays close to live. */
  | { kind: 'compact' }
  /** Every entry the same number of seconds apart. */
  | { kind: 'fixed'; seconds: number }
  /** Only plate-appearance results (and game end); everything between is skipped. */
  | { kind: 'results'; seconds?: number };

export const DEFAULT_PACE: PaceMode = { kind: 'compact' };

/** Caps for compact mode, seconds. Measured medians on 849841: 19.7 s pitch to pitch,
 *  36.7 s between plate appearances, 166 s between half-innings (docs/PROBE_REPORT.md 7.2). */
export const COMPACT_CAPS = { withinAtBat: 20, betweenAtBats: 25, betweenHalves: 20, floor: 1 } as const;

export interface Slot {
  /** Index into the timeline. */
  index: number;
  /** Milliseconds from the start of the replay. */
  at: number;
}

const halfOf = (e: TimelineEntry) => `${e.state.inning}${e.state.half}`;

export function schedule(entries: readonly TimelineEntry[], mode: PaceMode): Slot[] {
  if (entries.length === 0) return [];
  const first = entries[0]!;

  if (mode.kind === 'real') return entries.map((e, index) => ({ index, at: Math.max(0, e.t - first.t) }));

  if (mode.kind === 'fixed') {
    const step = Math.max(0, mode.seconds) * 1000;
    return entries.map((_, index) => ({ index, at: index * step }));
  }

  if (mode.kind === 'results') {
    const step = (mode.seconds ?? 6) * 1000;
    const picked = entries
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.events.some((ev) => ev.type === 'plateAppearance' || ev.type === 'gameEnd'));
    return picked.map(({ index }, i) => ({ index, at: i * step }));
  }

  // compact
  const out: Slot[] = [{ index: 0, at: 0 }];
  let at = 0;
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1]!, b = entries[i]!;
    const gap = Math.max(0, (b.t - a.t) / 1000);
    const cap = halfOf(a) !== halfOf(b) ? COMPACT_CAPS.betweenHalves
      : a.play !== b.play ? COMPACT_CAPS.betweenAtBats
      : COMPACT_CAPS.withinAtBat;
    at += Math.max(COMPACT_CAPS.floor, Math.min(gap, cap)) * 1000;
    out.push({ index: i, at });
  }
  return out;
}

/** Total length of a replay in milliseconds. */
export const duration = (slots: readonly Slot[]) => slots.at(-1)?.at ?? 0;
