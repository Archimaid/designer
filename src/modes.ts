import { pressOnly } from './dom.ts';
import { readStored, writeStored } from './storage.ts';
import { ui } from './ui.ts';

// Design mode builds on the canvas with the text out of sight; Code mode keeps the text docked beside the
// canvas. Phones show the text on their Text tab instead, in either mode.
export type Mode = 'design' | 'code';

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

// The address wins over the last mode used, so a link can open straight into Code mode.
export function readMode(): Mode {
  const requested = new URLSearchParams(location.search).get('mode') ?? readStored(modeKey);
  return requested === 'code' ? 'code' : 'design';
}

export function setMode(next: Mode): void {
  mode = next;
  document.body.classList.toggle('code-mode', next === 'code');
  pressOnly([ui.modeDesign, ui.modeCode], next === 'code' ? ui.modeCode : ui.modeDesign);
  writeStored(modeKey, next);
  const url = new URL(location.href);
  if (next === 'code') url.searchParams.set('mode', 'code');
  else url.searchParams.delete('mode');
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
  const pressed = mode === 'code' ? ui.modeCode : ui.modeDesign;
  ui.modes.style.setProperty('--pill-x', `${pressed.offsetLeft}px`);
  ui.modes.style.setProperty('--pill-width', `${pressed.offsetWidth}px`);
}

const pillObserver = new ResizeObserver(placeModePill);
pillObserver.observe(ui.modeDesign);
pillObserver.observe(ui.modeCode);
// The first placement must not slide in from the left edge.
requestAnimationFrame(() => requestAnimationFrame(() => ui.modes.classList.add('is-ready')));
