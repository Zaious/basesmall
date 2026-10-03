// The main window: choose a team, pick a game, follow it, change settings. The game view has four
// size tiers (dot, bar, field, full); the window's size picks one. Field and full draw the board.
// Runs in a plain browser too (without window controls), which is how the UI is checked headless.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MlbLiveSource } from '../data/mlb/live-source.ts';
import type { MlbFeed } from '../data/mlb/feed-types.ts';
import { mapStatus } from '../data/mlb/codes.ts';
import { MlbReplaySource } from '../data/replay/mlb-replay-source.ts';
import type { PaceMode } from '../data/replay/pacing.ts';
import { GameStore } from '../model/store.ts';
import type { GameEvent, GameState, Side } from '../model/types.ts';
import { detectLang, eventLine, pitchLine, STRINGS, type Lang } from '../i18n/index.ts';
import { piecePaints, teamPaint } from '../styles/team-colors.ts';
import { findStyle, loadStyles, nextStyle } from '../styles/loader.ts';
import type { StyleManifest } from '../styles/manifest.ts';
import { fromLocalStorage, NOTIFY_KINDS, type PaceSetting, type Settings, type Size } from '../settings/schema.ts';
import { SettingsStore, type SettingsBackend } from '../settings/store.ts';
import { Sounds } from '../audio/sounds.ts';
import { Notifier } from '../notify/notifier.ts';
import { diffSchedule, noticeFor, scheduleNotice, type GameSnap, type Notice } from '../notify/rules.ts';
import { FieldRenderer } from '../render/field-svg.ts';
import { AnimationQueue } from '../render/queue.ts';
import { planStep, sceneOf, type Plan, type Scene } from '../render/scene.ts';
import { nextTier, partsOf, tierOf, TIER_MIN_WIDTH, TIER_PRESET, type Tier, type TierParts } from '../render/tiers.ts';
import { frameGaps } from '../render/tween.ts';
import { zoneSvg } from '../render/zone.ts';
import { barView, dot, dotView, esc, hudView, linescoreView, matchupView, pitchCaption } from './views.ts';
import teamTable from '../../styles/team-colors/mlb.json' with { type: 'json' };

const inTauri = '__TAURI_INTERNALS__' in window;
const win = inTauri ? getCurrentWindow() : null;
const app = document.getElementById('app')!;
const tabsEl = document.getElementById('tabs')!;

/** Launch overrides for checking the app (--tier, --style, --bg, ...). They are never saved. */
const dev: { tier?: Tier; selfcheck?: boolean; speed?: number } = {};
const TEAMS = Object.keys((teamTable as { teams: Record<string, unknown> }).teams).sort();

// ---------- settings ----------

const legacy = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

/** settings.json in the app config dir; in a plain browser, localStorage stands in. */
const backend: SettingsBackend = inTauri
  ? { read: () => invoke<string | null>('read_settings'), write: (text) => invoke('write_settings', { text }) }
  : { read: async () => legacy('settings'), write: async (text) => { try { localStorage.setItem('settings', text); } catch { /* none */ } } };

/** Replaced by the saved file in start(); until then, what the older versions kept. */
let settings = new SettingsStore(backend, fromLocalStorage(legacy));
settings.persist = false;
const cfg = () => settings.current;
const fav = () => { const f = cfg().favorite; return f && f !== 'none' ? f : undefined; };

let lang: Lang = 'en';
let S = STRINGS.en;
function applyLanguage(): void {
  const l = cfg().language;
  lang = l === 'auto' ? detectLang(navigator.language) : l;
  S = STRINGS[lang];
  document.documentElement.lang = lang;
}
applyLanguage();

// ---------- styles ----------

let styles: StyleManifest[] = loadStyles([]).styles;
let styleProblems: string[] = [];
let style = findStyle(styles, cfg().style);
let configFolder = '';

function applyStyle(): void {
  for (const [k, v] of Object.entries(style.theme)) document.documentElement.style.setProperty(`--${k}`, v);
  document.documentElement.dataset.renderer = style.renderer;
}
applyStyle();

/** Style files the user dropped into the styles folder. Bad files are skipped and listed in the style button's tooltip. */
async function loadUserStyles(): Promise<void> {
  if (!inTauri) return;
  const files = await invoke<[string, string][]>('user_styles').catch(() => [] as [string, string][]);
  const r = loadStyles(files.map(([name, text]) => ({ name, text })));
  styles = r.styles;
  styleProblems = r.problems;
  if (r.problems.length) console.warn('Style files skipped:', r.problems);
  style = findStyle(styles, cfg().style);
  applyStyle();
}

// ---------- window size per view ----------

type View = 'chooser' | 'picker' | 'game' | 'settings';
const DEFAULT_SIZE: Record<View, Size> = {
  chooser: { w: 480, h: 300 }, picker: { w: 480, h: 300 }, game: TIER_PRESET.field, settings: { w: 400, h: 460 },
};
/** Below this the lists cannot show a single row, so they never open smaller. */
const LIST_MIN_HEIGHT = 200;
/** Height of the strip above the game: tabs on the left (clock, replay), controls on the
 *  right on hover. Always there in the game view, so nothing ever covers the game. Saved sizes exclude it. */
const TAB_H = 20;
let view: View = 'picker';
let programmaticResize = 0;

const savedSize = (key: string, fallback: Size): Size => cfg().sizes[key] ?? fallback;
const saveSize = (key: string, s: Size) => settings.update((d) => { d.sizes[key] = s; });

async function fitWindow(v: View): Promise<void> {
  view = v;
  if (!win) return;
  let size = savedSize(`size-${v}`, DEFAULT_SIZE[v]);
  if (v === 'game' && dev.tier) size = TIER_PRESET[dev.tier];
  if (v !== 'game') size = { w: Math.max(size.w, 320), h: Math.max(size.h, LIST_MIN_HEIGHT) };
  programmaticResize = Date.now();
  await win.setSize(new LogicalSize(size.w, size.h + (v === 'game' ? TAB_H : 0)));
  // The window starts hidden so it never flashes at the wrong size.
  await win.show();
}

