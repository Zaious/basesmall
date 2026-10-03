// The main window: choose a team, pick a game, follow it. The game view has four size tiers
// (dot, bar, field, full); the window's size picks one. Field and full draw the board.
// Runs in a plain browser too (without window controls), which is how the UI is checked headless.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { MlbLiveSource } from '../data/mlb/live-source.ts';
import type { MlbFeed } from '../data/mlb/feed-types.ts';
import { mapStatus } from '../data/mlb/codes.ts';
import { MlbReplaySource } from '../data/replay/mlb-replay-source.ts';
import { GameStore } from '../model/store.ts';
import type { GameEvent, GameState, Side } from '../model/types.ts';
import { detectLang, eventLine, pitchLine, STRINGS } from '../i18n/index.ts';
import { piecePaints, teamPaint } from '../styles/team-colors.ts';
import { findStyle, loadStyles, nextStyle } from '../styles/loader.ts';
import type { StyleManifest } from '../styles/manifest.ts';
import { FieldRenderer, type Background } from '../render/field-svg.ts';
import { AnimationQueue } from '../render/queue.ts';
import { planStep, type Plan, type Scene } from '../render/scene.ts';
import { nextTier, partsOf, tierOf, TIER_MIN_WIDTH, TIER_PRESET, type Tier, type TierParts } from '../render/tiers.ts';
import { frameGaps } from '../render/tween.ts';
import { zoneSvg } from '../render/zone.ts';
import { barView, dot, dotView, esc, hudView, linescoreView, matchupView, pitchCaption } from './views.ts';
import teamTable from '../../styles/team-colors/mlb.json' with { type: 'json' };

const inTauri = '__TAURI_INTERNALS__' in window;
const win = inTauri ? getCurrentWindow() : null;
const lang = detectLang(navigator.language);
const S = STRINGS[lang];
document.documentElement.lang = lang;

const app = document.getElementById('app')!;
const tabsEl = document.getElementById('tabs')!;

// ---------- settings (localStorage until the settings file arrives in M4) ----------

/** Launch overrides for checking the app (--tier, --style, --bg, ...). A checking run saves nothing. */
const dev: { tier?: Tier; selfcheck?: boolean; speed?: number; noSave?: boolean } = {};
const load = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { if (dev.noSave) return; try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
/** Team abbreviation, 'none', or null before the first choice. */
let favorite = load('favorite');
const fav = () => (favorite && favorite !== 'none' ? favorite : undefined);
const TEAMS = Object.keys((teamTable as { teams: Record<string, unknown> }).teams).sort();

// ---------- styles ----------

let styles: StyleManifest[] = loadStyles([]).styles;
let styleProblems: string[] = [];
let style = findStyle(styles, load('style'));

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
  const want = findStyle(styles, load('style'));
  if (want.id !== style.id) { style = want; applyStyle(); if (view === 'game') buildGame(); }
}

// ---------- window size per view ----------

type View = 'chooser' | 'picker' | 'game';
const DEFAULT_SIZE: Record<View, { w: number; h: number }> = {
  chooser: { w: 480, h: 300 }, picker: { w: 480, h: 300 }, game: TIER_PRESET.field,
};
/** Below this the picker and chooser cannot show a single row, so they never open smaller. */
const LIST_MIN_HEIGHT = 200;
/** Height of the strip above the game: tabs on the left (clock, replay), controls on the
 *  right on hover. Always there in the game view, so nothing ever covers the game. Saved sizes exclude it. */
const TAB_H = 20;
let view: View = 'picker';
let programmaticResize = 0;

function savedSize(key: string, fallback: { w: number; h: number }): { w: number; h: number } {
  try { return { ...fallback, ...(JSON.parse(load(key) ?? 'null') ?? {}) }; } catch { return fallback; }
}

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
      save(`size-${view}`, JSON.stringify({ w, h }));
      // Each tier remembers its own size, for the size button.
      if (view === 'game') save(`size-tier-${tierOf(h)}`, JSON.stringify({ w, h }));
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
  save('size-game', JSON.stringify({ w, h }));
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
  leaveGame();
  view = 'chooser';
  renderTabs(undefined);
  void fitWindow('chooser');
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
  leaveGame();
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
    const c = piecePaints(away, home, fav());
    const status = mapStatus(g.status);
    const when = pickerTab === 'later'
      ? new Date(g.gameDate).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
      : pickerTab === 'live' && g.linescore?.currentInning
        ? `${g.linescore.isTopInning ? '▲' : '▼'}${g.linescore.currentInning}`
        : status === 'final' ? `${S.ui.replay} ▶` : S.status(status, g.status.detailedState);
    // Scores are never shown here: picking a finished game must not spoil it.
    return `<button class="row${mine(g) ? ' mine' : ''}" data-pk="${g.gamePk}" data-mode="${pickerTab === 'final' ? 'replay' : 'live'}" ${pickerTab === 'final' && status !== 'final' ? 'disabled' : ''}>
      <span class="teams">${mine(g) ? '<span class="star">★</span>' : ''}${dot(c.away)}${esc(away)} @ ${esc(home)}${dot(c.home)}</span>
      <span class="when">${esc(when)}</span></button>`;
  }).join('');
  app.querySelector('.picker')!.innerHTML = `${pickerHeader()}
    <div class="tabs">${tabs}</div>
    <div class="list">${rows || `<div class="empty">${esc(S.ui.noGames)}</div>`}</div>
    ${pickerTab === 'final' ? `<div class="empty small">${esc(S.ui.scoresHidden)}</div>` : ''}`;
  pickerTimer = setTimeout(() => void showPicker(), 60_000);
}

