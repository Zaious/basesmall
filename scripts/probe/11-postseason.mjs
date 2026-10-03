// M5 probe: what the schedule says about series, probable pitchers and live situations, for the
// scoreboard, the postseason view, following the user's team, and spotting an elimination.
// node scripts/probe/11-postseason.mjs [date] [eliminated team id] [followed team id]
import { get } from './lib.mjs';

const date = process.argv[2] ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const out = process.argv[3] ?? '143'; // PHI, out in the 2026 NL Wild Card
const mine = process.argv[4] ?? '147'; // NYY
const H = 'team,linescore,seriesStatus,probablePitcher';
const short = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

const day = await get(`/api/v1/schedule?sportId=1&date=${date}&hydrate=${H}`);
const games = (day.json.dates ?? []).flatMap((d) => d.games);
console.log(`== ${date}: ${games.length} games, ${day.bytes} bytes`);
for (const g of games) {
  console.log(JSON.stringify({
    pk: g.gamePk, type: g.gameType, status: g.status?.detailedState, date: g.gameDate,
    away: g.teams.away.team.abbreviation, home: g.teams.home.team.abbreviation,
    score: [g.teams.away.score, g.teams.home.score],
    record: [g.teams.away.leagueRecord, g.teams.home.leagueRecord].map((r) => r && `${r.wins}-${r.losses}`),
    probable: [g.teams.away.probablePitcher?.fullName, g.teams.home.probablePitcher?.fullName],
    series: short(g.seriesStatus, ['gameNumber', 'totalGames', 'wins', 'losses', 'isTied', 'isOver', 'description', 'shortDescription', 'shortName', 'result']),
    seriesFields: [g.seriesDescription, g.seriesGameNumber, g.gamesInSeries, g.ifNecessary, g.ifNecessaryDescription],
    linescore: short(g.linescore, ['currentInning', 'isTopInning', 'inningState', 'outs', 'balls', 'strikes']),
    bases: g.linescore?.offense ? ['first', 'second', 'third'].filter((b) => g.linescore.offense[b]) : null,
  }));
}

const seasonEnd = `${date.slice(0, 4)}-11-15`;
for (const [label, id] of [['eliminated', out], ['followed', mine]]) {
  const t = await get(`/api/v1/schedule?sportId=1&teamId=${id}&startDate=${date.slice(0, 4)}-09-25&endDate=${seasonEnd}&hydrate=${H}`);
  const list = (t.json.dates ?? []).flatMap((d) => d.games);
  console.log(`== team ${id} (${label}): ${list.length} games from 9/25, ${t.bytes} bytes`);
  for (const g of list.slice(-6)) {
    const side = g.teams.away.team.id === Number(id) ? 'away' : 'home';
    console.log(JSON.stringify({
      pk: g.gamePk, type: g.gameType, date: g.officialDate, status: g.status?.abstractGameState + '/' + g.status?.detailedState,
      vs: g.teams[side === 'away' ? 'home' : 'away'].team.abbreviation, side, isWinner: g.teams[side].isWinner,
      series: short(g.seriesStatus, ['gameNumber', 'totalGames', 'wins', 'losses', 'isOver', 'shortDescription', 'result']),
      winningTeam: g.seriesStatus?.winningTeam?.abbreviation ?? g.seriesStatus?.winningTeam?.id, losingTeam: g.seriesStatus?.losingTeam?.abbreviation ?? g.seriesStatus?.losingTeam?.id,
    }));
  }
}

const series = await get(`/api/v1/schedule/postseason/series?sportId=1&season=${date.slice(0, 4)}`);
console.log(`== postseason series: ${series.json.series?.length ?? 0}, ${series.bytes} bytes`);
for (const s of (series.json.series ?? []).slice(0, 12)) {
  const g = s.games?.at(-1);
  console.log(JSON.stringify({ id: s.series?.id, sortNumber: s.series?.sortNumber, games: s.games?.length, last: g && short(g.seriesStatus, ['shortDescription', 'result', 'isOver']), teams: g && [g.teams.away.team.name, g.teams.home.team.name] }));
}

const next = await get(`/api/v1/seasons/${Number(date.slice(0, 4)) + 1}?sportId=1`);
console.log(`== next season: ${JSON.stringify(short(next.json.seasons?.[0], ['seasonId', 'regularSeasonStartDate', 'springStartDate', 'postSeasonEndDate']))}`);
