// Step 1: game types, postseason schedule, teams. Prints a compact summary.
import { get, keyPaths } from './lib.mjs';

const gt = await get('/api/v1/gameTypes');
console.log('gameTypes:', gt.json.map((g) => `${g.id}=${g.description}`).join(' | '));

const sch = await get('/api/v1/schedule?sportId=1&startDate=2026-09-29&endDate=2026-10-04&hydrate=linescore');
console.log('\nschedule bytes', sch.bytes, 'ms', sch.ms);
for (const d of sch.json.dates ?? []) {
  for (const g of d.games) {
    const ls = g.linescore;
    console.log(d.date, g.gamePk, g.gameType, g.status?.abstractGameState, '/', g.status?.detailedState, '/', g.status?.codedGameState,
      `${g.teams.away.team.name} ${g.teams.away.score ?? '-'} @ ${g.teams.home.team.name} ${g.teams.home.score ?? '-'}`,
      ls ? `inn=${ls.currentInning} ${ls.inningState ?? ''} lsKeys=${Object.keys(ls).length}` : 'NO-LINESCORE',
      g.seriesDescription ?? '', g.seriesGameNumber ?? '');
  }
}
const g0 = sch.json.dates?.[0]?.games?.[0];
console.log('\nschedule game keys:', Object.keys(g0 ?? {}).join(','));
console.log('linescore keys:', Object.keys(g0?.linescore ?? {}).join(','));

const teams = await get('/api/v1/teams?sportId=1');
const t0 = teams.json.teams[0];
console.log('\nteams count', teams.json.teams.length);
const tk = [...keyPaths(teams.json.teams)].filter((k) => /colo|hex|rgb/i.test(k));
console.log('team keys w/ color-ish names:', tk.length ? tk.join(',') : '(none)');
console.log('team top keys:', Object.keys(t0).join(','));
console.log('sample:', t0.id, t0.name, t0.abbreviation, t0.teamName, t0.shortName, t0.franchiseName, t0.clubName);
