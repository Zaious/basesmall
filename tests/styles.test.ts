import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, validateStyle } from '../src/styles/manifest.ts';

const files = readdirSync('styles').filter((f) => f.endsWith('.json'));

describe('style files in styles/', () => {
  it('include the two built-in styles', () => {
    expect(files).toEqual(expect.arrayContaining(['flat.json', 'iso.json']));
  });

  for (const file of files) {
    it(`${file} is valid and its id matches the file name`, () => {
      const style = JSON.parse(readFileSync(`styles/${file}`, 'utf8')) as { id?: string };
      expect(validateStyle(style)).toEqual([]);
      expect(`${style.id}.json`).toBe(file);
    });
  }

  it('ids are unique', () => {
    const ids = files.map((f) => (JSON.parse(readFileSync(`styles/${f}`, 'utf8')) as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('validateStyle', () => {
  const good = JSON.parse(readFileSync('styles/iso.json', 'utf8')) as Record<string, unknown>;

  it('names every problem it finds', () => {
    const bad = { ...good, id: 'Bad Id', renderer: '3d', piece: { shape: 'cube', thickness: 9, rim: 'yes', shadow: 'hard' } };
    const errs = validateStyle(bad);
    expect(errs).toEqual(expect.arrayContaining([
      expect.stringContaining('id'),
      expect.stringContaining('renderer'),
      expect.stringContaining('piece.shape'),
      expect.stringContaining('piece.thickness'),
      expect.stringContaining('piece.rim'),
      expect.stringContaining('piece.shadow'),
    ]));
  });

  it('rejects text that would be unreadable on its panel', () => {
    const theme = { ...(good.theme as object), text: '#2A2E37' };
    expect(validateStyle({ ...good, theme }).join()).toContain('contrast');
  });

  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});
