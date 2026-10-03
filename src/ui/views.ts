// Text parts of the main window for each size tier (docs/ARCHITECTURE.md 4.6). Pure string
// builders: state in, HTML out. The board itself is drawn by src/render/.

import type { Base, GameState, Side } from '../model/types.ts';
import { callWord, pitchLine, STRINGS, type Lang } from '../i18n/index.ts';
import type { StyleManifest } from '../styles/manifest.ts';
import { cssFill, svgFill, type Paint } from '../styles/team-colors.ts';
import { pitchMark } from '../render/zone.ts';
import type { TierParts } from '../render/tiers.ts';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const dot = (p: Paint) => `<i class="dot" style="background:${cssFill(p)}"></i>`;
export const lamps = (n: number, max: number, cls: string) =>
  Array.from({ length: max }, (_, i) => `<i class="lamp ${i < n ? cls : ''}"></i>`).join('');

const batting = (s: GameState): Side => (s.half === 'top' ? 'away' : 'home');
const count = (s: GameState) => `${Math.min(3, s.balls)}-${Math.min(2, s.strikes)}`;

/** Three small diamonds, filled in the batting team's colour where a runner stands. */
export function miniDiamond(s: GameState, paint: Paint, size: 'small' | 'normal'): string {
  const [w, h, r] = size === 'small' ? [18, 14, 2.8] : [30, 22, 4];
  const at: Record<Base, [number, number]> = size === 'small'
    ? { '1B': [15, 8], '2B': [9, 3.5], '3B': [3, 8] }
    : { '1B': [25, 15], '2B': [15, 5], '3B': [5, 15] };
  const { defs, fill } = svgFill(paint, `runner-fill-${size}`);
  const sq = ([x, y]: [number, number], on: boolean) =>
    `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" transform="rotate(45 ${x} ${y})" fill="${on ? fill : 'transparent'}" stroke="${on ? 'var(--text)' : 'var(--muted)'}" stroke-opacity="${on ? 0.8 : 0.6}" stroke-width="1.2"/>`;
  return `<svg class="diamond" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}${
    (Object.keys(at) as Base[]).map((b) => sq(at[b], !!s.bases[b])).join('')}</svg>`;
}

export function scoreHtml(s: GameState, paints: Record<Side, Paint>, withAbbr: boolean): string {
  const ab = (side: Side) => (withAbbr ? `<span class="muted">${esc(s.teams[side].abbr)}</span>` : '');
  return `${dot(paints.away)}${ab('away')}${s.score.away}<span class="muted">:</span>${s.score.home}${ab('home')}${dot(paints.home)}`;
}

/** Dot tier: a pill with the score, the inning, a tiny diamond and the outs. */
export function dotView(s: GameState, paints: Record<Side, Paint>, parts: TierParts): string {
  return `<div class="pill">
      <span class="sc">${scoreHtml(s, paints, false)}</span>
      <span class="inn">${s.half === 'top' ? '▲' : '▼'}${s.inning}</span>
      ${miniDiamond(s, paints[batting(s)], 'small')}
      ${parts.outs ? `<span class="lamps">${lamps(Math.min(3, s.outs), 3, 'o')}</span>` : ''}
    </div>`;
}

/** Bar tier: the prototype's control bar, two lines on the left, the latest pitch or play on the right. */
export function barView(s: GameState, paints: Record<Side, Paint>, lang: Lang, parts: TierParts, lastHtml: string, statusText: string, offline: string): string {
  const S = STRINGS[lang];
  return `<div class="bar">
      <div class="sb">
        <div class="l1">${scoreHtml(s, paints, true)}</div>
        <div class="l2"><span>${esc(S.inning(s.inning, s.half))}</span><span class="mono">${count(s)}</span><span class="lamps">${lamps(Math.min(3, s.outs), 3, 'o')}</span></div>
      </div>
      ${miniDiamond(s, paints[batting(s)], 'normal')}
      ${parts.lastLine ? `<span class="last">${statusText ? `<span class="status">${esc(statusText)}</span> ` : ''}${lastHtml}</span>` : '<span class="grow"></span>'}
      ${offline ? `<i class="conn" title="${esc(offline)}"></i>` : ''}
    </div>`;
}

