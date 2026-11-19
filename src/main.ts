import '@fontsource-variable/space-grotesk';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';

import {
  relationshipConnectors,
  relationshipNames,
  validateArchiMate,
  type ArchiMateDiagnostic,
  type ArchiMateModel,
  type ArchiMateRelationship,
} from 'archimaid/language';
import {
  DiagramCanvas,
  gridUnit,
  layoutPadding,
  type End,
  type Point,
  type Side,
  type Snapped,
  type Tool,
} from './canvas.ts';
import { notePaletteType, paletteType, tileIcon } from './catalogue.ts';
import { byId, confirmTwice, createDropdown, pressOnly } from './dom.ts';
import { createSourceEditor } from './editor.ts';
import { blankSource, blankTitle, examples, starterExample } from './examples.ts';
import { convertNotation, detectNotation, type Notation } from './notation.ts';
import { copyText } from './clipboard.ts';
import { downloadBlob, prepareSvg, renderPng } from './export.ts';
import { buildAddSheet, buildPalette, makeDraggable, type DragPayload } from './palette.ts';
import { closePicker, openPicker } from './picker.ts';
import { renderDiagram } from './render.ts';
import { installTooltips } from './tooltip.ts';
import { decodeShareHash, encodeShareHash } from './share.ts';
import {
  addElement,
  addNote,
  addRelationship,
  clearDiagram,
  countRelationshipLines,
  readAnchor,
  readRelationshipLabel,
  readRelationshipLine,
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
  setPosition,
  setPositions,
  setSize,
  shiftPositions,
  usedWords,
  type GridPoint,
  type GridSize,
} from './source.ts';
import { readStored, writeStored } from './storage.ts';

const sourceKey = 'archimaid.designer.source';
const modeKey = 'archimaid.designer.mode';
const codeWidthKey = 'archimaid.designer.code-width';
const titleKey = 'archimaid.designer.title';
const collapsedKey = 'archimaid.designer.palette-collapsed';
const groupsKey = 'archimaid.designer.open-groups';
const textEditDelayMs = 300;
const historyMergeMs = 800;
const toastMs = 2800;

const ui = {
  canvas: byId('canvas'),
  stage: byId('stage'),
  overlay: byId('overlay'),
  title: byId<HTMLInputElement>('title'),
  examplesToggle: byId<HTMLButtonElement>('examples-toggle'),
  examplesMenu: byId('examples-menu'),
  exampleItems: byId('example-items'),
  newDiagram: byId<HTMLButtonElement>('new-diagram'),
  layoutAuto: byId<HTMLButtonElement>('layout-auto'),
  layoutCustom: byId<HTMLButtonElement>('layout-custom'),
  undo: byId<HTMLButtonElement>('undo'),
  redo: byId<HTMLButtonElement>('redo'),
  clear: byId<HTMLButtonElement>('clear'),
  mClear: byId<HTMLButtonElement>('m-clear'),
  toolSelect: byId<HTMLButtonElement>('tool-select'),
  toolHand: byId<HTMLButtonElement>('tool-hand'),
  exportToggle: byId<HTMLButtonElement>('export-toggle'),
  exportMenu: byId('export-menu'),
  share: byId<HTMLButtonElement>('share'),
  palette: byId('palette'),
  rail: byId('rail'),
  railGroups: byId('rail-groups'),
  groups: byId('groups'),
  search: byId<HTMLInputElement>('search'),
  collapse: byId<HTMLButtonElement>('collapse'),
  expand: byId<HTMLButtonElement>('expand'),
  inspector: byId('inspector'),
  relInspector: byId('rel-inspector'),
  relGlyph: byId('rel-glyph'),
  relType: byId('rel-type'),
  relId: byId('rel-id'),
  relClose: byId<HTMLButtonElement>('rel-close'),
  relFrom: byId('rel-from'),
  relTo: byId('rel-to'),
  relLabel: byId<HTMLInputElement>('rel-label'),
  relRetype: byId<HTMLButtonElement>('rel-retype'),
  relDelete: byId<HTMLButtonElement>('rel-delete'),
  inspectorIcon: byId('inspector-icon'),
  inspectorType: byId('inspector-type'),
  inspectorId: byId('inspector-id'),
  inspectorClose: byId<HTMLButtonElement>('inspector-close'),
  fieldName: byId<HTMLInputElement>('field-name'),
  fieldDescription: byId<HTMLTextAreaElement>('field-description'),
  infoPosition: byId('info-position'),
  infoSize: byId('info-size'),
  relations: byId('relations'),
  remove: byId<HTMLButtonElement>('delete'),
  drawer: byId('drawer'),
  fileName: byId('file-name'),
  editor: byId('editor'),
  statusChip: byId('status-chip'),
  notationLong: byId<HTMLButtonElement>('notation-long'),
  notationShorthand: byId<HTMLButtonElement>('notation-shorthand'),
  problems: byId('problems'),
  problemsCount: byId('problems-count'),
  problemsList: byId('problems-list'),
  cursorPosition: byId('cursor-position'),
  modelSummary: byId('model-summary'),
  storageState: byId('storage-state'),
  drawerResize: byId('drawer-resize'),
  modeDesign: byId<HTMLButtonElement>('mode-design'),
  modes: byId('modes'),
  modeCode: byId<HTMLButtonElement>('mode-code'),
  codeBadge: byId('code-badge'),
  copyText: byId<HTMLButtonElement>('copy-text'),
  tray: byId('tray'),
  zoomOut: byId<HTMLButtonElement>('zoom-out'),
  zoomIn: byId<HTMLButtonElement>('zoom-in'),
  zoomFit: byId<HTMLButtonElement>('zoom-fit'),
  zoomLevel: byId<HTMLOutputElement>('zoom-level'),
  errorChip: byId('error-chip'),
  errorMessage: byId('error-message'),
  errorOpen: byId<HTMLButtonElement>('error-open'),
  toast: byId('toast'),
  toastMessage: byId('toast-message'),
  toastAction: byId<HTMLButtonElement>('toast-action'),
  mUndo: byId<HTMLButtonElement>('m-undo'),
  mMore: byId<HTMLButtonElement>('m-more'),
  moreMenu: byId('more-menu'),
  tabCanvas: byId<HTMLButtonElement>('tab-canvas'),
  tabText: byId<HTMLButtonElement>('tab-text'),
  tabBadge: byId('tab-badge'),
  addOpen: byId<HTMLButtonElement>('add-open'),
  addSheet: byId('add-sheet'),
  addClose: byId<HTMLButtonElement>('add-close'),
  addSearch: byId<HTMLInputElement>('add-search'),
  addChips: byId('add-chips'),
  addTiles: byId('add-tiles'),
  scrim: byId('scrim'),
  selectionBar: byId('selection-bar'),
  barIcon: byId('bar-icon'),
  barName: byId('bar-name'),
  barType: byId('bar-type'),
  barDetails: byId<HTMLButtonElement>('bar-details'),
  barRename: byId<HTMLButtonElement>('bar-rename'),
  barDelete: byId<HTMLButtonElement>('bar-delete'),
  barClose: byId<HTMLButtonElement>('bar-close'),
};

