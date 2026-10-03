// Counts what the board does across every recorded game: runner moves, runs, multi-base runs,
// and the longest step (M3 receipt). node scripts/board-census.ts
import { readdirSync, readFileSync } from 'node:fs';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import type { MlbFeed } from '../src/data/mlb/feed-types.ts';
import { planStep, settle, type Scene } from '../src/render/scene.ts';

const counts: Record<string, number> = {};
let games = 0, steps = 0, flights = 0, multiBase = 0, longest = 0, mismatches = 0;
for (const f of readdirSync('fixtures/mlb').filter((x) => /^game-\d+\.json$/.test(x))) {
  const tl = buildTimeline(JSON.parse(readFileSync(`fixtures/mlb/${f}`, 'utf8')) as MlbFeed);
  games++;
  let scene: Scene = new Map();
  for (const e of tl) {
    steps++;
    const plan = planStep(scene, e.state, e.events);
    if (plan.ball) flights++;
    mismatches += plan.mismatches.length;
    longest = Math.max(longest, plan.total);
    for (const t of plan.tracks) {
      counts[t.kind] = (counts[t.kind] ?? 0) + 1;
      if ((t.kind === 'move' || t.kind === 'score') && t.path.length > 2) multiBase++;
    }
    scene = settle(scene, plan);
  }
}
console.log(`${games} games, ${steps} steps, ${flights} batted balls drawn, longest step ${longest} ms at 1x`);
console.log(`runner moves ${counts.move ?? 0}, runs home ${counts.score ?? 0}, runs over more than one base ${multiBase}, outs ${counts.out ?? 0}`);
console.log(`pieces in ${counts.enter ?? 0}, off ${counts.leave ?? 0}, half-inning flips ${counts.flip ?? 0}, pitching changes ${counts.swap ?? 0}`);
console.log(`paths that disagreed with the state: ${mismatches}`);
