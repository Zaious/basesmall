// M2 minimal view: choose a team, pick a game, follow it on a one-line score bar.
// Runs in a plain browser too (without window controls), which is how the UI is checked headless.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { MlbLiveSource } from '../data/mlb/live-source.ts';
import type { MlbFeed } from '../data/mlb/feed-types.ts';
import { mapStatus } from '../data/mlb/codes.ts';
import { MlbReplaySource } from '../data/replay/mlb-replay-source.ts';
import { GameStore } from '../model/store.ts';
import type { GameState, Side } from '../model/types.ts';
import { detectLang, eventLine, pitchLine, STRINGS } from '../i18n/index.ts';
import { pieceColours } from '../styles/team-colors.ts';
import teamTable from '../../styles/team-colors/mlb.json' with { type: 'json' };
import style from '../../styles/iso.json' with { type: 'json' };

const inTauri = '__TAURI_INTERNALS__' in window;
const win = inTauri ? getCurrentWindow() : null;
const lang = detectLang(navigator.language);
const S = STRINGS[lang];
document.documentElement.lang = lang;
for (const [k, v] of Object.entries(style.theme)) document.documentElement.style.setProperty(`--${k}`, v);

const app = document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------- settings (localStorage until the settings file arrives in M4) ----------

const load = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
/** Team abbreviation, 'none', or null before the first choice. */
let favorite = load('favorite');
const fav = () => (favorite && favorite !== 'none' ? favorite : undefined);
const TEAMS = Object.keys((teamTable as { teams: Record<string, { piece: string }> }).teams).sort();
const teamPiece = (abbr: string) => (teamTable as { teams: Record<string, { piece: string }> }).teams[abbr]?.piece ?? '#9AA0AA';

// ---------- window size per view ----------

type View = 'chooser' | 'picker' | 'game';
const DEFAULT_SIZE: Record<View, { w: number; h: number }> = {
  chooser: { w: 480, h: 300 }, picker: { w: 480, h: 300 }, game: { w: 480, h: 64 },
};
/** Below this the picker and chooser cannot show a single row, so they never open smaller. */
const LIST_MIN_HEIGHT = 200;
/** Height of the tab strip above the score bar (clock, replay). Saved sizes exclude it. */
const TAB_H = 20;
let view: View = 'picker';
let programmaticResize = 0;
let tabsShown = false;

async function fitWindow(v: View): Promise<void> {
  view = v;
  if (!win) return;
  let size = DEFAULT_SIZE[v];
  try { size = { ...size, ...(JSON.parse(load(`size-${v}`) ?? 'null') ?? {}) }; } catch { /* keep default */ }
  if (v !== 'game') size = { w: Math.max(size.w, 320), h: Math.max(size.h, LIST_MIN_HEIGHT) };
  programmaticResize = Date.now();
  await win.setSize(new LogicalSize(size.w, size.h + (v === 'game' && tabsShown ? TAB_H : 0)));
  // The window starts hidden so it never flashes at the wrong size.
  await win.show();
}

/** Grow or shrink the window by the tab strip upwards, so the bar itself stays where it is on screen. */
async function resizeForTabs(show: boolean): Promise<void> {
  if (!win || view !== 'game') return;
  const scale = await win.scaleFactor();
  const size = (await win.innerSize()).toLogical(scale);
  const pos = await win.outerPosition();
  const dy = Math.round(TAB_H * scale) * (show ? -1 : 1);
  programmaticResize = Date.now();
  await win.setPosition(new PhysicalPosition(pos.x, pos.y + dy));
  await win.setSize(new LogicalSize(size.width, size.height + (show ? TAB_H : -TAB_H)));
}

if (win) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  void win.onResized(() => {
    if (Date.now() - programmaticResize < 800) return; // our own resize, not the user's
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const size = (await win.innerSize()).toLogical(await win.scaleFactor());
      const h = size.height - (view === 'game' && tabsShown ? TAB_H : 0);
      save(`size-${view}`, JSON.stringify({ w: Math.round(size.width), h: Math.round(h) }));
    }, 400);
  });
}

// ---------- data ----------