// Phones get full-width sheets: a selected element shows a short action bar, and its details open on demand.
const phone = matchMedia('(max-width: 760px)');
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

// The source text is the only document state; everything else is derived from it or is view state.
let source = '';
let model: ArchiMateModel | undefined;
let diagnostics: readonly ArchiMateDiagnostic[] = [];
let lastSvg: string | undefined;
let selected: string | null = null;
// Two or more selected elements; while it holds any, `selected` is null and no inspector shows.
let group: readonly string[] = [];
// A relationship is selected by its place among the relationships, which survives edits that change its ID.
let selectedRelationship: number | null = null;
let textOpen = false;
let unseenChanges = 0;
let firstRender = true;
const undoStack: string[] = [];
const redoStack: string[] = [];
let lastTextEdit = 0;
const afterRender: (() => void)[] = [];

const canvas: DiagramCanvas = new DiagramCanvas(ui.canvas, ui.stage, ui.overlay, {
  select: (id) => select(id),
  toggle: (id) => {
    const current = selection();
    selectMany(current.includes(id) ? current.filter((other) => other !== id) : [...current, id]);
  },
  selectMany: (ids) => selectMany(ids),
  snap: (id, topLeft): Snapped => {
    const raw = rawGridFor(id, topLeft);
    const grid = parents().has(id) ? gridFor(id, topLeft) : raw;
    const box = canvas.boxes.get(id);
    const origin = gridOrigin(id);
    return {
      box: {
        x: origin.x + grid.x * gridUnit,
        y: origin.y + grid.y * gridUnit,
        width: box?.width ?? 140,
        height: box?.height ?? 60,
      },
      label: grid.x < 0 || grid.y < 0 ? 'Moves the others to make room' : `${id} at ${grid.x} ${grid.y}`,
    };
  },
  move: (lead, topLeft, followers) =>
    followers.length ? moveGroup(lead, topLeft, followers) : moveElement(lead, topLeft),
  snapResize: (id, box): Snapped => {
    const grid = parents().has(id) ? gridFor(id, box) : rawGridFor(id, box);
    const origin = gridOrigin(id);
    const size = gridSize(box);
    return {
      box: {
        x: origin.x + grid.x * gridUnit,
        y: origin.y + grid.y * gridUnit,
        width: size.width * gridUnit,
        height: size.height * gridUnit,
      },
      label: `size ${size.width}x${size.height}`,
    };
  },
  resize: (id, box) => moveElement(id, box, gridSize(box)),
  connect: (from, to, client) => {
    openPicker(client, `${nameOf(from)} → ${nameOf(to)}`, (glyph) => {
      commit(addRelationship(source, from, glyph, to), `Connected ${nameOf(from)} ${glyph} ${nameOf(to)}`);
    });
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
    // Typing is one history step per pause, not one per keystroke.
    const now = Date.now();
    if (now - lastTextEdit > historyMergeMs) pushHistory();
    lastTextEdit = now;
    source = text;
    persist();
    scheduleRefresh(textEditDelayMs);
  },
  onCursorMove: ({ line, column }) => {
    ui.cursorPosition.textContent = `Ln ${line}, Col ${column}`;
  },
});

// Model lookups

function parents(): Map<string, string> {
  return new Map((model?.nesting ?? []).map(({ child, parent }) => [child, parent]));
}

function nameOf(id: string): string {
  return (
    model?.elements.find((element) => element.id === id)?.name ??
    model?.notes?.find((note) => note.id === id)?.text ??
    id
  );
}

function isNote(id: string): boolean {
  return model?.notes?.some((note) => note.id === id) ?? false;
}

function positionOf(id: string) {
  return model?.positions?.find((position) => position.id === id);
}

function gridOrigin(id: string): Point {
  const parent = parents().get(id);
  const box = parent ? canvas.boxes.get(parent) : undefined;
  if (!parent || !box) return { x: layoutPadding, y: layoutPadding };
  return { x: box.x + layoutPadding, y: box.y + canvas.headerOf(parent) + layoutPadding };
}

function rawGridFor(id: string, topLeft: Point): GridPoint {
  const origin = gridOrigin(id);
  return { x: Math.round((topLeft.x - origin.x) / gridUnit), y: Math.round((topLeft.y - origin.y) / gridUnit) };
}

