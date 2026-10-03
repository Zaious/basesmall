// UI strings and event text, Traditional Chinese and English. Event text is built from
// structured events (never from MLB's English description), so both languages read naturally.
// Player names are not translated.

import type { GameEvent, GameStatus, Half, Hand, PitchMark } from '../model/types.ts';
import type { Tier } from '../render/tiers.ts';
import type { NotifyKind } from '../settings/schema.ts';

export type Lang = 'zh-Hant' | 'en';
export const LANGS: readonly Lang[] = ['zh-Hant', 'en'];

export function detectLang(locale: string | undefined): Lang {
  return locale?.toLowerCase().startsWith('zh') ? 'zh-Hant' : 'en';
}

const LOC_ZH: Record<string, string> = { 1: '投手', 2: '捕手', 3: '一壘', 4: '二壘', 5: '三壘', 6: '游擊', 7: '左外野', 8: '中外野', 9: '右外野', 78: '左中間', 89: '右中間', 56: '三游間', 34: '一二壘間' };
const LOC_EN: Record<string, string> = { 1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 78: 'LCF', 89: 'RCF', 56: 'SS-3B', 34: '1B-2B' };
const OUTFIELD = new Set(['7', '8', '9', '78', '89']);
const REASON_ZH: Record<string, string> = {
  Rain: '雨', Snow: '雪', 'Wet Grounds': '場地濕滑', Fog: '霧', Cold: '低溫', Wind: '強風', Lightning: '雷電',
  Power: '停電', 'Air Quality': '空氣品質', Venue: '場地', 'Inclement Weather': '天候', Ceremony: '典禮',
};

type PA = Extract<GameEvent, { type: 'plateAppearance' }>;

/** Every code in MLB's /api/v1/pitchTypes. */
const PITCH_TYPE: Record<string, { zh: string; en: string }> = {
  FA: { zh: '速球', en: 'Fastball' }, FF: { zh: '四縫線', en: '4-Seam' }, FT: { zh: '二縫線', en: '2-Seam' },
  FC: { zh: '卡特', en: 'Cutter' }, FS: { zh: '指叉', en: 'Splitter' }, FO: { zh: '叉球', en: 'Forkball' },
  SI: { zh: '伸卡', en: 'Sinker' }, ST: { zh: '橫掃', en: 'Sweeper' }, SL: { zh: '滑球', en: 'Slider' },
  CU: { zh: '曲球', en: 'Curve' }, KC: { zh: '彈指曲', en: 'K-Curve' }, SC: { zh: '螺旋球', en: 'Screwball' },
  GY: { zh: '陀螺球', en: 'Gyroball' }, SV: { zh: '滑曲', en: 'Slurve' }, CS: { zh: '慢曲', en: 'Slow curve' },
  CH: { zh: '變速', en: 'Changeup' }, KN: { zh: '蝴蝶球', en: 'Knuckleball' }, EP: { zh: '慢速球', en: 'Eephus' },
  UN: { zh: '不明', en: 'Unknown' }, IN: { zh: '故意壞球', en: 'Intentional ball' }, PO: { zh: '故意外角球', en: 'Pitchout' },
  AB: { zh: '自動壞球', en: 'Automatic ball' }, AS: { zh: '自動好球', en: 'Automatic strike' }, NP: { zh: '未投球', en: 'No pitch' },
};
const CALL: Record<PitchMark['call'], { zh: string; en: string }> = {
  ball: { zh: '壞球', en: 'Ball' }, calledStrike: { zh: '好球', en: 'Called strike' },
  swingingStrike: { zh: '揮空', en: 'Swinging strike' }, foul: { zh: '界外', en: 'Foul' },
  inPlay: { zh: '擊出', en: 'In play' }, hitByPitch: { zh: '觸身', en: 'Hit by pitch' }, other: { zh: '', en: '' },
};

/** The call alone: "Foul", "界外". */
export function callWord(call: PitchMark['call'], lang: Lang): string {
  return CALL[call][lang === 'zh-Hant' ? 'zh' : 'en'];
}

