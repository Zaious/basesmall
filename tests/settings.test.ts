import { describe, expect, it } from 'vitest';
import { DEFAULTS, fromLocalStorage, normalize, NOTIFY_KINDS } from '../src/settings/schema.ts';
import { SettingsStore, type SettingsBackend } from '../src/settings/store.ts';

const memory = (initial: string | null = null) => {
  const writes: string[] = [];
  let text = initial;
  const backend: SettingsBackend = {
    read: async () => text,
    write: async (t) => { await new Promise((r) => setTimeout(r, 1)); writes.push(t); text = t; },
  };
  return { backend, writes, text: () => text };
};

describe('settings schema', () => {
  it('starts muted, compact, scores hidden, and notifies the plays that change a game', () => {
    expect(DEFAULTS.sound.muted).toBe(true);
    expect(DEFAULTS.replay).toEqual({ pace: 'compact', showScores: false });
    expect(Object.keys(DEFAULTS.notify.events)).toEqual([...NOTIFY_KINDS]);
    expect(NOTIFY_KINDS).toHaveLength(10);
  });

  it('reads back exactly what it wrote', () => {
    const s = normalize({ ...DEFAULTS, favorite: 'NYY', language: 'en', sizes: { 'size-game': { w: 480, h: 160 } } });
    expect(normalize(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('a bad value falls back on its own, without losing the rest of the file', () => {
    const s = normalize({
      favorite: 'NYY', language: 'klingon', style: 'Bad Style!', background: 'neon',
      sound: { muted: false, volume: 7, hit: 'yes' },
      notify: { mode: 'both', events: { hr: false, bogus: true } },
      sizes: { 'size-game': { w: 480, h: 160 }, 'size-evil': { w: 'x', h: 1 }, '__proto__': { w: 1, h: 1 } },
      extra: { anything: 1 },
    });
    expect(s.favorite).toBe('NYY');
    expect(s.language).toBe('auto');
    expect(s.style).toBe('iso');
    expect(s.background).toBe('solid');
    expect(s.sound).toEqual({ muted: false, volume: 1, hit: true, homeRun: true });
    expect(s.notify.mode).toBe('both');
    expect(s.notify.events.hr).toBe(false);
    expect(s.notify.events).not.toHaveProperty('bogus');
    expect(s.sizes).toEqual({ 'size-game': { w: 480, h: 160 } });
    expect(s).not.toHaveProperty('extra');
  });

  it('only accepts a team abbreviation, "none", or no choice yet', () => {
    expect(normalize({ favorite: 'none' }).favorite).toBe('none');
    expect(normalize({ favorite: null }).favorite).toBeNull();
    expect(normalize({ favorite: '<img>' }).favorite).toBeNull();
  });

  it('carries over what the older versions kept in localStorage', () => {
    const old: Record<string, string> = {
      favorite: 'NYY', style: 'flat', 'bg-mode': 'clear', 'tab-clock': 'off',
      'size-game': '{"w":520,"h":64}', 'size-tier-full': '{"w":480,"h":340}', 'size-picker': 'not json',
    };
    const s = fromLocalStorage((k) => old[k] ?? null);
    expect(s).toMatchObject({ favorite: 'NYY', style: 'flat', background: 'clear', tabs: { clock: false, replay: true } });
    expect(s.sizes).toEqual({ 'size-game': { w: 520, h: 64 }, 'size-tier-full': { w: 480, h: 340 } });
    expect(s.sound.muted).toBe(true);
  });
});

describe('SettingsStore', () => {
  it('with no file yet: migrates, and writes the file at once', async () => {
    const m = memory();
    const store = await SettingsStore.open(m.backend, () => normalize({ favorite: 'BOS' }));
    await store.flushed();
    expect(store.current.favorite).toBe('BOS');
    expect(JSON.parse(m.text()!).favorite).toBe('BOS');
  });

  it('loads the saved file and ignores the migration', async () => {
    const m = memory(JSON.stringify({ ...DEFAULTS, favorite: 'NYY' }));
    const store = await SettingsStore.open(m.backend, () => normalize({ favorite: 'BOS' }));
    expect(store.current.favorite).toBe('NYY');
    expect(m.writes).toHaveLength(0);
  });

  it('a burst of changes ends with the last one on disk, and listeners hear each', async () => {
    const m = memory(JSON.stringify(DEFAULTS));
    const store = await SettingsStore.open(m.backend, () => DEFAULTS);
    const heard: number[] = [];
    store.subscribe((now) => heard.push(now.sound.volume));
    for (const v of [0.1, 0.2, 0.3, 0.4]) store.update((d) => { d.sound.volume = v; });
    await store.flushed();
    expect(heard).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(JSON.parse(m.text()!).sound.volume).toBe(0.4);
    expect(m.writes.length).toBeLessThan(4); // writes are coalesced, never stale
  });

  it('a change that changes nothing is not written or announced', async () => {
    const m = memory(JSON.stringify(DEFAULTS));
    const store = await SettingsStore.open(m.backend, () => DEFAULTS);
    let heard = 0;
    store.subscribe(() => heard++);
    store.update((d) => { d.background = 'solid'; });
    await store.flushed();
    expect(heard).toBe(0);
    expect(m.writes).toHaveLength(0);
  });

  it('a checking run keeps changes in memory only', async () => {
    const m = memory(JSON.stringify(DEFAULTS));
    const store = await SettingsStore.open(m.backend, () => DEFAULTS);
    store.persist = false;
    store.update((d) => { d.style = 'flat'; });
    await store.flushed();
    expect(store.current.style).toBe('flat');
    expect(m.writes).toHaveLength(0);
  });

  it('reads a file saved with a byte-order mark (older Windows Notepad)', async () => {
    const m = memory(`﻿${JSON.stringify({ ...DEFAULTS, favorite: 'NYY' })}`);
    const store = await SettingsStore.open(m.backend, () => normalize({ favorite: 'BOS' }));
    expect(store.current.favorite).toBe('NYY');
  });

  it('a broken file (not JSON) starts from the migration and is replaced on the next change', async () => {
    const m = memory('{ broken');
    const store = await SettingsStore.open(m.backend, () => normalize({ favorite: 'SEA' }));
    expect(store.current.favorite).toBe('SEA');
    expect(m.writes).toHaveLength(0); // the broken file is left alone until there is something to save
    store.update((d) => { d.sound.muted = false; });
    await store.flushed();
    expect(JSON.parse(m.text()!).favorite).toBe('SEA');
  });
});
