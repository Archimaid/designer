import { gridUnit, layoutPadding, type Box, type Point, type Side, type Snapped } from './geometry.ts';

// The rendered SVG sits on a stage whose coordinates are the renderer's layout coordinates, so grid maths,
// overlays and hit-testing all share one space. Pan and zoom are a CSS transform on the stage.

export type End = 'source' | 'target';
export type Tool = 'select' | 'hand';
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface CanvasEvents {
  readonly select: (id: string | null) => void;
  readonly toggle: (id: string) => void;
  readonly selectMany: (ids: readonly string[]) => void;
  readonly selectRelationship: (id: string) => void;
  // An end dropped on an element: another element reconnects it, its own element pins the side.
  readonly reconnect: (id: string, end: End, element: string, side: Side) => void;
  readonly snap: (id: string, topLeft: Point) => Snapped;
  readonly snapResize: (id: string, box: Box) => Snapped;
  readonly resize: (id: string, box: Box) => void;
  // The dragged element leads; the other selected elements follow it by the same distance.
  readonly move: (lead: string, topLeft: Point, followers: readonly string[]) => void;
  readonly connect: (from: string, to: string, client: Point) => void;
  readonly rename: (id: string) => void;
}

const minZoom = 0.25;
const maxZoom = 3;
const dragThreshold = 4;
// Matches the stage transition in styles.css.
const easeMs = 320;
const svgNamespace = 'http://www.w3.org/2000/svg';

type Tap = { readonly kind: 'element' | 'relationship'; readonly id: string };

type Gesture =
  | { readonly kind: 'none' }
  // On touch, a finger on an unselected element pans; lifting it without moving selects what it touched.
  | { readonly kind: 'pan'; readonly start: Point; readonly pan: Point; moved: boolean; readonly tap?: Tap | undefined }
  | {
      readonly kind: 'pinch';
      readonly distance: number;
      readonly scale: number;
      readonly middle: Point;
      readonly pan: Point;
    }
  // What a press does when it is released without dragging.
  | {
      readonly kind: 'press';
      readonly id: string;
      readonly start: Point;
      readonly release: 'none' | 'toggle' | 'select';
    }
  | {
      readonly kind: 'drag';
      readonly id: string;
      readonly start: Point;
      readonly box: Box;
      readonly group: readonly { readonly id: string; readonly box: Box }[];
      target: Point;
    }
  | { readonly kind: 'marquee'; readonly start: Point; end: Point; moved: boolean }
  | { readonly kind: 'connect'; readonly from: string; readonly origin: Point }
  | {
      readonly kind: 'resize';
      readonly id: string;
      readonly edge: Edge;
      readonly start: Point;
      readonly box: Box;
      target: Box;
    }
  | { readonly kind: 'reconnect'; readonly id: string; readonly end: End; readonly origin: Point };

function parseTranslate(element: Element): Point | undefined {
  const match = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/u.exec(element.getAttribute('transform') ?? '');
  return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
}

function relationshipId(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const hit = target.closest('[data-hit-for], [data-archimate-relationship]');
  return hit?.getAttribute('data-hit-for') ?? hit?.getAttribute('data-archimate-relationship') ?? undefined;
}

// The side of a box nearest to a point, in the T/R/B/L letters of the positions block.
function nearestSide(box: Box, point: Point): Side {
  const distances: readonly (readonly [Side, number])[] = [
    ['T', Math.abs(point.y - box.y)],
    ['R', Math.abs(point.x - (box.x + box.width))],
    ['B', Math.abs(point.y - (box.y + box.height))],
    ['L', Math.abs(point.x - box.x)],
  ];
  return distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best))[0];
}

function pathEnds(path: SVGPathElement): { start: Point; end: Point } | undefined {
  const numbers = (path.getAttribute('d') ?? '').match(/-?\d*\.?\d+(?:e-?\d+)?/giu)?.map(Number) ?? [];
  const [x1, y1] = numbers;
  const [x2, y2] = numbers.slice(-2);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return undefined;
  return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
}

