// M2 minimal view: a game picker and a one-line score bar, in the floating window.
// Runs in a plain browser too (without window controls), which is how the UI is tested.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { MlbLiveSource } from '../data/mlb/live-source.ts';
import type { MlbFeed } from '../data/mlb/feed-types.ts';
import { mapStatus } from '../data/mlb/codes.ts';
import { MlbReplaySource } from '../data/replay/mlb-replay-source.ts';
import { GameStore } from '../model/store.ts';
import type { GameState, Side } from '../model/types.ts';
import { detectLang, eventLine, STRINGS } from '../i18n/index.ts';
import { pieceColours } from '../styles/team-colors.ts';
import style from '../../styles/iso.json' with { type: 'json' };

const inTauri = '__TAURI_INTERNALS__' in window;
const win = inTauri ? getCurrentWindow() : null;
const lang = detectLang(navigator.language);
const S = STRINGS[lang];
document.documentElement.lang = lang;
for (const [k, v] of Object.entries(style.theme)) document.documentElement.style.setProperty(`--${k}`, v);

const app = document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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

// ---------- picker ----------

interface ScheduleGame {
  gamePk: number;
  gameDate: string;
  officialDate: string;
  gameType: string;
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

type Tab = 'live' | 'later' | 'final';
let pickerDate = easternToday();
let pickerTab: Tab | null = null;
let pickerTimer: ReturnType<typeof setTimeout> | null = null;

function tabOf(g: ScheduleGame): Tab {
  const s = mapStatus(g.status);
  if (s === 'live' || s === 'delayed' || s === 'review' || s === 'suspended') return 'live';
  if (s === 'scheduled' || s === 'pregame') return 'later';
  return 'final';
}

async function showPicker(): Promise<void> {
  store.stop();
  if (pickerTimer) clearTimeout(pickerTimer);
  app.innerHTML = `<section class="picker"><header><b>${esc(S.ui.pickGame)}</b><span class="grow"></span>
    <button data-day="-1" title="${esc(S.ui.prevDay)}">‹</button><span class="date">${pickerDate}</span>
    <button data-day="1" title="${esc(S.ui.nextDay)}">›</button></header><div class="empty">${esc(S.ui.loading)}</div></section>`;
  let games: ScheduleGame[];
  try {
    const sched = (await fetchJson(`/api/v1/schedule?sportId=1&date=${pickerDate}&hydrate=linescore,team`)) as { dates?: { games: ScheduleGame[] }[] };
    games = (sched.dates ?? []).flatMap((d) => d.games);
  } catch {
    app.querySelector('.empty')!.textContent = S.ui.loadFailed;
    pickerTimer = setTimeout(() => void showPicker(), 30_000);
    return;
  }
  setTitle(`Basesmall · picker · ${pickerDate} · ${games.length} games`);
  const byTab: Record<Tab, ScheduleGame[]> = { live: [], later: [], final: [] };
  for (const g of games) byTab[tabOf(g)].push(g);
  pickerTab ??= byTab.live.length ? 'live' : byTab.later.length ? 'later' : 'final';
  const tabs = (['live', 'later', 'final'] as Tab[])
    .map((t) => `<button data-tab="${t}" aria-pressed="${t === pickerTab}">${esc(S.ui[t])} ${byTab[t].length}</button>`).join('');
  const rows = byTab[pickerTab].map((g) => {
    const away = g.teams.away.team.abbreviation ?? '?', home = g.teams.home.team.abbreviation ?? '?';
    const c = pieceColours(away, home);
    const status = mapStatus(g.status);
    const when = pickerTab === 'later'
      ? new Date(g.gameDate).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
      : pickerTab === 'live' && g.linescore?.currentInning
        ? `${g.linescore.isTopInning ? '▲' : '▼'}${g.linescore.currentInning}`
        : status === 'final' ? S.ui.replay : S.status(status, g.status.detailedState);
    // Scores are never shown here: picking a finished game must not spoil it.
    return `<button class="row" data-pk="${g.gamePk}" data-mode="${pickerTab === 'final' ? 'replay' : 'live'}" ${pickerTab === 'final' && status !== 'final' ? 'disabled' : ''}>
      <span class="teams"><i class="dot" style="background:${c.away}"></i>${esc(away)} @ ${esc(home)}<i class="dot" style="background:${c.home}"></i></span>
      <span class="when">${esc(when)}</span></button>`;
  }).join('');
  app.querySelector('.picker')!.innerHTML = `<header><b>${esc(S.ui.pickGame)}</b><span class="grow"></span>
      <button data-day="-1" title="${esc(S.ui.prevDay)}">‹</button><span class="date">${pickerDate}</span>
      <button data-day="1" title="${esc(S.ui.nextDay)}">›</button></header>
    <div class="tabs">${tabs}</div>
    <div class="list">${rows || `<div class="empty">${esc(S.ui.noGames)}</div>`}</div>
    ${pickerTab === 'final' ? `<div class="empty">${esc(S.ui.scoresHidden)}</div>` : ''}`;
  pickerTimer = setTimeout(() => void showPicker(), 60_000);
}

app.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button');
  if (!t) return;
  if (t.dataset.day) { pickerDate = shiftDate(pickerDate, Number(t.dataset.day)); pickerTab = null; void showPicker(); }
  else if (t.dataset.tab) { pickerTab = t.dataset.tab as Tab; void showPicker(); }
  else if (t.dataset.pk) follow(Number(t.dataset.pk), t.dataset.mode === 'replay' ? 'replay' : 'live');
  else if (t.dataset.action === 'back') void showPicker();
});

