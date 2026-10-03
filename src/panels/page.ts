// The page inside an optional window (panel.html#zone, #bases, #matchup, #linescore). It draws
// what the main window sends after each step; it never fetches anything itself.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';
import { STRINGS } from '../i18n/index.ts';
import { FieldRenderer } from '../render/field-svg.ts';
import { zoneSvg } from '../render/zone.ts';
import { esc, linescoreView, matchupView, pitchCaption } from '../ui/views.ts';
import { unpackPlan, type PanelFrame } from './frame.ts';
import type { PanelName } from '../settings/schema.ts';

const name = (location.hash.slice(1) || 'zone') as PanelName;
const win = getCurrentWindow();
const root = document.getElementById('panel')!;
root.classList.add(name);
let last: PanelFrame | null = null;
let field: FieldRenderer | null = null;

function applyLook(f: PanelFrame): void {
  for (const [k, v] of Object.entries(f.look.style.theme)) document.documentElement.style.setProperty(`--${k}`, v);
  root.classList.remove('bg-solid', 'bg-semi', 'bg-clear');
  root.classList.add(`bg-${f.look.background}`);
  document.documentElement.lang = f.lang;
}

function drawZone(f: PanelFrame, pop: boolean): void {
  if (!root.querySelector('svg.zone')) root.innerHTML = '<div class="who"></div><svg class="zone" aria-hidden="true"></svg><div class="pcap"></div>';
  const S = STRINGS[f.lang];
  // On its own the zone window still says who is batting, and the count.
  const b = f.state.batter;
  root.querySelector('.who')!.innerHTML = b
    ? `<b>${esc(b.short)}</b><span>${esc(S.bats(b.side))}</span><span class="mono">${Math.min(3, f.state.balls)}-${Math.min(2, f.state.strikes)}</span>`
    : '';
  const svg = root.querySelector<SVGSVGElement>('svg.zone')!;
  const r = svg.getBoundingClientRect();
  svg.innerHTML = zoneSvg(f.state.atBat, {
    w: r.width, h: r.height, iso: f.look.style.renderer === 'iso', theme: f.look.style.theme,
    batter: f.state.batter ? { side: f.state.batter.side, label: S.bats(f.state.batter.side) } : undefined,
    popLast: pop, noData: S.ui.noPitchData,
  });
  root.querySelector('.pcap')!.innerHTML = pitchCaption(f.state, f.lang, f.look.style.theme);
}

function draw(f: PanelFrame, fresh: boolean): void {
  applyLook(f);
  if (name === 'zone') drawZone(f, f.pop);
  else if (name === 'matchup') root.innerHTML = `<div class="mu">${matchupView(f.state, f.lang)}</div>`;
  else if (name === 'linescore') root.innerHTML = `<table class="ls">${linescoreView(f.state, f.look.paints)}</table>`;
  else {
    if (!field || fresh) {
      root.innerHTML = '<svg class="field" aria-hidden="true"></svg>';
      field = new FieldRenderer(root.querySelector<SVGSVGElement>('svg.field')!, f.look);
    } else field.setLook(f.look);
    const b = f.state.batter;
    const atBat = !!b && f.scene.some(([, p]) => p.id === b.id && p.role === 'batter');
    field.setLabel(atBat && b ? `${b.short} · ${STRINGS[f.lang].bats(b.side)}` : '', atBat);
    if (f.plan) void field.play(unpackPlan(f.plan), f.speed);
    else field.show(new Map(f.scene));
  }
}

new ResizeObserver(() => {
  if (!last) return;
  if (name === 'zone') drawZone(last, false);
  else if (name === 'bases') field?.resize();
}).observe(root);

// Drag anywhere, resize from the corner, close from the corner button.
root.addEventListener('mousedown', (e) => { if (e.button === 0) void win.startDragging(); });
document.getElementById('grip')!.addEventListener('mousedown', (e) => { e.preventDefault(); void win.startResizeDragging('SouthEast'); });
document.getElementById('close')!.addEventListener('click', () => void emit('panel-closed', name));

let resizeTimer: ReturnType<typeof setTimeout> | null = null;
void win.onResized(() => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    const s = (await win.innerSize()).toLogical(await win.scaleFactor());
    void emit('panel-size', { name, w: Math.round(s.width), h: Math.round(s.height) });
  }, 400);
});

const self = getCurrentWebviewWindow();
void (async () => {
  await self.listen<PanelFrame>('panel-frame', (e) => {
    const fresh = !last || last.state.gamePk !== e.payload.state.gamePk;
    last = e.payload;
    draw(e.payload, fresh);
  });
  await emit('panel-ready', name);
})();
