// The home card: what the user's team is up to when it is not playing right now
// (PRD §3.3 "主隊模式"), and the one-time "what now?" card when its season is over. Pure HTML.

import type { GameCard } from '../data/mlb/schedule.ts';
import type { Decision } from '../follow/decide.ts';
import { STRINGS, type Lang } from '../i18n/index.ts';
import type { AfterOut } from '../settings/schema.ts';
import { cssFill, teamPaint } from '../styles/team-colors.ts';
import { esc } from './views.ts';

export interface HomeContext {
  lang: Lang;
  /** The team this is about (the user's, or the one adopted for the postseason). */
  team: string;
  now: number;
  /** Show the four choices (the season just ended and the user has not chosen for it yet). */
  askAfter?: boolean;
  /** Days to next season's opening day, when known. */
  openingIn?: number;
  /** League mode or "most tense": nothing live right now. */
  idle?: boolean;
}

const dot = (abbr: string) => `<i class="dot" style="background:${cssFill(teamPaint(abbr))}"></i>`;
const matchup = (c: GameCard) => `${dot(c.away.abbr)}${esc(c.away.abbr)} @ ${esc(c.home.abbr)}${dot(c.home.abbr)}`;

export function timeOf(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}
export function dayOf(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleDateString(lang, { month: 'numeric', day: 'numeric', weekday: 'short' });
}

function seriesLine(c: GameCard, lang: Lang): string {
  return c.series ? `<span class="series">${esc(STRINGS[lang].series(c.series, c.gameType, { away: c.away.abbr, home: c.home.abbr }))}</span>` : '';
}

function actions(lang: Lang, last?: GameCard): string {
  const F = STRINGS[lang].follow;
  return `<div class="hrow actions">
      ${last ? `<button data-pk="${last.gamePk}" data-mode="replay">${esc(F.replayLast)}</button>` : ''}
      <button data-action="picker">${esc(F.allGames)}</button>
      <button data-action="scoreboard">${esc(F.scoreboard)}</button>
    </div>`;
}

export function homeView(d: Decision, ctx: HomeContext): string {
  const S = STRINGS[ctx.lang], F = S.follow;
  const head = (inner: string) => `<div class="hrow top">${inner}<span class="grow"></span><button data-action="settings" title="${esc(S.set.title)}">⚙</button></div>`;
  if (ctx.idle) {
    return `<section class="home">${head(`<b>${esc(F.noLiveGames)}</b>`)}${actions(ctx.lang)}</section>`;
  }
  switch (d.kind) {
    case 'today': case 'next': {
      const g = d.game;
      const when = d.kind === 'today'
        ? (g.start - ctx.now < 60_000 ? F.firstPitchDue(timeOf(g.start, ctx.lang)) : F.firstPitch(timeOf(g.start, ctx.lang), S.duration(g.start - ctx.now)))
        : F.next(`${dayOf(g.start, ctx.lang)} ${timeOf(g.start, ctx.lang)}`);
      const starters = g.away.probable || g.home.probable ? `<div class="hrow muted">${esc(F.starters(g.away.probable ?? '?', g.home.probable ?? '?'))}</div>` : '';
      return `<section class="home">${head(`<span class="teams">${matchup(g)}</span>${seriesLine(g, ctx.lang)}`)}
        <div class="hrow big">${esc(when)}</div>${starters}${actions(ctx.lang, d.last)}</section>`;
    }
    case 'over': {
      const title = F.over[d.how](ctx.team);
      const ask = ctx.askAfter && d.how !== 'advanced'
        ? `<div class="hrow muted">${esc(F.afterTitle)}</div>
           <div class="choices">${(['tension', 'adopt', 'manual', 'rest'] as AfterOut[]).map((k) => `<button data-after="${k}">${esc(F.after[k])}</button>`).join('')}</div>`
        : actions(ctx.lang, d.last);
      return `<section class="home">${head(`<b>${esc(title)}</b>${seriesLine(d.last, ctx.lang)}`)}${ask}</section>`;
    }
    case 'none':
      return `<section class="home">${head(`<b>${esc(ctx.openingIn !== undefined ? F.offseason(ctx.openingIn) : F.noTeamGames)}</b>`)}${actions(ctx.lang)}</section>`;
    case 'live':
      return '';
  }
}

/** The teams still playing this postseason, to adopt one. */
export function adoptView(teams: readonly string[], lang: Lang): string {
  const F = STRINGS[lang].follow;
  return `<section class="home"><div class="hrow top"><b>${esc(F.adoptPick)}</b></div>
      <div class="teams-grid">${teams.map((t) => `<button class="team" data-adopt="${esc(t)}">${dot(t)}${esc(t)}</button>`).join('')}</div></section>`;
}