function gridFor(id: string, topLeft: Point): GridPoint {
  const raw = rawGridFor(id, topLeft);
  return { x: Math.max(0, raw.x), y: Math.max(0, raw.y) };
}

// The canvas has no edge: a top-level element placed above or left of the others shifts them all by the
// same amount, and the view moves with them so nothing appears to jump. Nested elements stay in their parent.
function placeAll(
  text: string,
  targets: ReadonlyMap<string, GridPoint>,
): { text: string; placed: Map<string, GridPoint> } {
  const nested = parents();
  const topLevelTargets = [...targets].filter(([id]) => !nested.has(id)).map(([, raw]) => raw);
  const dx = Math.max(0, ...topLevelTargets.map((raw) => -raw.x));
  const dy = Math.max(0, ...topLevelTargets.map((raw) => -raw.y));
  let next = text;
  if (dx || dy) {
    const topLevel = new Set([
      ...(model?.elements ?? []).filter((element) => !nested.has(element.id)).map((element) => element.id),
      ...(model?.notes ?? []).filter((note) => !note.on).map((note) => note.id),
    ]);
    next = shiftPositions(next, dx, dy, topLevel);
    afterRender.push(() => canvas.shiftView(dx * gridUnit, dy * gridUnit));
  }
  const placed = new Map<string, GridPoint>();
  for (const [id, raw] of targets) {
    const grid = nested.has(id) ? { x: Math.max(0, raw.x), y: Math.max(0, raw.y) } : { x: raw.x + dx, y: raw.y + dy };
    placed.set(id, grid);
    next = setPosition(next, id, grid);
  }
  return { text: next, placed };
}

function placeAt(text: string, id: string, raw: GridPoint): { text: string; grid: GridPoint } {
  const { text: next, placed } = placeAll(text, new Map([[id, raw]]));
  const grid = placed.get(id);
  if (!grid) throw new Error(`placeAll did not place ${id}.`);
  return { text: next, grid };
}

// Pins every element at the place automatic layout put it, so switching to custom layout moves nothing.
function pinnedFromCanvas(except?: string): Map<string, GridPoint> {
  const nested = parents();
  const pinned = new Map<string, GridPoint>();
  for (const element of model?.elements ?? []) {
    if (element.id === except || nested.has(element.id) || positionOf(element.id)) continue;
    const box = canvas.boxes.get(element.id);
    if (box) pinned.set(element.id, gridFor(element.id, box));
  }
  return pinned;
}

function toCustomLayout(text: string, except?: string): string {
  return setLayout(setPositions(text, pinnedFromCanvas(except)), 'custom');
}

// Editing

