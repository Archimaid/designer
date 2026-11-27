import '@fontsource-variable/space-grotesk';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';

import type { ArchiMateRelationship, ArchiMateSide } from 'archimaid/language';
import { DiagramCanvas, type Tool } from './canvas.ts';
import { DiagramDocument } from './document.ts';
import { defaultItemSize, gridUnit, type Point } from './geometry.ts';
import { notePaletteType, paletteType, tileIcon } from './catalogue.ts';
import { confirmTwice, createDropdown, isCoarsePointer, isTyping, pressOnly } from './dom.ts';
import { plural, sideNames } from './format.ts';
import { renderElementInspector, renderRelationshipInspector, renderSelectionBar } from './inspector.ts';
import { changedLineNumbers } from './history.ts';
import { isNote, nameOf, parentsOf, positionOf } from './model.ts';
import {
  nothingSelected,
  reconcile,
  selectedElement,
  selectedIds,
  selectedRelationship,
  selectionOf,
  type Selection,
} from './selection.ts';
import {
  gridSize,
  moveItem,
  moveItems,
  placeAt,
  rawGridFor,
  snapMove,
  snapResize,
  toCustomLayout,
  type Placement,
} from './placement.ts';
import { currentMode, isTextOpen, noteUnseenChange, readMode, setMode, setTextOpen, type Mode } from './modes.ts';
import { codeWidth, installCopyButton, showCursor, showStatus, showStorageState } from './text-panel.ts';
import { showToast, type ToastAction } from './toast.ts';
import { phone, ui } from './ui.ts';
import { createSourceEditor } from './editor.ts';
import { blankSource, blankTitle, examples, starterExample } from './examples.ts';
import { convertNotation, type Notation } from './notation.ts';
import { copyText } from './clipboard.ts';
import { exportDiagram, fileBaseOf } from './export.ts';
import { buildAddSheet, buildPalette, makeDraggable, type DragPayload } from './palette.ts';
import { closePicker, openPicker, pickerWidth } from './picker.ts';
import type { RelationshipChoice } from './relationships.ts';
import { renderDiagram } from './render.ts';
import { installTooltips } from './tooltip.ts';
import { decodeShareHash, shareLink } from './share.ts';
import { installImport } from './import.ts';
import {
  addElement,
  addNote,
  addRelationship,
  clearDiagram,
  countRelationshipLines,
  readRelationshipLabel,
  reconnectRelationship,
  removeRelationship,
  setAnchor,
  setRelationshipGlyph,
  setRelationshipLabel,
  idFromName,
  readDescription,
  readLayout,
  removeElement,
  renameElement,
  renameId,
  setDescription,
  setLayout,
  setNoteText,
  usedWords,
  type GridPoint,
  type GridSize,
  type RelationshipEnd,
} from './source.ts';
import { STAR_REQUEST_MS, starRequest } from './star-request.ts';
import { readStored, writeStored } from './storage.ts';

const sourceKey = 'archimaid.designer.source';
const titleKey = 'archimaid.designer.title';
const collapsedKey = 'archimaid.designer.palette-collapsed';
const groupsKey = 'archimaid.designer.open-groups';
const textEditDelayMs = 300;

let detailsOpen = false;

// Phones show the result on the canvas itself, so moves, resizes and pins need no notification there.
function layoutNote(message: string): string | undefined {
  return phone.matches ? undefined : message;
}

function syncSheets(): void {
  const open = [ui.selectionBar, ui.inspector, ui.relInspector, ui.addSheet].some(
    (sheet) => !sheet.classList.contains('is-hidden'),
  );
  document.body.classList.toggle('has-sheet', phone.matches && open);
  ui.scrim.hidden = !phone.matches || !(detailsOpen || !ui.addSheet.classList.contains('is-hidden'));
}

const doc = new DiagramDocument();
let lastSvg: string | undefined;
let current: Selection = nothingSelected;
let tool: Tool = 'select';
// Leaving the connect tool returns to this one, so touch screens keep their hand.
let toolBeforeConnect: Tool = 'select';
// The relationship type the palette armed the connect tool with, if any.
let connectGlyph: string | undefined;
let firstRender = true;
const afterRender: (() => void)[] = [];

