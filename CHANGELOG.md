# Changelog

## Unreleased

- During a pitching change the score bar (or the bubble on the board) says "Pitching change · <new pitcher>" until the next pitch. The feed is silent while the new pitcher warms up, and a board that did not move for minutes looked stuck.
- The tag for a game without your team now says "Not your team" (in Chinese 非主隊; it used to be 代看, which nobody understood).

## 0.1.1 (2026-10-04)

- In-app updates. When a newer version is out, the settings button shows a dot and Settings offers **Update**: it downloads, checks the signature, installs and restarts, only when you press it. The Windows installer, the macOS app and the Linux AppImage update themselves; the portable zip and the .deb show a link to the download page. The check happens once at start-up and can be switched off. (0.1.0 cannot update itself: get 0.1.1 by hand once.)

## 0.1.0 (2026-10-04)

The first release.

- Follows live MLB games in a small, always-on-top window, or replays games from the 2023 season onward at a compact pace.
- Four sizes, from a pill with the score to a panel with the board, the strike zone, the matchup and the line score. Team-coloured pieces with runners' names, the flight of each batted ball, every pitch numbered and marked (ball, called strike, swing and miss, foul, in play).
- Flat and 2.5D styles; styles are files, and yours can go in the styles folder.
- Follows your team on its own: the game when it is on, otherwise a countdown with probable starters; once its season is over, your choice of what to watch.
- League scoreboard drawer, postseason series labels, a tab for another game's big moment.
- Notices as corner cards or a ticker, never taking focus. Synthesized sounds, off by default.
- Low-key mode and hotkeys (Ctrl+Alt+Shift+B to hide, Ctrl+Alt+Shift+L for low-key; ⌥⇧⌘B and ⌥⇧⌘L on macOS).
- Optional strike zone, bases, matchup, line score and lineup windows. The lineup window shows the batting side's order with today's lines (the batter and on-deck marked) and the fielding side's pitchers so far.
- A player card when the pointer rests on a piece: today's line so far; the regular season and postseason totals, your choice of either, both or neither. Totals that would give away a replay stay hidden.
- Outs on the bases in the same play are told and drawn ("Double to RF, out at 3rd"); the board marks where the infield dirt ends (it can be switched off).
- A quit button (✕, click twice) in every view.
- Catch up on a game joined late.
- English and Traditional Chinese.
- Windows installer (per user, no administrator rights) and a portable zip. macOS and Linux builds are experimental; the macOS build is signed and notarized by Apple.
- Apache License 2.0. Works based on Basesmall carry its NOTICE and use a name of their own.