async function fetchJson(path: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`https://statsapi.mlb.com${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const live = new MlbLiveSource(fetchJson);
const replay = new MlbReplaySource(async (pk) => (await fetchJson(`/api/v1.1/game/${pk}/feed/live`)) as MlbFeed);
const store = new GameStore();
document.addEventListener('visibilitychange', () => live.setBackground(document.hidden));
const setTitle = (t: string) => { document.title = t; void win?.setTitle(t); };

// ---------- team chooser ----------

function showChooser(): void {
  store.stop();
  view = 'chooser';
  renderTabs(undefined);
  void fitWindow('chooser');
  const buttons = TEAMS.map((t) =>
    `<button class="team" data-fav="${t}" aria-pressed="${t === favorite}"><i class="dot" style="background:${teamPiece(t)}"></i>${t}</button>`).join('');
  app.innerHTML = `<section class="chooser">
      <header><b>${esc(S.ui.chooseTeam)}</b></header>
      <p class="hint">${esc(S.ui.chooseTeamHint)}</p>
      <div class="teams">${buttons}</div>
      <button class="team none" data-fav="none" aria-pressed="${favorite === 'none'}">${esc(S.ui.noFavorite)}</button>
    </section>`;
  setTitle('Basesmall · choose team');
}

// ---------- picker ----------

interface ScheduleGame {
  gamePk: number;
  gameDate: string;
  officialDate: string;
  status: { abstractGameState?: string; codedGameState?: string; detailedState?: string };
  teams: Record<Side, { team: { abbreviation?: string; name: string } }>;
  linescore?: { currentInning?: number; isTopInning?: boolean };
}

/** MLB's schedule day is the US Eastern date. */
const easternToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const shiftDate = (d: string, days: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

type Tab = 'live' | 'later' | 'final';
let pickerDate = easternToday();
let pickerTab: Tab | null = null;
let pickerTimer: ReturnType<typeof setTimeout> | null = null;
let pickerFitted = false;
const dates = new Map<number, string>(); // gamePk -> officialDate, for the replay tab

function tabOf(g: ScheduleGame): Tab {
  const s = mapStatus(g.status);
  if (s === 'live' || s === 'delayed' || s === 'review' || s === 'suspended') return 'live';
  if (s === 'scheduled' || s === 'pregame') return 'later';
  return 'final';
}

function pickerHeader(): string {
  return `<header><b>${esc(S.ui.pickGame)}</b>
      <button class="fav" data-action="choose" title="${esc(S.ui.favorite)}">★ ${esc(fav() ?? S.ui.noFavorite)}</button>
      <span class="grow"></span>
      <button data-day="-1" title="${esc(S.ui.prevDay)}">‹</button><span class="date">${pickerDate}</span>
      <button data-day="1" title="${esc(S.ui.nextDay)}">›</button></header>`;
}

async function showPicker(): Promise<void> {
  store.stop();
  const from = view;
  view = 'picker';
  renderTabs(undefined);
  if (pickerTimer) clearTimeout(pickerTimer);
  if (from !== 'picker' || !pickerFitted) { pickerFitted = true; void fitWindow('picker'); }
  app.innerHTML = `<section class="picker">${pickerHeader()}<div class="empty">${esc(S.ui.loading)}</div></section>`;
  let games: ScheduleGame[];
  try {
    const sched = (await fetchJson(`/api/v1/schedule?sportId=1&date=${pickerDate}&hydrate=linescore,team`)) as { dates?: { games: ScheduleGame[] }[] };
    games = (sched.dates ?? []).flatMap((d) => d.games);
  } catch {
    app.querySelector('.empty')!.textContent = S.ui.loadFailed;
    pickerTimer = setTimeout(() => void showPicker(), 30_000);
    return;
  }
  if (view !== 'picker') return; // the user moved on while we were loading
  setTitle(`Basesmall · picker · ${pickerDate} · ${games.length} games`);
  const mine = (g: ScheduleGame) => [g.teams.away.team.abbreviation, g.teams.home.team.abbreviation].includes(fav());
  const byTab: Record<Tab, ScheduleGame[]> = { live: [], later: [], final: [] };
  for (const g of [...games].sort((a, b) => Number(mine(b)) - Number(mine(a)))) {
    byTab[tabOf(g)].push(g);
    dates.set(g.gamePk, g.officialDate);
  }
  pickerTab ??= byTab.live.length ? 'live' : byTab.later.length ? 'later' : 'final';
  const tabs = (['live', 'later', 'final'] as Tab[])
    .map((t) => `<button data-tab="${t}" aria-pressed="${t === pickerTab}">${esc(S.ui[t])} ${byTab[t].length}</button>`).join('');
  const rows = byTab[pickerTab].map((g) => {
    const away = g.teams.away.team.abbreviation ?? '?', home = g.teams.home.team.abbreviation ?? '?';
    const c = pieceColours(away, home, fav());
    const status = mapStatus(g.status);
    const when = pickerTab === 'later'
      ? new Date(g.gameDate).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
      : pickerTab === 'live' && g.linescore?.currentInning
        ? `${g.linescore.isTopInning ? '▲' : '▼'}${g.linescore.currentInning}`
        : status === 'final' ? `${S.ui.replay} ▶` : S.status(status, g.status.detailedState);
    // Scores are never shown here: picking a finished game must not spoil it.
    return `<button class="row${mine(g) ? ' mine' : ''}" data-pk="${g.gamePk}" data-mode="${pickerTab === 'final' ? 'replay' : 'live'}" ${pickerTab === 'final' && status !== 'final' ? 'disabled' : ''}>
      <span class="teams">${mine(g) ? '<span class="star">★</span>' : ''}<i class="dot" style="background:${c.away}"></i>${esc(away)} @ ${esc(home)}<i class="dot" style="background:${c.home}"></i></span>
      <span class="when">${esc(when)}</span></button>`;
  }).join('');
  app.querySelector('.picker')!.innerHTML = `${pickerHeader()}
    <div class="tabs">${tabs}</div>
    <div class="list">${rows || `<div class="empty">${esc(S.ui.noGames)}</div>`}</div>
    ${pickerTab === 'final' ? `<div class="empty small">${esc(S.ui.scoresHidden)}</div>` : ''}`;
  pickerTimer = setTimeout(() => void showPicker(), 60_000);
}

// ---------- game bar ----------

let mode: 'live' | 'replay' = 'live';
let following = 0;
let resultLine = '';
let pitchText = '';
let showPitch = false;
let speed = 1;
const SPEEDS = [1, 2, 4, 8];
/** Tabs above the bar, each closable on its own. */
const tabOn = { clock: load('tab-clock') !== 'off', replay: load('tab-replay') !== 'off' };
const tabsEl = document.getElementById('tabs')!;

/** How long the game has been going, h:mm. Live: until now. Replay: until the moment shown. Final: official length. */
function elapsed(s: GameState): string {
  const minutes = s.status === 'final' && s.durationMinutes ? s.durationMinutes
    : s.startedAt === undefined ? undefined
    : ((mode === 'live' && s.status !== 'final' ? Date.now() : s.at ?? Date.now()) - s.startedAt) / 60_000;
  if (minutes === undefined || minutes < 0) return '';
  const m = Math.floor(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
// Live clocks move between updates too.
setInterval(() => { if (view === 'game' && mode === 'live' && tabOn.clock && store.current?.status === 'live') renderBar(store.current); }, 30_000);

function renderTabs(s: GameState | undefined): void {
  const items: string[] = [];
  if (view === 'game' && s) {
    const time = elapsed(s);
    if (tabOn.clock && time) items.push(`<span class="tab" title="${esc(S.ui.clock)}">⏱ <span class="mono">${time}</span><button data-close="clock" aria-label="×">×</button></span>`);
    if (tabOn.replay && mode === 'replay') {
      const date = dates.get(s.gamePk);
      items.push(`<span class="tab accent">${esc(S.ui.replay)}${date ? ` · ${shortDate(date)}` : ''}${speed > 1 ? ` · ${speed}×` : ''}<button data-close="replay" aria-label="×">×</button></span>`);
    }
  }
  tabsEl.innerHTML = items.join('');
  const show = items.length > 0;
  document.body.classList.toggle('has-tabs', show);
  if (show !== tabsShown) { tabsShown = show; void resizeForTabs(show); }
}

function setTab(k: keyof typeof tabOn, on: boolean): void {
  tabOn[k] = on;
  save(`tab-${k}`, on ? 'on' : 'off');
  if (store.current) renderBar(store.current);
}

tabsEl.addEventListener('click', (e) => {
  const k = (e.target as HTMLElement).closest('button')?.dataset.close;
  if (k === 'clock' || k === 'replay') setTab(k, false);
});

function follow(pk: number, how: 'live' | 'replay'): void {
  if (pickerTimer) clearTimeout(pickerTimer);
  following = pk;
  mode = how;
  resultLine = pitchText = '';
  showPitch = false;
  speed = 1;
  void fitWindow('game');
  app.innerHTML = `<div class="bar"><span class="muted">${esc(S.ui.loading)}</span></div>${controls()}`;
  // Controls stay visible for a moment so a first-time user sees they exist.
  app.classList.add('reveal');
  setTimeout(() => app.classList.remove('reveal'), 4000);
  store.follow(how === 'live' ? live : replay, pk);
}

const formatLine = (l: { who?: string; text: string }) => `${l.who ? `<b>${esc(l.who)}</b> ` : ''}${esc(l.text)}`;

store.subscribe({
  onState: (s) => renderBar(s),
  onEvent: (ev) => {
    if (ev.type === 'pitch') { pitchText = pitchLine(ev.pitch, lang); showPitch = true; return; }
    const line = eventLine(ev, lang);
    if (line) { resultLine = formatLine(line); showPitch = false; }
  },
  onError: () => { if (store.current) renderBar(store.current); },
});

function controls(): string {
  const p = mode === 'replay' ? replay.player(following) : undefined;
  const replayButtons = mode === 'replay'
    ? `<button data-action="toggle">${p && !p.playing && !p.done ? `▶ ${esc(S.ui.play)}` : `❚❚ ${esc(S.ui.pause)}`}</button>
       <button data-action="speed" title="${esc(S.ui.speed)}">${speed}×</button>
       <button data-action="next">${esc(S.ui.nextResult)} ⏭</button>`
    : '';
  const tabButtons = `<button data-action="clock" aria-pressed="${tabOn.clock}" title="${esc(S.ui.clock)}">⏱</button>`
    + (mode === 'replay' ? `<button data-action="replay-tab" aria-pressed="${tabOn.replay}">${esc(S.ui.replay)}</button>` : '');
  return `<div class="controls">${replayButtons}${tabButtons}<button data-action="back">‹ ${esc(S.ui.back)}</button></div>`;
}

const lamps = (n: number, max: number, cls: string) =>
  Array.from({ length: max }, (_, i) => `<i class="lamp ${i < n ? cls : ''}"></i>`).join('');

function diamond(s: GameState, colour: string): string {
  const at = { '1B': [25, 15], '2B': [15, 5], '3B': [5, 15] } as const;
  const sq = ([x, y]: readonly [number, number], on: boolean) =>
    `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" transform="rotate(45 ${x} ${y})" fill="${on ? colour : 'transparent'}" stroke="${on ? 'var(--text)' : 'var(--muted)'}" stroke-opacity="${on ? 0.8 : 0.6}" stroke-width="1.2"/>`;
  return `<svg class="diamond" width="30" height="22" viewBox="0 0 30 22" aria-hidden="true">${
    (Object.keys(at) as (keyof typeof at)[]).map((b) => sq(at[b], !!s.bases[b])).join('')}</svg>`;
}

