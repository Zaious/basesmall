import type { Clock } from '../src/data/replay/player.ts';

/** Virtual clock: timers fire in time order when the test advances time. */
export class FakeClock implements Clock {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, fn }); return id; }
  clearTimeout(id: unknown) { this.timers.delete(id as number); }
  /** Advance time, firing timers in order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
  get pending() { return this.timers.size; }
  /** Milliseconds until the next timer, or undefined. */
  get nextIn() {
    const at = Math.min(...[...this.timers.values()].map((x) => x.at));
    return Number.isFinite(at) ? at - this.t : undefined;
  }
}
