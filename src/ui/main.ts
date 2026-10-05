// The main window: choose a team, follow it (or pick a game), change settings. The game view has
// four size tiers (dot, bar, field, full); the window's size picks one. Field and full draw the
// board. M5 adds the home card for the user's team, the scoreboard drawer, low-key mode, hotkeys,
// the optional windows and catching up on a game joined late.
// Runs in a plain browser too (without window controls), which is how the UI is checked headless.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { MlbLiveSource } from '../data/mlb/live-source.ts';
import type { MlbFeed } from '../data/mlb/feed-types.ts';
import { mapStatus } from '../data/mlb/codes.ts';
import { cardOf, isLive, type GameCard, type MlbScheduleGame } from '../data/mlb/schedule.ts';
import { ScheduleService, SCHEDULE_HYDRATE } from '../data/mlb/schedule-service.ts';
import { MlbReplaySource } from '../data/replay/mlb-replay-source.ts';
import type { PaceMode } from '../data/replay/pacing.ts';
import { GameStore } from '../model/store.ts';
import type { GameEvent, GameState, Totals } from '../model/types.ts';
import { detectLang, eventLine, pitchLine, STRINGS, type Lang } from '../i18n/index.ts';
import { piecePaints, teamPaint } from '../styles/team-colors.ts';
import { findStyle, loadStyles, nextStyle } from '../styles/loader.ts';
import type { StyleManifest } from '../styles/manifest.ts';
import {
  EXTRA_SOUNDS, fromLocalStorage, NOTIFY_KINDS, PANELS, type AfterOut, type PaceSetting, type PanelName, type Settings, type Size,
} from '../settings/schema.ts';
import { SettingsStore, type SettingsBackend } from '../settings/store.ts';
import { Sounds, type SoundName } from '../audio/sounds.ts';
import { soundsFor } from '../audio/cues.ts';
import { Notifier } from '../notify/notifier.ts';
import { diffSchedule, noticeFor, scheduleNotice, type GameSnap, type Notice } from '../notify/rules.ts';
import { decide, seasonKey, type Decision } from '../follow/decide.ts';
import { isBigMoment, mostTense, tension } from '../follow/tension.ts';
import { Panels } from '../panels/manager.ts';
import { packPlan, PANEL_SIZE } from '../panels/frame.ts';
import { FieldRenderer, type Look } from '../render/field-svg.ts';
import { AnimationQueue } from '../render/queue.ts';
import { planStep, sceneOf, type Plan, type Scene } from '../render/scene.ts';
import { nextTier, partsOf, tierOf, TIER_MIN_WIDTH, TIER_PRESET, type Tier, type TierParts } from '../render/tiers.ts';
import { frameGaps } from '../render/tween.ts';
import { zoneSvg } from '../render/zone.ts';
import { barView, cardTotals, dot, dotView, esc, hudView, linescoreView, lowKeyView, matchupView, pitchCaption, playerCardView } from './views.ts';
import { seasonStatsPath, seasonTotals } from '../data/mlb/season-stats.ts';
import { adoptView, homeView } from './home.ts';
import { boardRows } from './scoreboard.ts';
import { findNewer, installNewer, type Newer } from './updates.ts';
import { keyLabel } from './keys.ts';
import teamTable from '../../styles/team-colors/mlb.json' with { type: 'json' };

const inTauri = '__TAURI_INTERNALS__' in window;
const win = inTauri ? getCurrentWindow() : null;
const app = document.getElementById('app')!;
const tabsEl = document.getElementById('tabs')!;
const boardEl = document.getElementById('board')!;

/** Launch overrides for checking the app (--tier, --style, --bg, ...). They are never saved. */
const dev: { tier?: Tier; selfcheck?: boolean; speed?: number } = {};
const TEAM_TABLE = (teamTable as unknown as { teams: Record<string, { id: number }> }).teams;
const TEAMS = Object.keys(TEAM_TABLE).sort();
const teamId = (abbr: string) => TEAM_TABLE[abbr]?.id;

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
/** The team the home card follows: the one adopted for the postseason, else the user's own. */
const homeTeam = () => (cfg().follow.after === 'adopt' && cfg().follow.adopted) || fav();

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

type View = 'chooser' | 'picker' | 'game' | 'settings' | 'home';
const DEFAULT_SIZE: Record<View, Size> = {
  chooser: { w: 480, h: 300 }, picker: { w: 480, h: 300 }, game: TIER_PRESET.field, settings: { w: 400, h: 460 }, home: { w: 480, h: 116 },
};
/** Low-key mode's strip: small, plain. */
const LOW_KEY_SIZE: Size = { w: 150, h: 26 };
/** Below this the lists cannot show a single row, so they never open smaller. */
const LIST_MIN_HEIGHT = 200;
/** Height of the strip above the game: tabs on the left (clock, replay), controls on the
 *  right on hover. Always there in the game view, so nothing ever covers the game. Saved sizes exclude it. */
const TAB_H = 20;
/** The scoreboard drawer under the window, when open. Saved sizes exclude it too. */
const BOARD_H = 150;
let view: View = 'picker';
let programmaticResize = 0;

const lowKeyOn = () => cfg().lowKey && view === 'game';
const boardOpen = () => cfg().scoreboard && (view === 'game' || view === 'home') && !lowKeyOn();
const sizeKey = (v: View) => (v === 'game' && cfg().lowKey ? 'size-lowkey' : `size-${v}`);
/** Window height that is not the view's own: the tab strip and the scoreboard drawer. */
const extraH = (v: View) => (v === 'game' ? TAB_H : 0) + (cfg().scoreboard && (v === 'game' || v === 'home') && !(v === 'game' && cfg().lowKey) ? BOARD_H : 0);

const savedSize = (key: string, fallback: Size): Size => cfg().sizes[key] ?? fallback;
const saveSize = (key: string, s: Size) => settings.update((d) => { d.sizes[key] = s; });

async function fitWindow(v: View): Promise<void> {
  view = v;
  document.body.classList.toggle('has-board', boardOpen());
  if (!win) return;
  let size = savedSize(sizeKey(v), v === 'game' && cfg().lowKey ? LOW_KEY_SIZE : DEFAULT_SIZE[v]);
  if (v === 'game' && dev.tier && !cfg().lowKey) size = TIER_PRESET[dev.tier];
  if (v !== 'game' && v !== 'home') size = { w: Math.max(size.w, 320), h: Math.max(size.h, LIST_MIN_HEIGHT) };
  await resizeTo(size.w, size.h + extraH(v));
  // The window starts hidden so it never flashes at the wrong size.
  if (!hiddenByKey) await win.show();
}

/**
 * Resize, keeping the top-left corner where it is. macOS resized the still-hidden window at start
 * about its bottom-left corner, so every launch moved it down by the difference from the configured
 * height (measured: 44 pt per launch, 160 to 116).
 */
async function resizeTo(w: number, h: number): Promise<void> {
  if (!win) return;
  const at = await win.outerPosition();
  programmaticResize = Date.now();
  await win.setSize(new LogicalSize(w, h));
  const now = await win.outerPosition();
  if (now.x !== at.x || now.y !== at.y) await win.setPosition(at);
}

/** The game view's size, wherever the window is now: the optional windows line up beside it. */
const gameSize = (): Size => (cfg().lowKey ? savedSize('size-lowkey', LOW_KEY_SIZE) : savedSize('size-game', DEFAULT_SIZE.game));