// ---------- game: state ----------

let mode: 'live' | 'replay' = 'live';
let following = 0;
let speed = 1;
const SPEEDS = [1, 2, 4, 8];
/** Dev aid (--seek=<entry> [--paused]): jump a replay to an entry once it has loaded. */
let pendingSeek: { index: number; pause: boolean } | null = null;
/** Tabs above the game, each closable on its own. */
const tabOn = { clock: load('tab-clock') !== 'off', replay: load('tab-replay') !== 'off' };
let background: Background = 'solid';

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
const check = { steps: 0, bad: 0 };

interface Step { state: GameState; events: readonly GameEvent[]; text: readonly GameEvent[] }
const queue = new AnimationQueue<Step>(runStep, {
  // Skipped steps still count for the text: keep their plays so the latest line is right.
  merge: (skipped, newer) => ({ ...newer, text: [...skipped.text, ...newer.text] }),
});

const paintsOf = (s: GameState) => piecePaints(s.teams.away.abbr, s.teams.home.abbr, fav());
const look = (s: GameState) => ({ style, background, paints: paintsOf(s) });

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

// Tick once a second, touching only the clock's digits.
setInterval(() => {
  if (view !== 'game' || !tabOn.clock || !store.current) return;
  const el = tabsEl.querySelector('.clock-value');
  if (el) el.textContent = elapsed(store.current);
}, 1000);

/** A window too narrow for everything: the dot tier, or a squeezed bar. */
const isNarrow = () => app.clientWidth > 0 && app.clientWidth < 300;

function renderTabs(s: GameState | undefined): void {
  const items: string[] = [];
  const game = view === 'game';
  const narrow = isNarrow();
  if (game && s) {
    const time = elapsed(s);
    // Narrow: the clock alone, without its close button (the ⏱ control is in the menu of a wider window).
    if (tabOn.clock && time) items.push(`<span class="tab" title="${esc(S.ui.clock)}">⏱ <span class="mono clock-value">${time}</span>${narrow ? '' : '<button data-close="clock" aria-label="×">×</button>'}</span>`);
    if (tabOn.replay && mode === 'replay' && !narrow) {
      const date = dates.get(s.gamePk);
      items.push(`<span class="tab accent">${esc(S.ui.replay)}${date ? ` · ${shortDate(date)}` : ''}${speed > 1 ? ` · ${speed}×` : ''}<button data-close="replay" aria-label="×">×</button></span>`);
    }
  }
  tabsEl.innerHTML = game ? `${items.join('')}<span class="grow"></span>${controls()}` : '';
  document.body.classList.toggle('has-tabs', game);
}

function setTab(k: keyof typeof tabOn, on: boolean): void {
  tabOn[k] = on;
  save(`tab-${k}`, on ? 'on' : 'off');
  renderTabs(store.current);
}

function controls(): string {
  // A dot-sized window keeps only what it needs to get around.
  const narrow = isNarrow();
  const p = mode === 'replay' ? replay.player(following) : undefined;
  const toggle = mode === 'replay'
    ? `<button data-action="toggle" title="${esc(p && !p.playing && !p.done ? S.ui.play : S.ui.pause)}">${p && !p.playing && !p.done ? '▶' : '❚❚'}</button>`
    : '';
  const replayMore = mode === 'replay' && !narrow
    ? `<button data-action="speed" title="${esc(S.ui.speed)}">${speed}×</button><button data-action="next" title="${esc(S.ui.nextResult)}">⏭</button>`
    : '';
  const tabButtons = narrow ? '' : `<button data-action="clock" aria-pressed="${tabOn.clock}" title="${esc(S.ui.clock)}">⏱</button>`
    + (mode === 'replay' ? `<button data-action="replay-tab" aria-pressed="${tabOn.replay}">${esc(S.ui.replay)}</button>` : '');
  const sizeButton = `<button data-action="size" title="${esc(S.ui.size)}">⤢ ${esc(S.tier[tier])}</button>`;
  const styleTip = [S.ui.style, ...styleProblems].join('\n');
  const styleButton = narrow ? '' : `<button data-action="style" title="${esc(styleTip)}">◇ ${esc(style.name[lang])}</button>`;
  return `<span class="controls">${toggle}${replayMore}${tabButtons}${sizeButton}${styleButton}<button data-action="back">‹${narrow ? '' : ` ${esc(S.ui.back)}`}</button></span>`;
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
  if (how === 'replay' && speed !== 1) {
    // The player exists once the feed has loaded.
    const t = setInterval(() => { const p = replay.player(pk); if (p) { p.setSpeed(speed); clearInterval(t); } }, 100);
  }
}