const canvas: DiagramCanvas = new DiagramCanvas(ui.canvas, ui.stage, ui.overlay, {
  select: (id) => select(id),
  toggle: (id) => {
    const ids = selectedIds(current);
    setSelection(selectionOf(ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]));
  },
  selectMany: (ids) => setSelection(selectionOf(ids)),
  snap: (id, topLeft) => snapMove(placement(), id, topLeft),
  move: (lead, topLeft, followers) =>
    followers.length ? moveGroup(lead, topLeft, followers) : moveElement(lead, topLeft),
  snapResize: (id, box) => snapResize(placement(), id, box),
  resize: (id, box) => moveElement(id, box, gridSize(box)),
  connect: (from, to, client) => {
    const link = (glyph: string) =>
      commit(
        addRelationship(doc.source, from, glyph, to),
        `Connected ${nameOf(doc.model, from)} ${glyph} ${nameOf(doc.model, to)}`,
      );
    // A relationship type chosen in the palette is drawn at once; otherwise the picker asks which one.
    if (connectGlyph) link(connectGlyph);
    else openPicker(client, `${nameOf(doc.model, from)} → ${nameOf(doc.model, to)}`, link);
  },
  stopConnecting: () => {
    stopConnecting();
    setSelection(nothingSelected);
  },
  rename: (id) => startRename(id),
  selectRelationship: (id) => selectRelationship(id),
  reconnect: (id, end, element, side) => reconnect(id, end, element, side),
});
canvas.zoomListener = (scale) => {
  ui.zoomLevel.value = `${Math.round(scale * 100)}%`;
};

const editor = createSourceEditor(ui.editor, {
  initialSource: '',
  onChange: (text) => {
    doc.type(text, Date.now());
    persist();
    scheduleRefresh(textEditDelayMs);
  },
  onCursorMove: showCursor,
});

// Editing

function commit(next: string, message?: string): void {
  const before = doc.source;
  const outcome = doc.commit(next);
  if (outcome === 'refused') showToast('That change would break the text, so it was not applied.');
  if (outcome !== 'applied') return;
  persist();
  editor.rewriteSource(next);
  editor.markChanged(changedLineNumbers(before, next));
  noteUnseenChange();
  if (message) showToast(message, showCodeAction());
  void refresh();
}

// Shows a text that replaced the whole document, such as an undo or an opened diagram.
function showReplaced(): void {
  persist();
  editor.rewriteSource(doc.source);
  void refresh();
}

function undo(): void {
  if (doc.undo()) showReplaced();
}

function redo(): void {
  if (doc.redo()) showReplaced();
}

function persist(): void {
  showStorageState(writeStored(sourceKey, doc.source) ? 'saved' : 'blocked');
}

function placement(): Placement {
  return { model: doc.model, boxes: canvas.boxes, headerOf: (id) => canvas.headerOf(id) };
}

// The view follows a shift that made room above or left of the others, once the shifted diagram is drawn.
function applyShift({ x, y }: GridPoint): void {
  if (x || y) afterRender.push(() => canvas.shiftView(x * gridUnit, y * gridUnit));
}

function moveElement(id: string, topLeft: Point, size?: GridSize): void {
  const custom = doc.model?.layout === 'custom';
  const moved = moveItem(placement(), doc.source, id, topLeft, size);
  applyShift(moved.shift);
  const done = size
    ? `Resized ${nameOf(doc.model, id)} · size ${size.width}x${size.height}`
    : `Moved ${nameOf(doc.model, id)} · ${id} at ${moved.grid.x} ${moved.grid.y}`;
  commit(moved.text, custom ? layoutNote(done) : 'Switched to custom layout');
}

function moveGroup(lead: string, topLeft: Point, followers: readonly string[]): void {
  const moved = moveItems(placement(), doc.source, lead, topLeft, followers);
  // A drop on the spot it started from changes nothing, so only the drawing is put back.
  if (!moved) {
    void refresh();
    return;
  }
  applyShift(moved.shift);
  const note = `Moved ${followers.length + 1} elements`;
  commit(moved.text, doc.model?.layout === 'custom' ? layoutNote(note) : 'Switched to custom layout');
}

