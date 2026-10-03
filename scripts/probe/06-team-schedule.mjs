// Step 6: schedule filtered by team, probable pitchers, and postseason series status.
// Needed for "my team" mode: recent games to replay, next game, elimination.
import { get } from './lib.mjs';

const PHI = 143;
const s = await get(`/api/v1/schedule?sportId=1&teamId=${PHI}&startDate=2026-09-20&endDate=2026-10-10&hydrate=probablePitcher,seriesStatus`);
const games = (s.json.dates ?? []).flatMap((d) => d.games);
console.log(`teamId=${PHI}: ${games.length} games, ${s.bytes} bytes`);
for (const g of games) {
  const ss = g.seriesStatus;
  console.log(g.officialDate, g.gamePk, g.gameType, g.status.detailedState.padEnd(10),
    `${g.teams.away.team.name} @ ${g.teams.home.team.name}`,
    '| probable:', g.teams.away.probablePitcher?.fullName ?? '-', '/', g.teams.home.probablePitcher?.fullName ?? '-',
    '| series:', ss ? `${ss.result ?? ''} ${ss.description ?? ''} wins=${ss.wins}/${ss.losses} isOver=${ss.isOver} winner=${ss.winningTeam?.name ?? '-'}` : '(none)');
}
const any = games.find((g) => g.seriesStatus);
console.log('\nseriesStatus keys:', any ? Object.keys(any.seriesStatus).join(',') : '(none)');
console.log('gameDate (UTC) sample:', games.at(-1)?.gameDate, 'officialDate:', games.at(-1)?.officialDate);
