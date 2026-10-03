// Step 2: full GUMBO feed for one finished game; field inventory and coverage.
import { get, keyPaths, pct } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const pk = Number(process.argv[2] ?? 849841);
const f = await get(`/api/v1.1/game/${pk}/feed/live`);
const j = f.json;
console.log(`feed/live ${pk}: ${f.bytes} bytes, ${f.ms} ms, content-encoding=${f.headers['content-encoding'] ?? '-'}`);
console.log('top keys:', Object.keys(j).join(','));
console.log('metaData:', JSON.stringify(j.metaData));
console.log('gameData keys:', Object.keys(j.gameData).join(','));
console.log('liveData keys:', Object.keys(j.liveData).join(','));
console.log('gameData.teams.home keys:', Object.keys(j.gameData.teams.home).join(','));

const plays = j.liveData.plays.allPlays;
const evs = plays.flatMap((p) => p.playEvents);
const pitches = evs.filter((e) => e.isPitch);
const inPlay = pitches.filter((e) => e.details?.isInPlay);
console.log(`\nplays=${plays.length} playEvents=${evs.length} pitches=${pitches.length} inPlay=${inPlay.length}`);
const has = (arr, fn) => `${arr.filter(fn).length}/${arr.length} (${pct(arr.filter(fn).length, arr.length)}%)`;
console.log('pitch pX/pZ:', has(pitches, (e) => e.pitchData?.coordinates?.pX != null && e.pitchData?.coordinates?.pZ != null));
console.log('pitch strikeZoneTop/Bottom:', has(pitches, (e) => e.pitchData?.strikeZoneTop != null));
console.log('pitch startSpeed:', has(pitches, (e) => e.pitchData?.startSpeed != null));
console.log('pitch type code:', has(pitches, (e) => e.details?.type?.code != null));
console.log('pitch call code:', has(pitches, (e) => e.details?.call?.code != null));
console.log('pitch zone:', has(pitches, (e) => e.pitchData?.zone != null));
console.log('inPlay hitData:', has(inPlay, (e) => e.hitData != null));
console.log('inPlay coordX/Y:', has(inPlay, (e) => e.hitData?.coordinates?.coordX != null));
console.log('inPlay launchSpeed:', has(inPlay, (e) => e.hitData?.launchSpeed != null));
console.log('inPlay launchAngle:', has(inPlay, (e) => e.hitData?.launchAngle != null));
console.log('inPlay totalDistance:', has(inPlay, (e) => e.hitData?.totalDistance != null));
console.log('inPlay location (fielder pos):', has(inPlay, (e) => e.hitData?.location != null));
console.log('inPlay trajectory:', has(inPlay, (e) => e.hitData?.trajectory != null));

const kp = (o) => [...keyPaths(o)].sort();
console.log('\npitch event key paths:', kp(pitches.slice(0, 40)).join(' '));
console.log('\nhitData key paths:', kp(inPlay.map((e) => e.hitData)).join(' '));
console.log('\nplay.result keys:', kp(plays.map((p) => p.result)).join(' '));
console.log('\nplay.about keys:', kp(plays.map((p) => p.about)).join(' '));
console.log('\nplay.matchup keys:', kp(plays.map((p) => p.matchup)).filter((k) => !k.startsWith('splits')).join(' '));
console.log('\nrunner key paths:', kp(plays.flatMap((p) => p.runners)).join(' '));
console.log('\nplay.count keys:', kp(plays.map((p) => p.count)).join(' '));

const types = {};
for (const p of plays) types[p.result.eventType] = (types[p.result.eventType] ?? 0) + 1;
console.log('\neventType counts:', JSON.stringify(types));
const nonPitch = {};
for (const e of evs.filter((e) => !e.isPitch)) nonPitch[e.type + ':' + (e.details?.eventType ?? e.details?.event ?? '')] = (nonPitch[e.type + ':' + (e.details?.eventType ?? e.details?.event ?? '')] ?? 0) + 1;
console.log('non-pitch playEvents:', JSON.stringify(nonPitch));
const ptypes = {};
for (const e of pitches) ptypes[e.details?.type?.code + '=' + e.details?.type?.description] = 1;
console.log('pitch types:', Object.keys(ptypes).join(', '));
const calls = {};
for (const e of pitches) calls[e.details?.call?.code + '=' + e.details?.call?.description] = 1;
console.log('pitch calls:', Object.keys(calls).join(', '));

// Examples useful for localized text: a home run and a hit.
const ex = (t) => plays.find((p) => p.result.eventType === t);
for (const t of ['home_run', 'single', 'double', 'field_out', 'strikeout', 'walk']) {
  const p = ex(t); if (!p) continue;
  const last = p.playEvents.filter((e) => e.isPitch).at(-1);
  console.log(`\n[${t}] ${p.result.description}`);
  console.log('   rbi', p.result.rbi, 'score', p.result.awayScore, '-', p.result.homeScore, 'hitData', JSON.stringify(last?.hitData ?? null));
  console.log('   runners', JSON.stringify(p.runners.map((r) => ({ s: r.movement.start, e: r.movement.end, out: r.movement.isOut, ev: r.details.eventType, rbi: r.details.rbi, credits: r.credits?.map((c) => c.position?.abbreviation + ':' + c.credit) }))));
}

// linescore + defense/offense (what bases look like)
const ls = j.liveData.linescore;
console.log('\nlinescore keys:', Object.keys(ls).join(','));
console.log('linescore.offense keys:', Object.keys(ls.offense ?? {}).join(','));
console.log('linescore.defense keys:', Object.keys(ls.defense ?? {}).join(','));
console.log('innings[0]:', JSON.stringify(ls.innings[0]));

// boxscore: pitcher pitch counts, batter lines
const bx = j.liveData.boxscore;
console.log('\nboxscore keys:', Object.keys(bx).join(','));
const side = bx.teams.home;
console.log('boxscore.teams.home keys:', Object.keys(side).join(','));
const pid = side.pitchers[0];
const pl = side.players['ID' + pid];
console.log('pitcher stats.pitching keys:', Object.keys(pl.stats.pitching).join(','));
const bid = side.batters[0];
console.log('batter stats.batting keys:', Object.keys(side.players['ID' + bid].stats.batting).join(','));
console.log('batter keys:', Object.keys(side.players['ID' + bid]).join(','));
console.log('battingOrder:', JSON.stringify(side.battingOrder));

// currentPlay on a finished game
console.log('\ncurrentPlay present:', !!j.liveData.plays.currentPlay, 'about.isComplete', j.liveData.plays.currentPlay?.about?.isComplete);

writeFileSync(`fixtures/mlb/game-${pk}.json`, JSON.stringify(j));
console.log(`\nsaved fixtures/mlb/game-${pk}.json`);