if (win) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  void win.onResized(() => {
    if (Date.now() - programmaticResize < 800) return; // our own resize, not the user's
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const size = (await win.innerSize()).toLogical(await win.scaleFactor());
      const h = Math.round(size.height - (view === 'game' ? TAB_H : 0)), w = Math.round(size.width);
      saveSize(`size-${view}`, { w, h });
      // Each tier remembers its own size, for the size button.
      if (view === 'game') saveSize(`size-tier-${tierOf(h)}`, { w, h });
    }, 400);
  });
}

/** The size button: open the next tier at the size it last had. */
async function cycleTier(): Promise<void> {
  if (!win) return;
  const next = nextTier(tier);
  const size = savedSize(`size-tier-${next}`, TIER_PRESET[next]);
  const w = Math.max(size.w, TIER_MIN_WIDTH[next]);
  // A saved size from the edge of a tier could fall into the neighbouring one; keep the tier asked for.
  const h = tierOf(size.h) === next ? size.h : TIER_PRESET[next].h;
  programmaticResize = Date.now();
  await win.setSize(new LogicalSize(w, h + TAB_H));
  saveSize('size-game', { w, h });
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
const sounds = new Sounds();
const notifier = inTauri ? new Notifier() : null;

// ---------- team chooser ----------

function showChooser(): void {
  leaveGame();
  view = 'chooser';
  renderTabs(undefined);
  void fitWindow('chooser');
  renderChooser();
}

function renderChooser(): void {
  const favorite = cfg().favorite;
  const buttons = TEAMS.map((t) =>
    `<button class="team" data-fav="${t}" aria-pressed="${t === favorite}">${dot(teamPaint(t))}${t}</button>`).join('');
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
  teams: Record<Side, { team: { abbreviation?: string; name: string }; score?: number }>;
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
const schedulePath = (date: string) => `/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team`;

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
      <button data-day="1" title="${esc(S.ui.nextDay)}">›</button>
      <button data-action="settings" title="${esc(S.set.title)}">⚙</button></header>`;
}

async function showPicker(): Promise<void> {
  leaveGame();
  const from = view;
  view = 'picker';
  renderTabs(undefined);
  if (pickerTimer) clearTimeout(pickerTimer);
  if (from !== 'picker' || !pickerFitted) { pickerFitted = true; void fitWindow('picker'); }
  app.innerHTML = `<section class="picker">${pickerHeader()}<div class="empty">${esc(S.ui.loading)}</div></section>`;
  let games: ScheduleGame[];
  try {
    const sched = (await fetchJson(schedulePath(pickerDate))) as { dates?: { games: ScheduleGame[] }[] };
    games = (sched.dates ?? []).flatMap((d) => d.games);
  } catch {
    if (view === 'picker') app.querySelector('.empty')!.textContent = S.ui.loadFailed;
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
  const showScores = cfg().replay.showScores;
  const tabs = (['live', 'later', 'final'] as Tab[])
    .map((t) => `<button data-tab="${t}" aria-pressed="${t === pickerTab}">${esc(S.ui[t])} ${byTab[t].length}</button>`).join('');
  const rows = byTab[pickerTab].map((g) => {
    const away = g.teams.away.team.abbreviation ?? '?', home = g.teams.home.team.abbreviation ?? '?';
    const c = piecePaints(away, home, fav());
    const status = mapStatus(g.status);
    const when = pickerTab === 'later'
      ? new Date(g.gameDate).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
      : pickerTab === 'live' && g.linescore?.currentInning
        ? `${g.linescore.isTopInning ? '▲' : '▼'}${g.linescore.currentInning}`
        : status === 'final' ? `${S.ui.replay} ▶` : S.status(status, g.status.detailedState);
    // Scores stay hidden unless the user asked for them: picking a finished game must not spoil it.
    const score = showScores && pickerTab !== 'later' && g.teams.away.score !== undefined
      ? `<span class="score">${g.teams.away.score}:${g.teams.home.score ?? 0}</span>` : '';
    return `<button class="row${mine(g) ? ' mine' : ''}" data-pk="${g.gamePk}" data-mode="${pickerTab === 'final' ? 'replay' : 'live'}" ${pickerTab === 'final' && status !== 'final' ? 'disabled' : ''}>
      <span class="teams">${mine(g) ? '<span class="star">★</span>' : ''}${dot(c.away)}${esc(away)} @ ${esc(home)}${dot(c.home)}</span>
      ${score}<span class="when">${esc(when)}</span></button>`;
  }).join('');
  app.querySelector('.picker')!.innerHTML = `${pickerHeader()}
    <div class="tabs">${tabs}</div>
    <div class="list">${rows || `<div class="empty">${esc(S.ui.noGames)}</div>`}</div>
    ${pickerTab === 'final' && !showScores ? `<div class="empty small">${esc(S.ui.scoresHidden)}</div>` : ''}`;
  pickerTimer = setTimeout(() => void showPicker(), 60_000);
}

// ---------- settings screen ----------

/** Where "Done" goes back to. */
let settingsReturn: View = 'picker';
let appVersion = '';

function showSettings(): void {
  if (view === 'settings') return;
  settingsReturn = view;
  if (pickerTimer) clearTimeout(pickerTimer);
  view = 'settings';
  renderTabs(undefined);
  void fitWindow('settings');
  renderSettings();
}

function closeSettings(): void {
  if (settingsReturn === 'game' && store.current) {
    // The game kept going while settings were open; pick it up where it is now.
    view = 'game';
    void fitWindow('game');
    scene = sceneOf(store.current, store.currentEntry?.events ?? []);
    shown = store.current;
    buildGame();
  } else if (settingsReturn === 'chooser') showChooser();
  else void showPicker();
}

function renderSettings(): void {
  const c = cfg();
  const T = S.set;
  const seg = (path: string, current: string, options: [string, string][]) =>
    `<div class="seg">${options.map(([v, label]) => `<button data-pick="${path}" data-value="${esc(v)}" aria-pressed="${v === current}">${esc(label)}</button>`).join('')}</div>`;
  const check = (path: string, on: boolean, label: string) =>
    `<label class="check"><input type="checkbox" data-set="${path}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  const marquee = c.notify.mode === 'marquee' || c.notify.mode === 'both';
  const soundNote = !c.sound.muted && sounds.state === 'suspended' ? `<p class="note">${esc(T.soundBlocked)}</p>` : '';
  const scrollTop = app.querySelector('.settings .body')?.scrollTop ?? 0;
  app.innerHTML = `<section class="settings">
      <header><b>${esc(T.title)}</b><span class="grow"></span><button class="done" data-action="settings-done">${esc(T.done)}</button></header>
      <div class="body">
        <div class="srow"><span class="k">${esc(T.team)}</span><span class="v mono">★ ${esc(fav() ?? S.ui.noFavorite)}</span><button class="link" data-action="choose">${esc(T.change)}</button></div>
        <div class="srow"><span class="k">${esc(S.ui.style)}</span>${seg('style', style.id, styles.map((s) => [s.id, s.name[lang]]))}</div>
        <div class="srow"><span class="k">${esc(T.background)}</span>${seg('background', c.background, (['solid', 'semi', 'clear'] as const).map((b) => [b, T.bg[b]]))}</div>
        <div class="srow"><span class="k">${esc(T.language)}</span>${seg('language', c.language, [['auto', T.auto], ['zh-Hant', '繁體中文'], ['en', 'English']])}</div>
        <div class="srow"><span class="k">${esc(T.tabs)}</span>${check('tabs.clock', c.tabs.clock, S.ui.clock)}${check('tabs.replay', c.tabs.replay, S.ui.replay)}</div>

        <h3>${esc(T.sound)}</h3>
        <div class="srow">${check('sound.on', !c.sound.muted, T.soundOn)}<input type="range" min="0" max="100" step="5" data-set="sound.volume" value="${Math.round(c.sound.volume * 100)}" aria-label="${esc(T.volume)}"${c.sound.muted ? ' disabled' : ''}></div>
        <div class="srow">${check('sound.hit', c.sound.hit, T.hit)}<button class="link" data-preview="hit">▶ ${esc(T.preview)}</button>${check('sound.homeRun', c.sound.homeRun, T.homeRun)}<button class="link" data-preview="homeRun">▶ ${esc(T.preview)}</button></div>
        ${soundNote}

        <h3>${esc(T.notify)}</h3>
        <div class="srow"><span class="k">${esc(T.mode)}</span>${seg('notify.mode', c.notify.mode, (['toast', 'marquee', 'both', 'off'] as const).map((m) => [m, T.modes[m]]))}</div>
        <div class="srow${marquee ? '' : ' off'}"><span class="k">${esc(T.spot)}</span>${seg('notify.marquee', c.notify.marquee, (['top', 'bottom', 'bar'] as const).map((m) => [m, T.spots[m]]))}</div>
        <div class="block${c.notify.mode === 'off' ? ' off' : ''}"><span class="k">${esc(T.events)}</span><div class="chips">${NOTIFY_KINDS.map((k) => check(`notify.events.${k}`, c.notify.events[k], S.notify.kinds[k])).join('')}</div></div>
        <div class="srow${c.notify.mode === 'off' ? ' off' : ''}">${check('notify.onlyMine', c.notify.onlyMine, T.onlyMine)}</div>

        <h3>${esc(T.replay)}</h3>
        <div class="srow"><span class="k">${esc(T.pace)}</span>${seg('replay.pace', c.replay.pace, (['compact', 'real', 'fixed', 'results'] as const).map((p) => [p, T.paces[p]]))}</div>
        <div class="srow">${check('replay.showScores', c.replay.showScores, T.showScores)}</div>

        <h3>${esc(T.about)}</h3>
        <p class="about"><b>Basesmall</b> ${esc(appVersion)} · <i>Baseball, but small.</i><br>${esc(T.aboutText)}</p>
        <div class="srow"><button class="link" data-open="https://buymeacoffee.com/zaious">☕ ${esc(T.support)}</button><button class="link" data-open="https://github.com/Zaious/basesmall">${esc(T.source)}</button></div>
        ${configFolder ? `<p class="note">${esc(T.stylesFolder)}: <span class="mono">${esc(configFolder)}${configFolder.includes('\\') ? '\\' : '/'}styles</span></p>` : ''}
      </div>
    </section>`;
  const body = app.querySelector('.settings .body');
  if (body) body.scrollTop = scrollTop;
  setTitle(`Basesmall · settings · ${lang} · ${style.id} · ${c.background} · sound ${c.sound.muted ? 'off' : 'on'} · notify ${c.notify.mode}`);
}

/** Set a dotted path like "notify.events.hr" on a settings draft. */
function setPath(path: string, value: unknown): void {
  settings.update((d) => {
    if (path === 'sound.on') { d.sound.muted = !value; return; }
    const keys = path.split('.');
    let o = d as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys.at(-1)!] = value;
  });
}