if (win) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  void win.onResized(() => {
    if (Date.now() - programmaticResize < 800) return; // our own resize, not the user's
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const size = (await win.innerSize()).toLogical(await win.scaleFactor());
      const h = Math.round(size.height - extraH(view)), w = Math.round(size.width);
      saveSize(sizeKey(view), { w, h });
      // Each tier remembers its own size, for the size button.
      if (view === 'game' && !cfg().lowKey) saveSize(`size-tier-${tierOf(h)}`, { w, h });
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
  await resizeTo(w, h + extraH('game'));
  saveSize('size-game', { w, h });
}

// ---------- data ----------

async function fetchJson(path: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    // MLB answers with max-age=10, stale-while-revalidate=30, and with the default cache mode the web
    // view may answer a poll from its own copy. 'no-cache' asks the CDN every time; the CDN still
    // serves its cached copy, so MLB's servers see no more traffic. Measured side by side on a live
    // game (2026-10-04): median 17 s behind the feed before, 13 s after.
    const res = await fetch(`https://statsapi.mlb.com${path}`, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** MLB's schedule day is the US Eastern date. */
const easternToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const live = new MlbLiveSource(fetchJson);
const replay = new MlbReplaySource(async (pk) => (await fetchJson(`/api/v1.1/game/${pk}/feed/live`)) as MlbFeed);
const store = new GameStore();
const schedule = new ScheduleService(fetchJson, easternToday);
/** Every game card seen (schedule, team windows, the game list), for series and situations by game. */
const cardsByPk = new Map<number, GameCard>();
const remember = (cards: readonly GameCard[]) => { for (const c of cards) cardsByPk.set(c.gamePk, c); };
document.addEventListener('visibilitychange', () => live.setBackground(document.hidden));
const setTitle = (t: string) => { document.title = t; void win?.setTitle(t); };
/** Accelerator text ("CmdOrCtrl+Alt+Shift+B") reads as nothing on a Mac; settings add ⌥⇧⌘B there. */
const isMac = /Mac/.test(navigator.userAgent);
const sounds = new Sounds();
const notifier = inTauri ? new Notifier() : null;
const panels = inTauri ? new Panels((name) => savedSize(`size-panel-${name}`, PANEL_SIZE[name]), () => gameSize().w) : null;

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

const shiftDate = (d: string, days: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const schedulePath = (date: string) => `/api/v1/schedule?sportId=1&date=${date}&hydrate=${SCHEDULE_HYDRATE}`;

type Tab = 'live' | 'later' | 'final';
let pickerDate = easternToday();
let pickerTab: Tab | null = null;
let pickerTimer: ReturnType<typeof setTimeout> | null = null;
let pickerFitted = false;
const dates = new Map<number, string>(); // gamePk -> officialDate, for the replay tab

function tabOf(g: MlbScheduleGame): Tab {
  const s = mapStatus(g.status);
  if (s === 'live' || s === 'delayed' || s === 'review' || s === 'suspended') return 'live';
  if (s === 'scheduled' || s === 'pregame') return 'later';
  return 'final';
}

function pickerHeader(): string {
  return `<header><b>${esc(S.ui.pickGame)}</b>
      ${homeTeam() ? `<button class="fav" data-action="home" title="${esc(S.follow.home)}">⌂ ${esc(homeTeam()!)}</button>` : ''}
      <button class="fav" data-action="choose" title="${esc(S.ui.favorite)}">★ ${esc(fav() ?? S.ui.noFavorite)}</button>
      <span class="grow"></span>
      <button data-day="-1" title="${esc(S.ui.prevDay)}">‹</button><span class="date">${pickerDate}</span>
      <button data-day="1" title="${esc(S.ui.nextDay)}">›</button>
      <button data-action="settings" title="${esc(S.set.title)}">⚙</button>${quitButton()}</header>`;
}

async function showPicker(): Promise<void> {
  leaveGame();
  const from = view;
  view = 'picker';
  renderTabs(undefined);
  if (pickerTimer) clearTimeout(pickerTimer);
  if (from !== 'picker' || !pickerFitted) { pickerFitted = true; void fitWindow('picker'); }
  app.innerHTML = `<section class="picker">${pickerHeader()}<div class="empty">${esc(S.ui.loading)}</div></section>`;
  let games: MlbScheduleGame[];
  try {
    const sched = (await fetchJson(schedulePath(pickerDate))) as { dates?: { games: MlbScheduleGame[] }[] };
    games = (sched.dates ?? []).flatMap((d) => d.games);
  } catch {
    if (view === 'picker') app.querySelector('.empty')!.textContent = S.ui.loadFailed;
    pickerTimer = setTimeout(() => void showPicker(), 30_000);
    return;
  }
  if (view !== 'picker') return; // the user moved on while we were loading
  remember(games.map(cardOf));
  setTitle(`Basesmall · picker · ${pickerDate} · ${games.length} games`);
  const mine = (g: MlbScheduleGame) => [g.teams.away.team.abbreviation, g.teams.home.team.abbreviation].includes(fav());
  const byTab: Record<Tab, MlbScheduleGame[]> = { live: [], later: [], final: [] };
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
    const card = cardsByPk.get(g.gamePk);
    const when = pickerTab === 'later'
      ? new Date(g.gameDate).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
      : pickerTab === 'live' && g.linescore?.currentInning
        ? `${g.linescore.isTopInning ? '▲' : '▼'}${g.linescore.currentInning}`
        : status === 'final' ? `${S.ui.replay} ▶` : S.status(status, g.status.detailedState);
    // Scores stay hidden unless the user asked for them: picking a finished game must not spoil it.
    const score = showScores && pickerTab !== 'later' && g.teams.away.score !== undefined
      ? `<span class="score">${g.teams.away.score}:${g.teams.home.score ?? 0}</span>` : '';
    // Postseason games say which series and game; once final, the series standing would spoil, so only the game.
    const series = card?.series ? `<span class="ser">${esc(S.series(card.series, card.gameType, { away, home }).split(' · ')[0]!)}</span>` : '';
    return `<button class="row${mine(g) ? ' mine' : ''}" data-pk="${g.gamePk}" data-mode="${pickerTab === 'final' ? 'replay' : 'live'}" ${pickerTab === 'final' && status !== 'final' ? 'disabled' : ''}>
      <span class="teams">${mine(g) ? '<span class="star">★</span>' : ''}${dot(c.away)}${esc(away)} @ ${esc(home)}${dot(c.home)}</span>
      ${series}${score}<span class="when">${esc(when)}</span></button>`;
  }).join('');
  app.querySelector('.picker')!.innerHTML = `${pickerHeader()}
    <div class="tabs">${tabs}</div>
    <div class="list">${rows || `<div class="empty">${esc(S.ui.noGames)}</div>`}</div>
    ${pickerTab === 'final' && !showScores ? `<div class="empty small">${esc(S.ui.scoresHidden)}</div>` : ''}`;
  pickerTimer = setTimeout(() => void showPicker(), 60_000);
}

// ---------- home: the user's team ----------

type FollowMode = 'manual' | 'team' | 'tension';
let homeDecision: Decision | null = null;
let homeTimer: ReturnType<typeof setInterval> | null = null;
let homeIdle = false;
let openingIn: number | undefined;

function stopHome(): void {
  if (homeTimer) clearInterval(homeTimer);
  homeTimer = null;
  schedule.want('home', false);
}

/**
 * What the user's team is up to: follow it if it is playing, else the home card (countdown, next
 * game, or the season-over choices). Only called when nothing is being followed, or when the game on
 * screen has ended: it never switches games mid-game (ARCHITECTURE 4.2.1). `fresh` reads the team's
 * schedule past its five-minute cache, for the minutes around a first pitch.
 */
async function goHome(fresh = false): Promise<void> {
  const team = homeTeam();
  if (!team) { await tensionHome(); return; }
  if (view !== 'home') {
    leaveGame();
    view = 'home';
    renderTabs(undefined);
    void fitWindow('home');
    app.innerHTML = `<section class="home"><div class="hrow muted">${esc(S.ui.loading)}</div></section>`;
  }
  homeIdle = false;
  let d: Decision;
  try {
    const id = teamId(team);
    if (id === undefined) { void showPicker(); return; }
    const cards = await schedule.team(id, fresh);
    remember(cards);
    d = decide(id, cards, easternToday());
  } catch {
    app.innerHTML = `<section class="home"><div class="hrow muted">${esc(S.ui.loadFailed)}</div></section>`;
    armHome(30_000);
    return;
  }
  if (view !== 'home') return;
  homeDecision = d;
  if (d.kind === 'live') { follow(d.game.gamePk, 'live', 'team'); return; }
  if (d.kind === 'over' && d.how !== 'advanced') {
    // The adopted team is out: let go of it and look again from the user's own team.
    if (team === cfg().follow.adopted) { settings.update((s) => { s.follow.adopted = null; }); await goHome(); return; }
    const key = seasonKey(team, d.last);
    if (cfg().follow.seen !== key) { renderHome(true); return; }
    await applyAfter(cfg().follow.after);
    return;
  }
  if (d.kind === 'none') openingIn = await daysToOpening();
  renderHome(false);
  // Count down every minute; ask again every five (and every minute once the start time is near).
  armHome(60_000);
}

function armHome(ms: number): void {
  if (homeTimer) clearInterval(homeTimer);
  let ticks = 0;
  homeTimer = setInterval(() => {
    if (view !== 'home') { stopHome(); return; }
    ticks++;
    const d = homeDecision;
    // From ten minutes before the first pitch to an hour after it (late starts, rain), every minute
    // and past the team cache. With the cache the switch to the live game came 4 minutes after the
    // first pitch, after the start notice (measured 2026-10-04, NYY@TB).
    const toStart = d?.kind === 'today' ? d.game.start - Date.now() : Infinity;
    const near = toStart < 10 * 60_000 && toStart > -60 * 60_000;
    if (homeIdle) return; // the schedule subscription handles the idle (most tense) case
    if (near) void goHome(true); else if (ticks % 5 === 0) void goHome(); else renderHome(false);
  }, ms);
}

async function daysToOpening(): Promise<number | undefined> {
  const year = Number(easternToday().slice(0, 4));
  // This year's opening day, unless it has passed: then next year's.
  for (const y of [year, year + 1]) {
    try {
      const start = await schedule.seasonStart(y);
      if (!start) continue;
      const days = Math.ceil((Date.parse(`${start}T12:00:00Z`) - Date.now()) / 86_400_000);
      if (days > 0) return days;
    } catch { /* offline: no countdown */ }
  }
  return undefined;
}

function renderHome(askAfter: boolean): void {
  if (view !== 'home' || !homeDecision) return;
  const team = homeTeam() ?? '';
  app.innerHTML = homeView(homeDecision, { lang, team, now: Date.now(), askAfter, idle: homeIdle, corner: quitButton(), ...(openingIn !== undefined ? { openingIn } : {}) });
  setTitle(`Basesmall · home · ${team} · ${homeIdle ? 'idle' : homeDecision.kind}${homeDecision.kind === 'over' ? ` ${homeDecision.how}` : ''}${askAfter ? ' · ask' : ''}`);
}

/** The user chose (or had chosen) what to do now that the team is out. */
async function applyAfter(k: AfterOut): Promise<void> {
  switch (k) {
    case 'tension': await tensionHome(); return;
    case 'adopt': {
      // Later rounds are on the schedule with placeholder sides ("AL High"): only real clubs count.
      const teams = (await schedule.postseasonTeams().catch(() => [] as string[])).filter((t) => TEAM_TABLE[t]);
      if (view !== 'home') return;
      if (teams.length) { app.innerHTML = adoptView(teams, lang); setTitle(`Basesmall · home · adopt · ${teams.length} teams`); return; }
      renderHome(false); // the postseason is over: nobody left to adopt
      return;
    }
    case 'manual':
      settings.update((d) => { d.scoreboard = true; });
      renderHome(false);
      return;
    case 'rest':
      openingIn = await daysToOpening();
      homeDecision = { kind: 'none' };
      renderHome(false);
      return;
  }
}

/** League mode, or "follow the most tense game": take the tensest live game, or wait for one. */
async function tensionHome(): Promise<void> {
  await schedule.refresh();
  remember(schedule.cards);
  const best = mostTense(schedule.cards);
  if (best) { follow(best.gamePk, 'live', 'tension'); return; }
  if (view !== 'home') {
    leaveGame();
    view = 'home';
    renderTabs(undefined);
    void fitWindow('home');
  }
  homeIdle = true;
  homeDecision = { kind: 'none' };
  renderHome(false);
  // When a game goes live, the schedule subscription follows it.
  schedule.want('home', true);
}

// ---------- settings screen ----------

/** Where "Done" goes back to. */
let settingsReturn: View = 'picker';
let appVersion = '';
let hotkeyError = false;
/**
 * A newer release. Asked once at start-up (setting updateCheck), or when the user presses "Check for
 * updates" in settings. Found: a dot on every settings button, and an Update button in About.
 */
let newer: Newer | null = null;
/** Where the check is: not asked yet, asking, asked and nothing newer. */
let updateAsk: 'idle' | 'asking' | 'none' = 'idle';
/** Progress of an update being installed, or why it failed. */
let updateNote = '';
let askedForNewer = false;

function askNewer(): void {
  if (!inTauri || !appVersion || updateAsk === 'asking') return;
  askedForNewer = true;
  updateAsk = 'asking';
  void findNewer(appVersion).then((r) => {
    newer = r;
    updateAsk = r ? 'idle' : 'none';
    document.body.classList.toggle('has-update', !!r);
    if (view === 'settings') renderSettings();
  });
}

function startUpdate(): void {
  if (!newer?.update || updateNote) return;
  updateNote = S.set.downloading(null);
  renderSettings();
  void installNewer(newer, (pct) => { updateNote = S.set.downloading(pct); if (view === 'settings') renderSettings(); })
    .catch(() => { updateNote = S.set.updateFailed; if (view === 'settings') renderSettings(); setTimeout(() => { updateNote = ''; }, 10_000); });
}

function showSettings(): void {
  if (view === 'settings') return;
  settingsReturn = view;
  if (pickerTimer) clearTimeout(pickerTimer);
  stopHome();
  view = 'settings';
  renderTabs(undefined);
  void fitWindow('settings');
  renderSettings();
  if (!askedForNewer && cfg().updateCheck) askNewer();
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
  else if (settingsReturn === 'home') { view = 'picker'; void goHome(); }
  else void showPicker();
}

function renderSettings(): void {
  const c = cfg();
  const T = S.set;
  const seg = (path: string, current: string, options: [string, string][]) =>
    `<div class="seg">${options.map(([v, label]) => `<button data-pick="${path}" data-value="${esc(v)}" aria-pressed="${v === current}">${esc(label)}</button>`).join('')}</div>`;
  const check = (path: string, on: boolean, label: string) =>
    `<label class="check"><input type="checkbox" data-set="${path}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  const preview = (name: SoundName) => `<button class="link" data-preview="${name}">▶</button>`;
  const marquee = c.notify.mode === 'marquee' || c.notify.mode === 'both';
  const soundNote = !c.sound.muted && sounds.state === 'suspended' ? `<p class="note">${esc(T.soundBlocked)}</p>` : '';
  const scrollTop = app.querySelector('.settings .body')?.scrollTop ?? 0;
  app.innerHTML = `<section class="settings">
      <header><b>${esc(T.title)}</b><span class="grow"></span><button class="done" data-action="settings-done">${esc(T.done)}</button></header>
      <div class="body">
        <div class="srow"><span class="k">${esc(T.team)}</span><span class="v mono">★ ${esc(fav() ?? S.ui.noFavorite)}</span><button class="link" data-action="choose">${esc(T.change)}</button></div>
        <div class="srow"><span class="k">${esc(T.after)}</span>${seg('follow.after', c.follow.after, (['manual', 'tension', 'adopt', 'rest'] as const).map((k) => [k, S.follow.after[k]]))}</div>
        <div class="srow"><span class="k">${esc(S.ui.style)}</span>${seg('style', style.id, styles.map((s) => [s.id, s.name[lang]]))}</div>
        <div class="srow"><span class="k">${esc(T.background)}</span>${seg('background', c.background, (['solid', 'semi', 'clear'] as const).map((b) => [b, T.bg[b]]))}</div>
        <div class="srow"><span class="k">${esc(T.language)}</span>${seg('language', c.language, [['auto', T.auto], ['zh-Hant', '繁體中文'], ['en', 'English']])}</div>
        <div class="block"><span class="k">${esc(T.tabs)}</span><div class="chips">${check('tabs.clock', c.tabs.clock, S.ui.clock)}${check('tabs.replay', c.tabs.replay, S.ui.replay)}${check('tabs.series', c.tabs.series, T.seriesTab)}${check('tabs.elsewhere', c.tabs.elsewhere, T.elsewhereTab)}</div></div>
        <div class="srow">${check('lowKey', c.lowKey, S.follow.lowKey)}${check('scoreboard', c.scoreboard, S.follow.scoreboard)}</div>
        <div class="srow">${check('infieldEdge', c.infieldEdge, T.infieldEdge)}</div>
        <div class="srow">${check('hoverCard', c.hoverCard, T.hoverCard)}</div>
        <div class="srow${c.hoverCard ? '' : ' off'}"><span class="k">${esc(T.hoverTotals)}</span>${seg('hoverTotals', c.hoverTotals, (['both', 'season', 'postseason', 'off'] as const).map((k) => [k, T.totals[k]]))}</div>

        <h3>${esc(T.panels)}</h3>
        <div class="srow">${PANELS.map((p) => check(`panels.${p}`, c.panels[p], T.panel[p])).join('')}</div>

        <h3>${esc(T.sound)}</h3>
        <div class="srow">${check('sound.on', !c.sound.muted, T.soundOn)}<input type="range" min="0" max="100" step="5" data-set="sound.volume" value="${Math.round(c.sound.volume * 100)}" aria-label="${esc(T.volume)}"${c.sound.muted ? ' disabled' : ''}></div>
        <div class="srow">${check('sound.hit', c.sound.hit, T.hit)}${preview('hit')}${check('sound.homeRun', c.sound.homeRun, T.homeRun)}${preview('homeRun')}</div>
        <div class="block"><span class="k">${esc(T.more)}</span><div class="chips">${EXTRA_SOUNDS.map((k) => `<span class="chip">${check(`sound.${k}`, c.sound[k], T[k])}${preview(k)}</span>`).join('')}</div></div>
        ${soundNote}

        <h3>${esc(T.notify)}</h3>
        <div class="srow"><span class="k">${esc(T.mode)}</span>${seg('notify.mode', c.notify.mode, (['toast', 'marquee', 'both', 'off'] as const).map((m) => [m, T.modes[m]]))}</div>
        <div class="srow${marquee ? '' : ' off'}"><span class="k">${esc(T.spot)}</span>${seg('notify.marquee', c.notify.marquee, (['top', 'bottom', 'bar'] as const).map((m) => [m, T.spots[m]]))}</div>
        <div class="block${c.notify.mode === 'off' ? ' off' : ''}"><span class="k">${esc(T.events)}</span><div class="chips">${NOTIFY_KINDS.map((k) => check(`notify.events.${k}`, c.notify.events[k], S.notify.kinds[k])).join('')}</div></div>
        <div class="srow${c.notify.mode === 'off' ? ' off' : ''}">${check('notify.onlyMine', c.notify.onlyMine, T.onlyMine)}</div>

        <h3>${esc(T.hotkeys)}</h3>
        <div class="srow">${check('hotkeys.on', c.hotkeys.on, T.hotkeysOn)}</div>
        <div class="srow${c.hotkeys.on ? '' : ' off'}"><span class="k">${esc(T.hide)}</span><input class="key" type="text" spellcheck="false" data-set="hotkeys.hide" value="${esc(c.hotkeys.hide)}">${isMac ? `<span class="keyhint">${esc(keyLabel(c.hotkeys.hide, true))}</span>` : ''}</div>
        <div class="srow${c.hotkeys.on ? '' : ' off'}"><span class="k">${esc(S.follow.lowKey)}</span><input class="key" type="text" spellcheck="false" data-set="hotkeys.lowKey" value="${esc(c.hotkeys.lowKey)}">${isMac ? `<span class="keyhint">${esc(keyLabel(c.hotkeys.lowKey, true))}</span>` : ''}</div>
        ${hotkeyError ? `<p class="note">${esc(T.hotkeyBad)}</p>` : ''}

        <h3>${esc(T.replay)}</h3>
        <div class="srow"><span class="k">${esc(T.pace)}</span>${seg('replay.pace', c.replay.pace, (['compact', 'real', 'fixed', 'results'] as const).map((p) => [p, T.paces[p]]))}</div>
        <div class="srow">${check('replay.showScores', c.replay.showScores, T.showScores)}</div>

        <h3>${esc(T.about)}</h3>
        <p class="about"><b>Basesmall</b> ${esc(appVersion)} · <i>Baseball, but small.</i><br>${esc(T.aboutText)}</p>
        ${newerRow(T)}
        <div class="srow">${check('updateCheck', c.updateCheck, T.updateCheck)}${newer ? '' : `<button class="link" data-action="check-update"${updateAsk === 'asking' ? ' disabled' : ''}>${esc(updateAsk === 'asking' ? T.checking : updateAsk === 'none' ? T.upToDate : T.checkNow)}</button>`}</div>
        <p class="about">${esc(T.credit)}</p>
        <div class="srow"><button class="link" data-open="https://basesmall.chroniclecore.com/${lang === 'zh-Hant' ? 'zh/' : ''}">${esc(T.website)}</button><button class="link" data-open="https://github.com/Zaious/basesmall">${esc(T.source)}</button></div>
        ${configFolder ? `<p class="note">${esc(T.stylesFolder)}: <span class="mono">${esc(configFolder)}${configFolder.includes('\\') ? '\\' : '/'}styles</span></p>` : ''}
      </div>
    </section>`;
  const body = app.querySelector('.settings .body');
  if (body) body.scrollTop = scrollTop;
  setTitle(`Basesmall · settings · ${lang} · ${style.id} · ${c.background} · sound ${c.sound.muted ? 'off' : 'on'} · notify ${c.notify.mode} · after ${c.follow.after} · hotkeys ${c.hotkeys.on ? (hotkeyError ? 'error' : 'on') : 'off'}`);
}

/** The About section's line about a newer version: Update (installed copies) or a link. */
function newerRow(T: typeof S.set): string {
  if (!newer) return '';
  if (!newer.update) return `<div class="srow"><button class="link" data-open="${esc(newer.url)}">⬆ ${esc(T.newVersion(newer.tag))}</button></div>`;
  return `<div class="srow"><button class="link update" data-action="update"${updateNote ? ' disabled' : ''}>⬆ ${esc(T.updateTo(newer.tag))}</button>`
    + `${updateNote ? `<span class="note">${esc(updateNote)}</span>` : `<button class="link" data-open="${esc(newer.url)}">${esc(T.whatsNew)}</button>`}</div>`;
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
  else if (t.type === 'text') setPath(path, t.value.trim());
});

// ---------- reacting to settings ----------

function onSettings(now: Settings, before: Settings): void {
  sounds.setOptions(now.sound);
  if (now.language !== before.language) applyLanguage();
  if (now.style !== before.style) { style = findStyle(styles, now.style); applyStyle(); }
  if (now.background !== before.background) applyBackground();
  configureNotices();
  if (now.replay.pace !== before.replay.pace) applyPace();
  if (JSON.stringify(now.hotkeys) !== JSON.stringify(before.hotkeys)) void applyHotkeys();
  if (JSON.stringify(now.panels) !== JSON.stringify(before.panels)) void panels?.sync(now.panels);
  const layout = now.lowKey !== before.lowKey || now.scoreboard !== before.scoreboard;
  if (now.infieldEdge !== before.infieldEdge && field && shown) field.setLook(look(shown));
  if (now.tabs.elsewhere !== before.tabs.elsewhere && !now.tabs.elsewhere) elsewhere = null;
  if (layout && (view === 'game' || view === 'home')) void fitWindow(view);
  // Redraw what is on screen.
  if (view === 'settings') renderSettings();
  else if (view === 'picker' && (now.language !== before.language || now.replay.showScores !== before.replay.showScores)) void showPicker();
  else if (view === 'chooser') renderChooser();
  else if (view === 'home') renderHome(false);
  else if (view === 'game' && (layout || now.language !== before.language || now.style !== before.style || now.background !== before.background)) buildGame();
  else if (view === 'game') renderTabs(store.current);
  updateWants();
}

function applyBackground(): void {
  const m = cfg().background;
  for (const el of [app, tabsEl, boardEl]) {
    el.classList.remove('bg-solid', 'bg-semi', 'bg-clear');
    el.classList.add(`bg-${m}`);
  }
  if (field && shown) field.setLook(look(shown));
}

// ---------- game: state ----------

let mode: 'live' | 'replay' = 'live';
let followMode: FollowMode = 'manual';
let following = 0;
let speed = 1;
const SPEEDS = [1, 2, 4, 8];
/** Dev aid (--seek=<entry> [--paused]): jump a replay to an entry once it has loaded. */
let pendingSeek: { index: number; pause: boolean } | null = null;
/** Catching up on a game joined late: its plate appearances from the first inning, then live. */
let catchUp: { pk: number; then: FollowMode } | null = null;
/** Another game's big moment, offered as a tab while watching this one. */
let elsewhere: { key: string; card: GameCard } | null = null;
const dismissedElsewhere = new Set<string>();
let endTimer: ReturnType<typeof setTimeout> | null = null;

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
/**
 * The new pitcher after a pitching change, until the next pitch. The feed is silent while they warm
 * up, sometimes for minutes, and a board that does not move looked stuck (2026-10-05).
 */
let changingTo = '';
let bubbleSeq = 0;
let hiddenByKey = false;
const check = { steps: 0, bad: 0, notices: 0, sounds: 0, frames: 0 };

interface Step { state: GameState; events: readonly GameEvent[]; text: readonly GameEvent[] }
const queue = new AnimationQueue<Step>(runStep, {
  // Skipped steps still count for the text: keep their plays so the latest line is right.
  merge: (skipped, newer) => ({ ...newer, text: [...skipped.text, ...newer.text] }),
});

const paintsOf = (s: GameState) => piecePaints(s.teams.away.abbr, s.teams.home.abbr, fav());
const look = (s: GameState): Look => ({ style, background: cfg().background, paints: paintsOf(s), infieldEdge: cfg().infieldEdge });
/** "非主隊": a team of the user's is set, and neither side on screen is it. */
const proxyTag = (s: GameState) => {
  const mine = [fav(), cfg().follow.adopted].filter(Boolean);
  return mine.length && !mine.some((t) => t === s.teams.away.abbr || t === s.teams.home.abbr)
    ? { text: S.follow.proxy, title: S.follow.proxyTitle } : undefined;
};

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
  if (mode === 'replay' && !catchUp) replay.player(following)?.setPace(PACES[cfg().replay.pace]);
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
  if (view !== 'game' || !cfg().tabs.clock || !store.current || cfg().lowKey) return;
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
  if (game && s && !cfg().lowKey) {
    const time = elapsed(s);
    // Narrow: the clock alone, without its close button.
    if (tabs.clock && time) items.push(`<span class="tab" title="${esc(S.ui.clock)}">⏱ <span class="mono clock-value">${time}</span>${narrow ? '' : '<button data-close="clock" aria-label="×">×</button>'}</span>`);
    if (catchUp) items.push(`<span class="tab accent">⏩ ${esc(S.follow.catchingUp)}</span>`);
    else if (tabs.replay && mode === 'replay' && !narrow) {
      const date = dates.get(s.gamePk);
      items.push(`<span class="tab accent"><span class="tx">${esc(S.ui.replay)}${date ? ` · ${shortDate(date)}` : ''}${speed > 1 ? ` · ${speed}×` : ''}</span><button data-close="replay" aria-label="×">×</button></span>`);
    }
    const card = cardsByPk.get(s.gamePk);
    // The series standing in a replay would spoil the game's result: live only.
    if (tabs.series && card?.series && mode === 'live' && !narrow) {
      items.push(`<span class="tab"><span class="tx">${esc(S.series(card.series, card.gameType, { away: card.away.abbr, home: card.home.abbr }))}</span><button data-close="series" aria-label="×">×</button></span>`);
    }
    if (elsewhere && cfg().tabs.elsewhere && !narrow) {
      const c = elsewhere.card;
      const text = S.follow.elsewhere(S.inning(c.inning ?? 1, c.half ?? 'top'), `${c.away.abbr} ${c.away.runs ?? 0}:${c.home.runs ?? 0} ${c.home.abbr}`);
      items.push(`<span class="tab elsewhere"><button class="go" data-pk="${c.gamePk}" data-mode="live">${esc(text)} ▶</button><button data-close="elsewhere" aria-label="×">×</button></span>`);
    }
  }
  tabsEl.innerHTML = game ? `${items.join('')}<span class="grow"></span>${controls()}` : '';
  document.body.classList.toggle('has-tabs', game);
  document.body.classList.toggle('has-board', boardOpen());
  void panels?.setHidden(view !== 'game' || cfg().lowKey || hiddenByKey);
}

function setTab(k: 'clock' | 'replay' | 'series', on: boolean): void {
  settings.update((d) => { d.tabs[k] = on; });
}

/**
 * The ✕ at the end of each view's buttons. A first click asks, a second within three seconds quits:
 * closing the main window ends the app (lib.rs). Without it, quitting meant finding the tray icon.
 */
let quitArmed = 0;
function quitButton(): string {
  const armed = Date.now() - quitArmed < 3000;
  return `<button class="quit${armed ? ' armed' : ''}" data-action="quit" title="${esc(S.ui.quit)}">${armed ? esc(S.ui.quitAgain) : '✕'}</button>`;
}
function quit(): void {
  if (Date.now() - quitArmed < 3000) { void (win ? win.close() : Promise.resolve(window.close())); return; }
  quitArmed = Date.now();
  const show = () => { for (const b of document.querySelectorAll<HTMLButtonElement>('button.quit')) b.outerHTML = quitButton(); };
  show();
  setTimeout(show, 3050);
}

function controls(): string {
  if (cfg().lowKey) return `<span class="controls"><button data-action="lowkey" title="${esc(S.follow.lowKey)}">◱</button></span>`;
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
  // Joined a game already under way: offer to catch up from the first inning.
  const inProgress = mode === 'live' && shown?.status === 'live' && (shown.inning > 1 || shown.half === 'bottom');
  const catchButton = inProgress && !narrow ? `<button data-action="catchup" title="${esc(S.follow.catchUp)}">⏩</button>` : '';
  const tabButtons = narrow ? '' : `<button data-action="clock" aria-pressed="${tabs.clock}" title="${esc(S.ui.clock)}">⏱</button>`
    + (mode === 'replay' ? `<button data-action="replay-tab" aria-pressed="${tabs.replay}">${esc(S.ui.replay)}</button>` : '');
  const sizeButton = `<button data-action="size" title="${esc(S.ui.size)}">⤢ ${esc(S.tier[tier])}</button>`;
  const styleTip = [S.ui.style, ...styleProblems].join('\n');
  const styleButton = narrow ? '' : `<button data-action="style" title="${esc(`${style.name[lang]}\n${styleTip}`)}">◇</button>`;
  const boardButton = narrow ? '' : `<button data-action="scoreboard" aria-pressed="${cfg().scoreboard}" title="${esc(S.follow.scoreboard)}">▤</button>`;
  const lowKeyButton = narrow ? '' : `<button data-action="lowkey" title="${esc(S.follow.lowKey)}">◱</button>`;
  const settingsButton = `<button data-action="settings" title="${esc(S.set.title)}">⚙</button>`;
  return `<span class="controls">${toggle}${replayMore}${catchButton}${tabButtons}${sizeButton}${styleButton}${boardButton}${lowKeyButton}${settingsButton}<button data-action="back">‹${narrow ? '' : ` ${esc(S.ui.back)}`}</button>${quitButton()}</span>`;
}

// ---------- game: following ----------

/** Bumped whenever the game on screen goes away, so a step still animating for it stops there. */
let gameGen = 0;

function leaveGame(): void {
  gameGen++;
  zoneState = undefined;
  store.stop();
  queue.clear();
  field?.dispose();
  field = null;
  stopHome();
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  elsewhere = null;
  void notifier?.clearAll();
  updateWants();
}

function follow(pk: number, how: 'live' | 'replay', why: FollowMode = 'manual', opts: { catchUp?: boolean } = {}): void {
  if (pickerTimer) clearTimeout(pickerTimer);
  const then = followMode;
  leaveGame();
  following = pk;
  mode = how;
  followMode = why;
  catchUp = opts.catchUp ? { pk, then } : null;
  barLine = pitchText = changingTo = '';
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
      if (catchUp?.pk === pk) {
        // Catch-up: plate-appearance results only, then the live game from where it is now.
        p.setPace(PACES.results);
        p.onEnd(() => { if (catchUp?.pk === pk && following === pk && view === 'game') { const back = catchUp.then; catchUp = null; follow(pk, 'live', back); } });
      } else p.setPace(PACES[cfg().replay.pace]);
      if (speed !== 1) p.setSpeed(speed);
    });
  }
  updateWants();
}

const formatLine = (l: { who?: string; text: string }) => `${l.who ? `<b>${esc(l.who)}</b> ` : ''}${esc(l.text)}`;
/** Plays where the carry is worth a number in the bubble. */
const FAR = new Set(['single', 'double', 'triple', 'home_run', 'field_out', 'sac_fly']);

/** Update the text lines from what just happened. */
function applyLines(events: readonly GameEvent[]): void {
  for (const ev of events) {
    changingTo = ev.type === 'pitchingChange' ? ev.pitcher.short : '';
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

async function runStep(step: Step, animate: boolean, catchUpRate: number): Promise<void> {
  if (view !== 'game') return;
  const gen = gameGen;
  const before = shown;
  const plan = planStep(scene, step.state, step.events);
  scene = plan.end;
  applyLines(step.text);
  if (!shown) {
    shown = step.state;
    buildGame();
    updateWants(); // now it is known whose game is on screen
    sendPanels(step, plan, false, 1);
    return;
  }
  const rate = (mode === 'replay' ? speed : 1) * catchUpRate;
  const quiet = cfg().lowKey;
  // Sound at contact; not while the queue is catching up, when steps fly by, and never in low-key mode.
  if (animate && catchUpRate <= 2 && !quiet) playSound(before, step);
  sendPanels(step, plan, animate, rate);
  if (field && animate) {
    // Causal order: the pitch shows first, the ball flies, runners run, then the score changes.
    // The previous play's bubble goes as soon as the next pitch is thrown.
    renderZone(step.state, true);
    if (step.events.some((e) => e.type === 'pitch')) app.querySelector('.bubble')?.classList.remove('show', 'hr');
    field.setLabel(batterLabel(step.state, plan), plan.end.get(`r${step.state.batter?.id}`)?.role === 'batter');
    hideCard();
    await field.play(plan, rate);
    if (gen !== gameGen) return;
    shown = step.state;
    renderText({ zone: false });
  } else {
    field?.show(plan.end);
    shown = step.state;
    renderText();
  }
  // Notices go out with the score, after the play has been shown.
  if (animate && !quiet) notifyStep(before, step);
  // An auto-followed game that ended: after a while, back to the user's team (or the next tense game).
  if (step.events.some((e) => e.type === 'gameEnd') && mode === 'live' && followMode !== 'manual') {
    const pk = following;
    if (endTimer) clearTimeout(endTimer);
    endTimer = setTimeout(() => { if (view === 'game' && following === pk && followMode !== 'manual') void goHome(); }, 10 * 60_000);
  }
  if (dev.selfcheck) selfCheck(plan);
}

function sendPanels(step: Step, plan: Plan, animate: boolean, rate: number): void {
  if (!panels || !PANELS.some((p) => cfg().panels[p])) return;
  check.frames++;
  panels.send({
    state: step.state, scene: [...plan.end], ...(animate ? { plan: packPlan(plan) } : {}),
    speed: rate, pop: animate && step.events.some((e) => e.type === 'pitch'), look: look(step.state), lang,
  });
}

function playSound(before: GameState | undefined, step: Step): void {
  const name = soundsFor(before, step.state, step.events).find((n) => sounds.enabled(n));
  if (name) { sounds.play(name); check.sounds++; }
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

// ---------- the schedule: scoreboard, other games, tension ----------

/** Tell the schedule poller who needs it right now. */
function updateWants(): void {
  const n = cfg().notify;
  const watchingLive = view === 'game' && mode === 'live';
  const followingMine = view === 'game' && (!fav() || [shown?.teams.away.abbr, shown?.teams.home.abbr].includes(fav()));
  // Other games' notices: all games, or the user's team while something else is on screen.
  schedule.want('notices', inTauri && n.mode !== 'off' && !cfg().lowKey && (n.events.run || n.events.game)
    && (!n.onlyMine || (fav() !== undefined && !(watchingLive && followingMine))));
  schedule.want('scoreboard', boardOpen());
  schedule.want('elsewhere', watchingLive && !cfg().lowKey && cfg().tabs.elsewhere);
  renderBoard();
}

let noticeBase: Map<number, GameSnap> | null = null;
let noticeDate = '';
const snapOf = (c: GameCard): GameSnap => ({
  gamePk: c.gamePk,
  phase: c.status === 'scheduled' || c.status === 'pregame' ? 'pre' : isLive(c) || c.status === 'suspended' ? 'live' : c.status === 'final' ? 'final' : 'other',
  away: c.away.abbr, home: c.home.abbr, runs: { away: c.away.runs ?? 0, home: c.home.runs ?? 0 },
  ...(c.inning ? { inning: c.inning } : {}), ...(c.half ? { half: c.half } : {}),
});

schedule.subscribe((cards) => {
  remember(cards);
  // Other games' notices: starts, runs, finals (ARCHITECTURE 4.2).
  if (schedule.date !== noticeDate) { noticeDate = schedule.date; noticeBase = null; }
  const snaps = cards.map(snapOf);
  const n = cfg().notify;
  for (const c of diffSchedule(noticeBase, snaps)) {
    if (n.mode === 'off' || cfg().lowKey) break;
    // The game on screen notifies from its own plays, with more detail.
    if (view === 'game' && mode === 'live' && c.snap.gamePk === following) continue;
    if (n.onlyMine && (!fav() || ![c.snap.away, c.snap.home].includes(fav()!))) continue;
    sendNotice(scheduleNotice(c, n.events, lang));
  }
  noticeBase = new Map(snaps.map((s) => [s.gamePk, s]));
  // Another game's big moment, while watching this one: one tab, never a switch.
  if (view === 'game' && mode === 'live' && !cfg().lowKey && cfg().tabs.elsewhere) {
    const mine = cards.find((c) => c.gamePk === following);
    const here = mine ? tension(mine) : 0;
    const best = cards.filter((c) => c.gamePk !== following && isBigMoment(c) && tension(c) > here)
      .sort((a, b) => tension(b) - tension(a))[0];
    const key = best ? `${best.gamePk}:${best.inning}:${best.half}` : '';
    elsewhere = best && !dismissedElsewhere.has(key) ? { key, card: best } : null;
    renderTabs(store.current);
  }
  // Waiting for a game to go live (league mode, or "the most tense game").
  if (view === 'home' && homeIdle) {
    const best = mostTense(cards);
    if (best) follow(best.gamePk, 'live', 'tension');
  }
  renderBoard();
});

function renderBoard(): void {
  const open = boardOpen();
  document.body.classList.toggle('has-board', open);
  if (!open) { boardEl.innerHTML = ''; return; }
  boardEl.innerHTML = `<div class="board-list">${boardRows(schedule.cards, { lang, current: view === 'game' ? following : undefined, showScores: cfg().replay.showScores })}</div>`;
}

// ---------- notifications ----------

function configureNotices(): void {
  notifier?.configure(cfg().notify.mode, cfg().notify.marquee, {
    theme: style.theme, labels: { close: S.notify.close, replay: S.notify.replay },
  });
  updateWants();
}

/** The game on screen involves the user's team (or there is no team, so the game on screen counts). */
const followingMine = () => view === 'game' && (!fav() || [shown?.teams.away.abbr, shown?.teams.home.abbr].includes(fav()));

function sendNotice(n: Notice | null): void {
  if (!n || !notifier || cfg().notify.mode === 'off' || cfg().lowKey) return;
  check.notices++;
  void notifier.push(n);
}

function notifyStep(before: GameState | undefined, step: Step): void {
  const n = cfg().notify;
  if (n.mode === 'off' || (n.onlyMine && !followingMine())) return;
  // Catching up is a replay of what already happened: no notices for it.
  if (catchUp) return;
  sendNotice(noticeFor(before, step.state, step.events, n.events, lang, mode === 'replay'));
}

// ---------- hotkeys (F9) ----------

async function applyHotkeys(): Promise<void> {
  if (!inTauri) return;
  try { await unregisterAll(); } catch { /* nothing registered */ }
  hotkeyError = false;
  const h = cfg().hotkeys;
  if (h.on) {
    for (const [combo, fn] of [[h.hide, toggleHidden], [h.lowKey, toggleLowKey]] as const) {
      if (!combo) continue;
      try { await register(combo, (e) => { if (e.state === 'Pressed') fn(); }); } catch { hotkeyError = true; }
    }
  }
  if (view === 'settings') renderSettings();
}

/** The hide key: every Basesmall window out of sight, and back. */
function toggleHidden(): void {
  hiddenByKey = !hiddenByKey;
  if (hiddenByKey) { void win?.hide(); void notifier?.clearAll(); } else void win?.show();
  void panels?.setHidden(view !== 'game' || cfg().lowKey || hiddenByKey);
}

function toggleLowKey(): void {
  settings.update((d) => { d.lowKey = !d.lowKey; });
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
  const s = shown;
  if (cfg().lowKey) {
    app.dataset.tier = 'lowkey';
    app.innerHTML = s ? lowKeyView(s) : '<div class="lowkey mono">…</div>';
    renderTabs(s);
    if (s) setGameTitle(s);
    return;
  }
  const r = app.getBoundingClientRect();
  if (r.height > 0) { tier = tierOf(r.height); parts = partsOf(tier, r.width); }
  app.dataset.tier = tier;
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
    attachHover(app.querySelector<HTMLElement>('.fieldwrap')!);
  }
  renderText();
  if (field && 'ResizeObserver' in window) {
    partObserver = new ResizeObserver(() => {
      field?.resize();
      // Redraw what the zone shows now: during a step that is already the new pitch, ahead of `shown`.
      const z = zoneState ?? shown;
      if (z) renderZone(z, false);
    });
    partObserver.observe(app.querySelector('.fieldwrap')!);
    const zone = app.querySelector('svg.zone');
    if (zone) partObserver.observe(zone);
  }
}

/** The state the strike zone last drew. */
let zoneState: GameState | undefined;

/** Hides the player card; replaced each time the board is built. Pieces move with every step, so it goes then. */
let hideCard: () => void = () => undefined;

/** Regular-season totals of a postseason game's players, by game: fetched once, on the first card. */
const regular = new Map<number, Record<number, Totals> | 'loading'>();

const loaded = (pk: number) => { const r = regular.get(pk); return typeof r === 'object' ? r : undefined; };

/** Fetch a postseason game's regular-season totals, once; `done` runs when they arrive. */
function loadRegular(s: GameState, done: () => void): void {
  const want = cfg().hoverTotals;
  if (!s.postseason || !s.season || regular.has(s.gamePk) || (want !== 'both' && want !== 'season')) return;
  const ids = Object.keys(s.roster ?? {}).map(Number);
  if (!ids.length) return;
  const pk = s.gamePk;
  regular.set(pk, 'loading');
  fetchJson(seasonStatsPath(ids, s.season)).then(
    (j) => { regular.set(pk, seasonTotals(j)); done(); },
    // Let a later card try again, but not every card in a row.
    () => setTimeout(() => regular.delete(pk), 60_000),
  );
}

/**
 * The player card over a piece under the pointer (setting hoverCard). It reads the state on screen, so
 * today's lines never run ahead of the board; cardTotals keeps a replay from showing totals that would spoil it.
 */
function attachHover(wrap: HTMLElement): void {
  const card = document.createElement('div');
  card.className = 'pcard';
  card.hidden = true;
  wrap.append(card);
  let key = '';
  let over: Element | null = null;
  hideCard = () => { key = ''; over = null; card.hidden = true; };
  const draw = () => {
    const piece = key && field ? field.pieceOf(key) : undefined;
    if (!piece || !over || !shown) return;
    card.innerHTML = playerCardView(piece.id, piece.role === 'pitcher', piece.name ?? '', shown, cardTotals(shown, piece.id, cfg().hoverTotals, mode === 'live', loaded(shown.gamePk)), lang);
    card.hidden = false;
    // Above the piece if it fits, else below; always inside the board.
    const w = wrap.getBoundingClientRect(), r = over.getBoundingClientRect();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const x = Math.max(2, Math.min(w.width - cw - 2, r.left + r.width / 2 - w.left - cw / 2));
    const above = r.top - w.top - ch - 4;
    const y = above >= 2 ? above : Math.min(w.height - ch - 2, r.bottom - w.top + 4);
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(Math.max(2, y))}px`;
  };
  wrap.addEventListener('pointerover', (e) => {
    if (!cfg().hoverCard || !field || !shown) return;
    const g = (e.target as Element).closest?.('g[data-key]');
    const k = g?.getAttribute('data-key') ?? '';
    if (!g || !k || !field.pieceOf(k) || k === key) return;
    key = k;
    over = g;
    draw();
    const pk = shown.gamePk;
    loadRegular(shown, () => { if (key && shown?.gamePk === pk) draw(); });
  });
  wrap.addEventListener('pointerout', (e) => {
    const to = (e.relatedTarget as Element | null)?.closest?.('g[data-key]');
    if (to?.getAttribute('data-key') !== key) hideCard();
  });
}

function renderZone(s: GameState, pop: boolean): void {
  const svg = app.querySelector<SVGSVGElement>('svg.zone');
  if (!svg) return;
  zoneState = s;
  const r = svg.getBoundingClientRect();
  svg.innerHTML = zoneSvg(s.atBat, {
    w: r.width, h: r.height, iso: style.renderer === 'iso', theme: style.theme,
    batter: s.batter ? { side: s.batter.side, label: S.bats(s.batter.side) } : undefined,
    popLast: pop, noData: S.ui.noPitchData,
  });
  const cap = app.querySelector('.pcap');
  if (cap) cap.innerHTML = pitchCaption(s, lang, style.theme);
}

function renderText(opts: { zone?: boolean } = {}): void {
  const s = shown;
  if (!s || view !== 'game') return;
  if (cfg().lowKey) { app.innerHTML = lowKeyView(s); renderTabs(s); setGameTitle(s); return; }
  const paints = paintsOf(s);
  const statusText = s.status !== 'live' ? S.status(s.status, s.statusDetail) : changingTo ? S.changingPitchers(changingTo) : '';
  const conn = mode === 'live' ? live.status(following) : undefined;
  const offline = conn && !conn.connected ? S.ui.reconnecting : '';
  const proxy = proxyTag(s);
  if (tier === 'dot') {
    app.innerHTML = dotView(s, paints, parts);
  } else if (tier === 'bar') {
    // During a pitching change the status says it all; the "X 換投" line would repeat it.
    const lastHtml = changingTo && s.status === 'live' ? '' : showPitch ? `<span class="muted">${esc(pitchText)}</span>` : barLine;
    app.innerHTML = barView(s, paints, lang, parts, lastHtml, statusText, offline, proxy);
  } else {
    app.querySelector('.hud')!.innerHTML = hudView(s, paints, lang, proxy) + (offline ? `<i class="conn" title="${esc(offline)}"></i>` : '');
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
  setGameTitle(s);
}

function setGameTitle(s: GameState): void {
  const checkText = dev.selfcheck
    ? ` · check ${check.steps}/${check.bad} · ${frameStats()} · styles ${styles.length} style problems ${styleProblems.length} · notices ${check.notices} sounds ${check.sounds} audio ${sounds.state} · frames-sent ${check.frames} · schedule ${schedule.requests}${elsewhere ? ` · elsewhere ${elsewhere.card.gamePk}` : ''}`
    : '';
  const modeText = `${followMode}${catchUp ? ' catchup' : ''}${cfg().lowKey ? ' lowkey' : ''}${proxyTag(s) ? ' proxy' : ''}${changingTo ? ' pchange' : ''}`;
  setTitle(`Basesmall · ${s.gamePk} · ${mode} · ${s.status} · ${s.teams.away.abbr} ${s.score.away}-${s.score.home} ${s.teams.home.abbr} · ${S.inning(s.inning, s.half)} · ${s.balls}-${s.strikes} ${s.outs}out · ${elapsed(s)} · ${cfg().lowKey ? 'lowkey' : tier} · ${style.id} · ${modeText}${checkText}`);
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
    if (view !== 'game' || !shown || cfg().lowKey) return;
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
  if (action === 'check-update') { askNewer(); renderSettings(); return; }
  if (action === 'update') { startUpdate(); return; }
  if (action === 'quit') { quit(); return; }
  if (action === 'settings-done') { closeSettings(); return; }
  if (action === 'home') { void goHome(); return; }
  if (action === 'picker') { void showPicker(); return; }
  if (action === 'scoreboard') { settings.update((d) => { d.scoreboard = !d.scoreboard; }); return; }
  if (action === 'lowkey') { toggleLowKey(); return; }
  if (action === 'catchup') { if (mode === 'live' && following) follow(following, 'replay', followMode, { catchUp: true }); return; }
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
  if (close === 'clock' || close === 'replay' || close === 'series') setTab(close, false);
  else if (close === 'elsewhere') { if (elsewhere) dismissedElsewhere.add(elsewhere.key); elsewhere = null; renderTabs(store.current); }
  else if (t.dataset.fav) {
    const team = t.dataset.fav;
    settings.update((d) => { d.favorite = team; });
    pickerTab = null;
    if (team !== 'none') void goHome(); else void showPicker();
  }
  else if (t.dataset.after) {
    const k = t.dataset.after as AfterOut;
    const d = homeDecision;
    settings.update((s) => { s.follow.after = k; if (d?.kind === 'over') s.follow.seen = seasonKey(homeTeam() ?? '', d.last); });
    void applyAfter(k);
  }
  else if (t.dataset.adopt) {
    const team = t.dataset.adopt;
    settings.update((s) => { s.follow.adopted = team; });
    void goHome();
  }
  else if (pick) setPath(pick, value);
  else if (preview) sounds.play(preview as SoundName, true);
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
boardEl.addEventListener('click', onClick);

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
  void listen('toggle-low-key', () => toggleLowKey());
  void listen('toggle-scoreboard', () => settings.update((d) => { d.scoreboard = !d.scoreboard; }));
  void listen<PanelName>('panel-closed', (e) => settings.update((d) => { d.panels[e.payload] = false; }));
  void listen<{ name: PanelName; w: number; h: number }>('panel-size', (e) => saveSize(`size-panel-${e.payload.name}`, { w: e.payload.w, h: e.payload.h }));
}

// Open a game directly: `basesmall --game=<pk> [--mode=replay]` in the app, ?game=<pk>&mode=replay in a browser.
// Checking aids: --tier=dot|bar|field|full --style=<id> --bg=solid|semi|clear --speed=<n> --seek=<entry>
// [--paused] --selfcheck --press=<action>,<action> (control buttons, 2 s apart, once loaded) --settings
// --set=<path>:<value>,... (e.g. sound.on:true,notify.mode:both) --picker (the game list instead of home).
// A checking run saves no settings, unless BASESMALL_CONFIG_DIR points it at a scratch folder.
/** "follow.seen:2026:PHI" -> ["follow.seen", "2026:PHI"]: only the first colon separates. */
function splitPair(pair: string): [string, string] {
  const i = pair.indexOf(':');
  return i < 0 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)];
}

