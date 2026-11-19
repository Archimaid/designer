// The rendered SVG sits on a stage whose coordinates are the renderer's layout coordinates, so grid maths,
// overlays and hit-testing all share one space. Pan and zoom are a CSS transform on the stage.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box extends Point {
  readonly width: number;
  readonly height: number;
}

export interface Snapped {
  readonly box: Box;
  readonly label: string;
}

export type End = 'source' | 'target';
export type Side = 'T' | 'R' | 'B' | 'L';

export interface CanvasEvents {
  readonly select: (id: string | null) => void;
  readonly selectRelationship: (id: string) => void;
  // An end dropped on an element: another element reconnects it, its own element pins the side.
  readonly reconnect: (id: string, end: End, element: string, side: Side) => void;
  readonly snap: (id: string, topLeft: Point) => Snapped;
  readonly move: (id: string, topLeft: Point) => void;
  readonly connect: (from: string, to: string, client: Point) => void;
  readonly rename: (id: string) => void;
}

// The renderer leaves this margin around a custom layout before the first grid line.
export const layoutPadding = 24;
export const gridUnit = 20;
const minZoom = 0.25;
const maxZoom = 3;
const dragThreshold = 4;
const svgNamespace = 'http://www.w3.org/2000/svg';

type Gesture =
  | { readonly kind: 'none' }
  | { readonly kind: 'pan'; readonly start: Point; readonly pan: Point; moved: boolean }
  | { readonly kind: 'press'; readonly id: string; readonly start: Point; readonly box: Box }
  | { readonly kind: 'drag'; readonly id: string; readonly start: Point; readonly box: Box; target: Point }
  | { readonly kind: 'connect'; readonly from: string; readonly origin: Point }
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
export function nearestSide(box: Box, point: Point): Side {
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

function elementId(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  return target.closest('[data-archimate-element]')?.getAttribute('data-archimate-element') ?? undefined;
}

export class DiagramCanvas {
  readonly boxes = new Map<string, Box>();
  private readonly edges = new Map<string, { start: Point; end: Point }>();
  private selectedRelationship: string | null = null;
  private readonly headers = new Map<string, number>();
  private svg: SVGSVGElement | undefined;
  private pan: Point = { x: 360, y: 140 };
  private scale = 1;
  private gesture: Gesture = { kind: 'none' };
  private selected: string | null = null;
  private readonly ring = document.createElement('div');
  private readonly ghost = document.createElement('div');
  private readonly line = document.createElementNS(svgNamespace, 'svg');
  private onZoom: (scale: number) => void = () => undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly overlay: HTMLElement,
    private readonly events: CanvasEvents,
  ) {
    this.ring.className = 'ring';
    this.ghost.className = 'ghost';
    this.line.setAttribute('class', 'connector-line');
    this.line.innerHTML =
      '<line stroke="#17171c" stroke-width="2" stroke-dasharray="6 4" /><circle r="5" fill="#1f7fae" />';
    root.addEventListener('pointerdown', (event) => this.pointerDown(event));
    root.addEventListener('pointermove', (event) => this.pointerMove(event));
    root.addEventListener('pointerup', (event) => this.pointerUp(event));
    root.addEventListener('pointercancel', () => this.cancelGesture());
    root.addEventListener('dblclick', (event) => {
      const id = elementId(event.target);
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
    let offset: Point | undefined;
    for (const group of svg.querySelectorAll<SVGGElement>('[data-archimate-element]')) {
      const id = group.getAttribute('data-archimate-element');
      const position = parseTranslate(group);
      if (!id || !position) continue;
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

  setSelection(id: string | null): void {
    this.selected = id;
    this.selectedRelationship = null;
    this.drawSelection();
  }

  setRelationshipSelection(id: string | null): void {
    this.selectedRelationship = id;
    this.selected = null;
    this.drawSelection();
  }

  private drawSelection(): void {
    this.ring.remove();
    for (const handle of this.overlay.querySelectorAll('.handle')) handle.remove();
    for (const path of this.svg?.querySelectorAll('.is-selected') ?? []) path.classList.remove('is-selected');
    const edge = this.selectedRelationship ? this.edges.get(this.selectedRelationship) : undefined;
    if (edge && this.selectedRelationship) {
      this.svg
        ?.querySelector(`path[data-archimate-relationship="${CSS.escape(this.selectedRelationship)}"]`)
        ?.classList.add('is-selected');
      for (const [end, point] of [
        ['source', edge.start],
        ['target', edge.end],
      ] as const) {
        const handle = document.createElement('span');
        handle.className = 'handle endpoint';
        handle.dataset.end = end;
        handle.title = 'Drag onto another element to reconnect, or onto a side of this one to pin it';
        handle.style.left = `${point.x}px`;
        handle.style.top = `${point.y}px`;
        this.overlay.append(handle);
      }
      return;
    }
    const box = this.selected ? this.boxes.get(this.selected) : undefined;
    if (!box) return;
    const inset = 6;
    Object.assign(this.ring.style, {
      left: `${box.x - inset}px`,
      top: `${box.y - inset}px`,
      width: `${box.width + 2 * inset}px`,
      height: `${box.height + 2 * inset}px`,
    });
    this.overlay.append(this.ring);
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
      handle.title = 'Drag to connect';
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
  startRename(id: string, initial: string, commit: (name: string) => void, done: () => void): void {
    const box = this.boxes.get(id);
    if (!box) return;
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = initial;
    input.setAttribute('aria-label', 'Element name');
    Object.assign(input.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${Math.max(box.width, 140)}px`,
      height: `${Math.min(box.height, 60)}px`,
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
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.overlay.append(input);
    input.focus();
    input.select();
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

  // Fits the drawing into the space the floating panels leave free.
  fit(free: { left: number; right: number; top: number; bottom: number }): void {
    const boxes = [...this.boxes.values()];
    if (!boxes.length) return;
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

  private applyTransform(): void {
    this.stage.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
    const cell = gridUnit * this.scale;
    this.root.style.backgroundSize = `${cell}px ${cell}px`;
    this.root.style.backgroundPosition = `${this.pan.x + layoutPadding * this.scale}px ${this.pan.y + layoutPadding * this.scale}px`;
    this.onZoom(this.scale);
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    const client = { x: event.clientX, y: event.clientY };
    const target = event.target instanceof Element ? event.target : null;
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
    } else if (handle && this.selected) {
      const box = this.boxes.get(this.selected);
      if (!box) return;
      this.gesture = { kind: 'connect', from: this.selected, origin: this.layoutPoint(client.x, client.y) };
      this.overlay.append(this.line);
      this.updateLine(this.layoutPoint(client.x, client.y));
    } else {
      const id = event.button === 0 ? elementId(target) : undefined;
      const box = id ? this.boxes.get(id) : undefined;
      const relationship = event.button === 0 && !id ? relationshipId(target) : undefined;
      if (id && box) {
        this.events.select(id);
        this.gesture = { kind: 'press', id, start: client, box };
      } else if (relationship) {
        this.events.selectRelationship(relationship);
        this.gesture = { kind: 'none' };
      } else {
        this.gesture = { kind: 'pan', start: client, pan: this.pan, moved: false };
      }
    }
    this.root.setPointerCapture(event.pointerId);
  }

  private pointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    const client = { x: event.clientX, y: event.clientY };
    switch (gesture.kind) {
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
        this.gesture = { kind: 'drag', id: gesture.id, start: gesture.start, box: gesture.box, target: gesture.box };
        this.groupOf(gesture.id)?.classList.add('is-dragging');
        this.pointerMove(event);
        return;
      }
      case 'drag': {
        gesture.target = {
          x: gesture.box.x + (client.x - gesture.start.x) / this.scale,
          y: gesture.box.y + (client.y - gesture.start.y) / this.scale,
        };
        this.groupOf(gesture.id)?.setAttribute('transform', `translate(${gesture.target.x} ${gesture.target.y})`);
        this.showGhost(this.events.snap(gesture.id, gesture.target));
        return;
      }
      case 'connect':
      case 'reconnect':
        this.updateLine(this.layoutPoint(client.x, client.y));
        return;
      case 'none':
        return;
    }
  }

  private pointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    this.gesture = { kind: 'none' };
    this.root.classList.remove('is-panning');
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    switch (gesture.kind) {
      case 'pan':
        if (!gesture.moved) this.events.select(null);
        return;
      case 'drag':
        this.showGhost(null);
        this.events.move(gesture.id, gesture.target);
        return;
      case 'connect': {
        this.line.remove();
        const target = this.elementAt(event.clientX, event.clientY);
        if (target && target !== gesture.from) {
          this.events.connect(gesture.from, target, { x: event.clientX, y: event.clientY });
        }
        return;
      }
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
      case 'press':
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
    this.svg?.querySelector('.is-moving')?.classList.remove('is-moving');
    if (gesture.kind === 'drag') {
      this.groupOf(gesture.id)?.classList.remove('is-dragging');
      this.groupOf(gesture.id)?.setAttribute('transform', `translate(${gesture.box.x} ${gesture.box.y})`);
    }
  }

  cancel(): void {
    this.cancelGesture();
  }

  private groupOf(id: string): SVGGElement | null {
    return this.svg?.querySelector<SVGGElement>(`[data-archimate-element="${CSS.escape(id)}"]`) ?? null;
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
    if (event.ctrlKey || event.metaKey) {
      this.zoomBy(Math.exp(-event.deltaY * 0.01), { x: event.clientX, y: event.clientY });
      return;
    }
    this.pan = { x: this.pan.x - event.deltaX, y: this.pan.y - event.deltaY };
    this.applyTransform();
  }
}
