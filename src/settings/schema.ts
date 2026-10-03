// Every user setting, its default, and how a saved file is read back. Pure: tests run it on
// broken, old and hand-edited files. The file lives in the app config dir as settings.json.

export const SETTINGS_VERSION = 1;

export type Background = 'solid' | 'semi' | 'clear';
export type Language = 'auto' | 'zh-Hant' | 'en';
export type PaceSetting = 'compact' | 'real' | 'fixed' | 'results';
export type NotifyMode = 'toast' | 'marquee' | 'both' | 'off';
export type MarqueeSpot = 'top' | 'bottom' | 'bar';
/** The ten events a notification can be about (prototype settings screen). */
export const NOTIFY_KINDS = ['run', 'hr', 'hit', 'walk', 'k', 'out', 'sb', 'pchange', 'half', 'game'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type Size = { w: number; h: number };
/** What to do once the user's team is out for the season (PRD §3.3). */
export type AfterOut = 'tension' | 'adopt' | 'manual' | 'rest';
export const PANELS = ['zone', 'bases', 'matchup', 'linescore'] as const;
export type PanelName = (typeof PANELS)[number];
export const EXTRA_SOUNDS = ['strike', 'fullCount', 'bunt', 'strikeout'] as const;

export interface Settings {
  version: typeof SETTINGS_VERSION;
  /** Team abbreviation, 'none' for no team, null before the first choice. */
  favorite: string | null;
  language: Language;
  style: string;
  background: Background;
  tabs: { clock: boolean; replay: boolean; series: boolean };
  sound: {
    /** Master switch. Sound starts muted (PRD §6). */
    muted: boolean;
    /** 0 to 1. */
    volume: number;
    hit: boolean;
    homeRun: boolean;
    /** The quieter vocabulary (F13), each off until chosen. */
    strike: boolean;
    fullCount: boolean;
    bunt: boolean;
    strikeout: boolean;
  };
  replay: { pace: PaceSetting; showScores: boolean };
  follow: {
    after: AfterOut;
    /** The team adopted for the postseason ("adopt"), cleared when it ends. */
    adopted: string | null;
    /** Season and team the "what now?" card was shown for ("2026:PHI"), so it shows once. */
    seen: string;
  };
  /** The scoreboard drawer under the window is open. */
  scoreboard: boolean;
  /** Low-key mode: a plain, colourless status strip; no notices or sounds. */
  lowKey: boolean;
  hotkeys: { on: boolean; hide: string; lowKey: string };
  /** The optional windows that are open. */
  panels: Record<PanelName, boolean>;
  notify: {
    mode: NotifyMode;
    marquee: MarqueeSpot;
    events: Record<NotifyKind, boolean>;
    /** Only the user's team; with no team, only the game on screen. */
    onlyMine: boolean;
  };
  /** Window sizes: per view ('size-picker') and per game tier ('size-tier-field'). */
  sizes: Record<string, Size>;
}

export const DEFAULTS: Settings = {
  version: SETTINGS_VERSION,
  favorite: null,
  language: 'auto',
  style: 'iso',
  background: 'solid',
  tabs: { clock: true, replay: true, series: true },
  sound: { muted: true, volume: 0.6, hit: true, homeRun: true, strike: false, fullCount: false, bunt: false, strikeout: false },
  replay: { pace: 'compact', showScores: false },
  follow: { after: 'manual', adopted: null, seen: '' },
  scoreboard: false,
  lowKey: false,
  // Three modifiers: two-modifier combinations are often taken (Ctrl+Alt+L reformats code in some editors).
  hotkeys: { on: true, hide: 'CmdOrCtrl+Alt+Shift+B', lowKey: 'CmdOrCtrl+Alt+Shift+L' },
  panels: { zone: false, bases: false, matchup: false, linescore: false },
  notify: {
    mode: 'toast',
    marquee: 'bottom',
    // The prototype's defaults: the plays that change the game, not every pitch.
    events: { run: true, hr: true, hit: true, walk: false, k: false, out: true, sb: false, pchange: true, half: false, game: true },
    onlyMine: true,
  },
  sizes: {},
};

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  (options as readonly unknown[]).includes(v) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ABBR = /^[A-Z]{2,3}$/;
const STYLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function size(v: unknown): Size | undefined {
  const o = obj(v);
  const w = Number(o.w), h = Number(o.h);
  return Number.isFinite(w) && Number.isFinite(h) && w >= 100 && h >= 20 && w <= 10000 && h <= 10000
    ? { w: Math.round(w), h: Math.round(h) } : undefined;
}

/**
 * Read whatever was saved into a complete, valid Settings. Unknown fields are dropped, bad values
 * fall back to their defaults one by one, so a hand-edited typo never loses the rest of the file.
 */
export function normalize(raw: unknown): Settings {
  const o = obj(raw);
  const d = DEFAULTS;
  const fav = o.favorite;
  const sound = obj(o.sound), replay = obj(o.replay), notify = obj(o.notify), tabs = obj(o.tabs), events = obj(notify.events);
  const follow = obj(o.follow), hotkeys = obj(o.hotkeys), panels = obj(o.panels);
  const combo = (v: unknown, fallback: string) => (typeof v === 'string' && /^[A-Za-z0-9+]{0,60}$/.test(v) ? v : fallback);
  const volume = Number(sound.volume);
  const sizes: Record<string, Size> = {};
  for (const [k, v] of Object.entries(obj(o.sizes))) {
    const s = size(v);
    if (s && /^size-[a-z-]+$/.test(k)) sizes[k] = s;
  }
  return {
    version: SETTINGS_VERSION,
    favorite: fav === null || fav === 'none' || (typeof fav === 'string' && ABBR.test(fav)) ? (fav as string | null) : d.favorite,
    language: oneOf(o.language, ['auto', 'zh-Hant', 'en'], d.language),
    style: typeof o.style === 'string' && STYLE_ID.test(o.style) ? o.style : d.style,
    background: oneOf(o.background, ['solid', 'semi', 'clear'], d.background),
    tabs: { clock: bool(tabs.clock, d.tabs.clock), replay: bool(tabs.replay, d.tabs.replay), series: bool(tabs.series, d.tabs.series) },
    sound: {
      muted: bool(sound.muted, d.sound.muted),
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : d.sound.volume,
      hit: bool(sound.hit, d.sound.hit),
      homeRun: bool(sound.homeRun, d.sound.homeRun),
      strike: bool(sound.strike, d.sound.strike),
      fullCount: bool(sound.fullCount, d.sound.fullCount),
      bunt: bool(sound.bunt, d.sound.bunt),
      strikeout: bool(sound.strikeout, d.sound.strikeout),
    },
    replay: { pace: oneOf(replay.pace, ['compact', 'real', 'fixed', 'results'], d.replay.pace), showScores: bool(replay.showScores, d.replay.showScores) },
    follow: {
      after: oneOf(follow.after, ['tension', 'adopt', 'manual', 'rest'], d.follow.after),
      adopted: typeof follow.adopted === 'string' && ABBR.test(follow.adopted) ? follow.adopted : null,
      seen: typeof follow.seen === 'string' && /^(\d{4}:[A-Z]{2,3})?$/.test(follow.seen) ? follow.seen : '',
    },
    scoreboard: bool(o.scoreboard, d.scoreboard),
    lowKey: bool(o.lowKey, d.lowKey),
    hotkeys: { on: bool(hotkeys.on, d.hotkeys.on), hide: combo(hotkeys.hide, d.hotkeys.hide), lowKey: combo(hotkeys.lowKey, d.hotkeys.lowKey) },
    panels: Object.fromEntries(PANELS.map((p) => [p, bool(panels[p], false)])) as Record<PanelName, boolean>,
    notify: {
      mode: oneOf(notify.mode, ['toast', 'marquee', 'both', 'off'], d.notify.mode),
      marquee: oneOf(notify.marquee, ['top', 'bottom', 'bar'], d.notify.marquee),
      events: Object.fromEntries(NOTIFY_KINDS.map((k) => [k, bool(events[k], d.notify.events[k])])) as Record<NotifyKind, boolean>,
      onlyMine: bool(notify.onlyMine, d.notify.onlyMine),
    },
    sizes,
  };
}

/** Settings from before the settings file (M2–M3 kept them in the web view's localStorage). */
export function fromLocalStorage(get: (key: string) => string | null): Settings {
  const sizes: Record<string, unknown> = {};
  for (const k of ['size-chooser', 'size-picker', 'size-game', 'size-tier-dot', 'size-tier-bar', 'size-tier-field', 'size-tier-full']) {
    try { const v = get(k); if (v) sizes[k] = JSON.parse(v); } catch { /* skip a bad entry */ }
  }
  return normalize({
    favorite: get('favorite'),
    style: get('style') ?? undefined,
    background: get('bg-mode') ?? undefined,
    tabs: { clock: get('tab-clock') !== 'off', replay: get('tab-replay') !== 'off' },
    sizes,
  });
}