function dropOnCanvas(payload: DragPayload, client: Point | undefined): void {
  const rect = ui.canvas.getBoundingClientRect();
  const at = client ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const point = canvas.layoutPoint(at.x, at.y);
  const topLeft = { x: point.x - defaultItemSize.width / 2, y: point.y - defaultItemSize.height / 2 };
  if (payload.kind === 'place') {
    const placed = placeAt(placement(), doc.source, payload.id, rawGridFor(placement(), payload.id, topLeft));
    applyShift(placed.shift);
    commit(placed.text, layoutNote(`Placed ${nameOf(doc.model, payload.id)}`));
    return;
  }
  const { type } = payload;
  // The ID comes from the default name, so it follows the name the person types next.
  const id = idFromName(type.label, usedWords(doc.source));
  const added =
    type === notePaletteType
      ? addNote(doc.source, id, type.label)
      : addElement(doc.source, { type: type.key, id, name: type.label });
  let next = added;
  if (doc.model?.layout === 'custom') {
    const placed = placeAt(placement(), added, id, rawGridFor(placement(), id, topLeft));
    applyShift(placed.shift);
    next = placed.text;
  }
  afterRender.push(() => {
    select(id);
    startRename(id);
  });
  commit(next);
}

// The ID follows the name until someone gives it a name of its own.
function rename(id: string, name: string): string {
  if (isNote(doc.model, id)) return setNoteText(doc.source, id, name);
  const oldName = nameOf(doc.model, id);
  let next = renameElement(doc.source, id, name);
  const taken = usedWords(doc.source);
  taken.delete(id);
  if (idFromName(oldName, taken) === id) {
    const newId = idFromName(name, taken);
    if (newId !== id) {
      next = renameId(next, id, newId);
      if (selectedElement(current) === id) current = { kind: 'element', id: newId };
    }
  }
  return next;
}

// The inspector waits while the inline name field is open, so it never covers the element being named.
function startRename(id: string): void {
  ui.inspector.classList.add('is-hidden');
  ui.selectionBar.classList.add('is-hidden');
  canvas.startRename(
    id,
    nameOf(doc.model, id),
    (name) => commit(rename(id, name), `Saved “${name}” to the text`),
    showInspector,
  );
}

function deleteSelected(): void {
  const ids = selectedIds(current);
  const [first] = ids;
  if (first === undefined) return;
  const one = isNote(doc.model, first) ? 'the note' : nameOf(doc.model, first);
  const message = ids.length === 1 ? `Deleted ${one}` : `Deleted ${ids.length} items`;
  select(null, false);
  commit(
    ids.reduce((text, id) => removeElement(text, id), doc.source),
    message,
  );
}

function clearCanvas(): void {
  select(null, false);
  commit(clearDiagram(doc.source));
  showToast('Cleared the canvas', { label: 'Undo', run: undo });
}

// Selection and the inspector

let inspected: string | null = null;

// Leaving a field, the element or the inspector writes pending edits to the text.
function saveInspector(): void {
  const id = inspected;
  if (!id || !doc.model?.elements.some((element) => element.id === id)) return;
  let next = doc.source;
  const name = ui.fieldName.value.trim();
  if (name && name !== nameOf(doc.model, id)) next = rename(id, name);
  const currentId = selectedElement(current) ?? id;
  const description = ui.fieldDescription.value;
  if (description.trim() !== readDescription(next, currentId)) next = setDescription(next, currentId, description);
  if (next !== doc.source) {
    inspected = selectedElement(current);
    commit(next, `Saved “${name || nameOf(doc.model, id)}” to the text`);
  }
}

function select(id: string | null, save = true): void {
  setSelection(id ? { kind: 'element', id } : nothingSelected, save);
}

function drawSelection(): void {
  const relationship = selectedRelationshipModel();
  if (relationship) canvas.setRelationshipSelection(relationship.id);
  else canvas.setSelection(selectedIds(current));
}

// Every change of selection first writes what the inspectors hold. Selecting shows handles and the
// inspector, which belong to editing, so it puts the connect tool away.
function setSelection(next: Selection, save = true): void {
  if (next.kind !== 'none') stopConnecting();
  const elementChanged = selectedElement(next) !== selectedElement(current);
  if (save && elementChanged) saveInspector();
  if (save) saveRelationshipInspector();
  if (elementChanged) detailsOpen = false;
  current = next;
  drawSelection();
  showInspector();
  showRelationshipInspector();
}