function pushHistory(): void {
  undoStack.push(source);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

function changedLineNumbers(before: string, after: string): number[] {
  const remaining = new Map<string, number>();
  for (const line of before.split('\n')) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const changed: number[] = [];
  after.split('\n').forEach((line, index) => {
    const count = remaining.get(line) ?? 0;
    if (count > 0) remaining.set(line, count - 1);
    else if (line.trim()) changed.push(index + 1);
  });
  return changed;
}

const hasErrors = (text: string): boolean =>
  validateArchiMate(text).diagnostics.some(({ severity }) => severity === 'error');

function commit(next: string, message?: string): void {
  if (next === source) return;
  // The canvas never turns valid text into invalid text; a refused edit leaves the diagram as it was.
  if (hasErrors(next) && !hasErrors(source)) {
    showToast('That change would break the text, so it was not applied.', undefined);
    return;
  }
  pushHistory();
  const before = source;
  source = next;
  persist();
  editor.rewriteSource(next);
  editor.markChanged(changedLineNumbers(before, next));
  if (!textOpen) {
    unseenChanges++;
    ui.codeBadge.textContent = String(unseenChanges);
    ui.codeBadge.hidden = false;
    ui.tabBadge.textContent = String(unseenChanges);
    ui.tabBadge.hidden = false;
  }
  if (message) showToast(message);
  void refresh();
}

function replaceAll(next: string): void {
  source = next;
  persist();
  editor.rewriteSource(next);
  void refresh();
}

function undo(): void {
  const previous = undoStack.pop();
  if (previous === undefined) return;
  redoStack.push(source);
  replaceAll(previous);
}

function redo(): void {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(source);
  replaceAll(next);
}

function persist(): void {
  showStorageState(writeStored(sourceKey, source) ? 'saved' : 'blocked');
}

function showStorageState(state: 'saved' | 'blocked' | 'shared'): void {
  ui.storageState.textContent = {
    saved: 'Saved in this browser',
    blocked: 'Not saved: browser storage is blocked',
    shared: 'Opened from a share link',
  }[state];
}

function gridSize(box: { width: number; height: number }): GridSize {
  return {
    width: Math.max(1, Math.round(box.width / gridUnit)),
    height: Math.max(1, Math.round(box.height / gridUnit)),
  };
}

// Moving and resizing share one edit: resizing from the top or left edge moves the element too.
// A position inside an unpositioned parent is ignored, so the parents are pinned where they are.
function pinParents(text: string, id: string): string {
  let next = text;
  for (let parent = parents().get(id); parent; parent = parents().get(parent)) {
    const box = canvas.boxes.get(parent);
    if (box && !positionOf(parent)) next = setPosition(next, parent, gridFor(parent, box));
  }
  return next;
}

function moveElement(id: string, topLeft: Point, size?: GridSize): void {
  const custom = model?.layout === 'custom';
  const next = pinParents(custom ? source : toCustomLayout(source, id), id);
  const placed = placeAt(next, id, rawGridFor(id, topLeft));
  const { grid } = placed;
  const result = size ? setSize(placed.text, id, size) : placed.text;
  const done = size
    ? `Resized ${nameOf(id)} · size ${size.width}x${size.height}`
    : `Moved ${nameOf(id)} · ${id} at ${grid.x} ${grid.y}`;
  commit(result, custom ? layoutNote(done) : 'Switched to custom layout');
}

// Every selected element moves by the grid distance the dragged one snapped to. An element whose parent
// is also selected already moves with that parent, because nested positions are relative.
function moveGroup(lead: string, topLeft: Point, followers: readonly string[]): void {
  const leadBox = canvas.boxes.get(lead);
  if (!leadBox) return;
  const from = rawGridFor(lead, leadBox);
  const to = rawGridFor(lead, topLeft);
  const delta = { x: to.x - from.x, y: to.y - from.y };
  if (!delta.x && !delta.y) {
    void refresh();
    return;
  }
  const chosen = new Set([lead, ...followers]);
  const nested = parents();
  const hasChosenAncestor = (id: string): boolean => {
    for (let parent = nested.get(id); parent; parent = nested.get(parent)) if (chosen.has(parent)) return true;
    return false;
  };
  const custom = model?.layout === 'custom';
  let next = custom ? source : toCustomLayout(source);
  const targets = new Map<string, GridPoint>();
  for (const id of chosen) {
    const box = canvas.boxes.get(id);
    if (!box || hasChosenAncestor(id)) continue;
    next = pinParents(next, id);
    const at = rawGridFor(id, box);
    targets.set(id, { x: at.x + delta.x, y: at.y + delta.y });
  }
  const placed = placeAll(next, targets);
  commit(placed.text, custom ? layoutNote(`Moved ${chosen.size} elements`) : 'Switched to custom layout');
}

function dropOnCanvas(payload: DragPayload, client: Point | undefined): void {
  const rect = ui.canvas.getBoundingClientRect();
  const at = client ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const point = canvas.layoutPoint(at.x, at.y);
  const topLeft = { x: point.x - 70, y: point.y - 30 };
  if (payload.kind === 'place') {
    commit(
      placeAt(source, payload.id, rawGridFor(payload.id, topLeft)).text,
      layoutNote(`Placed ${nameOf(payload.id)}`),
    );
    return;
  }
  const { type } = payload;
  // The ID comes from the default name, so it follows the name the person types next.
  const id = idFromName(type.label, usedWords(source));
  const custom = model?.layout === 'custom';
  const raw = {
    x: Math.round((topLeft.x - layoutPadding) / gridUnit),
    y: Math.round((topLeft.y - layoutPadding) / gridUnit),
  };
  const added =
    type === notePaletteType
      ? addNote(source, id, type.label)
      : addElement(source, { type: type.key, id, name: type.label });
  const next = custom ? placeAt(added, id, raw).text : added;
  afterRender.push(() => {
    select(id);
    startRename(id);
  });
  commit(next);
}

// The ID follows the name until someone gives it a name of its own.
function rename(id: string, name: string): string {
  if (isNote(id)) return setNoteText(source, id, name);
  const oldName = nameOf(id);
  let next = renameElement(source, id, name);
  const taken = usedWords(source);
  taken.delete(id);
  if (idFromName(oldName, taken) === id) {
    const newId = idFromName(name, taken);
    if (newId !== id) {
      next = renameId(next, id, newId);
      if (selected === id) selected = newId;
    }
  }
  return next;
}

// The inspector waits while the inline name field is open, so it never covers the element being named.
function startRename(id: string): void {
  ui.inspector.classList.add('is-hidden');
  ui.selectionBar.classList.add('is-hidden');
  canvas.startRename(id, nameOf(id), (name) => commit(rename(id, name), `Saved “${name}” to the text`), showInspector);
}

function deleteSelected(): void {
  const ids = selection();
  const [first] = ids;
  if (first === undefined) return;
  const one = isNote(first) ? 'the note' : nameOf(first);
  const message = ids.length === 1 ? `Deleted ${one}` : `Deleted ${ids.length} items`;
  select(null, false);
  commit(
    ids.reduce((text, id) => removeElement(text, id), source),
    message,
  );
}

function clearCanvas(): void {
  select(null, false);
  commit(clearDiagram(source), undefined);
  showToast('Cleared the canvas', { label: 'Undo', run: undo });
}

// Selection and the inspector

let inspected: string | null = null;

// Leaving a field, the element or the inspector writes pending edits to the text.
function saveInspector(): void {
  const id = inspected;
  if (!id || !model?.elements.some((element) => element.id === id)) return;
  let next = source;
  const name = ui.fieldName.value.trim();
  if (name && name !== nameOf(id)) next = rename(id, name);
  const currentId = selected === id ? id : (selected ?? id);
  const description = ui.fieldDescription.value;
  if (description.trim() !== readDescription(next, currentId)) next = setDescription(next, currentId, description);
  if (next !== source) {
    inspected = selected;
    commit(next, `Saved “${name || nameOf(id)}” to the text`);
  }
}

function selection(): readonly string[] {
  if (group.length) return group;
  return selected ? [selected] : [];
}

function select(id: string | null, save = true): void {
  if (save && id !== selected) saveInspector();
  if (save) saveRelationshipInspector();
  if (id !== selected) detailsOpen = false;
  selected = id;
  group = [];
  selectedRelationship = null;
  canvas.setSelection(selection());
  showInspector();
  showRelationshipInspector();
}

function selectMany(ids: readonly string[]): void {
  const unique = [...new Set(ids)];
  if (unique.length < 2) {
    select(unique[0] ?? null);
    return;
  }
  saveInspector();
  saveRelationshipInspector();
  detailsOpen = false;
  selected = null;
  group = unique;
  selectedRelationship = null;
  canvas.setSelection(group);
  showInspector();
  showRelationshipInspector();
}

// Relationships

const sideNames: Record<Side, string> = { T: 'top', R: 'right', B: 'bottom', L: 'left' };

// Relationship edits address lines by position, which only works while the text and the model agree.
function relationshipsEditable(): boolean {
  if (model && countRelationshipLines(source) === model.relationships.length) return true;
  showToast('Fix the text first: its relationships do not match the diagram.', undefined);
  return false;
}

function selectRelationship(id: string): void {
  saveInspector();
  saveRelationshipInspector();
  const index = model?.relationships.findIndex((relationship) => relationship.id === id) ?? -1;
  selected = null;
  selectedRelationship = index >= 0 ? index : null;
  canvas.setRelationshipSelection(index >= 0 ? id : null);
  showInspector();
  showRelationshipInspector();
}

function reconnect(id: string, end: End, element: string, side: Side): void {
  const index = model?.relationships.findIndex((relationship) => relationship.id === id) ?? -1;
  const relationship = model?.relationships[index];
  if (!relationship || !relationshipsEditable()) return;
  const which = end === 'source' ? 'start' : 'end';
  if (relationship[end] === element) {
    const note = model?.layout === 'custom' ? '' : ' (used in custom layout)';
    commit(
      setAnchor(source, index, end, side),
      layoutNote(`Pinned the ${which} to the ${sideNames[side]} side${note}`),
    );
  } else {
    commit(reconnectRelationship(source, index, end, element), `Moved the ${which} to ${nameOf(element)}`);
  }
}

function saveRelationshipInspector(): void {
  const index = selectedRelationship;
  if (index === null || !model?.relationships[index] || ui.relInspector.classList.contains('is-hidden')) return;
  const label = ui.relLabel.value.trim();
  if (label === readRelationshipLabel(source, index) || !relationshipsEditable()) return;
  commit(setRelationshipLabel(source, index, label), label ? `Labelled “${label}”` : 'Removed the label');
}

function showRelationshipInspector(): void {
  const index = selectedRelationship;
  const relationship = index === null ? undefined : model?.relationships[index];
  ui.relInspector.classList.toggle('is-hidden', !relationship);
  syncSheets();
  if (!relationship || index === null) return;
  const line = readRelationshipLine(source, index);
  const anchor = readAnchor(source, index);
  ui.relGlyph.textContent = glyphOf(relationship);
  const typeName = Object.entries(relationshipNames).find(([key]) => key === relationship.type)?.[1];
  ui.relType.textContent = `${typeName ?? relationship.type} relationship`;
  ui.relId.textContent = relationship.id;
  ui.relFrom.textContent = nameOf(relationship.source) + (anchor.from ? ` · ${sideNames[anchor.from]}` : '');
  ui.relTo.textContent = nameOf(relationship.target) + (anchor.to ? ` · ${sideNames[anchor.to]}` : '');
  if (document.activeElement !== ui.relLabel) ui.relLabel.value = relationship.label ?? '';
  ui.relRetype.disabled = line?.kind !== 'shorthand';
  ui.relRetype.dataset.tip = ui.relRetype.disabled ? 'Change the type of a long-form relationship in the text.' : '';
}

function deleteRelationship(): void {
  const index = selectedRelationship;
  if (index === null || !relationshipsEditable()) return;
  selectedRelationship = null;
  canvas.setRelationshipSelection(null);
  showRelationshipInspector();
  commit(removeRelationship(source, index), 'Deleted the relationship');
}

function glyphOf(relationship: ArchiMateRelationship): string {
  const found = Object.entries(relationshipConnectors).find(([, notation]) => {
    const access = 'access' in notation ? notation.access : undefined;
    const directed = 'directed' in notation && notation.directed;
    return (
      notation.type === relationship.type &&
      (access ?? 'unspecified') === (relationship.access ?? 'unspecified') &&
      directed === (relationship.directed ?? false)
    );
  });
  return found?.[0] ?? relationship.type;
}

function showSelectionBar(element: ArchiMateModel['elements'][number] | undefined): void {
  ui.selectionBar.classList.toggle('is-hidden', !element || !phone.matches || detailsOpen);
  if (!element) return;
  const type = paletteType(element.type);
  ui.barIcon.className = `tile-icon t-${type?.category ?? 'composite'}`;
  ui.barIcon.replaceChildren(...(type ? tileIcon(type).childNodes : []));
  ui.selectionBar
    .querySelector('.selection-head')
    ?.setAttribute('class', `selection-head t-${type?.category ?? 'composite'}`);
  ui.barName.textContent = element.name;
  ui.barType.textContent = `${type?.name ?? element.type} · ${element.id}`;
}

function showInspector(): void {
  const element = selected ? model?.elements.find(({ id }) => id === selected) : undefined;
  if (!element) detailsOpen = false;
  ui.inspector.classList.toggle('is-hidden', !element || (phone.matches && !detailsOpen));
  showSelectionBar(element);
  syncSheets();
  if (!element) {
    inspected = null;
    return;
  }
  inspected = element.id;
  const type = paletteType(element.type);
  ui.inspectorIcon.replaceChildren();
  if (type) {
    const icon = tileIcon(type);
    ui.inspectorIcon.className = `tile-icon t-${type.category}`;
    ui.inspectorIcon.replaceChildren(...icon.childNodes);
    ui.inspectorIcon.parentElement?.setAttribute('class', `inspector-head t-${type.category}`);
  }
  ui.inspectorType.textContent = type?.name ?? element.type;
  ui.inspectorId.textContent = element.id;
  if (document.activeElement !== ui.fieldName) ui.fieldName.value = element.name;
  if (document.activeElement !== ui.fieldDescription) ui.fieldDescription.value = readDescription(source, element.id);
  const position = positionOf(element.id);
  const nested = parents().has(element.id);
  ui.infoPosition.textContent = position
    ? `${position.x}, ${position.y}${nested ? ' in parent' : ''}`
    : model?.layout === 'custom'
      ? 'not placed'
      : 'auto';
  ui.infoSize.textContent = position?.width ? `${position.width}x${position.height}` : 'auto';
  ui.relations.replaceChildren(
    ...(model?.relationships ?? [])
      .filter((relationship) => relationship.source === element.id || relationship.target === element.id)
      .map((relationship) => {
        const row = document.createElement('div');
        row.className = 'relation';
        const glyph = document.createElement('code');
        glyph.textContent = glyphOf(relationship);
        const text = document.createElement('span');
        const outgoing = relationship.source === element.id;
        const other = document.createElement('b');
        other.textContent = nameOf(outgoing ? relationship.target : relationship.source);
        text.append(outgoing ? 'to ' : 'from ', other);
        row.append(glyph, text);
        return row;
      }),
  );
  if (!ui.relations.childElementCount) {
    const none = document.createElement('span');
    none.className = 'hint';
    none.textContent = 'None yet.';
    ui.relations.append(none);
  }
}

// Rendering

let refreshTimer: number | undefined;

function scheduleRefresh(delay: number): void {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), delay);
}

