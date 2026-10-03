import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameState, PitchMark } from '../src/model/types.ts';
import { compress, fenceFeet, flight, project, spotFeet, toScreen } from '../src/render/geometry.ts';
import { AnimationQueue } from '../src/render/queue.ts';
import { nextTier, partsOf, tierOf, TIER_MIN_WIDTH, TIER_PRESET, TIERS } from '../src/render/tiers.ts';
import { zoneSvg } from '../src/render/zone.ts';
import { BUILT_IN, findStyle, loadStyles, nextStyle } from '../src/styles/loader.ts';
import { linescoreView } from '../src/ui/views.ts';

describe('size tiers', () => {
  it('switch at the heights in docs/ARCHITECTURE.md 4.6', () => {
    expect([24, 43, 44, 109, 110, 249, 250, 600].map(tierOf)).toEqual(['dot', 'dot', 'bar', 'bar', 'field', 'field', 'full', 'full']);
  });

  it('each preset size lands in its own tier and respects the minimum width', () => {
    for (const t of TIERS) {
      expect(tierOf(TIER_PRESET[t].h)).toBe(t);
      expect(TIER_PRESET[t].w).toBeGreaterThanOrEqual(TIER_MIN_WIDTH[t]);
    }
  });

  it('narrow windows drop the least useful part first', () => {
    expect(partsOf('dot', 160).outs).toBe(false);
    expect(partsOf('dot', 168).outs).toBe(true);
    expect(partsOf('bar', 299).lastLine).toBe(false);
    expect(partsOf('field', 339).zone).toBe(false);
    expect(partsOf('full', 340).zone).toBe(true);
  });

  it('the size button visits every tier and comes back', () => {
    const seen = ['bar'];
    for (let i = 0; i < 4; i++) seen.push(nextTier(seen.at(-1) as never));
    expect(seen).toEqual(['bar', 'field', 'full', 'dot', 'bar']);
  });
});

describe('field geometry', () => {
  it('spots follow the base path, fractions in between', () => {
    expect(spotFeet(0)).toEqual([0, 0]);
    expect(spotFeet(2)[1]).toBeCloseTo(127.28, 1);
    expect(spotFeet(4)).toEqual([0, 0]);
    const half = spotFeet(1.5);
    expect(half[0]).toBeCloseTo((spotFeet(1)[0] + spotFeet(2)[0]) / 2, 6);
    expect(spotFeet('mound')).toEqual([0, 60.5]);
  });

  it('2.5D shrinks the outfield; the fence is 330 ft at the lines and 400 ft to centre', () => {
    expect(compress(90)).toBe(90);
    expect(compress(400)).toBe(184);
    expect(fenceFeet(45)).toBe(330);
    expect(fenceFeet(0)).toBe(400);
  });

  it('the whole infield fits the box in both projections', () => {
    for (const iso of [false, true]) {
      const p = project(300, 140, iso);
      for (const s of [0, 1, 2, 3]) {
        const [x, y] = toScreen(p, ...spotFeet(s));
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(300);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(140);
      }
    }
  });

  it('a batted ball: straight in flat, arcing in 2.5D, and none without coordinates', () => {
    const ball = { coordX: 100, coordY: 60, distance: 390, trajectory: 'fly_ball', launchAngle: 30 };
    const flat = flight(ball, project(300, 140, false), 300, 140)!;
    const iso = flight(ball, project(300, 140, true), 300, 140)!;
    expect(flat.air).toEqual(flat.ground); // no height in flat
    const lift = iso.air.map((a, i) => iso.ground[i]![1] - a[1]);
    expect(Math.max(...lift)).toBeGreaterThan(5);
    expect(flight({ trajectory: 'ground_ball' }, project(300, 140, true), 300, 140)).toBeNull();
  });
});