app.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  const path = t.dataset.set;
  if (!path) return;
  if (t.type === 'checkbox') {
    // Switching sound on is a click: the moment the web view lets a page start audio.
    if (path === 'sound.on' && t.checked) sounds.prime();
    setPath(path, t.checked);
  } else if (t.type === 'range') setPath(path, Number(t.value) / 100);
});

// ---------- reacting to settings ----------

function onSettings(now: Settings, before: Settings): void {
  sounds.setOptions(now.sound);
  if (now.language !== before.language) applyLanguage();
  if (now.style !== before.style) { style = findStyle(styles, now.style); applyStyle(); }
  if (now.background !== before.background) applyBackground();
  configureNotices();
  if (now.replay.pace !== before.replay.pace) applyPace();
  // Redraw what is on screen.
  if (view === 'settings') renderSettings();
  else if (view === 'picker' && (now.language !== before.language || now.replay.showScores !== before.replay.showScores)) void showPicker();
  else if (view === 'chooser') renderChooser();
  else if (view === 'game' && (now.language !== before.language || now.style !== before.style || now.background !== before.background)) buildGame();
  else if (view === 'game') renderTabs(store.current);
}

function applyBackground(): void {
  const m = cfg().background;
  for (const el of [app, tabsEl]) {
    el.classList.remove('bg-solid', 'bg-semi', 'bg-clear');
    el.classList.add(`bg-${m}`);
  }
  if (field && shown) field.setLook(look(shown));
}

