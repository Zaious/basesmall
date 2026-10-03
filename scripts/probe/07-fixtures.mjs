// Step 7: build the fixture set used by the M1 tests.
// Re-saves feeds already in the request cache (no network), and finds one 2026
// regular-season extra-inning game, which carries the automatic runner on 2B.
import { get } from './lib.mjs';
import { writeFileSync, existsSync } from 'node:fs';

const save = async (pk) => {
  const out = `fixtures/mlb/game-${pk}.json`;
  if (existsSync(out)) return console.log(`have ${out}`);
  const f = await get(`/api/v1.1/game/${pk}/feed/live`);
  writeFileSync(out, JSON.stringify(f.json));
  console.log(`saved ${out} (${f.bytes} bytes${f.cached ? ', from cache' : ''})`);
};

for (const pk of [849841, 414921, 235127, 69405, 23885]) await save(pk);

const s = await get('/api/v1/schedule?sportId=1&startDate=2026-09-20&endDate=2026-09-27&gameType=R&hydrate=linescore');
const games = (s.json.dates ?? []).flatMap((d) => d.games);
const extra = games.filter((g) => g.status.abstractGameState === 'Final' && (g.linescore?.currentInning ?? 0) > 9);
console.log(`regular season 9/20-9/27: ${games.length} games, ${extra.length} went to extra innings`);
for (const g of extra.slice(0, 5)) console.log(' ', g.gamePk, g.officialDate, g.linescore.currentInning, `${g.teams.away.team.name} ${g.teams.away.score} @ ${g.teams.home.team.name} ${g.teams.home.score}`);
if (extra[0]) await save(extra[0].gamePk);