function renderBar(s: GameState): void {
  const away = s.teams.away.abbr, home = s.teams.home.abbr;
  const c = pieceColours(away, home, fav());
  const bat: Side = s.half === 'top' ? 'away' : 'home';
  const conn = mode === 'live' ? live.status(following) : undefined;
  const statusText = s.status === 'live' ? '' : S.status(s.status, s.statusDetail);
  const last = showPitch ? `<span class="muted">${esc(pitchText)}</span>` : resultLine;
  // Two lines on the left, like the prototype's control bar: score, then inning / count / outs / clock.
  // That leaves the right side for the latest pitch or play.
  app.innerHTML = `<div class="bar">
      <div class="sb">
        <div class="l1"><i class="dot" style="background:${c.away}"></i><span class="muted">${esc(away)}</span>${s.score.away}<span class="muted">:</span>${s.score.home}<span class="muted">${esc(home)}</span><i class="dot" style="background:${c.home}"></i></div>
        <div class="l2"><span>${esc(S.inning(s.inning, s.half))}</span><span class="mono">${Math.min(3, s.balls)}-${Math.min(2, s.strikes)}</span><span class="lamps">${lamps(Math.min(3, s.outs), 3, 'o')}</span></div>
      </div>
      ${diamond(s, c[bat])}
      <span class="last">${statusText ? `<span class="status">${esc(statusText)}</span> ` : ''}${last}</span>
      ${conn && !conn.connected ? `<i class="conn" title="${esc(S.ui.reconnecting)}"></i>` : ''}
    </div>${controls()}`;
  renderTabs(s);
  setTitle(`Basesmall · ${s.gamePk} · ${mode} · ${s.status} · ${away} ${s.score.away}-${s.score.home} ${home} · ${S.inning(s.inning, s.half)} · ${s.balls}-${s.strikes} ${s.outs}out · ${elapsed(s)}`);
}

