// Which sound a step deserves. One sound per step at most: the caller plays the first candidate
// the user has switched on. Pure.

import type { GameEvent, GameState } from '../model/types.ts';
import type { SoundName } from './sounds.ts';

const HITS = new Set(['single', 'double', 'triple']);
const STRIKEOUTS = new Set(['strikeout', 'strike_out', 'strikeout_double_play', 'strikeout_triple_play']);

/** Candidates for a step, most important first. */
export function soundsFor(prev: GameState | undefined, state: GameState, events: readonly GameEvent[]): SoundName[] {
  const out: SoundName[] = [];
  const pa = events.find((e): e is Extract<GameEvent, { type: 'plateAppearance' }> => e.type === 'plateAppearance');
  const ball = events.find((e): e is Extract<GameEvent, { type: 'ballInPlay' }> => e.type === 'ballInPlay')?.ball;
  if (pa?.result === 'home_run') out.push('homeRun');
  if (pa && HITS.has(pa.result)) out.push('hit');
  if (pa && STRIKEOUTS.has(pa.result)) out.push('strikeout');
  if (pa?.result === 'sac_bunt' || ball?.trajectory?.startsWith('bunt')) out.push('bunt');
  const pitch = events.find((e): e is Extract<GameEvent, { type: 'pitch' }> => e.type === 'pitch')?.pitch;
  if (!pa && pitch) {
    const full = state.balls === 3 && state.strikes === 2;
    const wasFull = prev !== undefined && prev.balls === 3 && prev.strikes === 2 && prev.batter?.id === state.batter?.id;
    if (full && !wasFull) out.push('fullCount');
    if (pitch.call === 'calledStrike' || pitch.call === 'swingingStrike') out.push('strike');
  }
  return out;
}
