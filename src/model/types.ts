// Normalized game model. Everything downstream of an adapter (store, animation,
// renderers, audio, notifications) sees only these types, never a league's raw JSON.

export type Side = 'away' | 'home';
export type Half = 'top' | 'bottom';
export type Base = '1B' | '2B' | '3B';
export type Hand = 'L' | 'R';

export type GameStatus =
  | 'scheduled'
  | 'pregame'
  | 'live'
  | 'delayed'
  /** A manager challenge or umpire review is in progress. */
  | 'review'
  | 'suspended'
  | 'postponed'
  | 'cancelled'
  | 'final'
  | 'unknown';

export interface PlayerRef {
  id: number;
  /** Full name as the league spells it. Player names are not translated. */
  name: string;
  /** Short form for tight layouts, usually the last name. */
  short: string;
}

export interface TeamRef {
  id: number;
  abbr: string;
  name: string;
}

export type PitchCall =
  | 'ball'
  | 'calledStrike'
  | 'swingingStrike'
  | 'foul'
  | 'inPlay'
  | 'hitByPitch'
  | 'other';

/** One pitch of the current plate appearance, for the strike-zone view. */
export interface PitchMark {
  /** 1-based pitch number within the plate appearance. */
  n: number;
  call: PitchCall;
  /** League's raw call code, kept for debugging and for calls we do not map. */
  callCode: string;
  /** Horizontal position at the plate in feet, catcher's view, 0 = centre. Absent before 2008. */
  x?: number;
  /** Height at the plate in feet. Absent before 2008. */
  z?: number;
  szTop?: number;
  szBottom?: number;
  /** 1–9 inside the zone, 11–14 outside. */
  zone?: number;
  /** Pitch type code such as FF or SL; display names come from i18n. */
  type?: string;
  /** Release speed, mph. */
  speed?: number;
}

export interface BattedBall {
  /** Fielder position the ball went to, as the league reports it (e.g. "7", "89"). */
  location?: string;
  trajectory?: string;
  hardness?: string;
  /** Landing or fielding point in the league's field-image coordinates. */
  coordX?: number;
  coordY?: number;
  launchSpeed?: number;
  launchAngle?: number;
  distance?: number;
}

export type RunnerFrom = Base | 'batter';
export type RunnerTo = Base | 'home' | 'out';

export type GameEvent =
  | { type: 'inningChange'; inning: number; half: Half }
  | { type: 'pitch'; pitch: PitchMark }
  /** Automatic ball or strike with no pitch thrown (intentional walk, pitch-clock violation). */
  | { type: 'automaticCall'; call: 'ball' | 'strike'; description: string }
  | { type: 'ballInPlay'; ball: BattedBall }
  /** A runner appears on a base without a play: the extra-innings runner, or a pinch runner (`replaces`). */
  | { type: 'runnerPlaced'; runner: PlayerRef; base: Base; replaces?: PlayerRef }
  | { type: 'runnerAdvance'; runner: PlayerRef; from: RunnerFrom; to: RunnerTo; cause: string }
  | { type: 'scoreChange'; side: Side; runs: number; score: Record<Side, number> }
  /** Stolen base, wild pitch, pickoff and other runner events that happen between pitches. */
  | { type: 'baserunning'; kind: string; runner?: PlayerRef }
  | { type: 'pitchingChange'; side: Side; pitcher: PlayerRef }
  /** End of a plate appearance. `result` is the league's event code; text comes from i18n templates. */
  | { type: 'plateAppearance'; result: string; rbi: number; batter: PlayerRef; isOut: boolean; ball?: BattedBall }
  | { type: 'gameEnd'; winner: Side | 'tie'; score: Record<Side, number> };

export interface BatterState extends PlayerRef {
  side: Hand;
  /** Today's at-bats and hits, including a plate appearance that completes in this entry. */
  today: { ab: number; h: number };
}

export interface PitcherState extends PlayerRef {
  hand: Hand;
  /** Pitches thrown in this game so far. */
  pitches: number;
}

export interface GameState {
  gamePk: number;
  status: GameStatus;
  /** League's own status text, e.g. "Delayed: Rain"; the UI translates the parts it knows. */
  statusDetail?: string;
  teams: Record<Side, TeamRef>;
  inning: number;
  half: Half;
  outs: number;
  balls: number;
  strikes: number;
  /** Only occupied bases have a key. */
  bases: Partial<Record<Base, PlayerRef>>;
  score: Record<Side, number>;
  hits: Record<Side, number>;
  errors: Record<Side, number>;
  /** Runs per inning; `null` for a half-inning that has not started. */
  linescore: Record<Side, (number | null)[]>;
  batter?: BatterState;
  pitcher?: PitcherState;
  /** Pitches of the current plate appearance. */
  atBat: PitchMark[];
}

/**
 * One step of a game: the events that happened at one moment, in causal order
 * (pitch, then ball in play, then runners, then score, then the plate-appearance result),
 * and the state after them.
 */
export interface TimelineEntry {
  /** Epoch milliseconds of the source event. */
  t: number;
  /** Plate-appearance index within the game. */
  play: number;
  /** Event index within the plate appearance. Synthetic entries: -1 game end, -2 a live plate
   *  appearance that has started but has no events yet. */
  event: number;
  events: GameEvent[];
  state: GameState;
}

export type Unsubscribe = () => void;

export interface GameHandlers {
  onEvent(event: GameEvent, entry: TimelineEntry): void;
  onState(state: GameState, entry: TimelineEntry): void;
  onError?(error: unknown): void;
}

/** A source of one game's events. MLB live, MLB replay, and any future league implement this. */
export interface GameSource {
  subscribe(gamePk: number, handlers: GameHandlers): Unsubscribe;
}
