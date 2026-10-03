// Step 3: timestamps -> state at two timecodes, diffPatch size, CORS with an Origin header.
import { get } from './lib.mjs';

const pk = Number(process.argv[2] ?? 849841);
const ts = await get(`/api/v1.1/game/${pk}/feed/live/timestamps`);
const codes = ts.json;
console.log(`timestamps: ${codes.length} timecodes, ${ts.bytes} bytes; first=${codes[0]} last=${codes.at(-1)}`);
// Gaps between consecutive timecodes (seconds) -> how often the feed updates.
const toDate = (c) => new Date(`${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(9, 11)}:${c.slice(11, 13)}:${c.slice(13, 15)}Z`);
const gaps = codes.slice(1).map((c, i) => (toDate(c) - toDate(codes[i])) / 1000).sort((a, b) => a - b);
const q = (p) => gaps[Math.floor(p * (gaps.length - 1))];
console.log(`timecode gap seconds: min=${gaps[0]} p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} max=${gaps.at(-1)}`);

const state = (j) => {
  const ls = j.liveData.linescore;
  const o = ls.offense ?? {};
  return `inning=${ls.currentInning} ${ls.inningHalf} B${ls.balls}-S${ls.strikes} O${ls.outs} score ${ls.teams.away.runs}-${ls.teams.home.runs} ` +
    `bases=[${o.first ? '1' : '-'}${o.second ? '2' : '-'}${o.third ? '3' : '-'}] plays=${j.liveData.plays.allPlays.length} ` +
    `status=${j.gameData.status.abstractGameState}`;
};
const iA = Math.floor(codes.length * 0.4), iB = iA + 3;
const A = codes[iA], B = codes[iB];
const fa = await get(`/api/v1.1/game/${pk}/feed/live?timecode=${A}`);
console.log(`\n@${A}: ${state(fa.json)} | ${fa.bytes}B (wire ${fa.headers['content-length'] ?? '?'}B)`);
console.log('   linescore.offense keys:', Object.keys(fa.json.liveData.linescore.offense).join(','));
const cp = fa.json.liveData.plays.currentPlay;
console.log('   currentPlay:', cp?.about?.inning, cp?.about?.halfInning, 'count', JSON.stringify(cp?.count), 'pitches so far', cp?.playEvents?.filter((e) => e.isPitch).length, 'complete', cp?.about?.isComplete);
const fb = await get(`/api/v1.1/game/${pk}/feed/live?timecode=${B}`);
console.log(`@${B}: ${state(fb.json)} | ${fb.bytes}B (wire ${fb.headers['content-length'] ?? '?'}B)`);

const dp = await get(`/api/v1.1/game/${pk}/feed/live/diffPatch?startTimecode=${A}&endTimecode=${B}`);
const isPatch = Array.isArray(dp.json);
console.log(`\ndiffPatch ${A}->${B}: ${dp.bytes}B (wire ${dp.headers['content-length'] ?? '?'}B), shape=${isPatch ? 'array of ' + dp.json.length : 'object keys ' + Object.keys(dp.json).join(',')}`);
if (isPatch) {
  const ops = dp.json.flatMap((x) => x.diff ?? [x]);
  console.log('   ops:', ops.length, 'sample:', JSON.stringify(ops.slice(0, 4)).slice(0, 600));
  console.log('   entry keys:', Object.keys(dp.json[0] ?? {}).join(','));
}
// one-step diff (adjacent timecodes) = what a live poller would receive
const dp1 = await get(`/api/v1.1/game/${pk}/feed/live/diffPatch?startTimecode=${A}&endTimecode=${codes[iA + 1]}`);
console.log(`diffPatch one step: ${dp1.bytes}B (wire ${dp1.headers['content-length'] ?? '?'}B), ${Array.isArray(dp1.json) ? 'array ' + dp1.json.length : 'object'}`);

const cors = await get(`/api/v1/schedule?sportId=1&date=2026-10-03`, { headers: { Origin: 'http://tauri.localhost' } });
console.log(`\nCORS with Origin http://tauri.localhost: allow-origin=${cors.headers['access-control-allow-origin']} allow-credentials=${cors.headers['access-control-allow-credentials']}`);
