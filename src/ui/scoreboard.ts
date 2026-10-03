// The league scoreboard drawer under the main window (F7): every game today, live ones first and
// the tensest on top. Click one to put it in the main window. Pure HTML.

import { isLive, isUpcoming, type GameCard } from '../data/mlb/schedule.ts';
import { tension } from '../follow/tension.ts';
import { STRINGS, type Lang } from '../i18n/index.ts';
import { cssFill, teamPaint } from '../styles/team-colors.ts';
import { esc } from './views.ts';
import { timeOf } from './home.ts';

export interface BoardContext {
  lang: Lang;
  /** The game in the main window, highlighted. */
  current?: number;
  /** Show finished games' scores (the replay spoiler setting). */
  showScores: boolean;
}

/** Live games by tension, then upcoming by start, then finished. */
export function boardOrder(cards: readonly GameCard[]): GameCard[] {
  const rank = (c: GameCard) => (isLive(c) ? 0 : isUpcoming(c) ? 1 : 2);
  return [...cards].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? tension(b) - tension(a) : a.start - b.start));
}

const dot = (abbr: string) => `<i class="dot" style="background:${cssFill(teamPaint(abbr))}"></i>`;

function bases(c: GameCard): string {
  if (!c.bases) return '';
  const on = (b: string) => (c.bases!.includes(b as never) ? 'on' : '');
  return `<span class="mini-bases" aria-hidden="true"><i class="${on('3B')}"></i><i class="${on('2B')}"></i><i class="${on('1B')}"></i></span>`;
}

export function boardRows(cards: readonly GameCard[], ctx: BoardContext): string {
  const S = STRINGS[ctx.lang];
  if (!cards.length) return `<div class="empty">${esc(S.ui.noGames)}</div>`;
  return boardOrder(cards).map((c) => {
    const live = isLive(c), later = isUpcoming(c);
    const final = c.status === 'final';
    const score = live || (final && ctx.showScores) ? `${c.away.runs ?? 0}:${c.home.runs ?? 0}` : '';
    const sit = live && c.inning
      ? `${c.half === 'top' ? '▲' : '▼'}${c.inning}${c.outs !== undefined ? ` <span class="outs">${'●'.repeat(Math.min(3, c.outs))}${'○'.repeat(3 - Math.min(3, c.outs))}</span>` : ''}${bases(c)}`
      : later ? timeOf(c.start, ctx.lang) : final ? S.status('final') : S.status(c.status, c.detail);
    const series = c.series ? `<span class="ser">${esc(S.series(c.series, c.gameType, { away: c.away.abbr, home: c.home.abbr }).split(' · ')[0]!)}</span>` : '';
    return `<button class="brow${live ? ' live' : ''}${c.gamePk === ctx.current ? ' current' : ''}" data-pk="${c.gamePk}" data-mode="${final ? 'replay' : 'live'}"${!final && !live && !later ? ' disabled' : ''}>
        <span class="t">${dot(c.away.abbr)}${esc(c.away.abbr)}<b>${score || '@'}</b>${esc(c.home.abbr)}${dot(c.home.abbr)}</span>
        <span class="sit">${sit}</span>${series}</button>`;
  }).join('');
}
