// Steps play one at a time and in order, so the score never changes before the runner gets home.
// When the game outruns the animations (a burst of live updates, a fast replay), waiting steps
// play faster, and past a limit the queue skips to the newest step. The newest state always wins.

export interface QueueOptions<T> {
  /** Most steps allowed to wait. One more and the queue jumps to the newest. */
  maxBacklog?: number;
  /** Fold a skipped step into the one that replaces it (e.g. keep its event text). */
  merge?: (skipped: T, newer: T) => T;
}

/** `catchUp` is 1 when nothing waits, and grows with the backlog. */
export type StepRunner<T> = (item: T, animate: boolean, catchUp: number) => Promise<void>;

export class AnimationQueue<T> {
  private readonly waiting: { item: T; animate: boolean }[] = [];
  private busy = false;
  private generation = 0;
  private readonly run: StepRunner<T>;
  private readonly maxBacklog: number;
  private readonly merge: ((skipped: T, newer: T) => T) | undefined;
  /** Steps dropped by catching up, for diagnostics. */
  skipped = 0;

  constructor(run: StepRunner<T>, opts: QueueOptions<T> = {}) {
    this.run = run;
    this.maxBacklog = opts.maxBacklog ?? 4;
    this.merge = opts.merge;
  }

  get pending(): number { return this.waiting.length; }

  push(item: T, animate = true): void {
    this.waiting.push({ item, animate });
    if (this.waiting.length > this.maxBacklog) {
      let merged = this.waiting[0]!.item;
      for (const w of this.waiting.slice(1)) merged = this.merge ? this.merge(merged, w.item) : w.item;
      this.skipped += this.waiting.length - 1;
      this.waiting.length = 0;
      // A jump: show where things are now, without replaying how they got there.
      this.waiting.push({ item: merged, animate: false });
    }
    void this.pump();
  }

  /** Drop everything waiting; a step already playing finishes on its own. */
  clear(): void {
    this.waiting.length = 0;
    this.generation++;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const gen = this.generation;
    try {
      while (this.waiting.length && gen === this.generation) {
        const step = this.waiting.shift()!;
        try {
          await this.run(step.item, step.animate, 1 + this.waiting.length);
        } catch {
          // a failed animation must not stall the game
        }
      }
    } finally {
      this.busy = false;
      if (this.waiting.length) void this.pump();
    }
  }
}
