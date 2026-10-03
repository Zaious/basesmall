// UI strings and event text, Traditional Chinese and English. Event text is built from
// structured events (never from MLB's English description), so both languages read naturally.
// Player names are not translated.

import type { GameEvent, GameStatus, Half } from '../model/types.ts';

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
  ui: Record<
    'today' | 'live' | 'later' | 'final' | 'noGames' | 'loading' | 'reconnecting' | 'replay' | 'back' |
    'pickGame' | 'scoresHidden' | 'prevDay' | 'nextDay' | 'loadFailed',
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
  ui: {
    today: '今日比賽', live: '直播中', later: '稍後', final: '已結束', noGames: '這天沒有比賽', loading: '載入中',
    reconnecting: '連線中斷，重試中', replay: '重播', back: '回清單', pickGame: '選一場比賽',
    scoresHidden: '不顯示比分', prevDay: '前一天', nextDay: '後一天', loadFailed: '讀不到賽程，稍後重試',
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
  ui: {
    today: "Today's games", live: 'Live', later: 'Later', final: 'Final', noGames: 'No games this day', loading: 'Loading',
    reconnecting: 'Connection lost, retrying', replay: 'Replay', back: 'Back', pickGame: 'Pick a game',
    scoresHidden: 'Scores hidden', prevDay: 'Previous day', nextDay: 'Next day', loadFailed: "Couldn't load the schedule, retrying",
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