/** Field and full tiers: the capsules on the left. */
export function hudView(s: GameState, paints: Record<Side, Paint>, lang: Lang): string {
  const S = STRINGS[lang];
  return `
      <div class="cap score">${scoreHtml(s, paints, true)}</div>
      <div class="cap"><span>${esc(S.inning(s.inning, s.half))}</span><span class="lamps">${lamps(Math.min(3, s.outs), 3, 'o')}</span></div>
      <div class="cap"><span class="muted mono">B</span><span class="lamps">${lamps(Math.min(3, s.balls), 3, 'b')}</span><span class="muted mono">S</span><span class="lamps">${lamps(Math.min(2, s.strikes), 2, 's')}</span></div>
      <div class="cap pit"><span class="muted">${esc(S.ui.pitcher)}</span><b>${esc(s.pitcher?.short ?? '')}</b><span class="mono muted">${s.pitcher?.pitches ?? ''}</span></div>`;
}

/** Under the strike zone: the newest pitch ("6 In play · Cutter 89"), or the batter before the first one. */
export function pitchCaption(s: GameState, lang: Lang, theme: StyleManifest['theme']): string {
  const p = s.atBat.at(-1);
  if (!p) return `<span class="muted">${esc(s.batter?.short ?? '')}</span>`;
  const [what] = pitchLine({ ...p, call: 'other' }, lang).split(' · ');
  const m = pitchMark(p.call, theme);
  // The badge is drawn like the dot in the zone: solid, ring or dashed ring.
  const badge = m.kind === 'solid'
    ? `background:${m.colour}`
    : `background:transparent;color:${m.colour};box-shadow:none;border:1.4px ${m.kind === 'dashed' ? 'dashed' : 'solid'} ${m.colour}`;
  const call = callWord(p.call, lang);
  return `<span class="n" style="${badge}">${p.n}</span><span class="what">${esc([call, what].filter(Boolean).join(' · '))}</span>`;
}

/** Full tier: pitcher and batter side by side. */
export function matchupView(s: GameState, lang: Lang): string {
  const S = STRINGS[lang];
  const pit = s.pitcher, bat = s.batter;
  return `
      <div class="cap"><span class="k">${esc(S.ui.pitcher)}</span><b>${esc(pit?.short ?? '')}</b><span class="k">${pit ? esc(S.throws(pit.hand)) : ''}</span><span class="v">${pit ? esc(S.pitches(pit.pitches)) : ''}</span></div>
      <div class="cap"><span class="k">${esc(S.ui.batter)}</span><b>${esc(bat?.short ?? '')}</b><span class="k">${bat ? esc(S.bats(bat.side)) : ''}</span><span class="v">${bat ? `${esc(S.ui.todayLine)} ${bat.today.ab}-${bat.today.h}` : ''}</span></div>`;
}

/** Full tier: runs by inning. At least nine columns; extra innings add columns. */
export function linescoreView(s: GameState, paints: Record<Side, Paint>): string {
  const n = Math.max(9, s.inning, s.linescore.away.length, s.linescore.home.length);
  const live = s.status !== 'final';
  const head = Array.from({ length: n }, (_, i) => `<th${live && i + 1 === s.inning ? ' class="cur"' : ''}>${i + 1}</th>`).join('');
  const row = (side: Side) => {
    const cells = Array.from({ length: n }, (_, i) => {
      const v = s.linescore[side][i];
      const now = live && i + 1 === s.inning && batting(s) === side;
      return v === null || v === undefined ? '<td class="na">·</td>' : `<td${now ? ' class="now"' : ''}>${v}</td>`;
    }).join('');
    return `<tr><th class="t"><span>${dot(paints[side])}${esc(s.teams[side].abbr)}</span></th>${cells}<td class="rh">${s.score[side]}</td><td class="rh">${s.hits[side]}</td><td class="rh">${s.errors[side]}</td></tr>`;
  };
  return `<thead><tr><th class="t"></th>${head}<th>R</th><th>H</th><th>E</th></tr></thead><tbody>${row('away')}${row('home')}</tbody>`;
}
