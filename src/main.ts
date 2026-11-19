import '@fontsource-variable/space-grotesk';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';

import {
  relationshipConnectors,
  validateArchiMate,
  type ArchiMateDiagnostic,
  type ArchiMateModel,
  type ArchiMateRelationship,
} from 'archimaid/language';
import { DiagramCanvas, gridUnit, layoutPadding, type Point, type Snapped } from './canvas.ts';
import { paletteType, tileIcon } from './catalogue.ts';
import { createSourceEditor } from './editor.ts';
import { downloadBlob, prepareSvg, renderPng } from './export.ts';
import { buildPalette, makeDraggable, type DragPayload } from './palette.ts';
import { closePicker, openPicker } from './picker.ts';
import { renderDiagram } from './render.ts';
import { decodeShareHash, encodeShareHash } from './share.ts';
import {
  addElement,
  addRelationship,
  idFromName,
  readDescription,
  readLayout,
  removeElement,
  renameElement,
  renameId,
  setDescription,
  setLayout,
  setPosition,
  setPositions,
  usedWords,
  type GridPoint,
} from './source.ts';
import starterSource from './starter.mmd?raw';
import { readStored, writeStored } from './storage.ts';

const sourceKey = 'archimaid.designer.source';
const titleKey = 'archimaid.designer.title';
const collapsedKey = 'archimaid.designer.palette-collapsed';
const groupsKey = 'archimaid.designer.open-groups';
const textEditDelayMs = 300;
const historyMergeMs = 800;
const toastMs = 2800;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html.`);
  return element as T;
}

const ui = {
  canvas: byId('canvas'),
  stage: byId('stage'),
  overlay: byId('overlay'),
  title: byId<HTMLInputElement>('title'),
  layoutAuto: byId<HTMLButtonElement>('layout-auto'),
  layoutCustom: byId<HTMLButtonElement>('layout-custom'),
  undo: byId<HTMLButtonElement>('undo'),
  redo: byId<HTMLButtonElement>('redo'),
  textToggle: byId<HTMLButtonElement>('text-toggle'),
  textBadge: byId('text-badge'),
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
  status: byId('status'),
  copyText: byId<HTMLButtonElement>('copy-text'),
  openPlayground: byId<HTMLAnchorElement>('open-playground'),
  drawerClose: byId<HTMLButtonElement>('drawer-close'),
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
};

// The source text is the only document state; everything else is derived from it or is view state.
let source = '';
let model: ArchiMateModel | undefined;
let diagnostics: readonly ArchiMateDiagnostic[] = [];
let lastSvg: string | undefined;
let selected: string | null = null;
let textOpen = false;
let unseenChanges = 0;
let firstRender = true;
const undoStack: string[] = [];
const redoStack: string[] = [];
let lastTextEdit = 0;
const afterRender: (() => void)[] = [];

const canvas: DiagramCanvas = new DiagramCanvas(ui.canvas, ui.stage, ui.overlay, {
  select: (id) => select(id),
  snap: (id, topLeft): Snapped => {
    const grid = gridFor(id, topLeft);
    const box = canvas.boxes.get(id);
    const origin = gridOrigin(id);
    return {
      box: {
        x: origin.x + grid.x * gridUnit,
        y: origin.y + grid.y * gridUnit,
        width: box?.width ?? 140,
        height: box?.height ?? 60,
      },
      label: `${id} at ${grid.x} ${grid.y}`,
    };
  },
  move: (id, topLeft) => moveElement(id, topLeft),
  connect: (from, to, client) => {
    openPicker(client, `${nameOf(from)} → ${nameOf(to)}`, (glyph) => {
      commit(addRelationship(source, from, glyph, to), `Connected ${nameOf(from)} ${glyph} ${nameOf(to)}`);
    });
  },
  rename: (id) => startRename(id),
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
});

// Model lookups

function parents(): Map<string, string> {
  return new Map((model?.nesting ?? []).map(({ child, parent }) => [child, parent]));
}

function nameOf(id: string): string {
  return model?.elements.find((element) => element.id === id)?.name ?? id;
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

function gridFor(id: string, topLeft: Point): GridPoint {
  const origin = gridOrigin(id);
  return {
    x: Math.max(0, Math.round((topLeft.x - origin.x) / gridUnit)),
    y: Math.max(0, Math.round((topLeft.y - origin.y) / gridUnit)),
  };
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

function commit(next: string, message?: string): void {
  if (next === source) return;
  pushHistory();
  const before = source;
  source = next;
  persist();
  editor.rewriteSource(next);
  editor.markChanged(changedLineNumbers(before, next));
  if (!textOpen) {
    unseenChanges++;
    ui.textBadge.textContent = String(unseenChanges);
    ui.textBadge.hidden = false;
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
  writeStored(sourceKey, source);
}

function moveElement(id: string, topLeft: Point): void {
  const grid = gridFor(id, topLeft);
  const custom = model?.layout === 'custom';
  let next = custom ? source : toCustomLayout(source, id);
  // A position inside an unpositioned parent is ignored, so the parent is pinned where it is.
  for (let parent = parents().get(id); parent; parent = parents().get(parent)) {
    const box = canvas.boxes.get(parent);
    if (box && !positionOf(parent)) next = setPosition(next, parent, gridFor(parent, box));
  }
  next = setPosition(next, id, grid);
  commit(next, custom ? `Moved ${nameOf(id)} · ${id} at ${grid.x} ${grid.y}` : 'Switched to custom layout');
}

function dropOnCanvas(payload: DragPayload, client: Point | undefined): void {
  const rect = ui.canvas.getBoundingClientRect();
  const at = client ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const point = canvas.layoutPoint(at.x, at.y);
  const topLeft = { x: point.x - 70, y: point.y - 30 };
  if (payload.kind === 'place') {
    commit(setPosition(source, payload.id, gridFor(payload.id, topLeft)), `Placed ${nameOf(payload.id)}`);
    return;
  }
  const { type } = payload;
  // The ID comes from the default name, so it follows the name the person types next.
  const id = idFromName(type.name, usedWords(source));
  const custom = model?.layout === 'custom';
  const grid = {
    x: Math.max(0, Math.round((topLeft.x - layoutPadding) / gridUnit)),
    y: Math.max(0, Math.round((topLeft.y - layoutPadding) / gridUnit)),
  };
  const next = addElement(source, { type: type.key, id, name: type.name, ...(custom && { at: grid }) });
  afterRender.push(() => {
    select(id);
    startRename(id);
  });
  commit(next);
}

// The ID follows the name until someone gives it a name of its own.
function rename(id: string, name: string): string {
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
  canvas.startRename(id, nameOf(id), (name) => commit(rename(id, name), `Saved “${name}” to the text`), showInspector);
}

function deleteSelected(): void {
  if (!selected) return;
  const id = selected;
  const name = nameOf(id);
  select(null, false);
  commit(removeElement(source, id), `Deleted ${name}`);
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

function select(id: string | null, save = true): void {
  if (save && id !== selected) saveInspector();
  selected = id;
  canvas.setSelection(id);
  showInspector();
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

function showInspector(): void {
  const element = selected ? model?.elements.find(({ id }) => id === selected) : undefined;
  ui.inspector.classList.toggle('is-hidden', !element);
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
  canvas.setSelection(selected);
  showInspector();
  updateTray();
  if (firstRender) {
    firstRender = false;
    fit();
  }
  for (const action of afterRender.splice(0)) action();
}

function showStatus(): void {
  const errors = diagnostics.filter(({ severity }) => severity === 'error');
  const warnings = diagnostics.filter(({ severity }) => severity === 'warning');
  editor.showDiagnostics(diagnostics);
  ui.status.replaceChildren();
  const add = (className: string, text: string, diagnostic?: ArchiMateDiagnostic) => {
    const item = document.createElement(diagnostic ? 'button' : 'span');
    item.className = className;
    item.textContent = text;
    if (diagnostic && item instanceof HTMLButtonElement) {
      item.type = 'button';
      Object.assign(item.style, { border: '0', background: 'none', padding: '0', cursor: 'pointer', font: 'inherit' });
      item.addEventListener('click', () => editor.revealDiagnostic(diagnostic));
    }
    ui.status.append(item);
  };
  if (!errors.length) add('ok', '● Checks passed');
  for (const diagnostic of [...errors, ...warnings].slice(0, 3)) {
    add(
      diagnostic.severity === 'error' ? 'error' : 'warning',
      `● Line ${diagnostic.line}: ${diagnostic.message}`,
      diagnostic,
    );
  }
  if (errors.length + warnings.length > 3) add('warning', `+${errors.length + warnings.length - 3} more`);
}

function updateChrome(): void {
  const layout = readLayout(source);
  const custom = layout === 'custom';
  ui.layoutCustom.setAttribute('aria-pressed', String(custom));
  ui.layoutAuto.setAttribute('aria-pressed', String(!custom));
  ui.undo.disabled = undoStack.length === 0;
  ui.redo.disabled = redoStack.length === 0;
}

function updateTray(): void {
  for (const chip of ui.tray.querySelectorAll('.tile')) chip.remove();
  const nested = parents();
  const unplaced =
    model?.layout === 'custom'
      ? model.elements.filter((element) => !nested.has(element.id) && !positionOf(element.id))
      : [];
  ui.tray.hidden = unplaced.length === 0;
  for (const element of unplaced) {
    const type = paletteType(element.type);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `tile t-${type?.category ?? 'composite'}`;
    chip.title = 'Drag onto the canvas to place it';
    if (type) chip.append(tileIcon(type, true));
    chip.append(element.name);
    makeDraggable(chip, () => ({ kind: 'place', id: element.id }), { drop: dropOnCanvas });
    ui.tray.append(chip);
  }
}

function fit(): void {
  const paletteOpen = !ui.palette.classList.contains('is-hidden');
  canvas.fit({
    left: paletteOpen ? 316 : 100,
    right: textOpen ? 500 : selected ? 340 : 40,
    top: 96,
    bottom: 80,
  });
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
  return textOpen ? undefined : { label: 'Show text', run: () => setTextOpen(true) };
}

function setTextOpen(open: boolean): void {
  textOpen = open;
  ui.drawer.classList.toggle('is-hidden', !open);
  ui.textToggle.setAttribute('aria-pressed', String(open));
  ui.inspector.classList.toggle('beside-text', open);
  document.querySelector('.zoom')?.classList.toggle('beside-text', open);
  if (open) {
    unseenChanges = 0;
    ui.textBadge.hidden = true;
  }
}

function setCollapsed(collapsed: boolean): void {
  ui.palette.classList.toggle('is-hidden', collapsed);
  ui.rail.classList.toggle('is-hidden', !collapsed);
  ui.tray.style.width = collapsed ? 'auto' : '';
  writeStored(collapsedKey, collapsed ? '1' : '0');
}

function setExportMenu(open: boolean): void {
  ui.exportMenu.classList.toggle('is-hidden', !open);
  ui.exportToggle.setAttribute('aria-expanded', String(open));
}

function fileBase(): string {
  return idFromName(ui.title.value || 'diagram', new Set()).replace(/[A-Z]/gu, (letter) => '-' + letter.toLowerCase());
}

async function exportAs(kind: string): Promise<void> {
  setExportMenu(false);
  if (kind === 'mmd') {
    downloadBlob(new Blob([source], { type: 'text/plain' }), `${fileBase()}.mmd`);
    return;
  }
  if (!lastSvg) return;
  const svg = prepareSvg(lastSvg, 'transparent');
  if (kind === 'svg') downloadBlob(new Blob([svg.source], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  else downloadBlob(await renderPng(svg), `${fileBase()}.png`);
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
  if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
    event.preventDefault();
    deleteSelected();
  } else if (event.key === 'Enter' && selected) {
    event.preventDefault();
    startRename(selected);
  } else if (event.key === 'Escape') {
    canvas.cancel();
    closePicker();
    setExportMenu(false);
    select(null);
  }
});

ui.fieldName.addEventListener('change', saveInspector);
ui.fieldName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') ui.fieldName.blur();
});
ui.fieldDescription.addEventListener('change', saveInspector);
ui.inspectorClose.addEventListener('click', () => select(null));
ui.remove.addEventListener('click', deleteSelected);

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
ui.textToggle.addEventListener('click', () => setTextOpen(!textOpen));
ui.drawerClose.addEventListener('click', () => setTextOpen(false));
ui.errorOpen.addEventListener('click', () => {
  setTextOpen(true);
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
ui.zoomFit.addEventListener('click', fit);

ui.exportToggle.addEventListener('click', () => setExportMenu(ui.exportMenu.classList.contains('is-hidden')));
for (const item of ui.exportMenu.querySelectorAll<HTMLButtonElement>('[data-export]')) {
  item.addEventListener('click', () => {
    exportAs(item.dataset.export ?? '').catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : 'Export failed.', undefined);
    });
  });
}
document.addEventListener('pointerdown', (event) => {
  if (event.target instanceof Node && !ui.exportMenu.parentElement?.contains(event.target)) setExportMenu(false);
});

ui.share.addEventListener('click', async () => {
  const link = await shareLink();
  history.replaceState(null, '', link);
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link copied', undefined);
  } catch {
    showToast('Link is in the address bar', undefined);
  }
});
ui.copyText.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(source);
    showToast('Text copied', undefined);
  } catch {
    showToast('Copy is blocked in this browser', undefined);
  }
});
ui.openPlayground.addEventListener('click', async (event) => {
  event.preventDefault();
  window.open(`https://try.archimaid.org/${await encodeShareHash(source)}`, '_blank', 'noopener');
});

ui.title.addEventListener('change', () => {
  writeStored(titleKey, ui.title.value);
  ui.fileName.textContent = `${fileBase()}.mmd`;
});

const openGroups = new Set((readStored(groupsKey) ?? 'business,application,technology').split(',').filter(Boolean));
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

window.addEventListener('resize', () => canvas.setSelection(selected));

async function start(): Promise<void> {
  ui.title.value = readStored(titleKey) ?? 'Order fulfilment';
  ui.fileName.textContent = `${fileBase()}.mmd`;
  setCollapsed(readStored(collapsedKey) === '1');
  const shared = await decodeShareHash(location.hash);
  source = shared.kind === 'source' ? shared.source : (readStored(sourceKey) ?? starterSource);
  if (shared.kind === 'invalid')
    showToast('That share link is damaged, so your last diagram opened instead.', undefined);
  editor.rewriteSource(source);
  await refresh();
}

void start();
