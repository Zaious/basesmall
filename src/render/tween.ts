// A tiny animation loop. It only asks for frames while something is moving, so a still board
// costs nothing. It also keeps frame times, for the smoothness check (--selfcheck).

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Tween { t0: number; dur: number; step: (t: number) => void; done?: (() => void) | undefined }

/** Gaps between animation frames (ms), across every board drawn this session. */
export const frameGaps: number[] = [];

export class Tweens {
  private readonly active = new Set<Tween>();
  private running = false;
  private last = 0;
  private readonly frameGaps = frameGaps;

  /** Run `step(t)` with t from 0 to 1 over `dur` ms, starting after `delay` ms. */
  add(dur: number, step: (t: number) => void, done?: () => void, delay = 0): void {
    this.active.add({ t0: performance.now() + delay, dur: Math.max(1, dur), step, done });
    if (!this.running) {
      this.running = true;
      this.last = 0;
      requestAnimationFrame(this.tick);
    }
  }

  /** Jump everything to its end, including tweens that finishing ones start (a run, then its fade). */
  finish(): void {
    for (let round = 0; this.active.size && round < 8; round++) {
      const all = [...this.active];
      this.active.clear();
      for (const tw of all) { tw.step(1); tw.done?.(); }
    }
  }

  get busy(): boolean { return this.active.size > 0; }

  private readonly tick = (now: number): void => {
    if (this.last) this.frameGaps.push(now - this.last);
    if (this.frameGaps.length > 20_000) this.frameGaps.splice(0, 10_000);
    this.last = now;
    for (const tw of [...this.active]) {
      const t = (now - tw.t0) / tw.dur;
      if (t < 0) continue;
      tw.step(Math.min(1, t));
      if (t >= 1) { this.active.delete(tw); tw.done?.(); }
    }
    if (this.active.size) requestAnimationFrame(this.tick);
    else this.running = false;
  };
}
