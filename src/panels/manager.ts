// Opens, closes, places and feeds the optional windows (the prototype's strike zone, bases, matchup,
// line score and lineup windows). They are all optional: one main window is enough to watch a game.

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo, listen } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { PANELS, type PanelName, type Size } from '../settings/schema.ts';
import { PANEL_SIZE, panelLabel, type PanelFrame } from './frame.ts';

export class Panels {
  private readonly open = new Map<PanelName, Promise<void>>();
  private frame: PanelFrame | null = null;
  private hidden = false;
  private readonly sizeOf: (name: PanelName) => Size;
  private readonly mainWidth: () => number;

  /**
   * `mainWidth` is the main window's width in the game view. Panels are often switched on in
   * settings, where the main window is narrower: placed by its width then, they covered the game.
   */
  constructor(sizeOf: (name: PanelName) => Size, mainWidth: () => number) {
    this.sizeOf = sizeOf;
    this.mainWidth = mainWidth;
    // A panel that starts (or restarts) asks for the current frame.
    void listen<PanelName>('panel-ready', (e) => {
      if (this.frame) void emitTo(panelLabel(e.payload), 'panel-frame', this.frame);
    });
  }

  private latest: Record<PanelName, boolean> | null = null;
  private syncing: Promise<void> | null = null;

  /**
   * Make the open windows match the settings. Calls queue up and only the latest wish is applied:
   * an older call resuming after a wait must not reopen what a newer one closed.
   */
  sync(wanted: Record<PanelName, boolean>): Promise<void> {
    this.latest = wanted;
    this.syncing ??= (async () => {
      while (this.latest) {
        const w = this.latest;
        this.latest = null;
        await this.apply(w);
      }
      this.syncing = null;
    })();
    return this.syncing;
  }

  private async apply(wanted: Record<PanelName, boolean>): Promise<void> {
    for (const name of PANELS) {
      if (wanted[name] && !this.open.has(name)) this.open.set(name, this.create(name));
      if (!wanted[name] && this.open.has(name)) {
        const creating = this.open.get(name);
        this.open.delete(name);
        // Switched off while still being made: wait for the window to exist, or it would stay open.
        await creating?.catch(() => undefined);
        await (await WebviewWindow.getByLabel(panelLabel(name)))?.close();
      }
    }
  }

  /** Send a step to every open panel. */
  send(frame: PanelFrame): void {
    // A panel that opens later gets the current board, without replaying the last animation.
    const { plan: _played, ...still } = frame;
    this.frame = still;
    for (const name of this.open.keys()) void emitTo(panelLabel(name), 'panel-frame', frame);
  }

  /** Hide or show them all (the hide hotkey, low-key mode). */
  async setHidden(hidden: boolean): Promise<void> {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    for (const name of this.open.keys()) {
      const w = await WebviewWindow.getByLabel(panelLabel(name));
      if (hidden) await w?.hide(); else await w?.show();
    }
  }

  private async create(name: PanelName): Promise<void> {
    const size = this.sizeOf(name);
    // Next to the main window to begin with; the window-state plugin restores where the user put it.
    const main = getCurrentWindow();
    const scale = await main.scaleFactor();
    const pos = (await main.outerPosition()).toLogical(scale);
    // Columns beside the main window, each window below the one before, so none covers another; a
    // window that would pass the bottom of the screen starts the next column.
    const mon = await currentMonitor();
    const bottom = mon ? (mon.position.y + mon.size.height) / mon.scaleFactor : Infinity;
    let x = pos.x + this.mainWidth() + 8, y = pos.y, colW = 0;
    for (const p of PANELS) {
      const s = this.sizeOf(p);
      if (y > pos.y && y + s.h > bottom) { x += colW + 8; y = pos.y; colW = 0; }
      if (p === name) break;
      y += s.h + 8;
      colW = Math.max(colW, s.w);
    }
    // Resolve once the window exists (or failed to), so a close right after an open finds it.
    await new Promise<void>((resolve) => {
      const w = new WebviewWindow(panelLabel(name), {
        url: `panel.html#${name}`,
        x: Math.round(x), y: Math.round(y),
        width: size.w, height: size.h, minWidth: 80, minHeight: 36,
        visible: !this.hidden, focus: false, focusable: false,
        decorations: false, transparent: true, shadow: false, resizable: true,
        alwaysOnTop: true, skipTaskbar: true, title: 'Basesmall',
      });
      void w.once('tauri://created', () => resolve());
      void w.once('tauri://error', () => resolve());
      // The created event can fire before those listeners are attached: also look for the window.
      const started = Date.now();
      const poll = setInterval(() => {
        void WebviewWindow.getByLabel(panelLabel(name)).then((found) => {
          if (found || Date.now() - started > 5000) { clearInterval(poll); resolve(); }
        });
      }, 50);
    });
  }
}

export { PANEL_SIZE };
