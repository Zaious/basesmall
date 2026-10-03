// The styles the app can use: the built-in ones, plus any valid style file the user put in the
// styles folder (`<app config dir>/styles/*.json`). Style files are data only; a file that fails
// validation is skipped and reported, never half-applied.

import flat from '../../styles/flat.json' with { type: 'json' };
import iso from '../../styles/iso.json' with { type: 'json' };
import { validateStyle, type StyleManifest } from './manifest.ts';

export const BUILT_IN: readonly StyleManifest[] = [iso as unknown as StyleManifest, flat as unknown as StyleManifest];
export const DEFAULT_STYLE_ID = 'iso';

export interface StyleFile { name: string; text: string }
export interface LoadedStyles { styles: StyleManifest[]; problems: string[] }

/** Only the fields the renderers read; anything else in a file is dropped. */
function clean(s: StyleManifest): StyleManifest {
  const { theme: t, piece: p, board: b } = s;
  return {
    format: 1, id: s.id, name: { en: s.name.en, 'zh-Hant': s.name['zh-Hant'] },
    ...(s.author !== undefined ? { author: s.author } : {}),
    renderer: s.renderer,
    theme: { background: t.background, panel: t.panel, border: t.border, text: t.text, muted: t.muted, accent: t.accent, ball: t.ball, strike: t.strike, out: t.out },
    piece: { shape: p.shape, thickness: p.thickness, rim: p.rim, shadow: p.shadow },
    board: { fill: b.fill, lines: b.lines },
  };
}

export function loadStyles(files: readonly StyleFile[]): LoadedStyles {
  const styles = [...BUILT_IN];
  const problems: string[] = [];
  for (const f of files) {
    let parsed: unknown;
    try { parsed = JSON.parse(f.text); } catch { problems.push(`${f.name}: not valid JSON`); continue; }
    const errs = validateStyle(parsed);
    if (errs.length) { problems.push(...errs.map((e) => `${f.name}: ${e}`)); continue; }
    const s = parsed as StyleManifest;
    if (`${s.id}.json` !== f.name) { problems.push(`${f.name}: id "${s.id}" must match the file name`); continue; }
    if (styles.some((x) => x.id === s.id)) { problems.push(`${f.name}: id "${s.id}" is already taken`); continue; }
    styles.push(clean(s));
  }
  return { styles, problems };
}

export function findStyle(styles: readonly StyleManifest[], id: string | null | undefined): StyleManifest {
  return styles.find((s) => s.id === id) ?? styles.find((s) => s.id === DEFAULT_STYLE_ID) ?? styles[0]!;
}

/** The style after this one, for the style button. */
export function nextStyle(styles: readonly StyleManifest[], id: string): StyleManifest {
  const i = styles.findIndex((s) => s.id === id);
  return styles[(i + 1) % styles.length]!;
}
