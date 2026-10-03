// Step 9: pick 2026 games that cover unusual situations and save them as fixtures.
// Same politeness as every probe: one request at a time, 1.5 s apart, everything cached.
// Writes fixtures/mlb/game-<pk>.json and fixtures/mlb/sweep.json (pk -> categories).
import { get } from './lib.mjs';
import { existsSync, writeFileSync } from 'node:fs';

const WINDOWS = [
  ['2026-04-01', '2026-04-12'],
  ['2026-06-01', '2026-06-12'],
  ['2026-08-01', '2026-08-12'],
  ['2026-09-20', '2026-09-27'], // already cached by 07-fixtures
];
const PER_CATEGORY = 2;

const games = [];
for (const [start, end] of WINDOWS) {
  const s = await get(`/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}&gameType=R&hydrate=linescore`);
  games.push(...(s.json.dates ?? []).flatMap((d) => d.games));
}
const post = await get('/api/v1/schedule?sportId=1&startDate=2026-09-29&endDate=2026-10-01&hydrate=linescore');
games.push(...(post.json.dates ?? []).flatMap((d) => d.games));

const ls = (g) => g.linescore ?? {};
const runs = (g, side) => g.teams[side].score ?? 0;
const final = (g) => g.status.abstractGameState === 'Final';
const lastInning = (g) => ls(g).innings?.at(-1);
const categories = {
  extraInnings: (g) => final(g) && g.gameType === 'R' && (ls(g).currentInning ?? 0) > 9,
  walkOff: (g) => final(g) && runs(g, 'home') > runs(g, 'away') && ls(g).isTopInning === false
    && (lastInning(g)?.home?.runs ?? 0) >= runs(g, 'home') - runs(g, 'away'),
  completedEarly: (g) => /Completed Early/.test(g.status.detailedState),
  resumed: (g) => final(g) && Object.keys(g).some((k) => /resum/i.test(k)),
  suspended: (g) => /Suspended/.test(g.status.detailedState),
  postponed: (g) => /Postponed|Cancelled/.test(g.status.detailedState),
  blowout: (g) => final(g) && Math.abs(runs(g, 'home') - runs(g, 'away')) >= 10,
  slugfest: (g) => final(g) && runs(g, 'home') + runs(g, 'away') >= 22,
  oneZero: (g) => final(g) && runs(g, 'home') + runs(g, 'away') === 1,
  doubleheader: (g) => final(g) && (g.doubleHeader === 'Y' || g.doubleHeader === 'S'),
  postseason: (g) => final(g) && g.gameType !== 'R',
};

const picked = new Map(); // pk -> Set(categories)
for (const [name, test] of Object.entries(categories)) {
  const hits = games.filter(test);
  console.log(`${name.padEnd(15)} ${String(hits.length).padStart(3)} candidates`);
  for (const g of hits.slice(0, name === 'postseason' ? 4 : PER_CATEGORY)) {
    if (!picked.has(g.gamePk)) picked.set(g.gamePk, new Set());
    picked.get(g.gamePk).add(name);
  }
}
// any game that fits several categories keeps all its labels
for (const g of games) if (picked.has(g.gamePk)) for (const [name, test] of Object.entries(categories)) if (test(g)) picked.get(g.gamePk).add(name);

console.log(`\nscanned ${games.length} schedule entries, picked ${picked.size} games`);
const manifest = {};
for (const [pk, cats] of picked) {
  const g = games.find((x) => x.gamePk === pk);
  manifest[pk] = { date: g.officialDate, status: g.status.detailedState, categories: [...cats], matchup: `${g.teams.away.team.name} ${g.teams.away.score ?? '-'} @ ${g.teams.home.team.name} ${g.teams.home.score ?? '-'}` };
  const out = `fixtures/mlb/game-${pk}.json`;
  if (!existsSync(out)) {
    const f = await get(`/api/v1.1/game/${pk}/feed/live`);
    writeFileSync(out, JSON.stringify(f.json));
  }
  console.log(pk, g.officialDate, [...cats].join(','), '|', manifest[pk].matchup, '|', g.status.detailedState);
}
writeFileSync('fixtures/mlb/sweep.json', JSON.stringify(manifest, null, 1));
