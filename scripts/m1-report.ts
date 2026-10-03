// Prints replay lengths and timeline stats for the recorded games (M1 receipt).
// Runs on plain Node 24 (type stripping), no build step: node scripts/m1-report.ts
import { readFileSync, existsSync } from 'node:fs';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import { duration, schedule } from '../src/data/replay/pacing.ts';
import type { MlbFeed } from '../src/data/mlb/feed-types.ts';

const min = (ms: number) => (ms / 60000).toFixed(1);
for (const pk of [849841, 824624, 414921, 235127, 69405, 23885]) {
  const path = `fixtures/mlb/game-${pk}.json`;
  if (!existsSync(path)) { console.log(pk, 'missing fixture'); continue; }
  const feed = JSON.parse(readFileSync(path, 'utf8')) as MlbFeed;
  const t0 = performance.now();
  const tl = buildTimeline(feed);
  const ms = (performance.now() - t0).toFixed(0);
  const s = tl.at(-1)!.state;
  const pitches = tl.reduce((n, e) => n + e.events.filter((ev) => ev.type === 'pitch').length, 0);
  const d = (kind: 'real' | 'compact' | 'results') => min(duration(schedule(tl, { kind })));
  console.log(`${pk} ${feed.gameData.datetime?.officialDate} ${s.teams.away.abbr} ${s.score.away}-${s.score.home} ${s.teams.home.abbr} ` +
    `inn=${s.inning} entries=${tl.length} pitches=${pitches} build=${ms}ms | real ${d('real')} min, compact ${d('compact')} min, results ${d('results')} min`);
}