// Relationships

// Relationship edits address lines by position, which only works while the text and the model agree.
function relationshipsEditable(): boolean {
  if (doc.model && countRelationshipLines(doc.source) === doc.model.relationships.length) return true;
  showToast('Fix the text first: its relationships do not match the diagram.');
  return false;
}

function relationshipIndex(id: string): number {
  return doc.model?.relationships.findIndex((relationship) => relationship.id === id) ?? -1;
}

function selectedRelationshipModel(): ArchiMateRelationship | undefined {
  const index = selectedRelationship(current);
  return index === null ? undefined : doc.model?.relationships[index];
}

function selectRelationship(id: string): void {
  const index = relationshipIndex(id);
  setSelection(index >= 0 ? { kind: 'relationship', index } : nothingSelected);
}

function reconnect(id: string, end: RelationshipEnd, element: string, side: ArchiMateSide): void {
  const index = relationshipIndex(id);
  const relationship = doc.model?.relationships[index];
  if (!relationship || !relationshipsEditable()) return;
  const which = end === 'source' ? 'start' : 'end';
  if (relationship[end] === element) {
    const note = doc.model?.layout === 'custom' ? '' : ' (used in custom layout)';
    commit(
      setAnchor(doc.source, index, end, side),
      layoutNote(`Pinned the ${which} to the ${sideNames[side]} side${note}`),
    );
  } else {
    commit(
      reconnectRelationship(doc.source, index, end, element),
      `Moved the ${which} to ${nameOf(doc.model, element)}`,
    );
  }
}

function saveRelationshipInspector(): void {
  const index = selectedRelationship(current);
  if (index === null || !doc.model?.relationships[index] || ui.relInspector.classList.contains('is-hidden')) return;
  const label = ui.relLabel.value.trim();
  if (label === readRelationshipLabel(doc.source, index) || !relationshipsEditable()) return;
  commit(setRelationshipLabel(doc.source, index, label), label ? `Labelled “${label}”` : 'Removed the label');
}

function showRelationshipInspector(): void {
  const index = selectedRelationship(current);
  const relationship = selectedRelationshipModel();
  ui.relInspector.classList.toggle('is-hidden', !relationship);
  syncSheets();
  if (doc.model && relationship && index !== null)
    renderRelationshipInspector(relationship, index, doc.model, doc.source);
}

function deleteRelationship(): void {
  const index = selectedRelationship(current);
  if (index === null || !relationshipsEditable()) return;
  setSelection(nothingSelected, false);
  commit(removeRelationship(doc.source, index), 'Deleted the relationship');
}

function showInspector(): void {
  const selected = selectedElement(current);
  const element = selected ? doc.model?.elements.find(({ id }) => id === selected) : undefined;
  if (!element) detailsOpen = false;
  ui.inspector.classList.toggle('is-hidden', !element || (phone.matches && !detailsOpen));
  ui.selectionBar.classList.toggle('is-hidden', !element || !phone.matches || detailsOpen);
  syncSheets();
  inspected = element?.id ?? null;
  if (!doc.model || !element) return;
  renderSelectionBar(element);
  renderElementInspector(element, doc.model, doc.source);
}

// Rendering

let refreshTimer: number | undefined;

function scheduleRefresh(delay: number): void {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), delay);
}

async function refresh(): Promise<void> {
  clearTimeout(refreshTimer);
  doc.validate();
  showStatus(editor, { source: doc.source, model: doc.model, diagnostics: doc.diagnostics });
  updateChrome();
  const errors = doc.diagnostics.filter(({ severity }) => severity === 'error');
  ui.errorChip.hidden = errors.length === 0;
  if (errors.length) {
    const [first] = errors;
    ui.errorMessage.textContent = `Line ${first?.line}: ${first?.message} Showing the last valid diagram.`;
    return;
  }
  const outcome = await renderDiagram(doc.source);
  if (outcome.kind === 'superseded') return;
  if (outcome.kind === 'failed') {
    ui.errorChip.hidden = false;
    ui.errorMessage.textContent = outcome.message;
    return;
  }
  lastSvg = outcome.svg;
  canvas.setSvg(outcome.svg);
  current = reconcile(current, (id) => canvas.boxes.has(id), doc.model?.relationships.length ?? 0);
  drawSelection();
  showInspector();
  showRelationshipInspector();
  updateTray();
  if (firstRender) {
    firstRender = false;
    fit();
  }
  for (const action of afterRender.splice(0)) action();
}

