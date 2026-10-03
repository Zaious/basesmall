// The page inside a notification window (notify.html#toast or #marquee). It only draws what the
// main window sends, shows itself when it has something, and hides when it is empty.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';
import type { NoticeLook } from './notifier.ts';
import type { Notice } from './rules.ts';

const kind = location.hash === '#marquee' ? 'marquee' : 'toast';
const win = getCurrentWindow();
const root = document.getElementById('root')!;
document.body.classList.add(kind);
let look: NoticeLook = { theme: {} as NoticeLook['theme'], labels: { close: '×', replay: 'Replay' } };
let shown = false;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const score = (n: Notice) => `<span class="ab">${esc(n.away.abbr)}</span>${n.away.runs}<span class="colon">:</span>${n.home.runs}<span class="ab">${esc(n.home.abbr)}</span>`;
const title = (n: Notice) => `${n.replay ? `<span class="replay">${esc(look.labels.replay)}</span> ` : ''}${esc(n.title)}`;
/** Mark colour by kind: big plays in the accent, outs in the out colour, reaching base in the ball colour. */
const tone = (n: Notice) => (['hr', 'run', 'game'].includes(n.kind) ? 'accent' : ['out', 'k', 'half'].includes(n.kind) ? 'out' : ['hit', 'walk'].includes(n.kind) ? 'ball' : 'muted');
const closeButton = () => `<button class="x" data-close aria-label="${esc(look.labels.close)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;

async function setShown(on: boolean): Promise<void> {
  if (on === shown) return;
  shown = on;
  if (on) await win.show(); else await win.hide();
}

// ---------- toast: up to two cards, newest at the bottom, each gone after a while ----------

const CARD_MS = 8000;
interface Card { n: Notice; left: number; id: number }
let cards: Card[] = [];
let nextId = 0;
let hovering = false;
let lastTick = performance.now();

function renderToast(): void {
  root.innerHTML = cards.map((c, i) => `
    <div class="card${i < cards.length - 1 ? ' old' : ''}" role="status" data-id="${c.id}">
      <span class="mark ${tone(c.n)}">${c.n.kind === 'hr' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>' : ''}</span>
      <div class="text">
        <div class="head"><span class="title">${title(c.n)}</span><span class="score">${score(c.n)}</span></div>
        <span class="detail">${esc(c.n.detail)}</span>
      </div>
      ${closeButton()}
    </div>`).join('');
  void setShown(cards.length > 0);
}

setInterval(() => {
  const now = performance.now();
  const dt = now - lastTick;
  lastTick = now;
  if (kind !== 'toast' || hovering || !cards.length) return;
  for (const c of cards) c.left -= dt;
  const before = cards.length;
  cards = cards.filter((c) => c.left > 0);
  if (cards.length !== before) renderToast();
}, 250);

// ---------- marquee: the latest plays scrolling past, with the score on the left ----------

const KEEP = 6;
const IDLE_MS = 5 * 60_000;
let items: Notice[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function renderMarquee(): void {
  const last = items.at(-1);
  if (!last) { root.innerHTML = ''; void setShown(false); return; }
  // Twice the list, scrolled by half its width, loops without a seam.
  const one = items.map((n) => `<span class="item"><i class="mark ${tone(n)}"></i>${title(n)}｜${esc(n.detail)}</span>`).join('');
  root.innerHTML = `<div class="bar">
      <div class="sb"><span class="score">${score(last)}</span><span class="sit">${esc(last.situation)}</span></div>
      <span class="sep"></span>
      <div class="ticker" aria-live="polite"><div class="track${items.length < 2 ? ' still' : ''}">${one}${items.length < 2 ? '' : one}</div></div>
      ${closeButton()}
    </div>`;
  void setShown(true);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { items = []; renderMarquee(); }, IDLE_MS);
}

// ---------- wiring ----------

function applyLook(l: NoticeLook): void {
  look = l;
  for (const [k, v] of Object.entries(l.theme)) document.documentElement.style.setProperty(`--${k}`, v);
}

root.addEventListener('mouseenter', () => { hovering = true; });
root.addEventListener('mouseleave', () => { hovering = false; });
root.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-close]');
  if (!b) return;
  if (kind === 'toast') {
    const id = Number(b.closest<HTMLElement>('.card')?.dataset.id);
    cards = cards.filter((c) => c.id !== id);
    renderToast();
  } else {
    items = [];
    renderMarquee();
  }
});

// Listen only for events addressed to this window: a plain listen() also hears the copy the
// main window sends to the other notification window.
const self = getCurrentWebviewWindow();
void (async () => {
  await self.listen<NoticeLook>('notice-look', (e) => applyLook(e.payload));
  await self.listen<Notice>('notice', (e) => {
    if (kind === 'toast') {
      cards = [...cards, { n: e.payload, left: CARD_MS, id: nextId++ }].slice(-2);
      renderToast();
    } else {
      items = [...items, e.payload].slice(-KEEP);
      renderMarquee();
    }
  });
  await self.listen('notice-clear', () => {
    cards = [];
    items = [];
    if (kind === 'toast') renderToast(); else renderMarquee();
  });
  await emit('notice-ready', kind);
})();
