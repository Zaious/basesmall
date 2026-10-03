# Basesmall

**Baseball, but small.**

A tiny, quiet desktop view of the game you can't watch.

Basesmall is an unofficial desktop companion for following live MLB games. It sits in a corner of your screen and keeps your team's game going as a few abstract pieces: who is on base, the count, the outs, the score, where each pitch crossed the plate, and which way the ball went. Enough to know what is happening at a glance, without video, without sound unless you want it, and without looking like you are watching sports.

> **Status: early development.** There is nothing to install yet. The data layer works and is tested; the window comes next.

## What it will do

- **Follow your team.** It finds today's game, shows the next one when there is none, and lets you choose what to watch when your team's season is over.
- **Resize from a pill to a panel.** The smallest size is a score, the inning and three dots for the bases. Larger sizes add the base diamond with team-coloured pieces, the strike zone for the current at-bat, the matchup and the linescore.
- **Solid, translucent or fully transparent background.** Text always sits on small dark capsules, so it stays readable on any wallpaper.
- **Swappable styles.** Flat and 2.5D are built in. Every style is a file, and new ones are welcome.
- **Replay recent games** (2023 season onward) at a compact pace that keeps the pitch-to-pitch rhythm and trims the dead time. The game picker hides final scores.
- **English and Traditional Chinese** interface.
- **Runs entirely on your computer.** No account, no server, no API key.

## Roadmap

- [x] **M0** Data probe: endpoints, fields and update rates measured against real responses ([report, in Chinese](docs/PROBE_REPORT.md))
- [x] **M1** Normalized game model and replay. Six recorded games are checked against MLB's own totals: runs, hits, errors, runs per inning, runners after every plate appearance, every pitcher's pitch count, and every batter's at-bats and hits.
- [~] **M2** Floating window (Tauri, Windows first) and live data: working on Windows; live measurement pending
- [ ] **M3** The board: styles, team colours, size tiers, animation
- [ ] **M4** Sound and settings
- [ ] **M5** League scoreboard, postseason, low-key mode
- [ ] **M6** Installers and a guide to writing styles

## Development

Requires Node 24.

```bash
npm install
node scripts/probe/07-fixtures.mjs   # fetch a few finished games into fixtures/mlb/ (git-ignored)
npm test
npm run typecheck
npm run tauri dev                     # the floating window; needs Rust and, on Windows, the MSVC build tools
npm run tauri build -- --no-bundle    # release binary in src-tauri/target/release/
```

Open a game directly: `basesmall --game=<gamePk>` follows it live, `--mode=replay` replays a finished one.

The fixture script sends a handful of requests, one at a time, and caches every response so re-runs stay offline. MLB responses are never committed.

Technical documents are in Traditional Chinese: [architecture](docs/ARCHITECTURE.md), [data source and terms](docs/DATA_SOURCE.md), [data probe report](docs/PROBE_REPORT.md).

Want to make your own look? See [styles/](styles/): every style is one file, and the built-in ones are the examples.

## Data, trademarks and disclaimers

- Basesmall is an independent fan project. It is **not affiliated with, endorsed by, or sponsored by** Major League Baseball, MLB Advanced Media, the MLB Players Association, or any team.
- Game data comes from the MLB Stats API and is fetched directly by your own computer. It is subject to MLB Advanced Media's [copyright notice](http://gdx.mlb.com/components/copyright.txt), which permits individual, non-commercial, non-bulk use. Basesmall does not host, relay or redistribute MLB data, and this repository contains none.
- No team logos, uniforms or league marks are used. Teams are shown by name, abbreviation and colour. Team colour values come from [colorr](https://github.com/lobsterbush/colorr) (MIT); see [NOTICE](styles/team-colors/NOTICE.md).
- Basesmall is free and will stay free: no ads and no paid features.

## Support

Basesmall is free and stays free. If it keeps you company at work, you can [buy me a coffee](https://buymeacoffee.com/zaious).

## License

[MIT](LICENSE), for the code in this repository. MLB data is not covered.
