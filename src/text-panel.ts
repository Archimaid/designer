import type { ArchiMateDiagnostic, ArchiMateModel } from 'archimaid/language';
import { copyText } from './clipboard.ts';
import { pressOnly } from './dom.ts';
import type { CursorPosition, SourceEditor } from './editor.ts';
import { plural } from './format.ts';
import { detectNotation } from './notation.ts';
import { readStored, writeStored } from './storage.ts';
import { ui } from './ui.ts';

// The text panel around the editor: its status chip, notation switch, problems, status bar, copy button and,
// in Code mode, the width of the docked panel.

export interface DocumentStatus {
  readonly source: string;
  readonly model: ArchiMateModel | undefined;
  readonly diagnostics: readonly ArchiMateDiagnostic[];
}

export function showStatus(editor: SourceEditor, { source, model, diagnostics }: DocumentStatus): void {
  const errors = diagnostics.filter(({ severity }) => severity === 'error').length;
  const warnings = diagnostics.length - errors;
  editor.showDiagnostics(diagnostics);
  ui.statusChip.textContent = errors ? plural(errors, 'error') : warnings ? plural(warnings, 'warning') : 'Valid';
  ui.statusChip.dataset.status = errors ? 'invalid' : warnings ? 'warning' : 'valid';
  ui.modelSummary.textContent = model
    ? `${plural(model.elements.length, 'element')} · ${plural(model.relationships.length, 'relationship')}`
    : '';
  showProblems(editor, diagnostics);
  showNotation(source, errors === 0);
}

function showProblems(editor: SourceEditor, diagnostics: readonly ArchiMateDiagnostic[]): void {
  ui.problems.hidden = diagnostics.length === 0;
  ui.problemsCount.textContent = String(diagnostics.length);
  ui.problemsList.replaceChildren(
    ...diagnostics.map((diagnostic) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `problem is-${diagnostic.severity}`;
      const position = document.createElement('span');
      position.className = 'problem-position';
      position.textContent = `${diagnostic.line}:${diagnostic.column}`;
      const message = document.createElement('span');
      message.textContent = diagnostic.message;
      button.append(position, message);
      button.addEventListener('click', () => editor.revealDiagnostic(diagnostic));
      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

const notationButtons = [ui.notationLong, ui.notationShorthand];
const notationTips = new Map(notationButtons.map((button) => [button, button.dataset.tip ?? ''] as const));

// The pressed button shows what the text is written in, which a hand edit can change; mixed presses neither.
function showNotation(source: string, valid: boolean): void {
  const written = detectNotation(source);
  pressOnly(
    notationButtons,
    written === 'long' ? ui.notationLong : written === 'shorthand' ? ui.notationShorthand : undefined,
  );
  for (const button of notationButtons) {
    button.disabled = !valid;
    button.dataset.tip = valid
      ? (notationTips.get(button) ?? '')
      : 'Fix the errors first; only a valid diagram can be rewritten.';
  }
}

export function showStorageState(state: 'saved' | 'blocked' | 'shared'): void {
  ui.storageState.textContent = {
    saved: 'Saved in this browser',
    blocked: 'Not saved: browser storage is blocked',
    shared: 'Opened from a share link',
  }[state];
}

export function showCursor({ line, column }: CursorPosition): void {
  ui.cursorPosition.textContent = `Ln ${line}, Col ${column}`;
}

// The button confirms a copy itself, so the text panel needs no notification.
export function installCopyButton(text: () => string): void {
  let reset: number | undefined;
  const label = ui.copyText.querySelector('.copy-label');
  ui.copyText.addEventListener('click', async () => {
    const copied = await copyText(text());
    ui.copyText.classList.toggle('is-copied', copied);
    ui.copyText.classList.toggle('is-failed', !copied);
    if (label) label.textContent = copied ? 'Copied' : 'Copy failed';
    clearTimeout(reset);
    reset = window.setTimeout(() => {
      ui.copyText.classList.remove('is-copied', 'is-failed');
      if (label) label.textContent = 'Copy';
    }, 1800);
  });
}

// The docked panel's right edge resizes it, by dragging or with the arrow keys.
const codeWidthKey = 'archimaid.designer.code-width';
const minCodeWidth = 320;
const defaultCodeWidth = 520;
let width = defaultCodeWidth;

export function codeWidth(): number {
  return width;
}

function setCodeWidth(next: number): void {
  const maxWidth = Math.max(minCodeWidth, Math.round(window.innerWidth * 0.6));
  width = Math.min(maxWidth, Math.max(minCodeWidth, Math.round(next)));
  document.body.style.setProperty('--code-width', `${width}px`);
  ui.drawerResize.setAttribute('aria-valuemin', String(minCodeWidth));
  ui.drawerResize.setAttribute('aria-valuemax', String(maxWidth));
  ui.drawerResize.setAttribute('aria-valuenow', String(width));
}

setCodeWidth(Number(readStored(codeWidthKey)) || defaultCodeWidth);

let resizeStart: { x: number; width: number } | undefined;
ui.drawerResize.addEventListener('pointerdown', (event) => {
  resizeStart = { x: event.clientX, width };
  ui.drawerResize.setPointerCapture(event.pointerId);
  ui.drawerResize.classList.add('is-dragging');
});
ui.drawerResize.addEventListener('pointermove', (event) => {
  if (resizeStart) setCodeWidth(resizeStart.width + event.clientX - resizeStart.x);
});
function endResize(): void {
  if (!resizeStart) return;
  resizeStart = undefined;
  ui.drawerResize.classList.remove('is-dragging');
  writeStored(codeWidthKey, String(width));
}
ui.drawerResize.addEventListener('pointerup', endResize);
ui.drawerResize.addEventListener('pointercancel', endResize);
ui.drawerResize.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const step = event.shiftKey ? 96 : 24;
  setCodeWidth(width + (event.key === 'ArrowRight' ? step : -step));
  writeStored(codeWidthKey, String(width));
});
window.addEventListener('resize', () => setCodeWidth(width));