/** "4-Seam 95 · Called strike": one pitch, short enough for the score bar. */
export function pitchLine(p: PitchMark, lang: Lang): string {
  const k = lang === 'zh-Hant' ? 'zh' : 'en';
  const type = p.type ? PITCH_TYPE[p.type]?.[k] ?? p.type : '';
  const speed = p.speed ? Math.round(p.speed) : '';
  return [[type, speed].filter(Boolean).join(' '), CALL[p.call][k]].filter(Boolean).join(' · ');
}

interface Strings {
  inning(n: number, half: Half): string;
  outs(n: number): string;
  pitches(n: number): string;
  status(status: GameStatus, detail?: string): string;
  result(pa: PA): string;
  baserunning(kind: string): string;
  pitchingChange: string;
  automaticBall: string;
  automaticStrike: string;
  /** "Right-handed batter" in a few characters. */
  bats(h: Hand): string;
  throws(h: Hand): string;
  feet(n: number): string;
  /** Size tiers of the main window. */
  tier: Record<Tier, string>;
  /** Notifications: the event names in settings, and notice titles. */
  notify: {
    kinds: Record<NotifyKind, string>;
    run: string; hr: string; hit: string; walk: string; k: string; out: string; sb: string; pchange: string;
    halfOver(inning: string): string;
    gameStart: string;
    gameEnd: string;
    replay: string;
    close: string;
  };
  /** The settings screen. */
  set: {
    title: string; done: string;
    team: string; change: string;
    background: string; bg: Record<'solid' | 'semi' | 'clear', string>;
    language: string; auto: string;
    tabs: string;
    sound: string; soundOn: string; volume: string; hit: string; homeRun: string; preview: string; soundBlocked: string;
    notify: string; mode: string; modes: Record<'toast' | 'marquee' | 'both' | 'off', string>;
    spot: string; spots: Record<'top' | 'bottom' | 'bar', string>;
    events: string; onlyMine: string;
    replay: string; pace: string; paces: Record<'compact' | 'real' | 'fixed' | 'results', string>; showScores: string;
    about: string; aboutText: string; support: string; source: string; stylesFolder: string;
  };
  ui: Record<
    'today' | 'live' | 'later' | 'final' | 'noGames' | 'loading' | 'reconnecting' | 'replay' | 'back' |
    'pickGame' | 'scoresHidden' | 'prevDay' | 'nextDay' | 'loadFailed' |
    'play' | 'pause' | 'speed' | 'nextResult' | 'chooseTeam' | 'chooseTeamHint' | 'noFavorite' | 'favorite' | 'clock' |
    'size' | 'style' | 'pitcher' | 'batter' | 'todayLine' | 'noPitchData',
    string
  >;
}

