// Plays a timeline on a clock, following a pace schedule. The clock is injectable
// so tests run a whole game in milliseconds.

import type { TimelineEntry, Unsubscribe } from '../../model/types.ts';
import { DEFAULT_PACE, schedule, type PaceMode, type Slot } from './pacing.ts';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface EntryInfo {
  /** Index of the entry in the timeline. */
  index: number;
  /** True when the entry was reached by seeking: show its state, skip its animations. */
  snap: boolean;
}

export interface ReplayOptions {
  pace?: PaceMode;
  /** Playback rate multiplier, e.g. 2 = twice as fast as the pace. */
  speed?: number;
  clock?: Clock;
}

export class ReplayPlayer {
  private slots: Slot[];
  /** Next slot to play. */
  private cursor = 0;
  private current = -1;
  private timer: unknown = null;
  private anchor = 0;
  private speed: number;
  private pace: PaceMode;
  private readonly clock: Clock;
  private readonly entryListeners = new Set<(entry: TimelineEntry, info: EntryInfo) => void>();
  private readonly endListeners = new Set<() => void>();

  readonly timeline: readonly TimelineEntry[];

  constructor(timeline: readonly TimelineEntry[], opts: ReplayOptions = {}) {
    this.timeline = timeline;
    this.pace = opts.pace ?? DEFAULT_PACE;
    this.speed = opts.speed ?? 1;
    this.clock = opts.clock ?? systemClock;
    this.slots = schedule(timeline, this.pace);
  }

  get playing(): boolean { return this.timer !== null; }
  get done(): boolean { return this.cursor >= this.slots.length; }
  /** Index of the last entry delivered, -1 before the first. */
  get position(): number { return this.current; }
  get length(): number { return this.timeline.length; }

  onEntry(fn: (entry: TimelineEntry, info: EntryInfo) => void): Unsubscribe {
    this.entryListeners.add(fn);
    return () => this.entryListeners.delete(fn);
  }

  onEnd(fn: () => void): Unsubscribe {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  play(): void {
    if (this.playing || this.done) return;
    const next = this.slots[this.cursor]!;
    const prevAt = this.cursor > 0 ? this.slots[this.cursor - 1]!.at : next.at;
    // Resume so that the next entry keeps its spacing from the previous one.
    this.anchor = this.clock.now() - prevAt / this.speed;
    this.arm();
  }

  pause(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Jump to an entry and deliver it as a snap. Keeps playing if it was playing. */
  seek(index: number): void {
    const wasPlaying = this.playing;
    this.pause();
    const i = Math.max(0, Math.min(this.timeline.length - 1, index));
    this.emit(i, true);
    this.cursor = this.slots.findIndex((s) => s.index > i);
    if (this.cursor < 0) this.cursor = this.slots.length;
    if (wasPlaying) this.play();
  }

  setPace(pace: PaceMode): void {
    const wasPlaying = this.playing;
    this.pause();
    this.pace = pace;
    this.slots = schedule(this.timeline, pace);
    this.cursor = this.slots.findIndex((s) => s.index > this.current);
    if (this.cursor < 0) this.cursor = this.slots.length;
    if (wasPlaying) this.play();
  }

  setSpeed(speed: number): void {
    const wasPlaying = this.playing;
    this.pause();
    this.speed = Math.max(0.01, speed);
    if (wasPlaying) this.play();
  }

  private arm(): void {
    if (this.done) {
      this.timer = null;
      for (const fn of this.endListeners) fn();
      return;
    }
    const slot = this.slots[this.cursor]!;
    const wait = Math.max(0, this.anchor + slot.at / this.speed - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.cursor++;
      this.emit(slot.index, false);
      this.arm();
    }, wait);
  }

  private emit(index: number, snap: boolean): void {
    this.current = index;
    const entry = this.timeline[index]!;
    for (const fn of this.entryListeners) fn(entry, { index, snap });
  }
}