function spanning(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

const minimumSide = 20;

// Dragging an edge moves only that edge; the opposite edge stays where it was.
function resized(box: Box, edge: Edge, dx: number, dy: number): Box {
  let { x, y, width, height } = box;
  if (edge.includes('e')) width = Math.max(minimumSide, box.width + dx);
  if (edge.includes('s')) height = Math.max(minimumSide, box.height + dy);
  if (edge.includes('w')) {
    width = Math.max(minimumSide, box.width - dx);
    x = box.x + box.width - width;
  }
  if (edge.includes('n')) {
    height = Math.max(minimumSide, box.height - dy);
    y = box.y + box.height - height;
  }
  return { x, y, width, height };
}

const allEdges: readonly Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const edgeCursors: Record<Edge, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

// Elements and notes are the items a person picks, moves and renames on the canvas.
const itemSelector = '[data-archimate-element], [data-archimate-note]';

function idUnder(target: EventTarget | null, selector: string): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const item = target.closest(selector);
  return item?.getAttribute('data-archimate-element') ?? item?.getAttribute('data-archimate-note') ?? undefined;
}

const itemId = (target: EventTarget | null): string | undefined => idUnder(target, itemSelector);
// Relationships connect elements only, so lines never attach to a note.
const elementId = (target: EventTarget | null): string | undefined => idUnder(target, '[data-archimate-element]');

