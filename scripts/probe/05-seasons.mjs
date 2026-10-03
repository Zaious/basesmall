// Step 5: one finished regular-season game per sampled season; field coverage.
import { get, pct } from './lib.mjs';

const dates = process.argv.slice(2).length ? process.argv.slice(2) : ['2015-07-08', '2008-07-09', '2007-07-05', '2005-07-06'];
for (const date of dates) {
  const s = await get(`/api/v1/schedule?sportId=1&date=${date}`);
  const g = s.json.dates?.[0]?.games?.find((x) => x.status?.abstractGameState === 'Final' && x.gameType === 'R');
  if (!g) { console.log(date, 'no final game'); continue; }
  const f = await get(`/api/v1.1/game/${g.gamePk}/feed/live`);
  const plays = f.json.liveData?.plays?.allPlays ?? [];
  const evs = plays.flatMap((p) => p.playEvents ?? []);
  const pitches = evs.filter((e) => e.isPitch);
  const inPlay = pitches.filter((e) => e.details?.isInPlay);
  const c = (arr, fn) => `${pct(arr.filter(fn).length, arr.length)}%`;
  console.log(`${date} pk=${g.gamePk} bytes=${f.bytes} plays=${plays.length} pitches=${pitches.length} ` +
    `pX/pZ=${c(pitches, (e) => e.pitchData?.coordinates?.pX != null)} szTop=${c(pitches, (e) => e.pitchData?.strikeZoneTop != null)} ` +
    `speed=${c(pitches, (e) => e.pitchData?.startSpeed != null)} ptype=${c(pitches, (e) => e.details?.type?.code != null)} ` +
    `inPlay=${inPlay.length} coordX=${c(inPlay, (e) => e.hitData?.coordinates?.coordX != null)} ` +
    `launchSpeed=${c(inPlay, (e) => e.hitData?.launchSpeed != null)} location=${c(inPlay, (e) => e.hitData?.location != null)} ` +
    `trajectory=${c(inPlay, (e) => e.hitData?.trajectory != null)} runners=${c(plays, (p) => Array.isArray(p.runners) && p.runners.length > 0)}`);
}
