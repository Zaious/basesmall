import { describe, expect, it } from 'vitest';
import { isNewer, newerRelease } from '../src/ui/version.ts';

describe('isNewer', () => {
  it('compares numbers, not text', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('v0.10.0', '0.9.3')).toBe(true);
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('v0.0.9', '0.1.0')).toBe(false);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
  });

  it('a release beats its own pre-release; junk is never newer', () => {
    expect(isNewer('v0.2.0', '0.2.0-beta.1')).toBe(true);
    expect(isNewer('v0.2.0-beta.2', '0.2.0')).toBe(false);
    expect(isNewer('nightly', '0.1.0')).toBe(false);
    expect(isNewer('v0.2.0', '')).toBe(false);
  });
});

describe('newerRelease', () => {
  const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

  it('returns the release page when GitHub has something newer', async () => {
    expect(await newerRelease('0.1.0', reply({ tag_name: 'v0.2.0', html_url: 'https://github.com/Zaious/basesmall/releases/tag/v0.2.0' })))
      .toEqual({ tag: 'v0.2.0', url: 'https://github.com/Zaious/basesmall/releases/tag/v0.2.0' });
  });

  it('stays quiet when up to date, offline, rate limited, or offered a pre-release', async () => {
    expect(await newerRelease('0.1.0', reply({ tag_name: 'v0.1.0', html_url: 'x' }))).toBeNull();
    expect(await newerRelease('0.1.0', reply({}, false))).toBeNull();
    expect(await newerRelease('0.1.0', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
    expect(await newerRelease('0.1.0', reply({ tag_name: 'v0.2.0-rc.1', html_url: 'x', prerelease: true }))).toBeNull();
  });
});
