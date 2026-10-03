// GameSource for a game in progress. One request at a time, at the pace the feed asks for
// (metaData.wait), with exponential backoff and jitter on failure (docs/DATA_SOURCE.md 7.2).
//
// First load: the whole feed, delivered as the current state only (no replay of what already
// happened). After that, each poll is a heartbeat (feed/live?fields=metaData, about 80 bytes on
// the wire) that names the latest timecode. Unchanged: nothing more is fetched. Changed: a
// diffPatch from our timecode to that one, applied to the cached feed. diffPatch without an end
// timecode returns the whole feed (docs/PROBE_REPORT.md 5.1), so the end is always given. When MLB revises a play it already
// published (a scoring change, an overturned call), the new state is delivered without events.

import type { GameHandlers, GameSource, GameState, TimelineEntry, Unsubscribe } from '../../model/types.ts';
import type { MlbFeed } from './feed-types.ts';
import { applyPatch, PatchError, type PatchOp } from './json-patch.ts';
import { buildTimeline, initialState } from './timeline.ts';
import { systemClock, type Clock } from '../replay/player.ts';

/** GET a statsapi path (e.g. "/api/v1.1/game/1/feed/live") and return parsed JSON. */
export type FetchJson = (path: string) => Promise<unknown>;

export interface LiveOptions {
  clock?: Clock;
  /** Shortest interval between polls, ms. The feed's metaData.wait wins when longer. */
  minWaitMs?: number;
  /** Interval while the game has not started, ms. */
  pregameWaitMs?: number;
  /** Longest wait after repeated failures, ms. */
  maxBackoffMs?: number;
  /** Multiplier on the interval while the window is hidden. */
  backgroundFactor?: number;
  random?: () => number;
}

export interface LiveStatus {
  /** False after a failed request until the next success. */
  connected: boolean;
  failures: number;
  lastSuccessAt?: number;
  requests: number;
  /** Times MLB revised a play we had already delivered. */
  corrections: number;
  /** Polling stopped because the game is over, postponed or cancelled. */
  stopped: boolean;
}

const DONE = new Set(['final', 'postponed', 'cancelled']);
const BEFORE = new Set(['scheduled', 'pregame']);
const key = (e: TimelineEntry) => `${e.play}:${e.event}`;
const signature = (e: TimelineEntry) => JSON.stringify(e.events);

class LiveGame {
  status: LiveStatus = { connected: true, failures: 0, requests: 0, corrections: 0, stopped: false };
  background = false;
  private feed: MlbFeed | null = null;
  private timer: unknown = null;
  private cancelled = false;
  private delivered = new Map<string, string>();
  private lastState = '';
  /** Last half-inning announced, so a half that was announced on its at-bat-start entry
   *  is not announced again on its first pitch. */
  private announced = '';
  private readonly pk: number;
  private readonly handlers: GameHandlers;
  private readonly fetchJson: FetchJson;
  private readonly o: Required<LiveOptions>;

  constructor(pk: number, handlers: GameHandlers, fetchJson: FetchJson, o: Required<LiveOptions>) {
    this.pk = pk;
    this.handlers = handlers;
    this.fetchJson = fetchJson;
    this.o = o;
  }

  start(): void { void this.tick(); }

  stop(): void {
    this.cancelled = true;
    if (this.timer !== null) this.o.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    if (this.cancelled) return;
    const wait = this.background ? ms * this.o.backgroundFactor : ms;
    this.timer = this.o.clock.setTimeout(() => void this.tick(), wait);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    let next: number;
    try {
      await this.refresh();
      if (this.cancelled) return;
      this.status = { ...this.status, connected: true, failures: 0, lastSuccessAt: this.o.clock.now() };
      const st = this.deliver();
      if (DONE.has(st.status)) { this.status = { ...this.status, stopped: true }; return; }
      const wait = Math.max(this.o.minWaitMs, (this.feed?.metaData?.wait ?? 10) * 1000);
      next = BEFORE.has(st.status) ? Math.max(wait, this.o.pregameWaitMs) : wait;
    } catch (err) {
      if (this.cancelled) return;
      if (err instanceof PatchError) this.feed = null; // our copy drifted: start over with the whole feed
      const failures = this.status.failures + 1;
      this.status = { ...this.status, connected: false, failures };
      this.handlers.onError?.(err);
      const base = Math.min(this.o.maxBackoffMs, this.o.minWaitMs * 2 ** failures);
      next = base * (0.75 + this.o.random() * 0.5);
    }
    this.schedule(next);
  }

