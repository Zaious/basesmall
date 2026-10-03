# Contributing to Basesmall

Thanks for wanting to help. There are four easy ways in, and one bigger one.

## Team colours

Every team is drawn in its own colours, from [`styles/team-colors/mlb.json`](styles/team-colors/mlb.json). If your team looks wrong, open a [team colour issue](https://github.com/Zaious/basesmall/issues/new?template=team-colours.yml) or edit the file and open a pull request. Colours and simple patterns (the Yankees' pinstripes) are fine. Logos, letters, numbers and uniform art are not.

## Styles

Every look is one JSON file. [`styles/README.md`](styles/README.md) explains the format, how to try a style in the app without building anything, and the rules a style has to follow.

## Bugs

Open a [bug report](https://github.com/Zaious/basesmall/issues/new?template=bug.yml). The most useful thing to include is the game: its date and teams, or the number in the window's title (`Basesmall · 824624 · …`).

## Code

```bash
npm install
npm test
npm run typecheck
npm run tauri dev
```

You need Node 24 and Rust. `node scripts/probe/07-fixtures.mjs` records a few finished games into `fixtures/mlb/` so the full test suite runs; those recordings are never committed.

A few rules the project keeps (the full list, in Chinese, is in [`CLAUDE.md`](CLAUDE.md)):

- **Less, not more.** Every feature should make a one-second glance more useful without making the window look more like watching sports. If it adds visual weight, it needs a good reason.
- **Every feature can be switched off**, with a sensible default.
- **The drawing side never sees MLB's JSON.** League data is turned into the normalized model in `src/model/types.ts` first (`src/data/mlb/`), and everything else works from that.
- **Tests check against the official numbers**, not numbers we computed ourselves. The adapter is tested against MLB's own line score and box score.
- **Be polite to the data source.** One request at a time, backing off on errors, never committing responses.
- **No logos or team art**, and no code copied from other projects unless its licence allows it.
- Code, identifiers and commit messages are in English. The UI is in English and Traditional Chinese: every string lives in `src/i18n/index.ts`.

## Adding another league

Basesmall only covers MLB because, when it was built, no other league had public play-by-play data it could use (see [`docs/DATA_SOURCE.md`](docs/DATA_SOURCE.md) §9). If that changes, a league is an adapter:

1. **Model.** Read the types in [`src/model/types.ts`](src/model/types.ts). Everything downstream works from `GameState` (the situation after a moment) and `GameEvent` (what happened: pitches, balls in play, runner moves, score changes, plate-appearance results). A `TimelineEntry` is one moment: its events in causal order, then the state after them.
2. **Timeline.** Write a pure function from the league's game data to `TimelineEntry[]`, like [`src/data/mlb/timeline.ts`](src/data/mlb/timeline.ts). Pure means testable: record a few finished games and check your output against the league's own totals (runs, hits, runners after each plate appearance), the way [`tests/timeline.test.ts`](tests/timeline.test.ts) does.
3. **Source.** Implement `GameSource` (`subscribe(gamePk, handlers)`), for live games by polling politely like [`src/data/mlb/live-source.ts`](src/data/mlb/live-source.ts), and for replays by reusing [`src/data/replay/`](src/data/replay/) with your timeline.
4. **Schedule.** The game list, the scoreboard and following a team read `GameCard`s ([`src/data/mlb/schedule.ts`](src/data/mlb/schedule.ts)). Map the league's schedule to those.
5. **Colours.** Add a colour table next to `styles/team-colors/mlb.json`.

The board, the strike zone, sounds and notices then work unchanged: they only know the model. Open an issue before starting, so we can agree on the details.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