async function refresh(): Promise<void> {
  clearTimeout(refreshTimer);
  const result = validateArchiMate(source);
  diagnostics = result.diagnostics;
  if (result.model) model = result.model;
  showStatus();
  updateChrome();
  const errors = diagnostics.filter(({ severity }) => severity === 'error');
  ui.errorChip.hidden = errors.length === 0;
  if (errors.length) {
    const [first] = errors;
    ui.errorMessage.textContent = `Line ${first?.line}: ${first?.message} Showing the last valid diagram.`;
    return;
  }
  const outcome = await renderDiagram(source);
  if (outcome.kind === 'superseded') return;
  if (outcome.kind === 'failed') {
    ui.errorChip.hidden = false;
    ui.errorMessage.textContent = outcome.message;
    return;
  }
  lastSvg = outcome.svg;
  canvas.setSvg(outcome.svg);
  if (selected && !canvas.boxes.has(selected)) selected = null;
  group = group.filter((id) => canvas.boxes.has(id));
  if (group.length === 1) {
    selected = group[0] ?? null;
    group = [];
  }
  const relationship = selectedRelationship === null ? undefined : model?.relationships[selectedRelationship];
  if (!relationship) selectedRelationship = null;
  if (relationship) canvas.setRelationshipSelection(relationship.id);
  else canvas.setSelection(selection());
  showInspector();
  showRelationshipInspector();
  updateTray();
  if (firstRender) {
    firstRender = false;
    fit();
  }
  for (const action of afterRender.splice(0)) action();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function showStatus(): void {
  const errors = diagnostics.filter(({ severity }) => severity === 'error').length;
  const warnings = diagnostics.length - errors;
  editor.showDiagnostics(diagnostics);
  ui.statusChip.textContent = errors ? plural(errors, 'error') : warnings ? plural(warnings, 'warning') : 'Valid';
  ui.statusChip.dataset.status = errors ? 'invalid' : warnings ? 'warning' : 'valid';
  ui.modelSummary.textContent = model
    ? `${plural(model.elements.length, 'element')} · ${plural(model.relationships.length, 'relationship')}`
    : '';
  showProblems();
  showNotation(errors === 0);
}

function showProblems(): void {
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

const notationTips = new Map(
  [ui.notationLong, ui.notationShorthand].map((button) => [button, button.dataset.tip ?? ''] as const),
);

// The pressed button shows what the text is written in, which a hand edit can change; mixed presses neither.
function showNotation(valid: boolean): void {
  const written = detectNotation(source);
  const buttons = [ui.notationLong, ui.notationShorthand];
  pressOnly(buttons, written === 'long' ? ui.notationLong : written === 'shorthand' ? ui.notationShorthand : undefined);
  for (const button of buttons) {
    button.disabled = !valid;
    button.dataset.tip = valid
      ? (notationTips.get(button) ?? '')
      : 'Fix the errors first; only a valid diagram can be rewritten.';
  }
}

function selectNotation(notation: Notation): void {
  const name = notation === 'long' ? 'long form' : 'shorthand';
  const keptNote = (kept: number): string =>
    kept > 0 ? ` ${plural(kept, 'relationship')} stay in long form because other lines refer to their IDs.` : '';
  const result = convertNotation(source, notation);
  switch (result.kind) {
    case 'converted':
      commit(result.source, `Rewrote ${plural(result.converted, 'relationship')} in ${name}.${keptNote(result.kept)}`);
      return;
    case 'unchanged':
      showToast(`The relationships are already in ${name}.${keptNote(result.kept)}`, undefined);
      return;
    case 'invalid':
      showToast('Fix the errors first; only a valid diagram can be rewritten.', undefined);
      return;
    case 'failed':
      showToast('This diagram could not be rewritten without changing it, so it was left as it is.', undefined);
      return;
  }
}

function updateChrome(): void {
  const layout = readLayout(source);
  const custom = layout === 'custom';
  pressOnly([ui.layoutAuto, ui.layoutCustom], custom ? ui.layoutCustom : ui.layoutAuto);
  ui.undo.disabled = undoStack.length === 0;
  ui.redo.disabled = redoStack.length === 0;
  const empty = clearDiagram(source) === source;
  ui.clear.disabled = empty;
  ui.mClear.disabled = empty;
}

function updateTray(): void {
  for (const chip of ui.tray.querySelectorAll('.tile')) chip.remove();
  const nested = parents();
  const unplaced =
    model?.layout === 'custom'
      ? model.elements.filter((element) => !nested.has(element.id) && !positionOf(element.id))
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
  const inspectorOpen = selected !== null || selectedRelationship !== null;
  canvas.fit(
    {
      left: mode === 'code' ? codeWidth + 48 : paletteOpen ? 408 : 100,
      right: inspectorOpen ? 340 : 40,
      top: 96,
      bottom: 80,
    },
    animate,
  );
}

// Panels and toasts

let toastTimer: number | undefined;
let toastAction: (() => void) | undefined;

function showToast(message: string, action: { label: string; run: () => void } | undefined = textAction()): void {
  clearTimeout(toastTimer);
  ui.toastMessage.textContent = message;
  ui.toastAction.hidden = !action;
  ui.toastAction.textContent = action?.label ?? '';
  toastAction = action?.run;
  ui.toast.classList.remove('is-hidden');
  toastTimer = window.setTimeout(() => ui.toast.classList.add('is-hidden'), toastMs);
}

function textAction(): { label: string; run: () => void } | undefined {
  return textOpen ? undefined : { label: 'Show code', run: () => switchMode('code') };
}

function setTextOpen(open: boolean): void {
  textOpen = open;
  document.body.classList.toggle('text-view', open);
  ui.tabText.setAttribute('aria-selected', String(open));
  ui.tabCanvas.setAttribute('aria-selected', String(!open));
  ui.drawer.classList.toggle('is-hidden', !open);
  if (open) {
    unseenChanges = 0;
    ui.codeBadge.hidden = true;
    ui.tabBadge.hidden = true;
  }
}

function setCollapsed(collapsed: boolean): void {
  ui.palette.classList.toggle('is-hidden', collapsed);
  ui.rail.classList.toggle('is-hidden', !collapsed);
  ui.tray.style.width = collapsed ? 'auto' : '';
  writeStored(collapsedKey, collapsed ? '1' : '0');
}

function fileBase(): string {
  return idFromName(ui.title.value || 'diagram', new Set()).replace(/[A-Z]/gu, (letter) => '-' + letter.toLowerCase());
}

async function exportAs(kind: string): Promise<void> {
  if (kind === 'mmd') {
    downloadBlob(new Blob([source], { type: 'text/plain' }), `${fileBase()}.mmd`);
    return;
  }
  if (!lastSvg) return;
  const svg = prepareSvg(lastSvg);
  if (kind === 'svg') downloadBlob(new Blob([svg.source], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  else downloadBlob(await renderPng(svg), `${fileBase()}.png`);
}

function runExport(kind: string): void {
  exportAs(kind).catch((error: unknown) => {
    showToast(error instanceof Error ? error.message : 'Export failed.', undefined);
  });
}

async function shareLink(): Promise<string> {
  return location.origin + location.pathname + (await encodeShareHash(source));
}

// Wiring

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
      !!target.closest('.cm-editor'))
  );
}

document.addEventListener('keydown', (event) => {
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
  } else if (command && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    selectMany((model?.elements ?? []).map(({ id }) => id).filter((id) => canvas.boxes.has(id)));
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRelationship !== null) {
    event.preventDefault();
    deleteRelationship();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection().length) {
    event.preventDefault();
    deleteSelected();
  } else if (event.key === 'Enter' && selected) {
    event.preventDefault();
    startRename(selected);
  } else if (event.key === 'Escape') {
    canvas.cancel();
    closePicker();
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
  if (selected) startRename(selected);
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
  const index = selectedRelationship;
  const relationship = index === null ? undefined : model?.relationships[index];
  if (index === null || !relationship) return;
  const rect = ui.relRetype.getBoundingClientRect();
  openPicker({ x: rect.left - 250, y: rect.top - 12 }, 'Change the type', (glyph) => {
    if (relationshipsEditable()) commit(setRelationshipGlyph(source, index, glyph), `Changed the type to ${glyph}`);
  });
});

ui.layoutAuto.addEventListener('click', () => {
  if (readLayout(source) !== 'custom') return;
  commit(setLayout(source, 'architecture'), 'Auto layout · positions kept in the text');
});
ui.layoutCustom.addEventListener('click', () => {
  if (readLayout(source) === 'custom') return;
  commit(toCustomLayout(source), 'Custom layout · elements pinned where they are');
});
ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);
ui.errorOpen.addEventListener('click', () => {
  switchMode('code');
  const first = diagnostics.find(({ severity }) => severity === 'error');
  if (first) editor.revealDiagnostic(first);
});
ui.toastAction.addEventListener('click', () => {
  toastAction?.();
  ui.toast.classList.add('is-hidden');
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
  const link = await shareLink();
  history.replaceState(null, '', link);
  showToast((await copyText(link)) ? 'Link copied' : 'Link is in the address bar', undefined);
});