export class DiagramCanvas {
  readonly boxes = new Map<string, Box>();
  // Notes are moved and renamed like elements, but take no relationships and keep the size of their text.
  readonly notes = new Set<string>();
  private readonly edges = new Map<string, { start: Point; end: Point }>();
  private selectedRelationship: string | null = null;
  private readonly headers = new Map<string, number>();
  private svg: SVGSVGElement | undefined;
  private pan: Point = { x: 360, y: 140 };
  private scale = 1;
  private gesture: Gesture = { kind: 'none' };
  private readonly pointers = new Map<number, Point>();
  private selection: readonly string[] = [];
  private chosenTool: Tool = 'select';
  private holdingSpace = false;
  private locked = false;
  private readonly marquee = document.createElement('div');
  private readonly ghost = document.createElement('div');
  private readonly line = document.createElementNS(svgNamespace, 'svg');
  private onZoom: (scale: number) => void = () => undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly overlay: HTMLElement,
    private readonly events: CanvasEvents,
  ) {
    this.marquee.className = 'marquee';
    this.ghost.className = 'ghost';
    this.line.setAttribute('class', 'connector-line');
    this.line.innerHTML =
      '<line stroke="#17171c" stroke-width="2" stroke-dasharray="6 4" /><circle r="5" fill="#1f7fae" />';
    root.addEventListener('pointerdown', (event) => this.pointerDown(event));
    root.addEventListener('pointermove', (event) => this.pointerMove(event));
    root.addEventListener('pointerup', (event) => this.pointerUp(event));
    root.addEventListener('pointercancel', (event) => {
      this.pointers.delete(event.pointerId);
      this.cancelGesture();
    });
    root.addEventListener('dblclick', (event) => {
      if (this.locked) return;
      const id = itemId(event.target);
      if (id) events.rename(id);
    });
    root.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    this.applyTransform();
  }

  get zoom(): number {
    return this.scale;
  }

  set zoomListener(listener: (scale: number) => void) {
    this.onZoom = listener;
  }

  // The select tool draws a selection box on empty canvas; the hand tool, or a held Space, moves the canvas.
  set tool(tool: Tool) {
    this.chosenTool = tool;
    this.root.classList.toggle('is-hand', this.handActive);
  }

  set spaceHeld(held: boolean) {
    this.holdingSpace = held;
    this.root.classList.toggle('is-hand', this.handActive);
  }

  private get handActive(): boolean {
    return this.locked || this.chosenTool === 'hand' || this.holdingSpace;
  }

  // A read-only canvas pans and zooms, and every drag on it moves the view rather than the diagram. A tap
  // still selects, so details can be read, but the selection offers no handles to change anything.
  set readOnly(locked: boolean) {
    this.locked = locked;
    this.cancelGesture();
    this.root.classList.toggle('is-hand', this.handActive);
    this.drawSelection();
  }

  private tapOn(target: Element | null): Tap | undefined {
    const id = itemId(target);
    if (id && this.boxes.has(id)) return { kind: 'element', id };
    const relationship = relationshipId(target);
    return relationship ? { kind: 'relationship', id: relationship } : undefined;
  }

  setSvg(markup: string): void {
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    const svg = holder.querySelector('svg');
    if (!(svg instanceof SVGSVGElement)) throw new Error('The renderer returned no SVG.');
    svg.classList.add('diagram');
    svg.removeAttribute('style');
    this.svg?.remove();
    this.stage.insertBefore(svg, this.overlay);
    this.svg = svg;
    this.measure();
    this.drawSelection();
  }

  private measure(): void {
    const svg = this.svg;
    this.boxes.clear();
    this.headers.clear();
    this.edges.clear();
    if (!svg) return;
    // Lines are two pixels wide; an invisible wide copy on top makes them easy to pick.
    for (const path of svg.querySelectorAll<SVGPathElement>('path[data-archimate-relationship]')) {
      const id = path.getAttribute('data-archimate-relationship');
      const ends = pathEnds(path);
      if (!id || !ends) continue;
      this.edges.set(id, ends);
      const hit = document.createElementNS(svgNamespace, 'path');
      hit.setAttribute('d', path.getAttribute('d') ?? '');
      hit.setAttribute('class', 'edge-hit');
      hit.setAttribute('data-hit-for', id);
      path.after(hit);
    }
    this.notes.clear();
    let offset: Point | undefined;
    for (const group of svg.querySelectorAll<SVGGElement>(itemSelector)) {
      const note = group.getAttribute('data-archimate-note');
      const id = group.getAttribute('data-archimate-element') ?? note;
      const position = parseTranslate(group);
      if (!id || !position) continue;
      if (note) this.notes.add(note);
      const matrix = group.getCTM();
      if (!offset && matrix) offset = { x: matrix.e - position.x, y: matrix.f - position.y };
      const outline = group.querySelector(':scope > rect');
      const bounds = group.getBBox();
      const width = Number(outline?.getAttribute('width') ?? bounds.width);
      const height = Number(outline?.getAttribute('height') ?? bounds.height);
      this.boxes.set(id, { x: position.x, y: position.y, width, height });
      const label = group.querySelector(':scope > text');
      this.headers.set(id, Math.max(54, (label instanceof SVGGraphicsElement ? label.getBBox().height : 0) + 20));
    }
    // Shift the SVG so layout coordinates equal stage coordinates and nothing jumps between renders.
    svg.style.left = `${-(offset?.x ?? 0)}px`;
    svg.style.top = `${-(offset?.y ?? 0)}px`;
  }

  // The renderer's header height decides where a container's content area starts.
  headerOf(id: string): number {
    return this.headers.get(id) ?? 54;
  }

  setSelection(ids: readonly string[]): void {
    this.selection = ids;
    this.selectedRelationship = null;
    this.drawSelection();
  }

  setRelationshipSelection(id: string | null): void {
    this.selectedRelationship = id;
    this.selection = [];
    this.drawSelection();
  }

  // Handles for connecting and resizing belong to a single selected element only.
  private get single(): string | null {
    return this.selection.length === 1 ? (this.selection[0] ?? null) : null;
  }

  private drawSelection(): void {
    for (const handle of this.overlay.querySelectorAll('.ring, .handle, .resize-zone')) handle.remove();
    for (const path of this.svg?.querySelectorAll('.is-selected') ?? []) path.classList.remove('is-selected');
    const edge = this.selectedRelationship ? this.edges.get(this.selectedRelationship) : undefined;
    if (edge && this.selectedRelationship) {
      this.svg
        ?.querySelector(`path[data-archimate-relationship="${CSS.escape(this.selectedRelationship)}"]`)
        ?.classList.add('is-selected');
      if (this.locked) return;
      for (const [end, point] of [
        ['source', edge.start],
        ['target', edge.end],
      ] as const) {
        const handle = document.createElement('span');
        handle.className = 'handle endpoint';
        handle.dataset.end = end;
        handle.dataset.tip = 'Drag onto another element to reconnect, or onto a side of this one to pin it';
        handle.style.left = `${point.x}px`;
        handle.style.top = `${point.y}px`;
        this.overlay.append(handle);
      }
      return;
    }
    const inset = 6;
    for (const id of this.selection) {
      const box = this.boxes.get(id);
      if (!box) continue;
      const ring = document.createElement('div');
      ring.className = 'ring';
      Object.assign(ring.style, {
        left: `${box.x - inset}px`,
        top: `${box.y - inset}px`,
        width: `${box.width + 2 * inset}px`,
        height: `${box.height + 2 * inset}px`,
      });
      this.overlay.append(ring);
    }
    if (this.locked) return;
    const box = this.single && !this.notes.has(this.single) ? this.boxes.get(this.single) : undefined;
    if (!box) return;
    // Edge and corner strips sit under the round connect handles, which win where they overlap.
    // Fingers need larger targets than a mouse pointer.
    const band = matchMedia('(pointer: coarse)').matches ? 20 : 10;
    const outer = { x: box.x - inset, y: box.y - inset, width: box.width + 2 * inset, height: box.height + 2 * inset };
    const zones: readonly (readonly [Edge, number, number, number, number])[] = [
      ['n', outer.x, outer.y - band / 2, outer.width, band],
      ['s', outer.x, outer.y + outer.height - band / 2, outer.width, band],
      ['w', outer.x - band / 2, outer.y, band, outer.height],
      ['e', outer.x + outer.width - band / 2, outer.y, band, outer.height],
      ['nw', outer.x - band, outer.y - band, 2 * band, 2 * band],
      ['ne', outer.x + outer.width - band, outer.y - band, 2 * band, 2 * band],
      ['sw', outer.x - band, outer.y + outer.height - band, 2 * band, 2 * band],
      ['se', outer.x + outer.width - band, outer.y + outer.height - band, 2 * band, 2 * band],
    ];
    for (const [edge, x, y, width, height] of zones) {
      const zone = document.createElement('span');
      zone.className = `resize-zone${edge.length === 2 ? ' corner' : ''}`;
      zone.dataset.edge = edge;
      zone.dataset.tip = 'Drag to resize';
      Object.assign(zone.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        cursor: edgeCursors[edge],
      });
      this.overlay.append(zone);
    }
    const sides: readonly (readonly [string, number, number])[] = [
      ['top', box.x + box.width / 2, box.y - inset],
      ['right', box.x + box.width + inset, box.y + box.height / 2],
      ['bottom', box.x + box.width / 2, box.y + box.height + inset],
      ['left', box.x - inset, box.y + box.height / 2],
    ];
    for (const [side, x, y] of sides) {
      const handle = document.createElement('span');
      handle.className = 'handle';
      handle.dataset.side = side;
      handle.dataset.tip = 'Drag to connect';
      handle.style.left = `${x}px`;
      handle.style.top = `${y}px`;
      this.overlay.append(handle);
    }
  }

  layoutPoint(clientX: number, clientY: number): Point {
    const rect = this.root.getBoundingClientRect();
    return { x: (clientX - rect.left - this.pan.x) / this.scale, y: (clientY - rect.top - this.pan.y) / this.scale };
  }

  clientPoint(point: Point): Point {
    const rect = this.root.getBoundingClientRect();
    return { x: rect.left + this.pan.x + point.x * this.scale, y: rect.top + this.pan.y + point.y * this.scale };
  }

  elementAt(clientX: number, clientY: number): string | undefined {
    return elementId(document.elementFromPoint(clientX, clientY));
  }

  showGhost(snapped: Snapped | null): void {
    if (!snapped) {
      this.ghost.remove();
      return;
    }
    const { box, label } = snapped;
    Object.assign(this.ghost.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    this.ghost.innerHTML = '';
    const tag = document.createElement('span');
    tag.className = 'ghost-label';
    tag.textContent = label;
    this.ghost.append(tag);
    if (!this.ghost.isConnected) this.overlay.append(this.ghost);
  }

  // An input over the element; Enter or leaving it commits, Escape keeps the current name.
  // A note's text may hold line breaks, so it is edited in a text area where Shift+Enter starts a new line.
  startRename(id: string, initial: string, commit: (name: string) => void, done: () => void): void {
    const box = this.boxes.get(id);
    if (!box) return;
    const note = this.notes.has(id);
    const input = document.createElement(note ? 'textarea' : 'input');
    input.className = note ? 'rename rename-note' : 'rename';
    input.value = initial;
    input.setAttribute('aria-label', note ? 'Note text' : 'Element name');
    Object.assign(input.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${Math.max(box.width, 140)}px`,
      height: note ? `${Math.max(box.height, 60)}px` : `${Math.min(box.height, 60)}px`,
    });
    let finished = false;
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      input.remove();
      if (save && name && name !== initial) commit(name);
      else done();
    };
    const field: HTMLElement = input;
    field.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        finish(true);
      }
      if (event.key === 'Escape') finish(false);
    });
    field.addEventListener('blur', () => finish(true));
    field.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.overlay.append(input);
    input.focus();
    input.select();
  }

  // Keeps the drawing still on screen after its layout coordinates moved by the given amount.
  shiftView(dx: number, dy: number): void {
    this.pan = { x: this.pan.x - dx * this.scale, y: this.pan.y - dy * this.scale };
    this.applyTransform();
  }

  zoomBy(factor: number, anchor?: Point): void {
    const rect = this.root.getBoundingClientRect();
    const client = anchor ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const before = this.layoutPoint(client.x, client.y);
    this.scale = Math.min(maxZoom, Math.max(minZoom, this.scale * factor));
    this.pan = {
      x: client.x - rect.left - before.x * this.scale,
      y: client.y - rect.top - before.y * this.scale,
    };
    this.applyTransform();
  }

  // Fits the drawing into the space the floating panels leave free; animated, it glides there instead of jumping.
  fit(free: { left: number; right: number; top: number; bottom: number }, animate = false): void {
    const boxes = [...this.boxes.values()];
    if (!boxes.length) return;
    if (animate) this.ease();
    const left = Math.min(...boxes.map(({ x }) => x)) - 40;
    const top = Math.min(...boxes.map(({ y }) => y)) - 40;
    const right = Math.max(...boxes.map(({ x, width }) => x + width)) + 40;
    const bottom = Math.max(...boxes.map(({ y, height }) => y + height)) + 40;
    const rect = this.root.getBoundingClientRect();
    const width = Math.max(200, rect.width - free.left - free.right);
    const height = Math.max(200, rect.height - free.top - free.bottom);
    this.scale = Math.min(1, Math.max(minZoom, Math.min(width / (right - left), height / (bottom - top))));
    this.pan = {
      x: free.left + (width - (right - left) * this.scale) / 2 - left * this.scale,
      y: free.top + (height - (bottom - top) * this.scale) / 2 - top * this.scale,
    };
    this.applyTransform();
  }

  private easeTimer: number | undefined;

  private ease(): void {
    clearTimeout(this.easeTimer);
    this.root.classList.add('is-easing');
    this.easeTimer = window.setTimeout(() => this.stopEasing(), easeMs);
  }

  // Pointer and wheel input take over at once, so the view never lags behind a hand.
  private stopEasing(): void {
    clearTimeout(this.easeTimer);
    this.root.classList.remove('is-easing');
  }

  private applyTransform(): void {
    this.stage.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
    const cell = gridUnit * this.scale;
    this.root.style.backgroundSize = `${cell}px ${cell}px`;
    this.root.style.backgroundPosition = `${this.pan.x + layoutPadding * this.scale}px ${this.pan.y + layoutPadding * this.scale}px`;
    this.onZoom(this.scale);
  }

  private startPinch(): void {
    const [first, second] = [...this.pointers.values()];
    if (!first || !second) return;
    this.cancelGesture();
    this.gesture = {
      kind: 'pinch',
      distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
      scale: this.scale,
      middle: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      pan: this.pan,
    };
  }

  // Zooms around the pinch's starting midpoint, which follows the fingers as they move.
  private pinch(gesture: Extract<Gesture, { kind: 'pinch' }>): void {
    const [first, second] = [...this.pointers.values()];
    if (!first || !second) return;
    const rect = this.root.getBoundingClientRect();
    const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const anchor = {
      x: (gesture.middle.x - rect.left - gesture.pan.x) / gesture.scale,
      y: (gesture.middle.y - rect.top - gesture.pan.y) / gesture.scale,
    };
    const ratio = Math.hypot(first.x - second.x, first.y - second.y) / gesture.distance;
    this.scale = Math.min(maxZoom, Math.max(minZoom, gesture.scale * ratio));
    this.pan = {
      x: middle.x - rect.left - anchor.x * this.scale,
      y: middle.y - rect.top - anchor.y * this.scale,
    };
    this.applyTransform();
  }

  private pointerDown(event: PointerEvent): void {
    this.stopEasing();
    if (event.button !== 0 && event.button !== 1) return;
    const client = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, client);
    this.root.setPointerCapture(event.pointerId);
    if (this.pointers.size === 2) {
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    const target = event.target instanceof Element ? event.target : null;
    if (this.locked) {
      this.gesture = { kind: 'pan', start: client, pan: this.pan, moved: false, tap: this.tapOn(target) };
      return;
    }
    const handle = target?.closest('.handle');
    const end = handle instanceof HTMLElement ? handle.dataset.end : undefined;
    const edge = this.selectedRelationship ? this.edges.get(this.selectedRelationship) : undefined;
    if ((end === 'source' || end === 'target') && edge && this.selectedRelationship) {
      // The line is redrawn from the end that stays put.
      const origin = end === 'source' ? edge.end : edge.start;
      this.gesture = { kind: 'reconnect', id: this.selectedRelationship, end, origin };
      this.svg
        ?.querySelector(`path[data-archimate-relationship="${CSS.escape(this.selectedRelationship)}"]`)
        ?.classList.add('is-moving');
      this.overlay.append(this.line);
      this.updateLine(this.layoutPoint(client.x, client.y));
    } else if (target?.closest('.resize-zone') && this.single && !handle) {
      const zone = target.closest<HTMLElement>('.resize-zone');
      const edge = allEdges.find((candidate) => candidate === zone?.dataset.edge);
      const box = this.boxes.get(this.single);
      if (!edge || !box) return;
      this.gesture = { kind: 'resize', id: this.single, edge, start: client, box, target: box };
    } else if (handle && this.single) {
      this.gesture = { kind: 'connect', from: this.single, origin: this.layoutPoint(client.x, client.y) };
      this.overlay.append(this.line);
      this.updateLine(this.layoutPoint(client.x, client.y));
    } else {
      this.pressCanvas(event, target, client);
    }
  }

  private pressCanvas(event: PointerEvent, target: Element | null, client: Point): void {
    const id = event.button === 0 ? itemId(target) : undefined;
    const relationship = event.button === 0 && !id ? relationshipId(target) : undefined;
    const additive = event.shiftKey;
    const isSelected = id !== undefined && this.selection.includes(id);
    if (id && this.boxes.has(id)) {
      // Holding Space moves the canvas even over an element; lifting without moving selects the element.
      // The hand tool alone leaves elements draggable and only changes what a drag on empty canvas does.
      if (this.holdingSpace) {
        this.gesture = { kind: 'pan', start: client, pan: this.pan, moved: false, tap: { kind: 'element', id } };
      } else if (additive && !isSelected) {
        this.events.toggle(id);
        this.gesture = { kind: 'press', id, start: client, release: 'none' };
      } else if (additive) {
        this.gesture = { kind: 'press', id, start: client, release: 'toggle' };
      } else if (isSelected) {
        // A press on one of several selected elements keeps the group, so it can be dragged together.
        this.gesture = { kind: 'press', id, start: client, release: this.selection.length > 1 ? 'select' : 'none' };
      } else {
        this.events.select(id);
        this.gesture = { kind: 'press', id, start: client, release: 'none' };
      }
    } else if (relationship) {
      this.events.selectRelationship(relationship);
      this.gesture = { kind: 'none' };
    } else if (event.button === 0 && !this.handActive) {
      const start = this.layoutPoint(client.x, client.y);
      this.gesture = { kind: 'marquee', start, end: start, moved: false };
    } else {
      this.gesture = { kind: 'pan', start: client, pan: this.pan, moved: false };
    }
  }

  private drawMarquee(gesture: Extract<Gesture, { kind: 'marquee' }>): void {
    const area = spanning(gesture.start, gesture.end);
    Object.assign(this.marquee.style, {
      left: `${area.x}px`,
      top: `${area.y}px`,
      width: `${area.width}px`,
      height: `${area.height}px`,
    });
    if (!this.marquee.isConnected) this.overlay.append(this.marquee);
  }

  // Only elements wholly inside the box are selected, so a box drawn inside a container leaves the container out.
  private enclosed(area: Box): string[] {
    return [...this.boxes].flatMap(([id, box]) =>
      box.x >= area.x &&
      box.y >= area.y &&
      box.x + box.width <= area.x + area.width &&
      box.y + box.height <= area.y + area.height
        ? [id]
        : [],
    );
  }

  private pointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    const client = { x: event.clientX, y: event.clientY };
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, client);
    switch (gesture.kind) {
      case 'pinch':
        this.pinch(gesture);
        return;
      case 'pan': {
        const dx = client.x - gesture.start.x;
        const dy = client.y - gesture.start.y;
        if (!gesture.moved && Math.hypot(dx, dy) < dragThreshold) return;
        gesture.moved = true;
        this.root.classList.add('is-panning');
        this.pan = { x: gesture.pan.x + dx, y: gesture.pan.y + dy };
        this.applyTransform();
        return;
      }
      case 'press': {
        if (Math.hypot(client.x - gesture.start.x, client.y - gesture.start.y) < dragThreshold) return;
        const box = this.boxes.get(gesture.id);
        if (!box) return;
        const ids = this.selection.includes(gesture.id) ? this.selection : [gesture.id];
        const group = ids.flatMap((id) => {
          const member = this.boxes.get(id);
          return member ? [{ id, box: member }] : [];
        });
        this.gesture = { kind: 'drag', id: gesture.id, start: gesture.start, box, group, target: box };
        for (const member of group) this.groupOf(member.id)?.classList.add('is-dragging');
        this.pointerMove(event);
        return;
      }
      case 'drag': {
        const dx = (client.x - gesture.start.x) / this.scale;
        const dy = (client.y - gesture.start.y) / this.scale;
        gesture.target = { x: gesture.box.x + dx, y: gesture.box.y + dy };
        for (const { id, box } of gesture.group) {
          this.groupOf(id)?.setAttribute('transform', `translate(${box.x + dx} ${box.y + dy})`);
        }
        this.showGhost(this.events.snap(gesture.id, gesture.target));
        return;
      }
      case 'marquee': {
        gesture.end = this.layoutPoint(client.x, client.y);
        const { width, height } = spanning(gesture.start, gesture.end);
        if (!gesture.moved && Math.hypot(width, height) * this.scale < dragThreshold) return;
        gesture.moved = true;
        this.drawMarquee(gesture);
        return;
      }
      case 'resize': {
        const dx = (client.x - gesture.start.x) / this.scale;
        const dy = (client.y - gesture.start.y) / this.scale;
        gesture.target = resized(gesture.box, gesture.edge, dx, dy);
        this.showGhost(this.events.snapResize(gesture.id, gesture.target));
        return;
      }
      case 'connect':
      case 'reconnect': {
        this.updateLine(this.layoutPoint(client.x, client.y));
        const target = this.elementAt(client.x, client.y);
        this.markTarget(gesture.kind === 'connect' && target === gesture.from ? undefined : target);
        return;
      }
      case 'none':
        return;
    }
  }

  private pointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    const gesture = this.gesture;
    this.gesture = { kind: 'none' };
    this.root.classList.remove('is-panning');
    this.markTarget(undefined);
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    switch (gesture.kind) {
      case 'pan':
        if (gesture.moved) return;
        if (gesture.tap?.kind === 'relationship') this.events.selectRelationship(gesture.tap.id);
        else this.events.select(gesture.tap?.id ?? null);
        return;
      case 'pinch':
        return;
      case 'drag':
        this.showGhost(null);
        this.events.move(
          gesture.id,
          gesture.target,
          gesture.group.flatMap(({ id }) => (id === gesture.id ? [] : [id])),
        );
        return;
      case 'marquee':
        this.marquee.remove();
        this.events.selectMany(gesture.moved ? this.enclosed(spanning(gesture.start, gesture.end)) : []);
        return;
      case 'press':
        if (gesture.release === 'toggle') this.events.toggle(gesture.id);
        if (gesture.release === 'select') this.events.select(gesture.id);
        return;
      case 'connect': {
        this.line.remove();
        const target = this.elementAt(event.clientX, event.clientY);
        if (target && target !== gesture.from) {
          this.events.connect(gesture.from, target, { x: event.clientX, y: event.clientY });
        }
        return;
      }
      case 'resize':
        this.showGhost(null);
        if (gesture.target !== gesture.box) this.events.resize(gesture.id, gesture.target);
        return;
      case 'reconnect': {
        this.line.remove();
        this.svg?.querySelector('.is-moving')?.classList.remove('is-moving');
        const element = this.elementAt(event.clientX, event.clientY);
        const box = element ? this.boxes.get(element) : undefined;
        if (element && box) {
          const side = nearestSide(box, this.layoutPoint(event.clientX, event.clientY));
          this.events.reconnect(gesture.id, gesture.end, element, side);
        }
        return;
      }
      case 'none':
        return;
    }
  }

  private cancelGesture(): void {
    const gesture = this.gesture;
    this.gesture = { kind: 'none' };
    this.root.classList.remove('is-panning');
    this.showGhost(null);
    this.line.remove();
    this.marquee.remove();
    this.markTarget(undefined);
    this.svg?.querySelector('.is-moving')?.classList.remove('is-moving');
    if (gesture.kind === 'drag') {
      for (const { id, box } of gesture.group) {
        this.groupOf(id)?.classList.remove('is-dragging');
        this.groupOf(id)?.setAttribute('transform', `translate(${box.x} ${box.y})`);
      }
    }
  }

  cancel(): void {
    this.cancelGesture();
  }

  private groupOf(id: string): SVGGElement | null {
    const escaped = CSS.escape(id);
    return (
      this.svg?.querySelector<SVGGElement>(
        `[data-archimate-element="${escaped}"], [data-archimate-note="${escaped}"]`,
      ) ?? null
    );
  }

  // The element a line would attach to gets a heavy outline while the pointer is over it.
  private markTarget(id: string | undefined): void {
    for (const marked of this.svg?.querySelectorAll('.is-target') ?? []) {
      if (marked.getAttribute('data-archimate-element') !== id) marked.classList.remove('is-target');
    }
    if (id) this.groupOf(id)?.classList.add('is-target');
  }

  private updateLine(to: Point): void {
    if (this.gesture.kind !== 'connect' && this.gesture.kind !== 'reconnect') return;
    const { origin } = this.gesture;
    const line = this.line.querySelector('line');
    const dot = this.line.querySelector('circle');
    line?.setAttribute('x1', String(origin.x));
    line?.setAttribute('y1', String(origin.y));
    line?.setAttribute('x2', String(to.x));
    line?.setAttribute('y2', String(to.y));
    dot?.setAttribute('cx', String(to.x));
    dot?.setAttribute('cy', String(to.y));
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    this.stopEasing();
    if (event.ctrlKey || event.metaKey) {
      this.zoomBy(Math.exp(-event.deltaY * 0.01), { x: event.clientX, y: event.clientY });
      return;
    }
    this.pan = { x: this.pan.x - event.deltaX, y: this.pan.y - event.deltaY };
    this.applyTransform();
  }
}