function showCodeAction(): ToastAction | undefined {
  return isTextOpen() ? undefined : { label: 'Show code', run: () => switchMode('code') };
}

function selectNotation(notation: Notation): void {
  const name = notation === 'long' ? 'long form' : 'shorthand';
  const keptNote = (kept: number): string =>
    kept > 0 ? ` ${plural(kept, 'relationship')} stay in long form because other lines refer to their IDs.` : '';
  const result = convertNotation(doc.source, notation);
  switch (result.kind) {
    case 'converted':
      commit(result.source, `Rewrote ${plural(result.converted, 'relationship')} in ${name}.${keptNote(result.kept)}`);
      return;
    case 'unchanged':
      showToast(`The relationships are already in ${name}.${keptNote(result.kept)}`);
      return;
    case 'invalid':
      showToast('Fix the errors first; only a valid diagram can be rewritten.');
      return;
    case 'failed':
      showToast('This diagram could not be rewritten without changing it, so it was left as it is.');
      return;
  }
}

function updateChrome(): void {
  const layout = readLayout(doc.source);
  const custom = layout === 'custom';
  pressOnly([ui.layoutAuto, ui.layoutCustom], custom ? ui.layoutCustom : ui.layoutAuto);
  ui.undo.disabled = !doc.canUndo;
  ui.redo.disabled = !doc.canRedo;
  const empty = clearDiagram(doc.source) === doc.source;
  document.body.classList.toggle('is-empty', isBlank());
  ui.clear.disabled = empty;
  ui.mClear.disabled = empty;
}

// Nothing to look at, which is when View mode asks for a diagram and a stray paste deserves an explanation.
function isBlank(): boolean {
  return !doc.model?.elements.length;
}

function updateTray(): void {
  for (const chip of ui.tray.querySelectorAll('.tile')) chip.remove();
  const nested = parentsOf(doc.model);
  const unplaced =
    doc.model?.layout === 'custom'
      ? doc.model.elements.filter((element) => !nested.has(element.id) && !positionOf(doc.model, element.id))
      : [];
  ui.tray.hidden = unplaced.length === 0;
  // The palette reaches down to the tray, or to the bottom margin when there is nothing unplaced.
  ui.palette.classList.toggle('above-tray', !ui.tray.hidden);
  for (const element of unplaced) {
    const type = paletteType(element.type);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `tile t-${type?.category ?? 'composite'}`;
    chip.dataset.tip = 'Drag onto the canvas to place it';
    if (type) chip.append(tileIcon(type, true));
    chip.append(element.name);
    makeDraggable(chip, () => ({ kind: 'place', id: element.id }), { drop: dropOnCanvas });
    ui.tray.append(chip);
  }
}

function fit(animate = false): void {
  if (phone.matches) {
    canvas.fit({ left: 16, right: 16, top: 152, bottom: 96 }, animate);
    return;
  }
  const paletteOpen = !ui.palette.classList.contains('is-hidden');
  const inspectorOpen = current.kind === 'element' || current.kind === 'relationship';
  canvas.fit(
    {
      left: { view: 40, code: codeWidth() + 48, design: paletteOpen ? 408 : 100 }[currentMode()],
      right: inspectorOpen ? 340 : 40,
      top: 96,
      bottom: 80,
    },
    animate,
  );
}

function setCollapsed(collapsed: boolean): void {
  ui.palette.classList.toggle('is-hidden', collapsed);
  ui.rail.classList.toggle('is-hidden', !collapsed);
  ui.tray.style.width = collapsed ? 'auto' : '';
  writeStored(collapsedKey, collapsed ? '1' : '0');
}

