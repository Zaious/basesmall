// Every MLB code the adapter can meet, classified on purpose. Source: MLB's own catalogues
// (/api/v1/eventTypes, /api/v1/pitchCodes, /api/v1/gameStatus, fetched 2026-10-03).
// tests/codes.test.ts fails when MLB adds a code that is not listed here.

import type { GameStatus, PitchCall } from '../../model/types.ts';

// ---------- pitch codes ----------

/** Codes on real pitches (MLB pitchStatus = true). */
export const PITCH_CALL: Readonly<Record<string, PitchCall>> = {
  B: 'ball', '*B': 'ball', I: 'ball', P: 'ball',
  H: 'hitByPitch',
  C: 'calledStrike',
  K: 'calledStrike', // "Strike - Unknown": a strike of unrecorded kind; shown as a strike
  S: 'swingingStrike', W: 'swingingStrike', Q: 'swingingStrike', M: 'swingingStrike',
  T: 'swingingStrike', O: 'swingingStrike', // foul tips are caught swinging strikes
  F: 'foul', L: 'foul', R: 'foul',
  X: 'inPlay', D: 'inPlay', E: 'inPlay', Y: 'inPlay', J: 'inPlay', Z: 'inPlay',
};

/** Automatic balls and strikes with no pitch thrown: pitch timer, batter timeout,
 *  intentional walk, shift violation. */
export const AUTOMATIC_CALL: Readonly<Record<string, 'ball' | 'strike'>> = {
  V: 'ball', VB: 'ball', VC: 'ball', VP: 'ball', VS: 'ball',
  A: 'strike', AB: 'strike', AC: 'strike',
};

/** Codes that are not pitches and do not change the count. */
export const NON_PITCH_CODES: ReadonlySet<string> = new Set([
  'N', '.', 'PSO', // no pitch, non pitch, pitcher step off
  '1', '2', '3', '+1', '+2', '+3', // pickoff throws by pitcher (digits) or catcher (+)
]);

// ---------- event types ----------

export const HIT_EVENTS: ReadonlySet<string> = new Set(['single', 'double', 'triple', 'home_run']);

/** Plate-appearance results charged as an official at-bat. */
export const AT_BAT_EVENTS: ReadonlySet<string> = new Set([
  ...HIT_EVENTS,
  'field_out', 'force_out', 'fielders_choice', 'fielders_choice_out', 'field_error',
  'double_play', 'triple_play', 'grounded_into_double_play', 'grounded_into_triple_play',
  'strikeout', 'strike_out', 'strikeout_double_play', 'strikeout_triple_play',
  'batter_interference', // batter is out on the play
  'fan_interference', // umpire awards the result the play would have had; scored as an at-bat
  'os_ruling_pending_primary', // official scorer has not ruled yet; counted until corrected
]);

/** Plate-appearance results that are not at-bats. */
export const NON_AT_BAT_EVENTS: ReadonlySet<string> = new Set([
  'walk', 'intent_walk', 'hit_by_pitch',
  'sac_fly', 'sac_fly_double_play', 'sac_bunt', 'sac_bunt_double_play',
  'catcher_interf', 'fielder_interference',
  'runner_interference', // a runner is out for interfering; recorded as a plate-appearance result
]);

/** Runner events between pitches. They get their own timeline entry. */
export const BASERUNNING_EVENTS: ReadonlySet<string> = new Set([
  'stolen_base', 'stolen_base_2b', 'stolen_base_3b', 'stolen_base_home',
  'caught_stealing', 'caught_stealing_2b', 'caught_stealing_3b', 'caught_stealing_home',
  'pickoff_1b', 'pickoff_2b', 'pickoff_3b',
  'pickoff_error_1b', 'pickoff_error_2b', 'pickoff_error_3b',
  'pickoff_caught_stealing_2b', 'pickoff_caught_stealing_3b', 'pickoff_caught_stealing_home',
  'wild_pitch', 'passed_ball', 'balk', 'forced_balk', 'defensive_indiff',
  'error', 'other_advance', 'other_out', 'cs_double_play', 'runner_double_play',
  'os_ruling_pending_prior',
]);

/** Non-pitch events the adapter acts on specially. */
export const HANDLED_ACTIONS: ReadonlySet<string> = new Set([
  'runner_placed', // extra-innings runner on 2B
  'pitching_substitution',
  'offensive_substitution', // only pinch runners change the board
]);

/** Events that do not change what the board shows. Listed so new codes are noticed. */
export const IGNORED_EVENTS: ReadonlySet<string> = new Set([
  'no_pitch', // its count change, if any, is read from the pitch code
  'pitcher_step_off', 'batter_timeout', 'mound_visit', 'batter_turn', 'at_bat_start',
  'defensive_switch', 'defensive_substitution', 'umpire_substitution',
  'pitcher_switch', // a switch-pitcher changes arms; hand is read per plate appearance
  'ejection', 'injury',
  'game_advisory', // status text; the game status comes from gameData.status
]);

// ---------- game status ----------

/**
 * MLB status -> our status. Keyed by abstract state and coded state together: the same
 * letter means different things under different abstract states ('T' is "Scheduled: COVID-19"
 * in Preview and "Suspended" in Live).
 */
export function mapStatus(status: { abstractGameState?: string; codedGameState?: string; detailedState?: string }): GameStatus {
  const a = status.abstractGameState ?? '';
  const c = status.codedGameState ?? '';
  const d = (status.detailedState ?? '').toLowerCase();
  switch (a) {
    case 'Preview':
      if (c === 'P') return d.startsWith('delayed') ? 'delayed' : 'pregame';
      return 'scheduled';
    case 'Live':
      if (c === 'P') return 'pregame'; // Warmup
      if (c === 'M' || c === 'N') return 'review'; // manager challenge, umpire review
      if (c === 'T' || c === 'U') return 'suspended';
      return d.startsWith('delayed') ? 'delayed' : 'live';
    case 'Final':
      if (c === 'D') return 'postponed';
      if (c === 'C') return 'cancelled';
      return 'final'; // Final, Game Over, Completed Early, Forfeit
    case 'Other':
      return c === 'W' ? 'final' : 'unknown'; // W = Writing: game over, scorer finishing up
    default:
      return 'unknown';
  }
}
