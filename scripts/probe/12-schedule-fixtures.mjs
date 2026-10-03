// Schedule fixtures for the M5 tests (following a team, eliminations, postseason series).
// Saved under fixtures/mlb/ (git-ignored, like every MLB response). node scripts/probe/12-schedule-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { get } from './lib.mjs';

const H = 'team,linescore,seriesStatus,probablePitcher';
const save = (name, json) => { writeFileSync(`fixtures/mlb/${name}.json`, JSON.stringify(json)); console.log(`saved fixtures/mlb/${name}.json`); };

// Days: postseason previews (Division Series day 1), a Wild Card day with finals, a regular-season day.
for (const date of ['2026-10-03', '2026-09-30', '2026-09-25']) {
  save(`schedule-${date}`, (await get(`/api/v1/schedule?sportId=1&date=${date}&hydrate=${H}`)).json);
}
// Team windows as the app asks for them: ten days back, twenty ahead, from 2026-10-03.
// 143 PHI (out in the Wild Card), 147 NYY (in the Division Series), 108 LAA (missed the postseason).
for (const id of [143, 147, 108]) {
  save(`team-${id}-2026-10-03`, (await get(`/api/v1/schedule?sportId=1&teamId=${id}&startDate=2026-09-23&endDate=2026-10-23&hydrate=${H}`)).json);
}
save('postseason-series-2026', (await get('/api/v1/schedule/postseason/series?sportId=1&season=2026')).json);
save('season-2027', (await get('/api/v1/seasons/2027?sportId=1')).json);