  private async refresh(): Promise<void> {
    const timecode = this.feed?.metaData?.timeStamp;
    this.status = { ...this.status, requests: this.status.requests + 1 };
    if (!this.feed || !timecode) {
      this.feed = (await this.fetchJson(`/api/v1.1/game/${this.pk}/feed/live`)) as MlbFeed;
      return;
    }
    const beat = (await this.fetchJson(`/api/v1.1/game/${this.pk}/feed/live?fields=metaData,timeStamp,wait`)) as
      { metaData?: { timeStamp?: string; wait?: number } };
    const latest = beat.metaData?.timeStamp;
    if (!latest || latest === timecode) {
      if (beat.metaData?.wait && this.feed.metaData) this.feed.metaData.wait = beat.metaData.wait;
      return;
    }
    this.status = { ...this.status, requests: this.status.requests + 1 };
    const res = await this.fetchJson(`/api/v1.1/game/${this.pk}/feed/live/diffPatch?startTimecode=${timecode}&endTimecode=${latest}`);
    if (Array.isArray(res)) {
      let doc = this.feed;
      for (const step of res as { diff?: PatchOp[] }[]) doc = applyPatch(doc, step.diff ?? []);
      this.feed = doc;
    } else if (res && typeof res === 'object' && 'gameData' in res) {
      this.feed = res as MlbFeed; // the server sent the whole feed instead of a patch
    }
  }

  /** Hand new entries to the handlers. Returns the current state. */
  private deliver(): GameState {
    const feed = this.feed!;
    const timeline = buildTimeline(feed);
    const last = timeline.at(-1);
    const current = last?.state ?? initialState(feed);

    if (this.delivered.size === 0 && this.lastState === '') {
      // First load: show where the game is now; do not replay what already happened.
      for (const e of timeline) this.delivered.set(key(e), signature(e));
      this.announced = `${current.inning}${current.half}`;
      this.emitState(current, last);
      return current;
    }

    let revised = false;
    const fresh: TimelineEntry[] = [];
    const present = new Set<string>();
    for (const e of timeline) {
      const k = key(e);
      present.add(k);
      const seen = this.delivered.get(k);
      if (seen === undefined) fresh.push(e);
      else if (seen !== signature(e)) revised = true;
      this.delivered.set(k, signature(e));
    }
    for (const k of [...this.delivered.keys()]) {
      if (present.has(k)) continue;
      this.delivered.delete(k);
      // An at-bat-start entry (event -2) is replaced by real events; that is not a revision.
      if (!k.endsWith(':-2')) revised = true;
    }
    if (revised) this.status = { ...this.status, corrections: this.status.corrections + 1 };

    for (const e of fresh) {
      for (const ev of e.events) {
        if (ev.type === 'inningChange') {
          const half = `${ev.inning}${ev.half}`;
          if (half === this.announced) continue;
          this.announced = half;
        }
        this.handlers.onEvent(ev, e);
      }
      this.emitState(e === last ? current : e.state, e);
    }
    // Revisions, status changes, or the linescore catching up: state only.
    if (fresh.length === 0) this.emitState(current, last);
    return current;
  }

  private emitState(state: GameState, entry: TimelineEntry | undefined): void {
    const s = JSON.stringify(state);
    if (s === this.lastState) return;
    this.lastState = s;
    this.handlers.onState(state, entry ?? { t: 0, play: -1, event: -1, events: [], state });
  }
}

export class MlbLiveSource implements GameSource {
  private readonly games = new Map<number, LiveGame>();
  private readonly fetchJson: FetchJson;
  private readonly opts: Required<LiveOptions>;

  constructor(fetchJson: FetchJson, opts: LiveOptions = {}) {
    this.fetchJson = fetchJson;
    this.opts = {
      clock: opts.clock ?? systemClock,
      minWaitMs: opts.minWaitMs ?? 5_000,
      pregameWaitMs: opts.pregameWaitMs ?? 60_000,
      maxBackoffMs: opts.maxBackoffMs ?? 300_000,
      backgroundFactor: opts.backgroundFactor ?? 3,
      random: opts.random ?? Math.random,
    };
  }

  status(gamePk: number): LiveStatus | undefined {
    return this.games.get(gamePk)?.status;
  }

  /** Poll less often while the window is hidden. */
  setBackground(background: boolean): void {
    for (const g of this.games.values()) g.background = background;
  }

  subscribe(gamePk: number, handlers: GameHandlers): Unsubscribe {
    this.games.get(gamePk)?.stop();
    const game = new LiveGame(gamePk, handlers, this.fetchJson, this.opts);
    this.games.set(gamePk, game);
    game.start();
    return () => {
      game.stop();
      if (this.games.get(gamePk) === game) this.games.delete(gamePk);
    };
  }
}
