// Size tiers of the main window (docs/ARCHITECTURE.md 4.6). The window's size picks the level
// of detail: dragging the border switches tier, there is no separate "mode".

export type Tier = 'dot' | 'bar' | 'field' | 'full';
export const TIERS: readonly Tier[] = ['dot', 'bar', 'field', 'full'];

/** Content height (window minus the tab strip) at which each tier starts. */
const STARTS_AT = { bar: 44, field: 110, full: 250 } as const;

/** Below this width a tier cannot drop anything else. */
export const TIER_MIN_WIDTH: Record<Tier, number> = { dot: 150, bar: 240, field: 300, full: 300 };

/** Size a tier opens at when picked from the size button, before the user has resized it. */
export const TIER_PRESET: Record<Tier, { w: number; h: number }> = {
  dot: { w: 168, h: 28 }, bar: { w: 480, h: 64 }, field: { w: 480, h: 160 }, full: { w: 480, h: 340 },
};

export function tierOf(height: number): Tier {
  return height < STARTS_AT.bar ? 'dot' : height < STARTS_AT.field ? 'bar' : height < STARTS_AT.full ? 'field' : 'full';
}

/** What a tier still shows at a given width. Narrow windows drop the least useful part first. */
export interface TierParts {
  /** Dot: the out lamps. */
  outs: boolean;
  /** Bar: the latest pitch or play. */
  lastLine: boolean;
  /** Field and full: the strike zone. */
  zone: boolean;
}

export function partsOf(tier: Tier, width: number): TierParts {
  return {
    outs: tier !== 'dot' || width >= 168,
    lastLine: tier !== 'bar' || width >= 300,
    zone: (tier === 'field' || tier === 'full') && width >= 340,
  };
}

/** The tier after this one for the size button: bar, field, full, dot, and round again. */
export function nextTier(t: Tier): Tier {
  return ({ bar: 'field', field: 'full', full: 'dot', dot: 'bar' } as const)[t];
}