function runExport(kind: string): void {
  exportDiagram(kind, doc.source, lastSvg, fileBaseOf(ui.title.value))
    .then((downloaded) => {
      const ask = downloaded ? starRequest() : undefined;
      if (ask) showToast('Exported. Enjoying Archimaid?', ask, STAR_REQUEST_MS);
    })
    .catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : 'Export failed.');
    });
}

// Wiring

document.addEventListener('keydown', (event) => {
  if (currentMode() === 'view') {
    if (event.key === 'Escape') select(null);
    return;
  }
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'z' && !isTyping(event.target)) {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && event.key.toLowerCase() === 'y' && !isTyping(event.target)) {
    event.preventDefault();
    redo();
    return;
  }
  if (isTyping(event.target)) return;
  if (!command && !event.altKey && event.key.toLowerCase() === 'v') {
    setTool('select');
  } else if (!command && !event.altKey && event.key.toLowerCase() === 'h') {
    setTool('hand');
  } else if (!command && !event.altKey && !event.defaultPrevented && event.key.toLowerCase() === 'c') {
    // The open picker takes C for Composition and marks the key as handled.
    setTool('connect');
  } else if (command && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    setSelection(selectionOf((doc.model?.elements ?? []).map(({ id }) => id).filter((id) => canvas.boxes.has(id))));
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && current.kind === 'relationship') {
    event.preventDefault();
    deleteRelationship();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds(current).length) {
    event.preventDefault();
    deleteSelected();
  } else if (event.key === 'Enter' && current.kind === 'element') {
    event.preventDefault();
    startRename(current.id);
  } else if (event.key === 'Escape' && !event.defaultPrevented) {
    // An Escape the picker handled only closes the picker, so the connect tool stays on for another pair.
    canvas.cancel();
    closePicker();
    stopConnecting();
    select(null);
  }
});

ui.fieldName.addEventListener('change', saveInspector);
ui.fieldName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') ui.fieldName.blur();
});
ui.fieldDescription.addEventListener('change', saveInspector);
ui.inspectorClose.addEventListener('click', () => {
  if (!phone.matches) {
    select(null);
    return;
  }
  // On a phone, closing the details keeps the element selected and returns to its action bar.
  saveInspector();
  detailsOpen = false;
  showInspector();
});
ui.barDetails.addEventListener('click', () => {
  detailsOpen = true;
  showInspector();
});
ui.barRename.addEventListener('click', () => {
  if (current.kind === 'element') startRename(current.id);
});
ui.barDelete.addEventListener('click', deleteSelected);
ui.barClose.addEventListener('click', () => select(null));
ui.scrim.addEventListener('click', () => {
  if (detailsOpen) ui.inspectorClose.click();
  setAddSheet(false);
});
ui.tabCanvas.addEventListener('click', () => setTextOpen(false));
ui.tabText.addEventListener('click', () => setTextOpen(true));
ui.mUndo.addEventListener('click', undo);

function setAddSheet(open: boolean): void {
  ui.addSheet.classList.toggle('is-hidden', !open);
  if (!open) ui.addSearch.value = '';
  syncSheets();
}
ui.addOpen.addEventListener('click', () => {
  select(null);
  setAddSheet(true);
});
ui.addClose.addEventListener('click', () => setAddSheet(false));
buildAddSheet({
  chips: ui.addChips,
  tiles: ui.addTiles,
  search: ui.addSearch,
  pick: (type) => {
    setAddSheet(false);
    dropOnCanvas({ kind: 'type', type }, undefined);
  },
});