const zh: Strings = {
  inning: (n, h) => `${n} 局${h === 'top' ? '上' : '下'}`,
  outs: (n) => `${n} 出局`,
  pitches: (n) => `${n} 球`,
  status(s, d) {
    const reason = d?.split(':')[1]?.trim();
    const why = reason ? REASON_ZH[reason] ?? reason : '';
    switch (s) {
      case 'scheduled': return '尚未開賽';
      case 'pregame': return '賽前';
      case 'delayed': return why ? `因${why}延遲` : '延遲';
      case 'review': return '挑戰／重播審查中';
      case 'suspended': return why ? `因${why}暫停` : '暫停';
      case 'postponed': return why ? `因${why}延賽` : '延賽';
      case 'cancelled': return '取消';
      case 'final': return d?.startsWith('Completed Early') ? (why ? `因${why}提前結束` : '提前結束') : '終場';
      case 'live': return '比賽中';
      default: return '';
    }
  },
  result(r) {
    const loc = LOC_ZH[r.ball?.location ?? ''] ?? '';
    const dir = loc && !OUTFIELD.has(r.ball?.location ?? '') ? `${loc}方向` : loc;
    const rbi = r.rbi > 0 && r.result !== 'home_run' ? ` · 打點 ${r.rbi}` : '';
    const traj: Record<string, string> = { ground_ball: '滾地球', fly_ball: '飛球', line_drive: '平飛球', popup: '內野飛球', bunt_grounder: '觸擊', bunt_popup: '觸擊飛球' };
    const base = (() => {
      switch (r.result) {
        case 'home_run': return loc + (['陽春砲', '陽春砲', '兩分砲', '三分砲', '滿貫砲'][r.rbi] ?? '全壘打');
        case 'single': return `${dir}一壘安打`;
        case 'double': return `${dir}二壘安打`;
        case 'triple': return `${dir}三壘安打`;
        case 'field_out': return `${loc}${traj[r.ball?.trajectory ?? ''] ?? ''}出局`;
        case 'force_out': return `${loc}封殺`;
        case 'grounded_into_double_play': return `${loc}雙殺打`;
        case 'grounded_into_triple_play': case 'triple_play': return '三殺';
        case 'double_play': return '雙殺';
        case 'fielders_choice': case 'fielders_choice_out': return '野手選擇';
        case 'strikeout': case 'strike_out': return '三振';
        case 'strikeout_double_play': return '三振雙殺';
        case 'walk': return '保送';
        case 'intent_walk': return '故意四壞';
        case 'hit_by_pitch': return '觸身球';
        case 'sac_bunt': return '犧牲觸擊';
        case 'sac_fly': return `${loc}高飛犧牲打`;
        case 'field_error': return `${loc}失誤上壘`;
        case 'catcher_interf': return '捕手妨礙';
        default: return '';
      }
    })();
    return base + rbi;
  },
  baserunning(k) {
    if (k.startsWith('stolen_base')) return k.endsWith('home') ? '盜回本壘' : k.endsWith('3b') ? '盜上三壘' : '盜上二壘';
    if (k.startsWith('caught_stealing') || k.startsWith('pickoff_caught_stealing')) return '盜壘失敗';
    if (k.startsWith('pickoff_error')) return '牽制失誤';
    if (k.startsWith('pickoff')) return '牽制出局';
    return { wild_pitch: '暴投', passed_ball: '捕逸', balk: '投手犯規', forced_balk: '投手犯規', defensive_indiff: '無防守盜壘', error: '失誤進壘' }[k] ?? '';
  },
  pitchingChange: '換投',
  automaticBall: '自動壞球',
  automaticStrike: '自動好球',
  bats: (h) => (h === 'L' ? '左打' : '右打'),
  throws: (h) => (h === 'L' ? '左投' : '右投'),
  feet: (n) => `${n} 呎`,
  tier: { dot: '點', bar: '條', field: '場', full: '全' },
  notify: {
    kinds: { run: '得分', hr: '全壘打', hit: '安打', walk: '保送／觸身', k: '三振', out: '出局數變化', sb: '盜壘', pchange: '換投', half: '半局結束', game: '開賽／終場' },
    run: '得分', hr: '全壘打', hit: '安打', walk: '上壘', k: '三振', out: '出局', sb: '盜壘', pchange: '換投',
    halfOver: (inning) => `${inning}結束`,
    gameStart: '開賽', gameEnd: '終場', replay: '重播', close: '關閉通知',
  },
  set: {
    title: '設定', done: '完成',
    team: '主隊', change: '更改',
    background: '背景', bg: { solid: '實底', semi: '半透明', clear: '全透明' },
    language: '語言', auto: '跟隨系統',
    tabs: '頁籤',
    sound: '音效', soundOn: '開啟音效', volume: '音量', hit: '安打', homeRun: '全壘打', preview: '試聽',
    soundBlocked: '系統還不讓這個視窗發聲，點一下視窗任何地方就好',
    notify: '通知', mode: '方式', modes: { toast: '右下角', marquee: '跑馬燈', both: '兩者', off: '關閉' },
    spot: '跑馬燈位置', spots: { top: '螢幕上緣', bottom: '螢幕下緣', bar: '貼控制條' },
    events: '要通知的事件', onlyMine: '只通知我追蹤的球隊',
    replay: '重播', pace: '節奏', paces: { compact: '緊湊', real: '原速', fixed: '每球 5 秒', results: '只看結果' }, showScores: '選場時顯示比分',
    about: '關於', aboutText: '非官方的球迷專案，與 MLB、MLBAM、球員工會或任何球隊無關。比賽資料來自 MLB Stats API，由你的電腦直接取得，僅供個人、非商業使用。',
    support: '請我喝杯咖啡', source: '原始碼', stylesFolder: '自訂風格資料夾',
  },
  ui: {
    today: '今日比賽', live: '直播中', later: '稍後', final: '已結束', noGames: '這天沒有比賽', loading: '載入中',
    reconnecting: '連線中斷，重試中', replay: '重播', back: '回清單', pickGame: '選一場比賽',
    scoresHidden: '不顯示比分', prevDay: '前一天', nextDay: '後一天', loadFailed: '讀不到賽程，稍後重試',
    play: '播放', pause: '暫停', speed: '速度', nextResult: '下一個結果',
    chooseTeam: '你的主隊是？', chooseTeamHint: '主隊的比賽會排在最前面，撞色時主隊保留原色。之後可以改。',
    noFavorite: '不指定', favorite: '主隊', clock: '比賽經過時間',
    size: '尺寸（也可以拖曳右下角）', style: '風格', pitcher: '投', batter: '打', todayLine: '今日', noPitchData: '此場無落點資料',
  },
};

