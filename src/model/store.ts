// Single owner of "the game on screen": latest state plus a short event history.
// Windows, audio and notifications subscribe here; only the store talks to a GameSource.

import type { GameEvent, GameSource, GameState, TimelineEntry, Unsubscribe } from './types.ts';

export interface StoreListener {
  /** `entry` is the timeline step the state belongs to; its events tell what just happened. */
  onState?(state: GameState, entry?: TimelineEntry): void;
  onEvent?(event: GameEvent, entry: TimelineEntry): void;
  onError?(error: unknown): void;
}

export class GameStore {
  private state: GameState | undefined;
  private entry: TimelineEntry | undefined;
  private readonly history: GameEvent[] = [];
  private readonly listeners = new Set<StoreListener>();
  private detach: Unsubscribe | null = null;
  private readonly historyLimit: number;

  constructor(historyLimit = 200) {
    this.historyLimit = historyLimit;
  }

  get current(): GameState | undefined { return this.state; }
  /** The timeline entry the current state belongs to. */
  get currentEntry(): TimelineEntry | undefined { return this.entry; }
  /** Most recent events, oldest first. */
  get recent(): readonly GameEvent[] { return this.history; }

  subscribe(listener: StoreListener): Unsubscribe {
    this.listeners.add(listener);
    if (this.state) listener.onState?.(this.state, this.entry);
    return () => this.listeners.delete(listener);
  }

  /** Follow one game from a source. Replaces whatever was followed before. */
  follow(source: GameSource, gamePk: number): void {
    this.stop();
    this.state = undefined;
    this.entry = undefined;
    this.history.length = 0;
    this.detach = source.subscribe(gamePk, {
      onEvent: (event, entry) => {
        this.history.push(event);
        if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
        for (const l of this.listeners) l.onEvent?.(event, entry);
      },
      onState: (state, entry) => {
        this.state = state;
        this.entry = entry;
        for (const l of this.listeners) l.onState?.(state, entry);
      },
      onError: (error) => {
        for (const l of this.listeners) l.onError?.(error);
      },
    });
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
  }
}