// ---------- game: state ----------

let mode: 'live' | 'replay' = 'live';
let following = 0;
let speed = 1;
const SPEEDS = [1, 2, 4, 8];
/** Dev aid (--seek=<entry> [--paused]): jump a replay to an entry once it has loaded. */
let pendingSeek: { index: number; pause: boolean } | null = null;

let tier: Tier = 'field';
let parts: TierParts = partsOf('field', 480);
let field: FieldRenderer | null = null;
/** The board as of the last step taken from the queue. */
let scene: Scene = new Map();
/** What the text shows. It lags the store while a step animates, so the score never jumps ahead. */
let shown: GameState | undefined;
/** Events since the last state: present for steps that happened, absent for jumps and corrections. */
let pendingEvents: GameEvent[] = [];
let barLine = '';
let pitchText = '';
let showPitch = false;
let bubble: { html: string; hr: boolean; seq: number } | null = null;
let bubbleSeq = 0;
const check = { steps: 0, bad: 0, notices: 0, sounds: 0 };

interface Step { state: GameState; events: readonly GameEvent[]; text: readonly GameEvent[] }
const queue = new AnimationQueue<Step>(runStep, {
  // Skipped steps still count for the text: keep their plays so the latest line is right.
  merge: (skipped, newer) => ({ ...newer, text: [...skipped.text, ...newer.text] }),
});

const paintsOf = (s: GameState) => piecePaints(s.teams.away.abbr, s.teams.home.abbr, fav());
const look = (s: GameState) => ({ style, background: cfg().background, paints: paintsOf(s) });

const PACES: Record<PaceSetting, PaceMode> = {
  compact: { kind: 'compact' }, real: { kind: 'real' }, fixed: { kind: 'fixed', seconds: 5 }, results: { kind: 'results' },
};

/** Run `fn` on a replay's player once its feed has loaded. */
function withPlayer(pk: number, fn: (p: NonNullable<ReturnType<typeof replay.player>>) => void): void {
  const started = Date.now();
  const t = setInterval(() => {
    const p = replay.player(pk);
    if (p) { clearInterval(t); fn(p); } else if (Date.now() - started > 30_000 || following !== pk) clearInterval(t);
  }, 100);
}

function applyPace(): void {
  if (mode === 'replay') replay.player(following)?.setPace(PACES[cfg().replay.pace]);
}

// ---------- game: the clock tab ----------

// When the shown state arrived, and when the next one is due in game time (replay only),
// so the clock can keep ticking between events instead of jumping every 20 s.
let deliveredAt = 0;
let nextEventAt: number | undefined;
/** Real time already run since the state arrived, frozen while a replay is paused. */
let frozenOffset: number | null = null;

/** The moment the clock should show, in game time. */
function clockNow(s: GameState): number | undefined {
  if (mode === 'live') return Date.now();
  if (s.at === undefined) return undefined;
  const t = s.at + (frozenOffset ?? performance.now() - deliveredAt) * speed;
  return nextEventAt === undefined ? t : Math.min(t, nextEventAt);
}