const closeMoreMenu = createDropdown(ui.mMore, ui.moreMenu);
const moreActions: Record<string, () => void> = {
  auto: () => ui.layoutAuto.click(),
  custom: () => ui.layoutCustom.click(),
  redo,
  share: () => ui.share.click(),
  svg: () => runExport('svg'),
  png: () => runExport('png'),
  mmd: () => runExport('mmd'),
};
for (const item of ui.moreMenu.querySelectorAll<HTMLButtonElement>('[data-more]')) {
  item.addEventListener('click', () => moreActions[item.dataset.more ?? '']?.());
}
phone.addEventListener('change', () => {
  detailsOpen = false;
  showInspector();
});
ui.remove.addEventListener('click', deleteSelected);
ui.relClose.addEventListener('click', () => select(null));
ui.relDelete.addEventListener('click', deleteRelationship);
ui.relLabel.addEventListener('change', saveRelationshipInspector);
ui.relLabel.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') ui.relLabel.blur();
});
ui.relRetype.addEventListener('click', () => {
  const index = selectedRelationship(current);
  if (index === null || !selectedRelationshipModel()) return;
  const rect = ui.relRetype.getBoundingClientRect();
  openPicker({ x: rect.left - pickerWidth, y: rect.top - 12 }, 'Change the type', (glyph) => {
    if (relationshipsEditable()) commit(setRelationshipGlyph(doc.source, index, glyph), `Changed the type to ${glyph}`);
  });
});

ui.layoutAuto.addEventListener('click', () => {
  if (readLayout(doc.source) !== 'custom') return;
  commit(setLayout(doc.source, 'architecture'), 'Auto layout · positions kept in the text');
});
ui.layoutCustom.addEventListener('click', () => {
  if (readLayout(doc.source) === 'custom') return;
  commit(toCustomLayout(placement(), doc.source), 'Custom layout · elements pinned where they are');
});
ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);
ui.errorOpen.addEventListener('click', () => {
  switchMode('code');
  const first = doc.diagnostics.find(({ severity }) => severity === 'error');
  if (first) editor.revealDiagnostic(first);
});
ui.collapse.addEventListener('click', () => setCollapsed(true));
ui.expand.addEventListener('click', () => setCollapsed(false));
ui.zoomIn.addEventListener('click', () => canvas.zoomBy(1.2));
ui.zoomOut.addEventListener('click', () => canvas.zoomBy(1 / 1.2));
ui.zoomFit.addEventListener('click', () => fit(true));

createDropdown(ui.exportToggle, ui.exportMenu);
for (const item of ui.exportMenu.querySelectorAll<HTMLButtonElement>('[data-export]')) {
  item.addEventListener('click', () => {
    runExport(item.dataset.export ?? '');
  });
}

ui.share.addEventListener('click', async () => {
  const link = await shareLink(doc.source);
  history.replaceState(null, '', link);
  const result = (await copyText(link)) ? 'Link copied' : 'Link is in the address bar';
  const ask = starRequest();
  if (ask) showToast(`${result}. Enjoying Archimaid?`, ask, STAR_REQUEST_MS);
  else showToast(result);
});

installCopyButton(() => doc.source);

function showTitle(title: string): void {
  ui.title.value = title;
  ui.fileName.textContent = `${fileBaseOf(title)}.mmd`;
}

function setTitle(title: string): void {
  showTitle(title);
  writeStored(titleKey, title);
}

ui.title.addEventListener('change', () => setTitle(ui.title.value));

// Opening replaces the whole diagram in one undo step. The notification's Undo also brings the old name back,
// as long as nothing was edited since.
function openDiagram(next: string, title: string, message: string): void {
  const previous = { source: doc.source, title: ui.title.value };
  if (next === previous.source && title === previous.title) return;
  select(null, false);
  setTitle(title);
  // A share link in the address would otherwise reopen the shared diagram on the next visit.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  afterRender.push(() => fit(true));
  doc.replace(next);
  showReplaced();
  showToast(message, {
    label: 'Undo',
    run: () => {
      if (doc.source !== next) return;
      undo();
      setTitle(previous.title);
    },
  });
}

ui.exampleItems.replaceChildren(
  ...examples.map((example) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.textContent = example.title;
    item.addEventListener('click', () => openDiagram(example.source, example.title, `Opened “${example.title}”`));
    return item;
  }),
);
ui.newDiagram.addEventListener('click', () => openDiagram(blankSource, blankTitle, 'Started a new diagram'));
createDropdown(ui.examplesToggle, ui.examplesMenu);
ui.emptyExamples.addEventListener('click', () => ui.examplesToggle.click());
installImport({
  open: (next, title) => openDiagram(next, title, `Opened “${title}”`),
  expectsPaste: () => currentMode() === 'view' || isBlank(),
});

