// What the main window sends the optional windows after each step. Plain data (no Maps), so it
// survives Tauri's JSON events. The main window stays the only owner of the game (ARCHITECTURE 4.6).

import type { Lang } from '../i18n/index.ts';
import type { GameState } from '../model/types.ts';
import type { Look } from '../render/field-svg.ts';
import type { Piece, Plan } from '../render/scene.ts';
import type { PanelName } from '../settings/schema.ts';

export interface PanelFrame {
  state: GameState;
  /** The board after the step. */
  scene: [string, Piece][];
  /** The step's animation, when it should play (not for jumps). */
  plan?: Omit<Plan, 'end'> & { end: [string, Piece][] };
  speed: number;
  /** A new pitch just arrived: pop it in. */
  pop: boolean;
  look: Look;
  lang: Lang;
}

export const panelLabel = (name: PanelName) => `panel-${name}`;

/** Logical sizes the windows open at before the user resizes them. */
export const PANEL_SIZE: Record<PanelName, { w: number; h: number }> = {
  zone: { w: 150, h: 196 }, bases: { w: 250, h: 170 }, matchup: { w: 380, h: 46 }, linescore: { w: 430, h: 92 },
  lineup: { w: 250, h: 352 },
};

export function packPlan(plan: Plan): NonNullable<PanelFrame['plan']> {
  return { ...plan, end: [...plan.end] };
}
export function unpackPlan(p: NonNullable<PanelFrame['plan']>): Plan {
  return { ...p, end: new Map(p.end) };
}
