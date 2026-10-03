// Recorded MLB games used by the tests. They are not committed (docs/DATA_SOURCE.md 7.2);
// create them with `node scripts/probe/07-fixtures.mjs`. Missing fixtures skip their tests.

import { existsSync, readFileSync } from 'node:fs';
import type { MlbFeed } from '../src/data/mlb/feed-types.ts';

// Replays start at the 2023 season (current rules era). The 2005–2015 games stay because they
// exposed adapter bugs that also occur in current data (pinch runners, runner order,
// out-of-order timestamps).
export const FIXTURES = [
  { pk: 849841, note: '2026 NL Wild Card G2, 10 innings (postseason, no automatic runner)' },
  { pk: 824624, note: '2026 regular season, 12 innings, automatic runner, one error' },
  { pk: 414921, note: '2015 regular season' },
  { pk: 235127, note: '2008 regular season' },
  { pk: 69405, note: '2007 regular season, no pitch tracking' },
  { pk: 23885, note: '2005 regular season, no pitch tracking' },
] as const;

export const fixturePath = (pk: number) => `fixtures/mlb/game-${pk}.json`;
export const hasFixture = (pk: number) => existsSync(fixturePath(pk));
export const loadFixture = (pk: number): MlbFeed => JSON.parse(readFileSync(fixturePath(pk), 'utf8')) as MlbFeed;

/** Boxscore and linescore fields the adapter does not read but the tests check against. */
export interface OfficialTotals {
  liveData: {
    linescore: {
      teams: Record<'away' | 'home', { runs: number; hits: number; errors: number }>;
      innings: { num: number; away?: { runs?: number }; home?: { runs?: number } }[];
    };
    boxscore: {
      teams: Record<'away' | 'home', {
        players: Record<string, {
          person: { id: number };
          stats: {
            batting?: { atBats?: number; hits?: number };
            pitching?: { numberOfPitches?: number };
          };
        }>;
      }>;
    };
  };
  gameData: { gameInfo?: { gameDurationMinutes?: number } };
}

export const official = (feed: MlbFeed) => feed as unknown as OfficialTotals;
