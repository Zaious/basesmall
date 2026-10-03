// Small colour helpers for the renderers. Inputs are validated style colours (#RRGGBB[AA]).

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** The colour with its alpha multiplied by `a`. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = channels(hex);
  const own = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return `rgba(${r},${g},${b},${+(own * a).toFixed(3)})`;
}

/** Darker (f < 1) or lighter (f > 1) version of an opaque colour. */
export function shade(hex: string, f: number): string {
  return `#${channels(hex).map((c) => Math.max(0, Math.min(255, Math.round(c * f))).toString(16).padStart(2, '0')).join('')}`;
}
