import { describe, expect, it } from 'vitest';
import { keyLabel } from '../src/ui/keys.ts';

describe('keyLabel', () => {
  it('writes the default hotkeys the way each system does', () => {
    expect(keyLabel('CmdOrCtrl+Alt+Shift+B', true)).toBe('⌥⇧⌘B');
    expect(keyLabel('CmdOrCtrl+Alt+Shift+B', false)).toBe('Ctrl+Alt+Shift+B');
  });

  it('puts Mac modifiers in the usual order, whatever order they were typed in', () => {
    expect(keyLabel('shift+ctrl+option+KeyL', true)).toBe('⌃⌥⇧L');
    expect(keyLabel('Super+Digit5', false)).toBe('Win+5');
  });

  it('keeps named keys as they are and survives odd input', () => {
    expect(keyLabel('Alt+F9', true)).toBe('⌥F9');
    expect(keyLabel('', false)).toBe('');
    expect(keyLabel('Shift+', false)).toBe('Shift');
  });
});
