// One schedule poller for everything that needs today's games: the scoreboard, the most tense
// game, other games' notifications, and following the user's team (ARCHITECTURE 4.2). It polls only
// while someone wants it, one request at a time, and a team's own window is cached for minutes.

import type { Clock } from '../replay/player.ts';
import { systemClock } from '../replay/player.ts';
import { cardsOf, type GameCard, type MlbSchedule } from './schedule.ts';

export const SCHEDULE_HYDRATE = 'team,linescore,seriesStatus,probablePitcher';
const TEAM_CACHE_MS = 5 * 60_000;

export type Fetch = (path: string) => Promise<unknown>;

const shift = (d: string, days: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

export class ScheduleService {
  private readonly fetch: Fetch;
  private readonly today: () => string;
  private readonly clock: Clock;
  private readonly intervalMs: number;
  private readonly wants = new Set<string>();
  private readonly listeners = new Set<(cards: readonly GameCard[]) => void>();
  private readonly teams = new Map<string, { at: number; cards: GameCard[] }>();
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private lastPoll = -Infinity;
  /** Today's games as of the last poll. */
  cards: GameCard[] = [];
  /** The US Eastern date those games belong to. */
  date = '';
  requests = 0;

  constructor(fetch: Fetch, today: () => string, clock: Clock = systemClock, intervalMs = 60_000) {
    this.fetch = fetch;
    this.today = today;
    this.clock = clock;
    this.intervalMs = intervalMs;
  }

  /** Ask for (or stop asking for) live updates of today's games, under a name. */
  want(who: string, on: boolean): void {
    const had = this.wants.size > 0;
    if (on) this.wants.add(who); else this.wants.delete(who);
    if (!had && this.wants.size) {
      // Fresh enough already? Otherwise fetch now, then keep going.
      const wait = Math.max(0, this.lastPoll + this.intervalMs - this.clock.now());
      this.arm(wait > this.intervalMs / 2 ? wait : 0);
    } else if (had && !this.wants.size && this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get active(): boolean { return this.wants.size > 0; }

  subscribe(fn: (cards: readonly GameCard[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fetch today's games now (shares a request already on its way). */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      const date = this.today();
      try {
        this.requests++;
        const s = (await this.fetch(`/api/v1/schedule?sportId=1&date=${date}&hydrate=${SCHEDULE_HYDRATE}`)) as MlbSchedule;
        this.cards = cardsOf(s);
        this.date = date;
        this.lastPoll = this.clock.now();
        for (const l of this.listeners) l(this.cards);
      } catch {
        // offline: keep the last cards, try again at the next tick
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** A team's games from ten days back to twenty ahead (one request, cached for five minutes). */
  async team(teamId: number, force = false): Promise<GameCard[]> {
    const today = this.today();
    const key = `${teamId}:${today}`;
    const hit = this.teams.get(key);
    if (hit && !force && this.clock.now() - hit.at < TEAM_CACHE_MS) return hit.cards;
    this.requests++;
    const s = (await this.fetch(`/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${shift(today, -10)}&endDate=${shift(today, 20)}&hydrate=${SCHEDULE_HYDRATE}`)) as MlbSchedule;
    const cards = cardsOf(s);
    this.teams.set(key, { at: this.clock.now(), cards });
    return cards;
  }

  /** Teams with a postseason game still ahead (to adopt one), from the next two weeks' schedule. */
  async postseasonTeams(): Promise<string[]> {
    const today = this.today();
    this.requests++;
    const s = (await this.fetch(`/api/v1/schedule?sportId=1&startDate=${today}&endDate=${shift(today, 14)}&gameType=F,D,L,W&hydrate=team`)) as MlbSchedule;
    const teams = new Set<string>();
    for (const c of cardsOf(s)) {
      if (c.status === 'final' || c.status === 'cancelled' || c.status === 'postponed') continue;
      for (const t of [c.away, c.home]) if (t.abbr !== '?') teams.add(t.abbr);
    }
    return [...teams].sort();
  }

  /** Opening day of a season, if MLB has published it. */
  async seasonStart(year: number): Promise<string | undefined> {
    this.requests++;
    const s = (await this.fetch(`/api/v1/seasons/${year}?sportId=1`)) as { seasons?: { regularSeasonStartDate?: string }[] };
    return s.seasons?.[0]?.regularSeasonStartDate;
  }

  private arm(wait: number): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.refresh().finally(() => { if (this.wants.size) this.arm(this.intervalMs); });
    }, wait);
  }
}
