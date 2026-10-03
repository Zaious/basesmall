// GameSource for finished MLB games: fetch the whole feed once, then replay it.
// How the feed is loaded is injected (fixture file in tests, polite fetcher in the app).

import type { GameHandlers, GameSource, Unsubscribe } from '../../model/types.ts';
import type { MlbFeed } from '../mlb/feed-types.ts';
import { buildTimeline } from '../mlb/timeline.ts';
import { ReplayPlayer, type ReplayOptions } from './player.ts';

export type FeedLoader = (gamePk: number) => Promise<MlbFeed>;

export class MlbReplaySource implements GameSource {
  private readonly players = new Map<number, ReplayPlayer>();
  private readonly load: FeedLoader;
  private readonly opts: ReplayOptions;

  constructor(load: FeedLoader, opts: ReplayOptions = {}) {
    this.load = load;
    this.opts = opts;
  }

  /** The player for a subscribed game, for pause / seek / pace controls. */
  player(gamePk: number): ReplayPlayer | undefined {
    return this.players.get(gamePk);
  }

  subscribe(gamePk: number, handlers: GameHandlers): Unsubscribe {
    let cancelled = false;
    const offs: Unsubscribe[] = [];
    this.load(gamePk)
      .then((feed) => {
        if (cancelled) return;
        const player = new ReplayPlayer(buildTimeline(feed), this.opts);
        this.players.set(gamePk, player);
        offs.push(player.onEntry((entry, info) => {
          // A snap is a jump: the state is enough, replaying its animations would mislead.
          if (!info.snap) for (const ev of entry.events) handlers.onEvent(ev, entry);
          handlers.onState(entry.state, entry);
        }));
        player.play();
      })
      .catch((err: unknown) => handlers.onError?.(err));
    return () => {
      cancelled = true;
      for (const off of offs) off();
      this.players.get(gamePk)?.pause();
      this.players.delete(gamePk);
    };
  }
}