/** How long the game has been going: m:ss, then h:mm:ss. A finished game shows its official length. */
function elapsed(s: GameState): string {
  if (s.status === 'final' && s.durationMinutes) {
    return `${Math.floor(s.durationMinutes / 60)}:${String(s.durationMinutes % 60).padStart(2, '0')}`;
  }
  const now = s.startedAt === undefined ? undefined : clockNow(s);
  if (now === undefined || s.startedAt === undefined || now < s.startedAt) return '';
  const sec = Math.floor((now - s.startedAt) / 1000);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Tick once a second, touching only the clock's digits, and only when they change (a paused
// replay's clock stands still, and an unchanged write still costs a layout).
setInterval(() => {
  if (view !== 'game' || !cfg().tabs.clock || !store.current) return;
  const el = tabsEl.querySelector('.clock-value');
  const text = elapsed(store.current);
  if (el && el.textContent !== text) el.textContent = text;
}, 1000);

/** A window too narrow for everything: the dot tier, or a squeezed bar. */
const isNarrow = () => app.clientWidth > 0 && app.clientWidth < 300;

function renderTabs(s: GameState | undefined): void {
  const items: string[] = [];
  const game = view === 'game';
  const narrow = isNarrow();
  const tabs = cfg().tabs;
  if (game && s) {
    const time = elapsed(s);
    // Narrow: the clock alone, without its close button.
    if (tabs.clock && time) items.push(`<span class="tab" title="${esc(S.ui.clock)}">⏱ <span class="mono clock-value">${time}</span>${narrow ? '' : '<button data-close="clock" aria-label="×">×</button>'}</span>`);
    if (tabs.replay && mode === 'replay' && !narrow) {
      const date = dates.get(s.gamePk);
      items.push(`<span class="tab accent">${esc(S.ui.replay)}${date ? ` · ${shortDate(date)}` : ''}${speed > 1 ? ` · ${speed}×` : ''}<button data-close="replay" aria-label="×">×</button></span>`);
    }
  }
  tabsEl.innerHTML = game ? `${items.join('')}<span class="grow"></span>${controls()}` : '';
  document.body.classList.toggle('has-tabs', game);
}

function setTab(k: 'clock' | 'replay', on: boolean): void {
  settings.update((d) => { d.tabs[k] = on; });
}

function controls(): string {
  // A dot-sized window keeps only what it needs to get around.
  const narrow = isNarrow();
  const tabs = cfg().tabs;
  const p = mode === 'replay' ? replay.player(following) : undefined;
  const toggle = mode === 'replay'
    ? `<button data-action="toggle" title="${esc(p && !p.playing && !p.done ? S.ui.play : S.ui.pause)}">${p && !p.playing && !p.done ? '▶' : '❚❚'}</button>`
    : '';
  const replayMore = mode === 'replay' && !narrow
    ? `<button data-action="speed" title="${esc(S.ui.speed)}">${speed}×</button><button data-action="next" title="${esc(S.ui.nextResult)}">⏭</button>`
    : '';
  const tabButtons = narrow ? '' : `<button data-action="clock" aria-pressed="${tabs.clock}" title="${esc(S.ui.clock)}">⏱</button>`
    + (mode === 'replay' ? `<button data-action="replay-tab" aria-pressed="${tabs.replay}">${esc(S.ui.replay)}</button>` : '');
  const sizeButton = `<button data-action="size" title="${esc(S.ui.size)}">⤢ ${esc(S.tier[tier])}</button>`;
  const styleTip = [S.ui.style, ...styleProblems].join('\n');
  const styleButton = narrow ? '' : `<button data-action="style" title="${esc(styleTip)}">◇ ${esc(style.name[lang])}</button>`;
  const settingsButton = `<button data-action="settings" title="${esc(S.set.title)}">⚙</button>`;
  return `<span class="controls">${toggle}${replayMore}${tabButtons}${sizeButton}${styleButton}${settingsButton}<button data-action="back">‹${narrow ? '' : ` ${esc(S.ui.back)}`}</button></span>`;
}

// ---------- game: following ----------

/** Bumped whenever the game on screen goes away, so a step still animating for it stops there. */
let gameGen = 0;

function leaveGame(): void {
  gameGen++;
  store.stop();
  queue.clear();
  field?.dispose();
  field = null;
  void notifier?.clearAll();
  updateWatcher();
}

function follow(pk: number, how: 'live' | 'replay'): void {
  if (pickerTimer) clearTimeout(pickerTimer);
  leaveGame();
  following = pk;
  mode = how;
  barLine = pitchText = '';
  showPitch = false;
  bubble = null;
  speed = dev.speed ?? 1;
  scene = new Map();
  shown = undefined;
  pendingEvents = [];
  void fitWindow('game');
  buildGame();
  // Controls stay visible for a moment so a first-time user sees they exist.
  document.body.classList.add('reveal');
  setTimeout(() => document.body.classList.remove('reveal'), 4000);
  store.follow(how === 'live' ? live : replay, pk);
  if (how === 'replay') {
    withPlayer(pk, (p) => {
      p.setPace(PACES[cfg().replay.pace]);
      if (speed !== 1) p.setSpeed(speed);
    });
  }
  updateWatcher();
}

const formatLine = (l: { who?: string; text: string }) => `${l.who ? `<b>${esc(l.who)}</b> ` : ''}${esc(l.text)}`;
/** Plays where the carry is worth a number in the bubble. */
const FAR = new Set(['single', 'double', 'triple', 'home_run', 'field_out', 'sac_fly']);
const HITS = new Set(['single', 'double', 'triple']);

/** Update the text lines from what just happened. */
function applyLines(events: readonly GameEvent[]): void {
  for (const ev of events) {
    if (ev.type === 'pitch') { pitchText = pitchLine(ev.pitch, lang); showPitch = true; bubble = null; continue; }
    const line = eventLine(ev, lang);
    if (!line) continue;
    barLine = formatLine(line);
    showPitch = false;
    const d = ev.type === 'plateAppearance' && FAR.has(ev.result) ? ev.ball?.distance : undefined;
    bubble = {
      html: formatLine(d && d >= 150 ? { ...line, text: `${line.text} · ${S.feet(Math.round(d))}` } : line),
      hr: ev.type === 'plateAppearance' && ev.result === 'home_run',
      seq: ++bubbleSeq,
    };
  }
}

store.subscribe({
  onState: (s, entry) => {
    const p = pendingSeek && mode === 'replay' ? replay.player(following) : undefined;
    if (p && pendingSeek) {
      const { index, pause } = pendingSeek;
      pendingSeek = null;
      pendingEvents = [];
      if (pause) p.pause();
      p.seek(index);
      return;
    }
    deliveredAt = performance.now();
    const rp = mode === 'replay' ? replay.player(following) : undefined;
    nextEventAt = rp ? rp.timeline[rp.position + 1]?.t : undefined;
    frozenOffset = rp && !rp.playing ? 0 : null;

    const animate = pendingEvents.length > 0;
    const step: Step = { state: s, events: entry?.events ?? [], text: animate ? pendingEvents : entry?.events ?? [] };
    pendingEvents = [];
    // A replay jump: drop what is waiting and show the new state at once. Live states without
    // events (a correction, the next batter stepping in) queue behind the plays before them.
    if (!animate && mode === 'replay') { queue.clear(); field?.finish(); }
    queue.push(step, animate);
  },
  onEvent: (ev) => { pendingEvents.push(ev); },
  onError: () => { if (shown) renderText(); },
});

async function runStep(step: Step, animate: boolean, catchUp: number): Promise<void> {
  if (view !== 'game') return;
  const gen = gameGen;
  const before = shown;
  const plan = planStep(scene, step.state, step.events);
  scene = plan.end;
  applyLines(step.text);
  if (!shown) {
    shown = step.state;
    buildGame();
    updateWatcher(); // now it is known whose game is on screen
    return;
  }
  // Sound at contact; not while the queue is catching up, when steps fly by.
  if (animate && catchUp <= 2) playSound(step.events);
  if (field && animate) {
    // Causal order: the pitch shows first, the ball flies, runners run, then the score changes.
    // The previous play's bubble goes as soon as the next pitch is thrown.
    renderZone(step.state, true);
    if (step.events.some((e) => e.type === 'pitch')) app.querySelector('.bubble')?.classList.remove('show', 'hr');
    field.setLabel(batterLabel(step.state, plan), plan.end.get(`r${step.state.batter?.id}`)?.role === 'batter');
    await field.play(plan, (mode === 'replay' ? speed : 1) * catchUp);
    if (gen !== gameGen) return;
    shown = step.state;
    renderText({ zone: false });
  } else {
    field?.show(plan.end);
    shown = step.state;
    renderText();
  }
  // Notices go out with the score, after the play has been shown.
  if (animate) notifyStep(before, step);
  if (dev.selfcheck) selfCheck(plan);
}

function playSound(events: readonly GameEvent[]): void {
  const pa = events.find((e) => e.type === 'plateAppearance');
  if (pa?.type !== 'plateAppearance') return;
  const name = pa.result === 'home_run' ? 'homeRun' : HITS.has(pa.result) ? 'hit' : null;
  if (name && sounds.enabled(name)) { sounds.play(name); check.sounds++; }
}

function batterLabel(s: GameState, plan: Plan): string {
  const b = s.batter;
  if (!b || plan.end.get(`r${b.id}`)?.role !== 'batter') return '';
  return `${b.short} · ${S.bats(b.side)}`;
}

/** Dev check (--selfcheck): after every step the drawn board must equal the state's board. */
function selfCheck(plan: Plan): void {
  if (!field) return;
  const drawn = field.drawnScene();
  let ok = drawn.size === plan.end.size;
  for (const [k, p] of plan.end) {
    const d = drawn.get(k);
    if (!d || d.spot !== p.spot || d.side !== p.side || d.id !== p.id) ok = false;
  }
  check.steps++;
  if (!ok) { check.bad++; console.warn('board mismatch', [...drawn], [...plan.end]); }
}

// ---------- notifications ----------

function configureNotices(): void {
  notifier?.configure(cfg().notify.mode, cfg().notify.marquee, {
    theme: style.theme, labels: { close: S.notify.close, replay: S.notify.replay },
  });
  updateWatcher();
}

/** The game on screen involves the user's team (or there is no team, so the game on screen counts). */
const followingMine = () => view === 'game' && (!fav() || [shown?.teams.away.abbr, shown?.teams.home.abbr].includes(fav()));

function sendNotice(n: Notice | null): void {
  if (!n || !notifier || cfg().notify.mode === 'off') return;
  check.notices++;
  void notifier.push(n);
}

function notifyStep(before: GameState | undefined, step: Step): void {
  const n = cfg().notify;
  if (n.mode === 'off' || (n.onlyMine && !followingMine())) return;
  sendNotice(noticeFor(before, step.state, step.events, n.events, lang, mode === 'replay'));
}

// Other games: one schedule request a minute notices starts, runs and finals (ARCHITECTURE 4.2).
let watchTimer: ReturnType<typeof setInterval> | null = null;
let watchBase: Map<number, GameSnap> | null = null;
let watchDate = '';
let watchBusy = false;

function updateWatcher(): void {
  const n = cfg().notify;
  const watching = view === 'game' && mode === 'live';
  // Needed when other games can notify: all games, or the user's team while something else is on screen.
  const need = inTauri && n.mode !== 'off' && (n.events.run || n.events.game)
    && (!n.onlyMine || (fav() !== undefined && !(watching && followingMine())));
  if (need && !watchTimer) {
    watchBase = null;
    void pollSchedule();
    watchTimer = setInterval(() => void pollSchedule(), 60_000);
  } else if (!need && watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

function snapOf(g: ScheduleGame): GameSnap {
  const s = mapStatus(g.status);
  const phase = s === 'scheduled' || s === 'pregame' ? 'pre'
    : s === 'live' || s === 'delayed' || s === 'review' || s === 'suspended' ? 'live'
    : s === 'final' ? 'final' : 'other';
  return {
    gamePk: g.gamePk, phase,
    away: g.teams.away.team.abbreviation ?? '?', home: g.teams.home.team.abbreviation ?? '?',
    runs: { away: g.teams.away.score ?? 0, home: g.teams.home.score ?? 0 },
    ...(g.linescore?.currentInning ? { inning: g.linescore.currentInning, half: g.linescore.isTopInning ? 'top' : 'bottom' } : {}),
  } as GameSnap;
}

async function pollSchedule(): Promise<void> {
  if (watchBusy) return;
  watchBusy = true;
  try {
    const date = easternToday();
    if (date !== watchDate) { watchDate = date; watchBase = null; }
    const sched = (await fetchJson(schedulePath(date))) as { dates?: { games: ScheduleGame[] }[] };
    const snaps = (sched.dates ?? []).flatMap((d) => d.games).map(snapOf);
    const n = cfg().notify;
    for (const c of diffSchedule(watchBase, snaps)) {
      // The game on screen notifies from its own plays, with more detail.
      if (view === 'game' && mode === 'live' && c.snap.gamePk === following) continue;
      if (n.onlyMine && (!fav() || ![c.snap.away, c.snap.home].includes(fav()!))) continue;
      sendNotice(scheduleNotice(c, n.events, lang));
    }
    watchBase = new Map(snaps.map((s) => [s.gamePk, s]));
  } catch {
    // offline for a minute: try again at the next tick
  } finally {
    watchBusy = false;
  }
}

// ---------- game: drawing ----------

/** Redraws the board and the zone when their boxes change size (window resize, rows filling in below). */
let partObserver: ResizeObserver | null = null;

/** Build the game view for the current window size. */
function buildGame(): void {
  field?.dispose();
  field = null;
  partObserver?.disconnect();
  partObserver = null;
  if (view !== 'game') return;
  const r = app.getBoundingClientRect();
  if (r.height > 0) { tier = tierOf(r.height); parts = partsOf(tier, r.width); }
  app.dataset.tier = tier;
  const s = shown;
  if (!s) {
    app.innerHTML = `<div class="bar"><span class="muted">${esc(S.ui.loading)}</span></div>`;
    renderTabs(undefined);
    return;
  }
  if (tier === 'field' || tier === 'full') {
    app.innerHTML = `<div class="strip${parts.zone ? '' : ' nozone'}">
        <div class="hud"></div>
        <div class="fieldwrap"><svg class="field" aria-hidden="true"></svg><div class="bubble"></div></div>
        ${parts.zone ? '<div class="zonewrap"><svg class="zone" aria-hidden="true"></svg><div class="cap pcap"></div></div>' : ''}
      </div>
      ${tier === 'full' ? '<div class="below"><div class="mu"></div><table class="ls"></table></div>' : ''}`;
    field = new FieldRenderer(app.querySelector<SVGSVGElement>('svg.field')!, look(s));
    field.show(scene);
  }
  renderText();
  if (field && 'ResizeObserver' in window) {
    partObserver = new ResizeObserver(() => {
      field?.resize();
      if (shown) renderZone(shown, false);
    });
    partObserver.observe(app.querySelector('.fieldwrap')!);
    const zone = app.querySelector('svg.zone');
    if (zone) partObserver.observe(zone);
  }
}

function renderZone(s: GameState, pop: boolean): void {
  const svg = app.querySelector<SVGSVGElement>('svg.zone');
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  svg.innerHTML = zoneSvg(s.atBat, {
    w: r.width, h: r.height, iso: style.renderer === 'iso', theme: style.theme,
    batterSide: s.batter?.side, popLast: pop, noData: S.ui.noPitchData,
  });
  const cap = app.querySelector('.pcap');
  if (cap) cap.innerHTML = pitchCaption(s, lang, style.theme);
}

function renderText(opts: { zone?: boolean } = {}): void {
  const s = shown;
  if (!s || view !== 'game') return;
  const paints = paintsOf(s);
  const statusText = s.status === 'live' ? '' : S.status(s.status, s.statusDetail);
  const conn = mode === 'live' ? live.status(following) : undefined;
  const offline = conn && !conn.connected ? S.ui.reconnecting : '';
  if (tier === 'dot') {
    app.innerHTML = dotView(s, paints, parts);
  } else if (tier === 'bar') {
    app.innerHTML = barView(s, paints, lang, parts, showPitch ? `<span class="muted">${esc(pitchText)}</span>` : barLine, statusText, offline);
  } else {
    app.querySelector('.hud')!.innerHTML = hudView(s, paints, lang) + (offline ? `<i class="conn" title="${esc(offline)}"></i>` : '');
    // Rows below first: they decide how much height the board and the zone get.
    if (tier === 'full') {
      app.querySelector('.mu')!.innerHTML = matchupView(s, lang);
      app.querySelector('.ls')!.innerHTML = linescoreView(s, paints);
    }
    if (opts.zone !== false) renderZone(s, false);
    renderBubble(statusText);
    if (field) {
      const b = s.batter;
      const atBat = b && scene.get(`r${b.id}`)?.role === 'batter';
      field.setLabel(atBat ? `${b.short} · ${S.bats(b.side)}` : '', !!atBat);
    }
  }
  renderTabs(s);
  const checkText = dev.selfcheck
    ? ` · check ${check.steps}/${check.bad} · ${frameStats()} · styles ${styles.length} style problems ${styleProblems.length} · notices ${check.notices} sounds ${check.sounds} audio ${sounds.state}`
    : '';
  setTitle(`Basesmall · ${s.gamePk} · ${mode} · ${s.status} · ${s.teams.away.abbr} ${s.score.away}-${s.score.home} ${s.teams.home.abbr} · ${S.inning(s.inning, s.half)} · ${s.balls}-${s.strikes} ${s.outs}out · ${elapsed(s)} · ${tier} · ${style.id}${checkText}`);
}

function renderBubble(statusText: string): void {
  const el = app.querySelector<HTMLElement>('.bubble');
  if (!el) return;
  const b = statusText ? { html: esc(statusText), hr: false, seq: -1 } : bubble;
  const fresh = el.dataset.seq !== String(b?.seq ?? '');
  el.dataset.seq = String(b?.seq ?? '');
  el.className = `bubble${b ? ' show' : ''}${b?.hr ? ' hr' : ''}`;
  el.innerHTML = b?.html ?? '';
  if (fresh && b) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
}

/** Frame gaps while animating: 95th percentile, worst, and how many were over 50 ms. */
function frameStats(): string {
  const g = [...frameGaps].sort((a, b) => a - b);
  if (!g.length) return 'frames 0';
  const p95 = g[Math.floor(g.length * 0.95)]!;
  return `frames ${g.length} p95 ${p95.toFixed(1)} max ${g.at(-1)!.toFixed(1)} >50ms ${g.filter((x) => x > 50).length} skipped ${queue.skipped}`;
}

if ('ResizeObserver' in window) {
  new ResizeObserver(() => {
    if (view !== 'game' || !shown) return;
    const r = app.getBoundingClientRect();
    const t = tierOf(r.height), p = partsOf(t, r.width);
    if (t !== tier || p.outs !== parts.outs || p.lastLine !== parts.lastLine || p.zone !== parts.zone) buildGame();
    else renderTabs(store.current); // the controls depend on the width
  }).observe(app);
}

function replayAction(action: string): void {
  if (action === 'clock') { setTab('clock', !cfg().tabs.clock); return; }
  if (action === 'replay-tab') { setTab('replay', !cfg().tabs.replay); return; }
  if (action === 'size') { void cycleTier(); return; }
  if (action === 'settings') { showSettings(); return; }
  if (action === 'settings-done') { closeSettings(); return; }
  if (action === 'style') {
    settings.update((d) => { d.style = nextStyle(styles, style.id).id; });
    return;
  }
  const p = replay.player(following);
  if (!p) return;
  if (action === 'toggle') {
    if (p.playing) { frozenOffset = performance.now() - deliveredAt; p.pause(); }
    else { deliveredAt = performance.now() - (frozenOffset ?? 0); frozenOffset = null; p.play(); }
  }
  else if (action === 'speed') { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!; p.setSpeed(speed); }
  else if (action === 'next') {
    const i = p.timeline.findIndex((e, n) => n > p.position && e.events.some((ev) => ev.type === 'plateAppearance' || ev.type === 'gameEnd'));
    if (i >= 0) p.seek(i); // a snap: state only, its play shows as text
  }
  renderTabs(store.current);
}

// ---------- input ----------

function onClick(e: MouseEvent): void {
  // Any click is a user gesture: the moment an audio context may start (or wake, if suspended).
  if (!cfg().sound.muted && sounds.state !== 'running') sounds.prime();
  const t = (e.target as HTMLElement).closest('button');
  if (!t) return;
  const { day, tab, pk, action, pick, value, preview } = t.dataset;
  const close = t.dataset.close;
  if (close === 'clock' || close === 'replay') setTab(close, false);
  else if (t.dataset.fav) {
    const team = t.dataset.fav;
    settings.update((d) => { d.favorite = team; });
    pickerTab = null;
    void showPicker();
  }
  else if (pick) setPath(pick, value);
  else if (preview === 'hit' || preview === 'homeRun') sounds.play(preview, true);
  else if (t.dataset.open) void openUrl(t.dataset.open).catch(() => { /* not in the allow list */ });
  else if (day) { pickerDate = shiftDate(pickerDate, Number(day)); pickerTab = null; void showPicker(); }
  else if (tab) { pickerTab = tab as Tab; void showPicker(); }
  else if (pk) follow(Number(pk), t.dataset.mode === 'replay' ? 'replay' : 'live');
  else if (action === 'back') void showPicker();
  else if (action === 'choose') showChooser();
  else if (action) replayAction(action);
}
app.addEventListener('click', onClick);
tabsEl.addEventListener('click', onClick);

if (win) {
  for (const el of [app, tabsEl]) {
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, label, .body')) return;
      void win.startDragging();
    });
  }
  document.getElementById('grip')!.addEventListener('mousedown', (e) => {
    e.preventDefault();
    void win.startResizeDragging('SouthEast');
  });
  void listen<string>('bg-mode', (e) => {
    const m = e.payload;
    if (m === 'solid' || m === 'semi' || m === 'clear') settings.update((d) => { d.background = m; });
  });
  void listen('open-settings', () => showSettings());
}

// Open a game directly: `basesmall --game=<pk> [--mode=replay]` in the app, ?game=<pk>&mode=replay in a browser.
// Checking aids: --tier=dot|bar|field|full --style=<id> --bg=solid|semi|clear --speed=<n> --seek=<entry>
// [--paused] --selfcheck --press=<action>,<action> (control buttons, 2 s apart, once loaded) --settings
// --set=<path>:<value>,... (e.g. sound.on:true,notify.mode:both).
// A checking run saves no settings, unless BASESMALL_CONFIG_DIR points it at a scratch folder.
async function start(): Promise<void> {
  const q = new URLSearchParams(location.search);
  let overridden = false;
  if (inTauri) {
    for (const a of await invoke<string[]>('launch_args').catch(() => [] as string[])) {
      const m = /^--(game|mode|team|seek|tier|style|bg|speed|press|set)=(.+)$/.exec(a);
      if (m) q.set(m[1]!, m[2]!);
      for (const flag of ['paused', 'selfcheck', 'settings']) if (a === `--${flag}`) q.set(flag, '1');
    }
    [configFolder, overridden] = await invoke<[string, boolean]>('config_info').catch(() => ['', false] as [string, boolean]);
    appVersion = await getVersion().catch(() => '');
  }
  const checking = ['tier', 'style', 'bg', 'speed', 'seek', 'selfcheck', 'press', 'settings', 'set'].some((k) => q.has(k));
  settings = await SettingsStore.open(backend, () => fromLocalStorage(legacy));
  settings.persist = !checking || overridden;
  settings.subscribe(onSettings);
  // --set=sound.on:true,notify.mode:both — change settings as the settings screen would.
  for (const pair of (q.get('set') ?? '').split(',').filter(Boolean)) {
    const [path, raw = ''] = pair.split(':');
    if (path) setPath(path, raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw);
  }
  await loadUserStyles();
  applyLanguage();
  sounds.setOptions(cfg().sound);
  // Launch overrides apply in memory only.
  if (q.has('team') || q.has('style') || q.has('bg')) {
    const persist = settings.persist;
    settings.persist = persist && !q.has('style') && !q.has('bg');
    settings.update((d) => {
      if (q.has('team')) d.favorite = q.get('team');
      if (q.has('style')) d.style = findStyle(styles, q.get('style')).id;
      if (q.has('bg')) d.background = q.get('bg') as Settings['background'];
    });
    settings.persist = persist;
  }
  style = findStyle(styles, cfg().style);
  applyStyle();
  applyBackground();
  configureNotices();
  if (q.has('seek')) pendingSeek = { index: Number(q.get('seek')), pause: q.has('paused') };
  const t = q.get('tier');
  if (t === 'dot' || t === 'bar' || t === 'field' || t === 'full') dev.tier = t;
  if (q.has('speed')) dev.speed = Math.max(0.25, Number(q.get('speed')) || 1);
  if (q.has('selfcheck')) dev.selfcheck = true;
  // Each press is a control button ("size") or a setting change ("language:en"), 2 s apart.
  const presses = (q.get('press') ?? '').split(',').filter(Boolean);
  presses.forEach((action, i) => setTimeout(() => {
    const [path, raw] = action.split(':');
    if (raw === undefined) replayAction(action);
    else setPath(path!, raw === 'true' ? true : raw === 'false' ? false : raw);
  }, 6000 + i * 2000));
  if (q.has('game')) follow(Number(q.get('game')), q.get('mode') === 'replay' ? 'replay' : 'live');
  else if (cfg().favorite === null) showChooser();
  else void showPicker();
  if (q.has('settings')) setTimeout(showSettings, 1500);
}
void start();