function replayAction(action: string): void {
  if (action === 'clock') { setTab('clock', !tabOn.clock); return; }
  if (action === 'replay-tab') { setTab('replay', !tabOn.replay); return; }
  const p = replay.player(following);
  if (!p) return;
  if (action === 'toggle') { if (p.playing) p.pause(); else p.play(); }
  else if (action === 'speed') { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!; p.setSpeed(speed); }
  else if (action === 'next') {
    const i = p.timeline.findIndex((e, n) => n > p.position && e.events.some((ev) => ev.type === 'plateAppearance' || ev.type === 'gameEnd'));
    if (i < 0) return;
    const pa = p.timeline[i]!.events.map((ev) => eventLine(ev, lang)).find(Boolean);
    if (pa) { resultLine = formatLine(pa); showPitch = false; }
    p.seek(i); // a snap: state only, no replayed events
  }
  if (store.current) renderBar(store.current);
}

// ---------- input ----------

app.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button');
  if (!t) return;
  const { day, tab, pk, action } = t.dataset;
  if (t.dataset.fav) { favorite = t.dataset.fav; save('favorite', favorite); pickerTab = null; void showPicker(); }
  else if (day) { pickerDate = shiftDate(pickerDate, Number(day)); pickerTab = null; void showPicker(); }
  else if (tab) { pickerTab = tab as Tab; void showPicker(); }
  else if (pk) follow(Number(pk), t.dataset.mode === 'replay' ? 'replay' : 'live');
  else if (action === 'back') void showPicker();
  else if (action === 'choose') showChooser();
  else if (action) replayAction(action);
});