const openGroups = new Set((readStored(groupsKey) ?? 'business').split(',').filter(Boolean).slice(0, 1));
const showArmedRelationship = buildPalette(
  {
    groups: ui.groups,
    rail: ui.railGroups,
    search: ui.search,
    openGroups,
    onToggleGroup: (open) => writeStored(groupsKey, [...open].join(',')),
    connectors: {
      armed: () => connectGlyph,
      // Choosing the armed type again puts it away.
      choose: (choice) => (connectGlyph === choice.glyph ? stopConnecting() : setTool('connect', choice)),
    },
  },
  { drop: dropOnCanvas },
);

window.addEventListener('resize', drawSelection);

confirmTwice(ui.clear, clearCanvas);
confirmTwice(ui.mClear, () => {
  closeMoreMenu();
  clearCanvas();
});

// The connect tool links the next two elements clicked. With a relationship type from the palette it draws
// that type straight away; from the bottom bar it asks for the type once both ends are known. It stays on
// for the next line until the canvas is clicked or Escape is pressed.
function setTool(next: Tool, relationship?: RelationshipChoice): void {
  const wasConnecting = tool === 'connect';
  const previousGlyph = connectGlyph;
  const connecting = next === 'connect';
  if (connecting && !wasConnecting) {
    toolBeforeConnect = tool;
    select(null);
  }
  tool = next;
  connectGlyph = connecting ? relationship?.glyph : undefined;
  canvas.tool = next;
  const pressed = { select: ui.toolSelect, hand: ui.toolHand, connect: ui.toolConnect }[next];
  pressOnly([ui.toolSelect, ui.toolHand, ui.toolConnect], pressed);
  showArmedRelationship();
  if (connecting && (!wasConnecting || previousGlyph !== connectGlyph)) {
    const how = relationship ? `${relationship.name}: click` : 'Click';
    showToast(`${how} the start element, then the end. Click the canvas to stop.`);
  }
}
function stopConnecting(): void {
  if (tool === 'connect') setTool(toolBeforeConnect);
}

ui.toolSelect.addEventListener('click', () => setTool('select'));
ui.toolHand.addEventListener('click', () => setTool('hand'));
ui.toolConnect.addEventListener('click', () => {
  if (tool === 'connect' && !connectGlyph) stopConnecting();
  else setTool('connect');
});
// A finger has no scroll wheel, so touch screens start with the hand and a one-finger drag moves the canvas.
setTool(isCoarsePointer() ? 'hand' : 'select');

// View mode still selects, so names, descriptions and relationships can be read, but its fields only show.
function applyMode(next: Mode): void {
  const viewing = next === 'view';
  if (viewing) stopConnecting();
  if (viewing) select(null);
  for (const field of [ui.fieldName, ui.fieldDescription, ui.relLabel]) field.readOnly = viewing;
  ui.fieldDescription.placeholder = viewing ? 'No description' : '';
  ui.relLabel.placeholder = viewing ? 'No label' : 'Optional';
  canvas.readOnly = viewing;
  setMode(next);
}

function switchMode(next: Mode): void {
  if (currentMode() === next) return;
  applyMode(next);
  fit(true);
}

ui.modeView.addEventListener('click', () => switchMode('view'));
ui.viewEdit.addEventListener('click', () => switchMode('design'));
ui.modeDesign.addEventListener('click', () => switchMode('design'));
ui.modeCode.addEventListener('click', () => switchMode('code'));

ui.notationLong.addEventListener('click', () => selectNotation('long'));
ui.notationShorthand.addEventListener('click', () => selectNotation('shorthand'));

installTooltips();

async function start(): Promise<void> {
  const shared = await decodeShareHash(location.hash);
  applyMode(readMode(shared.kind === 'source'));
  showTitle(readStored(titleKey) ?? starterExample.title);
  setCollapsed(readStored(collapsedKey) === '1');
  doc.load(shared.kind === 'source' ? shared.source : (readStored(sourceKey) ?? starterExample.source));
  if (shared.kind === 'invalid') showToast('That share link is damaged, so your last diagram opened instead.');
  showStorageState(shared.kind === 'source' ? 'shared' : 'saved');
  editor.rewriteSource(doc.source);
  await refresh();
}

void start();
