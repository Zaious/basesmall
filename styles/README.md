# Writing a style

Every look in Basesmall is a style file: one JSON file in this folder. The two built-in styles, [`flat.json`](flat.json) and [`iso.json`](iso.json), are the examples. Copy one, change it, and open a pull request.

> **Draft.** The format is settled when the renderer ships (milestone M3). Until then fields may still change, and there is no app to preview a style in. `npm test` already checks every file here.

## What a style controls, and what it does not

A style sets the colours of the window, the capsules, the pitch dots and the board, and the shape of the pieces.

It does **not** set the piece colours. Pieces always use team colours from [`team-colors/mlb.json`](team-colors/mlb.json), so a fan always sees their team. When two teams clash, the app swaps one side to its alternate colour.

The background mode (solid, translucent, clear) and the window size are user settings, not part of a style. A style has to work in all of them.

## Format

```json
{
  "format": 1,
  "id": "midnight",
  "name": { "en": "Midnight", "zh-Hant": "午夜" },
  "author": "your-github-name",
  "renderer": "iso",
  "theme": {
    "background": "#15171C",
    "panel": "#1B1E24",
    "border": "#2A2E37",
    "text": "#E8EAEE",
    "muted": "#A0A6B1",
    "accent": "#E8B04A",
    "ball": "#8EC1F0",
    "strike": "#D9643F",
    "out": "#ECE8DF"
  },
  "piece": { "shape": "disc", "thickness": 0.5, "rim": true, "shadow": "soft" },
  "board": { "fill": "#20242B", "lines": "#3A404B" }
}
```

| Field | Meaning |
| --- | --- |
| `format` | Always `1` for now. |
| `id` | Lower-case words joined by hyphens. Must match the file name: `midnight` lives in `midnight.json`. |
| `name` | Shown in settings. Both `en` and `zh-Hant` are required. |
| `author` | Optional. Your name or GitHub handle. |
| `renderer` | `flat` draws from straight above. `iso` is the 2.5D view, where pieces have a side and fly balls arc. |
| `theme.background` | Window colour when the background is solid. |
| `theme.panel` | The capsules and panels that all text sits on. |
| `theme.border` | Window and panel edges. |
| `theme.text`, `theme.muted` | Main and secondary text. |
| `theme.accent` | Highlights: the batter's ring, the latest pitch, the home-run bubble. |
| `theme.ball`, `theme.strike`, `theme.out` | Pitch dots and the B / S / O lamps. |
| `piece.shape` | `disc` or `dot` (a smaller, simpler mark). |
| `piece.thickness` | Side height as a fraction of the piece radius, 0 to 2. `0` is flat. The flat renderer ignores it. |
| `piece.rim` | A light outline around each piece. Keep it on with dark themes: several team colours are dark navy or black. |
| `piece.shadow` | `none` or `soft`. |
| `board.fill`, `board.lines` | The infield and its lines. `#RRGGBBAA` lets the background through. |

Colours are `#RRGGBB`, or `#RRGGBBAA` with alpha.

## Rules the tests enforce

- Every field above is present and well formed.
- `theme.text` on `theme.panel` has a contrast ratio of at least 4.5, and `theme.muted` on `theme.panel` at least 3. Text must stay readable on any wallpaper, including with a transparent background.
- The `id` matches the file name and is unique.

## Rules the reviewers enforce

- **Less, not more.** Basesmall is for when you cannot watch the game. A style that makes the window look more like a broadcast or a video game is out of scope.
- **Quiet.** Someone walking past should not think "sports". Saturated, flashing or high-contrast-everywhere styles belong in a fork.
- **No logos and no team art.** No league or team marks, wordmarks, letters or numbers, and nothing traced from a uniform or a broadcast. Team colours and simple patterns such as pinstripes are fine, and they live in [`team-colors/mlb.json`](team-colors/mlb.json), not in a style.
- **Your own work.** Only submit colours and designs you made or have the right to share under the MIT license.

## Checking your style

```bash
npm install
npm test
```

The style test validates every `*.json` in this folder and prints what is wrong.