const formatLine = (l: { who?: string; text: string }) => `${l.who ? `<b>${esc(l.who)}</b> ` : ''}${esc(l.text)}`;
/** Plays where the carry is worth a number in the bubble. */
const FAR = new Set(['single', 'double', 'triple', 'home_run', 'field_out', 'sac_fly']);

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
  const plan = planStep(scene, step.state, step.events);
  scene = plan.end;
  applyLines(step.text);
  if (!shown) {
    shown = step.state;
    buildGame();
    return;
  }
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
  if (dev.selfcheck) selfCheck(plan);
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

// ---------- game: drawing ----------

/** Redraws the board and the zone when their boxes change size (window resize, rows filling in below). */
let partObserver: ResizeObserver | null = null;

/** Build the game view for the current window size. */
function buildGame(): void {
  field?.dispose();
  field = null;
  partObserver?.disconnect();
  partObserver = null;
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
  const checkText = dev.selfcheck ? ` · check ${check.steps}/${check.bad} · ${frameStats()} · styles ${styles.length} style problems ${styleProblems.length}` : '';
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
  if (action === 'clock') { setTab('clock', !tabOn.clock); return; }
  if (action === 'replay-tab') { setTab('replay', !tabOn.replay); return; }
  if (action === 'size') { void cycleTier(); return; }
  if (action === 'style') {
    style = nextStyle(styles, style.id);
    save('style', style.id);
    applyStyle();
    buildGame();
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
  const t = (e.target as HTMLElement).closest('button');
  if (!t) return;
  const { day, tab, pk, action } = t.dataset;
  const close = t.dataset.close;
  if (close === 'clock' || close === 'replay') setTab(close, false);
  else if (t.dataset.fav) { favorite = t.dataset.fav; save('favorite', favorite); pickerTab = null; void showPicker(); }
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
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      void win.startDragging();
    });
  }
  document.getElementById('grip')!.addEventListener('mousedown', (e) => {
    e.preventDefault();
    void win.startResizeDragging('SouthEast');
  });
  void listen<string>('bg-mode', (e) => setBackground(e.payload, true));
}

function setBackground(m: string, persist: boolean): void {
  if (m !== 'solid' && m !== 'semi' && m !== 'clear') return;
  background = m;
  for (const el of [app, tabsEl]) {
    el.classList.remove('bg-solid', 'bg-semi', 'bg-clear');
    el.classList.add(`bg-${m}`);
  }
  if (persist) save('bg-mode', m);
  if (field && shown) field.setLook(look(shown));
}
setBackground(load('bg-mode') ?? 'solid', false);

// Open a game directly: `basesmall --game=<pk> [--mode=replay]` in the app, ?game=<pk>&mode=replay in a browser.
// Checking aids, never saved: --tier=dot|bar|field|full --style=<id> --bg=solid|semi|clear --speed=<n>
// --seek=<entry> [--paused] --selfcheck --press=<action>,<action> (control buttons, 2 s apart, once loaded).
async function start(): Promise<void> {
  const q = new URLSearchParams(location.search);
  if (inTauri) {
    for (const a of await invoke<string[]>('launch_args').catch(() => [] as string[])) {
      const m = /^--(game|mode|team|seek|tier|style|bg|speed|press)=(.+)$/.exec(a);
      if (m) q.set(m[1]!, m[2]!);
      if (a === '--paused') q.set('paused', '1');
      if (a === '--selfcheck') q.set('selfcheck', '1');
    }
  }
  await loadUserStyles();
  if (q.has('team')) { favorite = q.get('team')!; save('favorite', favorite); }
  if (q.has('seek')) pendingSeek = { index: Number(q.get('seek')), pause: q.has('paused') };
  const t = q.get('tier');
  if (t === 'dot' || t === 'bar' || t === 'field' || t === 'full') dev.tier = t;
  if (q.has('style')) { style = findStyle(styles, q.get('style')); applyStyle(); }
  if (q.has('bg')) setBackground(q.get('bg')!, false);
  if (q.has('speed')) dev.speed = Math.max(0.25, Number(q.get('speed')) || 1);
  if (q.has('selfcheck')) dev.selfcheck = true;
  const presses = (q.get('press') ?? '').split(',').filter(Boolean);
  presses.forEach((action, i) => setTimeout(() => replayAction(action), 6000 + i * 2000));
  // A checking run shares storage with the user's own copy of the app: it must not change their settings.
  if (['tier', 'style', 'bg', 'speed', 'seek', 'selfcheck', 'press'].some((k) => q.has(k))) dev.noSave = true;
  if (q.has('game')) follow(Number(q.get('game')), q.get('mode') === 'replay' ? 'replay' : 'live');
  else if (favorite === null) showChooser();
  else void showPicker();
}
void start();