async function start(): Promise<void> {
  const q = new URLSearchParams(location.search);
  let overridden = false;
  if (inTauri) {
    for (const a of await invoke<string[]>('launch_args').catch(() => [] as string[])) {
      const m = /^--(game|mode|team|seek|tier|style|bg|speed|press|set)=(.+)$/.exec(a);
      if (m) q.set(m[1]!, m[2]!);
      for (const flag of ['paused', 'selfcheck', 'settings', 'picker']) if (a === `--${flag}`) q.set(flag, '1');
    }
    [configFolder, overridden] = await invoke<[string, boolean]>('config_info').catch(() => ['', false] as [string, boolean]);
    appVersion = await getVersion().catch(() => '');
  }
  const checking = ['tier', 'style', 'bg', 'speed', 'seek', 'selfcheck', 'press', 'settings', 'set', 'picker'].some((k) => q.has(k));
  settings = await SettingsStore.open(backend, () => fromLocalStorage(legacy));
  settings.persist = !checking || overridden;
  settings.subscribe(onSettings);
  // --set=sound.on:true,notify.mode:both — change settings as the settings screen would.
  for (const pair of (q.get('set') ?? '').split(',').filter(Boolean)) {
    const [path, raw] = splitPair(pair);
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
  void applyHotkeys();
  void panels?.sync(cfg().panels);
  if (q.has('seek')) pendingSeek = { index: Number(q.get('seek')), pause: q.has('paused') };
  const t = q.get('tier');
  if (t === 'dot' || t === 'bar' || t === 'field' || t === 'full') dev.tier = t;
  if (q.has('speed')) dev.speed = Math.max(0.25, Number(q.get('speed')) || 1);
  if (q.has('selfcheck')) dev.selfcheck = true;
  // Each press is a control button ("size") or a setting change ("language:en"), 2 s apart.
  const presses = (q.get('press') ?? '').split(',').filter(Boolean);
  presses.forEach((action, i) => setTimeout(() => {
    if (!action.includes(':')) { replayAction(action); return; }
    const [path, raw] = splitPair(action);
    setPath(path, raw === 'true' ? true : raw === 'false' ? false : raw);
  }, 6000 + i * 2000));
  if (q.has('game')) follow(Number(q.get('game')), q.get('mode') === 'replay' ? 'replay' : 'live');
  else if (cfg().favorite === null) showChooser();
  else if (q.has('picker')) void showPicker();
  else void goHome();
  if (q.has('settings')) setTimeout(showSettings, 1500);
  // One question to GitHub per launch, after the game has had time to load (setting updateCheck).
  if (cfg().updateCheck && !checking) setTimeout(() => { if (!askedForNewer && cfg().updateCheck) askNewer(); }, 20_000);
}
void start();