// ---------- game bar ----------

let lastLine = '';
let mode: 'live' | 'replay' = 'live';
let following = 0;

function follow(pk: number, how: 'live' | 'replay'): void {
  if (pickerTimer) clearTimeout(pickerTimer);
  following = pk;
  mode = how;
  lastLine = '';
  app.innerHTML = `<div class="bar"><span class="muted">${esc(S.ui.loading)}</span></div>`;
  store.follow(how === 'live' ? live : replay, pk);
}

store.subscribe({
  onState: (s) => renderBar(s),
  onEvent: (ev) => {
    const line = eventLine(ev, lang);
    if (line) lastLine = `${line.who ? `<b>${esc(line.who)}</b> ` : ''}${esc(line.text)}`;
  },
  onError: () => { if (store.current) renderBar(store.current); },
});

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
  const c = pieceColours(away, home);
  const bat: Side = s.half === 'top' ? 'away' : 'home';
  const conn = mode === 'live' ? live.status(following) : undefined;
  const statusText = s.status === 'live' ? '' : S.status(s.status, s.statusDetail);
  app.innerHTML = `<div class="bar">
      <span class="cap score"><i class="dot" style="background:${c.away}"></i><span class="muted">${esc(away)}</span>${s.score.away}<span class="muted">:</span>${s.score.home}<span class="muted">${esc(home)}</span><i class="dot" style="background:${c.home}"></i></span>
      <span class="cap">${esc(S.inning(s.inning, s.half))}<span class="lamps">${lamps(Math.min(3, s.outs), 3, 'o')}</span></span>
      <span class="cap mono"><span class="muted">B</span><span class="lamps">${lamps(Math.min(3, s.balls), 3, 'b')}</span><span class="muted">S</span><span class="lamps">${lamps(Math.min(2, s.strikes), 2, 's')}</span></span>
      ${diamond(s, c[bat])}
      <span class="last">${statusText ? `<span class="status">${esc(statusText)}</span> ` : ''}${lastLine}</span>
      ${conn && !conn.connected ? `<i class="conn" title="${esc(S.ui.reconnecting)}"></i>` : ''}
    </div>
    <div class="controls"><button data-action="back">${esc(S.ui.back)}</button></div>`;
  setTitle(`Basesmall · ${s.gamePk} · ${mode} · ${s.status} · ${away} ${s.score.away}-${s.score.home} ${home} · ${S.inning(s.inning, s.half)}`);
}

// ---------- window: drag, resize, background mode ----------

if (win) {
  app.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    void win.startDragging();
  });
  document.getElementById('grip')!.addEventListener('mousedown', (e) => {
    e.preventDefault();
    void win.startResizeDragging('SouthEast');
  });
  void listen<string>('bg-mode', (e) => setBackground(e.payload));
}

function setBackground(m: string): void {
  if (!['solid', 'semi', 'clear'].includes(m)) return;
  app.className = `bg-${m}`;
  try { localStorage.setItem('bg-mode', m); } catch { /* storage unavailable */ }
}
try { setBackground(localStorage.getItem('bg-mode') ?? 'solid'); } catch { setBackground('solid'); }

// Open a game directly: `basesmall --game=<pk> [--mode=replay]` in the app, ?game=<pk>&mode=replay in a browser.
async function start(): Promise<void> {
  const q = new URLSearchParams(location.search);
  if (inTauri) {
    for (const a of await invoke<string[]>('launch_args').catch(() => [] as string[])) {
      const m = /^--(game|mode)=(.+)$/.exec(a);
      if (m) q.set(m[1]!, m[2]!);
    }
  }
  if (q.has('game')) follow(Number(q.get('game')), q.get('mode') === 'replay' ? 'replay' : 'live');
  else void showPicker();
}
void start();
