import { pressOnly } from './dom.ts';
import { readStored, writeStored } from './storage.ts';
import { ui } from './ui.ts';

// View mode only looks: the canvas pans and zooms but nothing on it can change. Design mode builds on the
// canvas with the text out of sight; Code mode keeps the text docked beside the canvas. Phones show the text
// on their Text tab instead, in Design and Code mode.
export type Mode = 'view' | 'design' | 'code';

const modes: readonly Mode[] = ['view', 'design', 'code'];
const isMode = (value: string | null): value is Mode => modes.some((known) => known === value);

const modeKey = 'archimaid.designer.mode';
let mode: Mode = 'design';
let textOpen = false;
let unseenChanges = 0;

export function currentMode(): Mode {
  return mode;
}

export function isTextOpen(): boolean {
  return textOpen;
}

// The address wins, so a link can open straight into a mode. A shared diagram opens to be looked at, and
// otherwise the last mode used comes back.
export function readMode(shared: boolean): Mode {
  const requested = new URLSearchParams(location.search).get('mode');
  if (isMode(requested)) return requested;
  if (shared) return 'view';
  const stored = readStored(modeKey);
  return isMode(stored) ? stored : 'design';
}

function buttonFor(which: Mode): HTMLButtonElement {
  return { view: ui.modeView, design: ui.modeDesign, code: ui.modeCode }[which];
}

export function setMode(next: Mode): void {
  mode = next;
  document.body.classList.toggle('view-mode', next === 'view');
  document.body.classList.toggle('code-mode', next === 'code');
  pressOnly(modes.map(buttonFor), buttonFor(next));
  writeStored(modeKey, next);
  const url = new URL(location.href);
  if (next === 'design') url.searchParams.delete('mode');
  else url.searchParams.set('mode', next);
  history.replaceState(null, '', url);
  setTextOpen(next === 'code');
  placeModePill();
}

export function setTextOpen(open: boolean): void {
  textOpen = open;
  document.body.classList.toggle('text-view', open);
  ui.tabText.setAttribute('aria-selected', String(open));
  ui.tabCanvas.setAttribute('aria-selected', String(!open));
  ui.drawer.classList.toggle('is-hidden', !open);
  if (!open) return;
  unseenChanges = 0;
  ui.codeBadge.hidden = true;
  ui.tabBadge.hidden = true;
}

// Edits made on the canvas while the text is out of sight are counted on the Code button and the Text tab.
export function noteUnseenChange(): void {
  if (textOpen) return;
  unseenChanges++;
  for (const badge of [ui.codeBadge, ui.tabBadge]) {
    badge.textContent = String(unseenChanges);
    badge.hidden = false;
  }
}

// The pill under the pressed mode follows its button, also when fonts load or a badge changes its width.
function placeModePill(): void {
  const pressed = buttonFor(mode);
  ui.modes.style.setProperty('--pill-x', `${pressed.offsetLeft}px`);
  ui.modes.style.setProperty('--pill-width', `${pressed.offsetWidth}px`);
}

const pillObserver = new ResizeObserver(placeModePill);
for (const button of modes.map(buttonFor)) pillObserver.observe(button);
// The first placement must not slide in from the left edge.
requestAnimationFrame(() => requestAnimationFrame(() => ui.modes.classList.add('is-ready')));
