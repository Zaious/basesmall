// Step 4: verify how runners on base appear in linescore.offense mid-game.
import { get } from './lib.mjs';
import { readFileSync } from 'node:fs';

const pk = Number(process.argv[2] ?? 849841);
const game = JSON.parse(readFileSync(`fixtures/mlb/game-${pk}.json`, 'utf8'));
const codes = (await get(`/api/v1.1/game/${pk}/feed/live/timestamps`)).json;
// first play that ends with runners on first and third (or at least two bases occupied)
const play = game.liveData.plays.allPlays.find((p) => p.matchup.postOnFirst && (p.matchup.postOnSecond || p.matchup.postOnThird))
  ?? game.liveData.plays.allPlays.find((p) => p.matchup.postOnFirst);
const end = new Date(play.about.endTime);
const code = codes.find((c) => new Date(`${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(9, 11)}:${c.slice(11, 13)}:${c.slice(13, 15)}Z`) > end);
console.log(`play #${play.about.atBatIndex} "${play.result.description}" ended ${play.about.endTime}; using timecode ${code}`);
const f = await get(`/api/v1.1/game/${pk}/feed/live?timecode=${code}`);
const o = f.json.liveData.linescore.offense;
console.log('linescore.offense keys:', Object.keys(o).join(','));
for (const b of ['first', 'second', 'third']) console.log(`  ${b}:`, o[b] ? JSON.stringify(o[b]).slice(0, 120) : '(empty)');
