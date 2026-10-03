// Step 10: measure a game in progress. Polls at the feed's own pace (metaData.wait) with a
// heartbeat and, on a new timecode, a diffPatch, exactly like the app, and records for every new pitch how long after the pitch
// ended (MLB's playEvents[].endTime) the data reached us.
//
//   node scripts/probe/10-live-measure.mjs <gamePk> [minutes=20]
//
// Writes fixtures/mlb/live-<pk>-<timestamp>.json (git-ignored) and prints a summary.
import { writeFileSync } from 'node:fs';
import { get } from './lib.mjs';
import { applyPatch } from '../../src/data/mlb/json-patch.ts';

const pk = Number(process.argv[2]);
const minutes = Number(process.argv[3] ?? 20);
if (!pk) { console.error('usage: node scripts/probe/10-live-measure.mjs <gamePk> [minutes]'); process.exit(1); }

const deadline = Date.now() + minutes * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wire = (r) => Number(r.headers['content-length'] ?? 0) || null;

const first = await get(`/api/v1.1/game/${pk}/feed/live`, { noCache: true });
let feed = first.json;
const record = { pk, startedAt: new Date().toISOString(), fullFeed: { bytes: first.bytes, wire: wire(first), ms: first.ms }, polls: [], pitches: [], errors: [] };
const seen = new Set();
const pitchKeys = (f) => f.liveData.plays.allPlays.flatMap((p) => p.playEvents.filter((e) => e.isPitch).map((e) => ({ key: `${p.about.atBatIndex}:${e.index}`, end: e.endTime })));
for (const p of pitchKeys(feed)) seen.add(p.key);
console.log(`following ${pk}: ${feed.gameData.teams.away.abbreviation} @ ${feed.gameData.teams.home.abbreviation}, status ${feed.gameData.status.detailedState}, ${seen.size} pitches so far`);

while (Date.now() < deadline) {
  const waitS = feed.metaData?.wait ?? 10;
  await sleep(Math.max(5, waitS) * 1000);
  try {
    const beat = await get(`/api/v1.1/game/${pk}/feed/live?fields=metaData,timeStamp,wait`, { noCache: true });
    const latest = beat.json?.metaData?.timeStamp;
    if (!latest || latest === feed.metaData.timeStamp) {
      record.polls.push({ at: new Date().toISOString(), ms: beat.ms, bytes: beat.bytes, wire: wire(beat), age: beat.headers.age ?? null, wait: waitS, shape: 'heartbeat', newPitches: 0 });
      continue;
    }
    const r = await get(`/api/v1.1/game/${pk}/feed/live/diffPatch?startTimecode=${feed.metaData.timeStamp}&endTimecode=${latest}`, { noCache: true });
    const receivedAt = Date.now();
    const steps = Array.isArray(r.json) ? r.json : null;
    if (steps) for (const s of steps) feed = applyPatch(feed, s.diff ?? []);
    else if (r.json?.gameData) feed = r.json;
    const fresh = pitchKeys(feed).filter((p) => !seen.has(p.key));
    for (const p of fresh) {
      seen.add(p.key);
      const lagMs = p.end ? receivedAt - Date.parse(p.end) : null;
      record.pitches.push({ key: p.key, end: p.end, receivedAt: new Date(receivedAt).toISOString(), lagMs });
    }
    record.polls.push({ at: new Date(receivedAt).toISOString(), ms: r.ms, bytes: r.bytes, wire: wire(r), age: r.headers.age ?? null, wait: waitS, shape: steps ? `patch x${steps.length}` : 'full', newPitches: fresh.length });
    process.stdout.write(`\r${new Date().toLocaleTimeString()} polls=${record.polls.length} pitches=${record.pitches.length} status=${feed.gameData.status.detailedState}    `);
    if (feed.gameData.status.abstractGameState === 'Final') break;
  } catch (err) {
    record.errors.push({ at: new Date().toISOString(), error: String(err) });
  }
}

const lags = record.pitches.map((p) => p.lagMs).filter((x) => x !== null).sort((a, b) => a - b);
const q = (p) => (lags.length ? Math.round(lags[Math.floor(p * (lags.length - 1))] / 100) / 10 : null);
const wires = record.polls.map((p) => p.wire).filter(Boolean);
record.summary = {
  polls: record.polls.length,
  errors: record.errors.length,
  pitches: lags.length,
  lagSeconds: { min: q(0), p50: q(0.5), p90: q(0.9), max: q(1) },
  diffWireBytes: wires.length ? { avg: Math.round(wires.reduce((s, x) => s + x, 0) / wires.length), max: Math.max(...wires) } : null,
  fullFeedWireBytes: record.fullFeed.wire,
};
const out = `fixtures/mlb/live-${pk}-${record.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify(record, null, 1));
console.log(`\n${JSON.stringify(record.summary, null, 1)}\nwrote ${out}`);
