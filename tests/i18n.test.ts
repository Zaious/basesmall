import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/data/mlb/timeline.ts';
import { detectLang, eventLine, LANGS, STRINGS } from '../src/i18n/index.ts';
import { cssFill, pieceColours, piecePaints, svgFill, teamPaint } from '../src/styles/team-colors.ts';
import type { GameEvent } from '../src/model/types.ts';
import { FIXTURES, hasFixture, loadFixture } from './fixtures.ts';

describe('event text', () => {
  it.skipIf(!hasFixture(849841))('reads naturally in both languages for real plays', () => {
    const pas = buildTimeline(loadFixture(849841)).flatMap((e) => e.events.filter((ev) => ev.type === 'plateAppearance'));
    const hr = pas.find((ev) => ev.type === 'plateAppearance' && ev.result === 'home_run' && ev.batter.short === 'Schwarber')!;
    expect(eventLine(hr, 'zh-Hant')).toEqual({ who: 'Schwarber', text: '右中間陽春砲' });
    expect(eventLine(hr, 'en')).toEqual({ who: 'Schwarber', text: 'Solo HR to RCF' });
  });

  it('has text for every plate-appearance result in the recorded games', () => {
    const missing = new Set<string>();
    for (const fx of FIXTURES.filter((f) => hasFixture(f.pk))) {
      for (const e of buildTimeline(loadFixture(fx.pk))) {
        for (const ev of e.events) {
          if (ev.type !== 'plateAppearance') continue;
          for (const lang of LANGS) if (!eventLine(ev, lang)) missing.add(`${lang}:${ev.result}`);
        }
      }
    }
    // other_out is a runner out that ends the plate appearance; the runner event carries the text.
    expect([...missing].filter((m) => !m.endsWith(':other_out') && !/caught_stealing|pickoff/.test(m))).toEqual([]);
  });

  it('describes delays and early endings with the reason', () => {
    expect(STRINGS['zh-Hant'].status('final', 'Completed Early: Rain')).toBe('因雨提前結束');
    expect(STRINGS.en.status('delayed', 'Delayed: Rain')).toBe('Delayed: Rain');
    expect(STRINGS['zh-Hant'].status('review', 'Manager challenge: Tag play')).toBe('挑戰／重播審查中');
  });

  it('picks the language from the locale', () => {
    expect(detectLang('zh-TW')).toBe('zh-Hant');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });

  it('gives baserunning events a line', () => {
    const ev: GameEvent = { type: 'baserunning', kind: 'stolen_base_3b', runner: { id: 1, name: 'A B', short: 'B' } };
    expect(eventLine(ev, 'zh-Hant')).toEqual({ who: 'B', text: '盜上三壘' });
  });
});

describe('piece colours', () => {
  it('keeps both primaries when they differ', () => {
    expect(pieceColours('LAD', 'SF')).toEqual({ away: '#005A9C', home: '#FD5A1E' });
  });
  it('judges the Yankees by their pinstripes, so they no longer clash with blue teams', () => {
    expect(piecePaints('NYY', 'TB').away.pattern).toEqual({ kind: 'pinstripe', base: '#F4F4F4', stripe: '#0C2340' });
    expect(pieceColours('NYY', 'TB')).toEqual({ away: '#F4F4F4', home: '#092C5C' });
    expect(pieceColours('LAD', 'NYY')).toEqual({ away: '#005A9C', home: '#F4F4F4' });
  });
  it('draws pinstripes in CSS and SVG, and plain colours as themselves', () => {
    expect(cssFill(teamPaint('NYY'))).toContain('repeating-linear-gradient');
    expect(cssFill(teamPaint('BOS'))).toBe('#BD3039');
    const s = svgFill(teamPaint('NYY'), 'x');
    expect(s.fill).toBe('url(#x)');
    expect(s.defs).toContain('<pattern id="x"');
    expect(svgFill(teamPaint('BOS'), 'x')).toEqual({ defs: '', fill: '#BD3039' });
  });
  it('on a clash, the favourite keeps its colour', () => {
    // PHI red and ATL scarlet clash
    expect(pieceColours('PHI', 'ATL')).toEqual({ away: '#002D72', home: '#CE1141' });
    expect(pieceColours('PHI', 'ATL', 'PHI')).toEqual({ away: '#E81828', home: '#13274F' });
  });
});
