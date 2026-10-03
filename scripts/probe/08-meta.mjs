// Step 8: MLB's own code catalogues, so the adapter can classify every code deliberately.
import { get } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('fixtures/mlb/meta', { recursive: true });
for (const type of ['eventTypes', 'pitchCodes', 'gameStatus', 'pitchTypes', 'hitTrajectories']) {
  const r = await get(`/api/v1/${type}`);
  writeFileSync(`fixtures/mlb/meta/${type}.json`, JSON.stringify(r.json, null, 1));
  const arr = Array.isArray(r.json) ? r.json : [];
  console.log(`${type}: ${r.status}, ${arr.length} entries, ${r.bytes} bytes; keys: ${Object.keys(arr[0] ?? {}).join(',')}`);
}
