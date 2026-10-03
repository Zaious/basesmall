// Style file format (styles/*.json). Draft: settled when the renderer lands in M3.
// A style is data only. Renderers read it; it never contains code.

export type Renderer = 'flat' | 'iso';

export interface StyleManifest {
  format: 1;
  /** Lower-case, digits and hyphens; must match the file name. */
  id: string;
  name: { en: string; 'zh-Hant': string };
  author?: string;
  /** Which built-in renderer draws this style. */
  renderer: Renderer;
  theme: {
    /** Window background when the background mode is solid. */
    background: string;
    /** Capsules and panels. Text sits on these, so it stays readable on any wallpaper. */
    panel: string;
    border: string;
    text: string;
    muted: string;
    /** Highlights: current batter ring, last pitch, home-run bubble. */
    accent: string;
    /** Pitch dots and count lamps. */
    ball: string;
    strike: string;
    out: string;
  };
  piece: {
    shape: 'dot' | 'disc';
    /** Side height as a fraction of the radius. 0 = flat; ignored by the flat renderer. */
    thickness: number;
    /** Light outline around each piece. Team colours can be dark, so keep it on unless the theme is light. */
    rim: boolean;
    shadow: 'none' | 'soft';
  };
  board: {
    /** Infield fill. Use alpha (#RRGGBBAA) to let the background through. */
    fill: string;
    lines: string;
  };
}

const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THEME_KEYS = ['background', 'panel', 'border', 'text', 'muted', 'accent', 'ball', 'strike', 'out'] as const;

/** Problems with a parsed style file; empty when it is valid. */
export function validateStyle(x: unknown): string[] {
  const errs: string[] = [];
  const o = (x ?? {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);
  const hex = (path: string, v: unknown) => { if (typeof v !== 'string' || !HEX.test(v)) errs.push(`${path} must be #RRGGBB or #RRGGBBAA`); };

  if (o.format !== 1) errs.push('format must be 1');
  if (typeof o.id !== 'string' || !ID.test(o.id)) errs.push('id must be lower-case words joined by hyphens');
  const name = obj(o.name);
  if (!name || typeof name.en !== 'string' || typeof name['zh-Hant'] !== 'string') errs.push('name needs en and zh-Hant');
  if (o.author !== undefined && typeof o.author !== 'string') errs.push('author must be a string');
  if (o.renderer !== 'flat' && o.renderer !== 'iso') errs.push('renderer must be "flat" or "iso"');

  const theme = obj(o.theme);
  if (!theme) errs.push('theme is required');
  else for (const k of THEME_KEYS) hex(`theme.${k}`, theme[k]);

  const piece = obj(o.piece);
  if (!piece) errs.push('piece is required');
  else {
    if (piece.shape !== 'dot' && piece.shape !== 'disc') errs.push('piece.shape must be "dot" or "disc"');
    if (typeof piece.thickness !== 'number' || piece.thickness < 0 || piece.thickness > 2) errs.push('piece.thickness must be a number from 0 to 2');
    if (typeof piece.rim !== 'boolean') errs.push('piece.rim must be true or false');
    if (piece.shadow !== 'none' && piece.shadow !== 'soft') errs.push('piece.shadow must be "none" or "soft"');
  }

  const board = obj(o.board);
  if (!board) errs.push('board is required');
  else { hex('board.fill', board.fill); hex('board.lines', board.lines); }

  if (errs.length === 0 && theme) {
    const t = theme as Record<(typeof THEME_KEYS)[number], string>;
    if (contrast(t.text, t.panel) < 4.5) errs.push(`theme.text on theme.panel has contrast ${contrast(t.text, t.panel).toFixed(2)}, needs 4.5`);
    if (contrast(t.muted, t.panel) < 3) errs.push(`theme.muted on theme.panel has contrast ${contrast(t.muted, t.panel).toFixed(2)}, needs 3`);
  }
  return errs;
}

/** WCAG contrast ratio between two opaque colours (alpha ignored). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