describe('AnimationQueue', () => {
  const later = () => {
    let release!: () => void;
    const p = new Promise<void>((r) => { release = r; });
    return { p, release };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('plays steps one at a time, in order', async () => {
    const order: string[] = [];
    const gates = new Map<string, ReturnType<typeof later>>();
    const q = new AnimationQueue<string>(async (item) => {
      order.push(`start ${item}`);
      const g = later(); gates.set(item, g); await g.p;
      order.push(`end ${item}`);
    });
    q.push('a'); q.push('b');
    await tick();
    expect(order).toEqual(['start a']);
    gates.get('a')!.release(); await tick(); await tick();
    expect(order).toEqual(['start a', 'end a', 'start b']);
    gates.get('b')!.release(); await tick();
    expect(order.at(-1)).toBe('end b');
  });

  it('waiting steps play faster, and too many collapse into one jump that keeps their text', async () => {
    const runs: { item: string; animate: boolean; catchUp: number }[] = [];
    const first = later();
    const q = new AnimationQueue<string>(async (item, animate, catchUp) => {
      runs.push({ item, animate, catchUp });
      if (item === 'a') await first.p;
    }, { maxBacklog: 2, merge: (old, newer) => `${old}+${newer}` });
    q.push('a');
    await tick();
    q.push('b'); q.push('c');
    expect(q.pending).toBe(2);
    q.push('d'); // one over the limit
    expect(q.pending).toBe(1);
    expect(q.skipped).toBe(2);
    first.release(); await tick(); await tick();
    expect(runs).toEqual([
      { item: 'a', animate: true, catchUp: 1 },
      { item: 'b+c+d', animate: false, catchUp: 1 },
    ]);
  });

  it('a failing step does not stall the queue', async () => {
    const seen: string[] = [];
    const q = new AnimationQueue<string>(async (item) => { seen.push(item); if (item === 'x') throw new Error('boom'); });
    q.push('x'); q.push('y');
    await tick(); await tick();
    expect(seen).toEqual(['x', 'y']);
  });
});

describe('style loader', () => {
  const light = JSON.parse(readFileSync('styles/flat.json', 'utf8')) as Record<string, unknown>;
  const file = (id: string, extra: object = {}) => ({ name: `${id}.json`, text: JSON.stringify({ ...light, id, ...extra }) });

  it('adds valid user styles after the built-in ones and drops unknown fields', () => {
    const r = loadStyles([file('midnight', { extra: '<script>' })]);
    expect(r.problems).toEqual([]);
    expect(r.styles.map((s) => s.id)).toEqual([...BUILT_IN.map((s) => s.id), 'midnight']);
    expect(Object.keys(r.styles.at(-1)!)).not.toContain('extra');
  });

  it('reads a style file saved with a byte-order mark', () => {
    const f = file('bom');
    expect(loadStyles([{ ...f, text: `﻿${f.text}` }]).problems).toEqual([]);
  });

  it('skips broken files and says why', () => {
    const r = loadStyles([
      { name: 'bad.json', text: '{ nope' },
      file('wrong-name', { id: 'other' }),
      file('flat'),
      file('ugly', { theme: { ...(light.theme as object), accent: 'red' } }),
    ]);
    expect(r.styles).toHaveLength(BUILT_IN.length);
    expect(r.problems.join('\n')).toMatch(/bad\.json: not valid JSON/);
    expect(r.problems.join('\n')).toMatch(/wrong-name\.json: id "other" must match/);
    expect(r.problems.join('\n')).toMatch(/flat\.json: id "flat" is already taken/);
    expect(r.problems.join('\n')).toMatch(/ugly\.json: theme\.accent/);
  });

  it('falls back to the default style and cycles through all of them', () => {
    const { styles } = loadStyles([file('midnight')]);
    expect(findStyle(styles, 'gone').id).toBe('iso');
    expect(nextStyle(styles, 'iso').id).toBe('flat');
    expect(nextStyle(styles, 'midnight').id).toBe('iso');
  });
});

describe('strike zone', () => {
  const theme = BUILT_IN[0]!.theme;
  const pitches: PitchMark[] = [
    { n: 1, call: 'ball', callCode: 'B', x: 1.4, z: 2.2, szTop: 3.4, szBottom: 1.6 },
    { n: 2, call: 'calledStrike', callCode: 'C', x: 0.1, z: 2.5 },
    { n: 3, call: 'foul', callCode: 'F' }, // no location
  ];

  it('draws one numbered dot per located pitch, the newest ringed and popping in', () => {
    const svg = zoneSvg(pitches, { w: 118, h: 150, iso: true, theme, batter: { side: 'L', label: 'LHB' }, popLast: true, noData: 'NO-LOCATIONS' });
    expect(svg.match(/data-pitch=/g)).toHaveLength(2);
    expect(svg).toContain(`fill="${theme.ball}"`);
    expect(svg).toContain(`fill="${theme.strike}"`);
    expect(svg.match(/class="pop"/g)).toHaveLength(1);
    expect(svg).not.toContain('NO-LOCATIONS'); // some pitches have locations, so no notice
    // every dot carries its number
    for (const n of [1, 2]) expect(svg).toMatch(new RegExp(`data-pitch="${n}"[^]*?>${n}</text>`));
  });

  it('marks a swing and miss as a ring and a foul as a dashed ring (PRD §3.2.4)', () => {
    const seq: PitchMark[] = [
      { n: 1, call: 'ball', callCode: 'B', x: 0.9, z: 2 },
      { n: 2, call: 'calledStrike', callCode: 'C', x: 0, z: 2.5 },
      { n: 3, call: 'swingingStrike', callCode: 'S', x: 0.3, z: 1.2 },
      { n: 4, call: 'foul', callCode: 'F', x: -0.4, z: 3 },
      { n: 5, call: 'inPlay', callCode: 'X', x: 0.1, z: 2.2 },
    ];
    const svg = zoneSvg(seq, { w: 118, h: 150, iso: false, theme, popLast: false, noData: '' });
    expect([...svg.matchAll(/data-mark="(\w+)"/g)].map((m) => m[1])).toEqual(['solid', 'solid', 'ring', 'dashed', 'solid']);
    const dashedDot = /data-mark="dashed"[^]*?<\/g><\/g>/.exec(svg)![0];
    expect(dashedDot).toContain('stroke-dasharray');
    expect(/data-mark="ring"[^]*?<\/g><\/g>/.exec(svg)![0]).not.toContain('stroke-dasharray');
  });

  it('balls are drawn near real size, so the centre reads as the location', () => {
    const svg = zoneSvg([{ n: 1, call: 'ball', callCode: 'B', x: 0, z: 2.5 }], { w: 118, h: 150, iso: false, theme, popLast: false, noData: '' });
    const r = Number(new RegExp(`<circle r="([\\d.]+)" fill="${theme.ball}"`).exec(svg)![1]);
    const plate = Number(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="3"/.exec(svg)![1]); // 17 in wide
    const ballOverPlate = (2 * r) / plate;
    expect(ballOverPlate).toBeGreaterThan((2.9 / 17) * 1.1);
    expect(ballOverPlate).toBeLessThan((2.9 / 17) * 1.35);
  });

  it('keeps a wild pitch on the panel, at its edge', () => {
    const svg = zoneSvg([{ n: 1, call: 'ball', callCode: 'B', x: 4, z: -1 }], { w: 118, h: 150, iso: false, theme, popLast: false, noData: '' });
    const [, x, y] = /translate\(([\d.]+),([\d.]+)\)/.exec(svg)!;
    expect(Number(x)).toBeLessThan(118);
    expect(Number(y)).toBeLessThan(150);
  });

  it('says so when a game has no pitch locations', () => {
    const svg = zoneSvg([{ n: 1, call: 'ball', callCode: 'B' }], { w: 118, h: 150, iso: false, theme, popLast: false, noData: 'No locations' });
    expect(svg).toContain('No locations');
  });
});

describe('linescore', () => {
  it('has at least nine innings and grows for extra innings', () => {
    const base = { status: 'live', inning: 3, half: 'top', teams: { away: { abbr: 'AAA' }, home: { abbr: 'HHH' } },
      linescore: { away: [0, 1, 0], home: [0, 0] }, score: { away: 1, home: 0 }, hits: { away: 3, home: 1 }, errors: { away: 0, home: 1 } } as unknown as GameState;
    const paints = { away: { color: '#111111' }, home: { color: '#EEEEEE' } };
    const nine = linescoreView(base, paints);
    expect(nine.match(/<th(?: class="cur")?>\d+<\/th>/g)).toHaveLength(9);
    const twelve = linescoreView({ ...base, inning: 12, linescore: { away: Array(12).fill(0), home: Array(11).fill(0) } }, paints);
    expect(twelve.match(/<th(?: class="cur")?>\d+<\/th>/g)).toHaveLength(12);
    expect(twelve).toContain('<th class="cur">12</th>');
  });
});
