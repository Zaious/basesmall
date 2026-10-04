// Field coordinates in feet, and the two projections the built-in renderers draw with.
// x runs toward first base, y toward centre field, z up; home plate is the origin.

import type { BattedBall } from '../model/types.ts';
import type { Spot } from './scene.ts';

const B45 = 90 / Math.SQRT2;
/** Home, first, second, third, home: the base path in feet. */
export const BASE_PATH: readonly (readonly [number, number])[] = [[0, 0], [B45, B45], [0, 2 * B45], [-B45, B45], [0, 0]];
export const MOUND: readonly [number, number] = [0, 60.5];

/** Field position of a spot. Fractions interpolate along the base path. */
export function spotFeet(spot: Spot): [number, number] {
  if (spot === 'mound') return [MOUND[0], MOUND[1]];
  const s = Math.max(0, Math.min(4, spot));
  const i = Math.min(3, Math.floor(s)), t = s - i;
  const a = BASE_PATH[i]!, b = BASE_PATH[i + 1]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 2.5D only: past the infield, distances shrink to a fifth, so a whole fly ball fits the frame. */
export const compress = (d: number) => (d <= 130 ? d : 130 + (d - 130) * 0.2);
/** A generic fence: 330 ft down the lines, 400 ft to centre. Not any real park. */
export const fenceFeet = (deg: number) => 400 - (70 * Math.min(45, Math.abs(deg))) / 45;
/**
 * The edge of the infield dirt, by bearing from home: a 95 ft circle around the pitcher's plate, as the
 * rule book draws it. About 155 ft out to centre, 128 ft down the lines.
 */
export function infieldEdgeFeet(deg: number): number {
  const uy = Math.cos((deg * Math.PI) / 180), m = MOUND[1], R = 95;
  return m * uy + Math.sqrt((m * uy) ** 2 - (m * m - R * R));
}

export interface Projection {
  iso: boolean;
  /** Pixels per foot. */
  k: number;
  /** Home plate in pixels. */
  hx: number;
  hy: number;
  /** Piece radius in pixels. */
  r: number;
}

/** Fit the infield (and in 2.5D the compressed outfield) into a W×H box. */
export function project(w: number, h: number, iso: boolean): Projection {
  const d = 2 * B45;
  // Room under home plate for the batter's name: a flat piece is a full circle, so it needs more.
  const k = iso
    ? Math.max(0.05, Math.min((w - 34) / d, (h - 50) / (compress(400) * 0.5 + 6)))
    : Math.max(0.05, Math.min((w - 34) / d, (h - 56) / d));
  return { iso, k, hx: w / 2, hy: h - (iso ? 22 : 34), r: Math.max(5, Math.min(11, k * 9)) };
}

/** Feet to pixels. In 2.5D the ground is squashed to half height and z lifts the point. */
export function toScreen(p: Projection, fx: number, fy: number, fz = 0): [number, number] {
  return p.iso
    ? [p.hx + fx * p.k, p.hy - fy * p.k * 0.5 - fz * p.k * 0.8]
    : [p.hx + fx * p.k, p.hy - fy * p.k];
}

/** MLB's batted-ball coordinates: home plate sits at (125.42, 198.27), 2.5 ft per unit. */
const PLATE = { x: 125.42, y: 198.27, ftPerUnit: 2.5 };

export interface Flight {
  /** Ball positions in pixels, from the plate to where it landed or was fielded. */
  air: [number, number][];
  /** Its shadow on the ground (2.5D), same length as `air`. */
  ground: [number, number][];
  /** The path left the frame and was cut; draw an arrowhead instead of a landing mark. */
  clipped: boolean;
}

/**
 * The ball's path. Flat: a straight line to the landing point. 2.5D: an arc whose height comes
 * from the launch angle, kept inside the frame.
 */
export function flight(ball: BattedBall, p: Projection, w: number, h: number): Flight | null {
  if (ball.coordX === undefined || ball.coordY === undefined) return null;
  let fx = (ball.coordX - PLATE.x) * PLATE.ftPerUnit, fy = (PLATE.y - ball.coordY) * PLATE.ftPerUnit;
  const d0 = Math.hypot(fx, fy) || 1;
  // Fly balls and liners carry; the coordinates mark where they were caught or landed.
  const air = ball.trajectory === 'fly_ball' || ball.trajectory === 'line_drive' || ball.trajectory === 'popup';
  const d = air && ball.distance ? ball.distance : d0;
  const shown = p.iso ? compress(d) : d;
  fx = (fx / d0) * shown; fy = (fy / d0) * shown;
  const la = ball.launchAngle ?? 10;
  const realApex = ball.trajectory === 'ground_ball' || la < 6 ? 1.5 : Math.max(4, (d * Math.tan((la * Math.PI) / 180)) / 4);
  let apex = p.iso ? Math.min(realApex * (shown / d) * 1.4, (h * 0.55) / (p.k * 0.8)) : 0;
  const N = 40;
  // A ball that stays in the park stays under the fence line. Drawn at full height, a 59° popup
  // caught 168 ft out by the second baseman rose past the dashed fence and read as a deep fly
  // (NYY@TB, 2026-10-04). Balls that clear the fence keep their arc.
  if (apex > 0) {
    const fence = compress(fenceFeet((Math.atan2(fx, fy) * 180) / Math.PI));
    if (shown < fence) {
      // Screen lift above home, in feet: the ground path climbs 0.5 per foot of depth, height 0.8.
      const limit = Math.max(0.5 * fy, 0.5 * (fy / shown) * fence - 6 / p.k);
      const peak = (a: number) => {
        let m = 0;
        for (let i = 0; i <= N; i++) { const t = i / N; m = Math.max(m, 0.5 * fy * t + 0.8 * a * 4 * t * (1 - t)); }
        return m;
      };
      if (peak(apex) > limit) {
        let lo = 0, hi = apex;
        for (let j = 0; j < 24; j++) { const mid = (lo + hi) / 2; if (peak(mid) > limit) hi = mid; else lo = mid; }
        apex = lo;
      }
    }
  }
  const out: Flight = { air: [], ground: [], clipped: false };
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = toScreen(p, fx * t, fy * t, apex * 4 * t * (1 - t));
    if (i > 0 && (a[0] < 4 || a[0] > w - 4 || a[1] < 4 || a[1] > h - 4)) { out.clipped = true; break; }
    out.air.push(a);
    out.ground.push(toScreen(p, fx * t, fy * t, 0));
  }
  return out.air.length >= 2 ? out : null;
}