// The button confirms a copy itself, so the text panel needs no notification.
let copyReset: number | undefined;
ui.copyText.addEventListener('click', async () => {
  const copied = await copyText(source);
  const label = ui.copyText.querySelector('.copy-label');
  ui.copyText.classList.toggle('is-copied', copied);
  ui.copyText.classList.toggle('is-failed', !copied);
  if (label) label.textContent = copied ? 'Copied' : 'Copy failed';
  clearTimeout(copyReset);
  copyReset = window.setTimeout(() => {
    ui.copyText.classList.remove('is-copied', 'is-failed');
    if (label) label.textContent = 'Copy';
  }, 1800);
});

function setTitle(title: string): void {
  ui.title.value = title;
  writeStored(titleKey, title);
  ui.fileName.textContent = `${fileBase()}.mmd`;
}

ui.title.addEventListener('change', () => setTitle(ui.title.value));

// Opening replaces the whole diagram in one undo step. The notification's Undo also brings the old name back,
// as long as nothing was edited since.
function openDiagram(next: string, title: string, message: string): void {
  const previous = { source, title: ui.title.value };
  if (next === previous.source && title === previous.title) return;
  pushHistory();
  select(null, false);
  setTitle(title);
  // A share link in the address would otherwise reopen the shared diagram on the next visit.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  afterRender.push(() => fit(true));
  replaceAll(next);
  showToast(message, {
    label: 'Undo',
    run: () => {
      if (source !== next) return;
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

const openGroups = new Set((readStored(groupsKey) ?? 'business').split(',').filter(Boolean).slice(0, 1));
buildPalette(
  {
    groups: ui.groups,
    rail: ui.railGroups,
    search: ui.search,
    openGroups,
    onToggleGroup: (open) => writeStored(groupsKey, [...open].join(',')),
  },
  { drop: dropOnCanvas },
);

window.addEventListener('resize', () => canvas.setSelection(selection()));

confirmTwice(ui.clear, clearCanvas);
confirmTwice(ui.mClear, () => {
  closeMoreMenu();
  clearCanvas();
});

function setTool(tool: Tool): void {
  canvas.tool = tool;
  pressOnly([ui.toolSelect, ui.toolHand], tool === 'select' ? ui.toolSelect : ui.toolHand);
}
ui.toolSelect.addEventListener('click', () => setTool('select'));
ui.toolHand.addEventListener('click', () => setTool('hand'));
// A finger has no scroll wheel, so touch screens start with the hand and a one-finger drag moves the canvas.
setTool(matchMedia('(pointer: coarse)').matches ? 'hand' : 'select');

// Space moves the canvas only while it is held, and only when it would not press a focused control.
function holdsSpace(event: KeyboardEvent): boolean {
  return (
    event.key === ' ' &&
    (event.target === document.body || (event.target instanceof Node && ui.canvas.contains(event.target)))
  );
}
document.addEventListener('keydown', (event) => {
  if (!holdsSpace(event)) return;
  event.preventDefault();
  canvas.spaceHeld = true;
});
document.addEventListener('keyup', (event) => {
  if (event.key === ' ') canvas.spaceHeld = false;
});
window.addEventListener('blur', () => {
  canvas.spaceHeld = false;
});

// Design mode builds on the canvas with the text on demand; Code mode keeps the text docked beside the canvas.
type Mode = 'design' | 'code';
let mode: Mode = 'design';

function readMode(): Mode {
  const requested = new URLSearchParams(location.search).get('mode') ?? readStored(modeKey);
  return requested === 'code' ? 'code' : 'design';
}

function setMode(next: Mode): void {
  mode = next;
  document.body.classList.toggle('code-mode', next === 'code');
  pressOnly([ui.modeDesign, ui.modeCode], next === 'code' ? ui.modeCode : ui.modeDesign);
  writeStored(modeKey, next);
  // The address names Code mode, so a link can open straight into it.
  const url = new URL(location.href);
  if (next === 'code') url.searchParams.set('mode', 'code');
  else url.searchParams.delete('mode');
  history.replaceState(null, '', url);
  setTextOpen(next === 'code');
  placeModePill();
}

function switchMode(next: Mode): void {
  if (mode === next) return;
  setMode(next);
  fit(true);
}

// The pill under the pressed mode follows its button, including when fonts load or a badge changes its width.
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

ui.modeDesign.addEventListener('click', () => switchMode('design'));
ui.modeCode.addEventListener('click', () => switchMode('code'));

ui.notationLong.addEventListener('click', () => selectNotation('long'));
ui.notationShorthand.addEventListener('click', () => selectNotation('shorthand'));

// The docked panel's right edge resizes it, by dragging or with the arrow keys.
const minCodeWidth = 320;
const defaultCodeWidth = 520;
let codeWidth = defaultCodeWidth;

function setCodeWidth(width: number): void {
  const maxWidth = Math.max(minCodeWidth, Math.round(window.innerWidth * 0.6));
  codeWidth = Math.min(maxWidth, Math.max(minCodeWidth, Math.round(width)));
  document.body.style.setProperty('--code-width', `${codeWidth}px`);
  ui.drawerResize.setAttribute('aria-valuemin', String(minCodeWidth));
  ui.drawerResize.setAttribute('aria-valuemax', String(maxWidth));
  ui.drawerResize.setAttribute('aria-valuenow', String(codeWidth));
}

let resizeStart: { x: number; width: number } | undefined;
ui.drawerResize.addEventListener('pointerdown', (event) => {
  resizeStart = { x: event.clientX, width: codeWidth };
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
  writeStored(codeWidthKey, String(codeWidth));
}
ui.drawerResize.addEventListener('pointerup', endResize);
ui.drawerResize.addEventListener('pointercancel', endResize);
ui.drawerResize.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 96 : 24;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  setCodeWidth(codeWidth + (event.key === 'ArrowRight' ? step : -step));
  writeStored(codeWidthKey, String(codeWidth));
});
window.addEventListener('resize', () => setCodeWidth(codeWidth));

installTooltips();

async function start(): Promise<void> {
  setCodeWidth(Number(readStored(codeWidthKey)) || defaultCodeWidth);
  setMode(readMode());
  ui.title.value = readStored(titleKey) ?? starterExample.title;
  ui.fileName.textContent = `${fileBase()}.mmd`;
  setCollapsed(readStored(collapsedKey) === '1');
  const shared = await decodeShareHash(location.hash);
  source = shared.kind === 'source' ? shared.source : (readStored(sourceKey) ?? starterExample.source);
  if (shared.kind === 'invalid')
    showToast('That share link is damaged, so your last diagram opened instead.', undefined);
  showStorageState(shared.kind === 'source' ? 'shared' : 'saved');
  editor.rewriteSource(source);
  await refresh();
}

void start();
