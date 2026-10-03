// Shows notices in their own small windows: a card in the corner of the screen ("toast") and a
// ticker along an edge of the screen or under the main window ("marquee"). The windows are made
// on first use, never take focus (typing elsewhere is never interrupted), and hide when empty.

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo, listen } from '@tauri-apps/api/event';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { currentMonitor, getCurrentWindow, type Window } from '@tauri-apps/api/window';
import type { MarqueeSpot, NotifyMode } from '../settings/schema.ts';
import type { StyleManifest } from '../styles/manifest.ts';
import type { Notice } from './rules.ts';

export type NoticeWindow = 'toast' | 'marquee';

/** What the notice windows need besides the notice itself. */
export interface NoticeLook {
  theme: StyleManifest['theme'];
  labels: { close: string; replay: string };
}

/** Logical sizes, matching the prototype's notification screens. */
const SIZE: Record<NoticeWindow, { w: number; h: number }> = { toast: { w: 320, h: 176 }, marquee: { w: 760, h: 36 } };
const MARGIN = 12;

export class Notifier {
  private mode: NotifyMode = 'off';
  private spot: MarqueeSpot = 'bottom';
  private look: NoticeLook | null = null;
  private readonly ready = new Map<NoticeWindow, Promise<void>>();
  private readonly main: Window;

  constructor() {
    this.main = getCurrentWindow();
  }

  configure(mode: NotifyMode, spot: MarqueeSpot, look: NoticeLook): void {
    const was = this.mode;
    this.mode = mode;
    this.spot = spot;
    this.look = look;
    for (const w of this.ready.keys()) void this.send(w, 'notice-look', look);
    // Switched off or away from a window: empty it so nothing lingers.
    if (!this.uses('toast', mode) && this.uses('toast', was)) void this.clear('toast');
    if (!this.uses('marquee', mode) && this.uses('marquee', was)) void this.clear('marquee');
  }

  private uses(w: NoticeWindow, mode = this.mode): boolean {
    return mode === 'both' || mode === w;
  }

  async push(n: Notice): Promise<void> {
    for (const w of ['toast', 'marquee'] as NoticeWindow[]) {
      if (!this.uses(w)) continue;
      try {
        await this.open(w);
        await this.place(w);
        await this.send(w, 'notice', n);
      } catch (e) {
        console.warn(`notice window ${w}:`, e);
      }
    }
  }

  /** Empty both windows (a different game, or back to the game list). */
  async clearAll(): Promise<void> {
    await Promise.all([...this.ready.keys()].map((w) => this.clear(w)));
  }

  private async clear(w: NoticeWindow): Promise<void> {
    if (this.ready.has(w)) await this.send(w, 'notice-clear', null);
  }

  private async send(w: NoticeWindow, event: string, payload: unknown): Promise<void> {
    await this.ready.get(w);
    await emitTo(w, event, payload);
  }

  /** Create the window once; resolves when its page is listening. */
  private open(w: NoticeWindow): Promise<void> {
    let p = this.ready.get(w);
    if (p) return p;
    p = new Promise<void>((resolve, reject) => {
      let unlisten: (() => void) | undefined;
      const timer = setTimeout(() => { unlisten?.(); reject(new Error(`${w} did not start`)); }, 15_000);
      void listen<string>('notice-ready', (e) => {
        if (e.payload !== w) return;
        clearTimeout(timer);
        unlisten?.();
        if (this.look) void emitTo(w, 'notice-look', this.look);
        resolve();
      }).then((u) => { unlisten = u; });
      const win = new WebviewWindow(w, {
        url: `notify.html#${w}`,
        width: SIZE[w].w, height: SIZE[w].h,
        visible: false, focus: false, focusable: false,
        decorations: false, transparent: true, shadow: false, resizable: false,
        alwaysOnTop: true, skipTaskbar: true, title: 'Basesmall',
      });
      void win.once('tauri://error', (e) => { clearTimeout(timer); reject(new Error(String(e.payload))); });
    });
    p.catch(() => this.ready.delete(w));
    this.ready.set(w, p);
    return p;
  }

  /** Put the window where it belongs on the screen the main window is on. */
  private async place(w: NoticeWindow): Promise<void> {
    const target = await WebviewWindow.getByLabel(w);
    const monitor = await currentMonitor(); // the screen the main window is on (this code runs in it)
    if (!target || !monitor) return;
    const s = monitor.scaleFactor;
    const area = monitor.workArea;
    const m = Math.round(MARGIN * s);
    let width = Math.round(SIZE[w].w * s);
    const height = Math.round(SIZE[w].h * s);
    let x: number, y: number;
    if (w === 'toast') {
      x = area.position.x + area.size.width - width - m;
      y = area.position.y + area.size.height - height - m;
      // Keep clear of a ticker along the bottom edge.
      if (this.uses('marquee') && this.spot === 'bottom') y -= Math.round((SIZE.marquee.h + MARGIN) * s);
    } else if (this.spot === 'bar') {
      const pos = await this.main.outerPosition();
      const size = await this.main.outerSize();
      width = Math.max(Math.round(300 * s), size.width);
      x = pos.x;
      const below = pos.y + size.height + Math.round(4 * s);
      y = below + height <= area.position.y + area.size.height ? below : pos.y - height - Math.round(4 * s);
    } else {
      width = Math.min(width, area.size.width - 2 * m);
      x = area.position.x + Math.round((area.size.width - width) / 2);
      y = this.spot === 'top' ? area.position.y + m : area.position.y + area.size.height - height - m;
    }
    await target.setSize(new PhysicalSize(width, height));
    await target.setPosition(new PhysicalPosition(x, y));
  }
}