const en: Strings = {
  inning: (n, h) => `${h === 'top' ? 'Top' : 'Bot'} ${n}`,
  outs: (n) => `${n} out`,
  pitches: (n) => `${n}p`,
  status(s, d) {
    const reason = d?.split(':')[1]?.trim();
    switch (s) {
      case 'scheduled': return 'Scheduled';
      case 'pregame': return 'Pre-game';
      case 'delayed': return reason ? `Delayed: ${reason}` : 'Delayed';
      case 'review': return 'Under review';
      case 'suspended': return reason ? `Suspended: ${reason}` : 'Suspended';
      case 'postponed': return reason ? `Postponed: ${reason}` : 'Postponed';
      case 'cancelled': return 'Cancelled';
      case 'final': return d?.startsWith('Completed Early') ? `Completed early${reason ? `: ${reason}` : ''}` : 'Final';
      case 'live': return 'Live';
      default: return '';
    }
  },
  result(r) {
    const loc = LOC_EN[r.ball?.location ?? ''];
    const to = loc ? ` to ${loc}` : '';
    const rbi = r.rbi > 0 && r.result !== 'home_run' ? ` · ${r.rbi} RBI` : '';
    const traj: Record<string, string> = { ground_ball: 'Groundout', fly_ball: 'Flyout', line_drive: 'Lineout', popup: 'Popout', bunt_grounder: 'Bunt groundout', bunt_popup: 'Bunt popout' };
    const base = (() => {
      switch (r.result) {
        case 'home_run': return (['Solo HR', 'Solo HR', '2-run HR', '3-run HR', 'Grand slam'][r.rbi] ?? 'Home run') + to;
        case 'single': return `Single${to}`;
        case 'double': return `Double${to}`;
        case 'triple': return `Triple${to}`;
        case 'field_out': return `${traj[r.ball?.trajectory ?? ''] ?? 'Out'}${to}`;
        case 'force_out': return 'Force out';
        case 'grounded_into_double_play': return 'Grounds into DP';
        case 'grounded_into_triple_play': case 'triple_play': return 'Triple play';
        case 'double_play': return 'Double play';
        case 'fielders_choice': case 'fielders_choice_out': return "Fielder's choice";
        case 'strikeout': case 'strike_out': return 'Strikeout';
        case 'strikeout_double_play': return 'Strikeout DP';
        case 'walk': return 'Walk';
        case 'intent_walk': return 'Intentional walk';
        case 'hit_by_pitch': return 'Hit by pitch';
        case 'sac_bunt': return 'Sac bunt';
        case 'sac_fly': return `Sac fly${to}`;
        case 'field_error': return 'Reaches on error';
        case 'catcher_interf': return "Catcher's interference";
        default: return '';
      }
    })();
    return base + rbi;
  },
  baserunning(k) {
    if (k.startsWith('stolen_base')) return k.endsWith('home') ? 'Steals home' : k.endsWith('3b') ? 'Steals 3rd' : 'Steals 2nd';
    if (k.startsWith('caught_stealing') || k.startsWith('pickoff_caught_stealing')) return 'Caught stealing';
    if (k.startsWith('pickoff_error')) return 'Pickoff error';
    if (k.startsWith('pickoff')) return 'Picked off';
    return { wild_pitch: 'Wild pitch', passed_ball: 'Passed ball', balk: 'Balk', forced_balk: 'Balk', defensive_indiff: 'Defensive indifference', error: 'Advances on error' }[k] ?? '';
  },
  pitchingChange: 'Pitching change',
  automaticBall: 'Automatic ball',
  automaticStrike: 'Automatic strike',
  bats: (h) => (h === 'L' ? 'LHB' : 'RHB'),
  throws: (h) => (h === 'L' ? 'LHP' : 'RHP'),
  feet: (n) => `${n} ft`,
  tier: { dot: 'Dot', bar: 'Bar', field: 'Field', full: 'Full' },
  notify: {
    kinds: { run: 'Runs', hr: 'Home runs', hit: 'Hits', walk: 'Walks / HBP', k: 'Strikeouts', out: 'Outs', sb: 'Stolen bases', pchange: 'Pitching changes', half: 'End of half-inning', game: 'Start / final' },
    run: 'Run', hr: 'Home run', hit: 'Hit', walk: 'On base', k: 'Strikeout', out: 'Out', sb: 'Stolen base', pchange: 'Pitching change',
    halfOver: (inning) => `End of ${inning}`,
    gameStart: 'First pitch', gameEnd: 'Final', replay: 'Replay', close: 'Close notification',
  },
  set: {
    title: 'Settings', done: 'Done',
    team: 'My team', change: 'Change',
    background: 'Background', bg: { solid: 'Solid', semi: 'Translucent', clear: 'Clear' },
    language: 'Language', auto: 'System',
    tabs: 'Tabs',
    sound: 'Sound', soundOn: 'Sound on', volume: 'Volume', hit: 'Hit', homeRun: 'Home run', preview: 'Play',
    soundBlocked: 'The system wants a click before this window makes sound: click anywhere in it',
    notify: 'Notifications', mode: 'Show as', modes: { toast: 'Corner', marquee: 'Ticker', both: 'Both', off: 'Off' },
    spot: 'Ticker position', spots: { top: 'Top of screen', bottom: 'Bottom of screen', bar: 'Under the window' },
    events: 'Notify me about', onlyMine: 'Only my team',
    replay: 'Replay', pace: 'Pace', paces: { compact: 'Compact', real: 'Real time', fixed: '5 s a pitch', results: 'Results only' }, showScores: 'Show scores when picking',
    about: 'About', aboutText: 'An unofficial fan project, not affiliated with MLB, MLBAM, the MLBPA or any team. Game data comes from the MLB Stats API, fetched by your own computer, for personal, non-commercial use.',
    support: 'Buy me a coffee', source: 'Source code', stylesFolder: 'Custom styles folder',
  },
  ui: {
    today: "Today's games", live: 'Live', later: 'Later', final: 'Final', noGames: 'No games this day', loading: 'Loading',
    reconnecting: 'Connection lost, retrying', replay: 'Replay', back: 'Back', pickGame: 'Pick a game',
    scoresHidden: 'Scores hidden', prevDay: 'Previous day', nextDay: 'Next day', loadFailed: "Couldn't load the schedule, retrying",
    play: 'Play', pause: 'Pause', speed: 'Speed', nextResult: 'Next result',
    chooseTeam: 'Which team is yours?', chooseTeamHint: 'Its games come first, and it keeps its colour when two teams clash. You can change this later.',
    noFavorite: 'No team', favorite: 'My team', clock: 'Game time',
    size: 'Size (or drag the bottom-right corner)', style: 'Style', pitcher: 'P', batter: 'AB', todayLine: 'Today', noPitchData: 'No pitch locations for this game',
  },
};

export const STRINGS: Record<Lang, Strings> = { 'zh-Hant': zh, en };

/** One line for an event, or null when the event is not worth a line on its own. */
export function eventLine(ev: GameEvent, lang: Lang): { who?: string; text: string } | null {
  const s = STRINGS[lang];
  switch (ev.type) {
    case 'plateAppearance': { const text = s.result(ev); return text ? { who: ev.batter.short, text } : null; }
    case 'baserunning': { const text = s.baserunning(ev.kind); return text ? { ...(ev.runner ? { who: ev.runner.short } : {}), text } : null; }
    case 'pitchingChange': return { who: ev.pitcher.short, text: s.pitchingChange };
    case 'automaticCall': return { text: ev.call === 'ball' ? s.automaticBall : s.automaticStrike };
    default: return null;
  }
}