if (win) {
  for (const el of [app, tabsEl]) {
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      void win.startDragging();
    });
  }
  document.getElementById('grip')!.addEventListener('mousedown', (e) => {
    e.preventDefault();
    void win.startResizeDragging('SouthEast');
  });
  void listen<string>('bg-mode', (e) => setBackground(e.payload));
}

function setBackground(m: string): void {
  if (!['solid', 'semi', 'clear'].includes(m)) return;
  for (const el of [app, tabsEl]) {
    el.classList.remove('bg-solid', 'bg-semi', 'bg-clear');
    el.classList.add(`bg-${m}`);
  }
  save('bg-mode', m);
}
setBackground(load('bg-mode') ?? 'solid');

// Open a game directly: `basesmall --game=<pk> [--mode=replay]` in the app, ?game=<pk>&mode=replay in a browser.
async function start(): Promise<void> {
  const q = new URLSearchParams(location.search);
  if (inTauri) {
    for (const a of await invoke<string[]>('launch_args').catch(() => [] as string[])) {
      const m = /^--(game|mode|team)=(.+)$/.exec(a);
      if (m) q.set(m[1]!, m[2]!);
    }
  }
  if (q.has('team')) { favorite = q.get('team')!; save('favorite', favorite); }
  if (q.has('game')) follow(Number(q.get('game')), q.get('mode') === 'replay' ? 'replay' : 'live');
  else if (favorite === null) showChooser();
  else void showPicker();
}
void start();
