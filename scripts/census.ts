// Which MLB codes the recorded fixtures actually exercise, versus the full catalogues.
// Codes never seen in a fixture are handled by classification alone and are worth a real game
// when one turns up. Run: node scripts/census.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { AUTOMATIC_CALL, PITCH_CALL } from '../src/data/mlb/codes.ts';
import type { MlbFeed } from '../src/data/mlb/feed-types.ts';

const dir = 'fixtures/mlb';
const games = readdirSync(dir).filter((f) => /^game-\d+\.json$/.test(f));
const events = new Map<string, number>();
const calls = new Map<string, number>();
let plays = 0, pitches = 0;
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

for (const f of games) {
  const feed = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as MlbFeed;
  for (const p of feed.liveData.plays.allPlays) {
    plays++;
    if (p.result.eventType) bump(events, p.result.eventType);
    for (const e of p.playEvents) {
      if (!e.isPitch && e.details?.eventType) bump(events, e.details.eventType);
      const code = e.details?.call?.code ?? e.details?.code;
      if (code && (e.isPitch || code in AUTOMATIC_CALL)) { bump(calls, code); if (e.isPitch) pitches++; }
    }
  }
}

console.log(`${games.length} games, ${plays} plate appearances, ${pitches} pitches\n`);
const report = (title: string, seen: Map<string, number>, catalogue: string[]) => {
  const never = catalogue.filter((c) => !seen.has(c));
  const unknown = [...seen.keys()].filter((c) => !catalogue.includes(c));
  console.log(`${title}: ${catalogue.length - never.length}/${catalogue.length} seen in fixtures`);
  console.log(`  seen:   ${[...seen].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ')}`);
  console.log(`  never:  ${never.join(' ') || '-'}`);
  if (unknown.length) console.log(`  NOT IN CATALOGUE: ${unknown.join(' ')}`);
  console.log();
};

const metaPath = (n: string) => `${dir}/meta/${n}.json`;
if (existsSync(metaPath('eventTypes'))) {
  const cat = (JSON.parse(readFileSync(metaPath('eventTypes'), 'utf8')) as { code: string }[]).map((e) => e.code);
  report('event types', events, cat);
}
report('pitch and automatic-call codes', calls, [...Object.keys(PITCH_CALL), ...Object.keys(AUTOMATIC_CALL)]);
