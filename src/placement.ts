import type { ArchiMateModel } from 'archimaid/language';
import { gridUnit, layoutPadding, type Box, type Point, type Snapped } from './geometry.ts';
import { parentsOf, positionOf, topLevelIds } from './model.ts';
import {
  setLayout,
  setPosition,
  setPositions,
  setSize,
  shiftPositions,
  type GridPoint,
  type GridSize,
} from './source.ts';

// Turning canvas gestures into grid positions in the text. Everything here is a pure function of the model,
// the boxes the renderer drew and the text, so the canvas and the tests share one set of rules.

export interface Placement {
  readonly model: ArchiMateModel | undefined;
  readonly boxes: ReadonlyMap<string, Box>;
  // Where a container's content area starts below its top edge.
  readonly headerOf: (id: string) => number;
}

// A placed edit and the grid distance every top-level item moved to make room; the view follows that shift,
// so nothing appears to jump.
export interface Placed {
  readonly text: string;
  readonly shift: GridPoint;
}

// A nested element's grid starts inside its parent's content area; everything else starts at the diagram's.
export function gridOrigin(placement: Placement, id: string): Point {
  const parent = parentsOf(placement.model).get(id);
  const box = parent ? placement.boxes.get(parent) : undefined;
  if (!parent || !box) return { x: layoutPadding, y: layoutPadding };
  return { x: box.x + layoutPadding, y: box.y + placement.headerOf(parent) + layoutPadding };
}

export function rawGridFor(placement: Placement, id: string, topLeft: Point): GridPoint {
  const origin = gridOrigin(placement, id);
  return { x: Math.round((topLeft.x - origin.x) / gridUnit), y: Math.round((topLeft.y - origin.y) / gridUnit) };
}

function gridFor(placement: Placement, id: string, topLeft: Point): GridPoint {
  const raw = rawGridFor(placement, id, topLeft);
  return { x: Math.max(0, raw.x), y: Math.max(0, raw.y) };
}

export function gridSize(box: { width: number; height: number }): GridSize {
  return {
    width: Math.max(1, Math.round(box.width / gridUnit)),
    height: Math.max(1, Math.round(box.height / gridUnit)),
  };
}

// Where a dragged item would land, for the ghost the canvas draws under the pointer.
export function snapMove(placement: Placement, id: string, topLeft: Point): Snapped {
  const nested = parentsOf(placement.model).has(id);
  const grid = nested ? gridFor(placement, id, topLeft) : rawGridFor(placement, id, topLeft);
  const box = placement.boxes.get(id);
  const origin = gridOrigin(placement, id);
  return {
    box: {
      x: origin.x + grid.x * gridUnit,
      y: origin.y + grid.y * gridUnit,
      width: box?.width ?? 140,
      height: box?.height ?? 60,
    },
    label: grid.x < 0 || grid.y < 0 ? 'Moves the others to make room' : `${id} at ${grid.x} ${grid.y}`,
  };
}

export function snapResize(placement: Placement, id: string, box: Box): Snapped {
  const nested = parentsOf(placement.model).has(id);
  const grid = nested ? gridFor(placement, id, box) : rawGridFor(placement, id, box);
  const origin = gridOrigin(placement, id);
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
}

// The canvas has no edge: a top-level item placed above or left of the others shifts them all by the same
// amount. Nested items stay inside their parent, so their positions only clamp at zero.
function placeAll(
  placement: Placement,
  text: string,
  targets: ReadonlyMap<string, GridPoint>,
): Placed & { readonly placed: ReadonlyMap<string, GridPoint> } {
  const nested = parentsOf(placement.model);
  const topLevelTargets = [...targets].filter(([id]) => !nested.has(id)).map(([, raw]) => raw);
  const shift = {
    x: Math.max(0, ...topLevelTargets.map((raw) => -raw.x)),
    y: Math.max(0, ...topLevelTargets.map((raw) => -raw.y)),
  };
  let next = shift.x || shift.y ? shiftPositions(text, shift.x, shift.y, topLevelIds(placement.model)) : text;
  const placed = new Map<string, GridPoint>();
  for (const [id, raw] of targets) {
    const grid = nested.has(id)
      ? { x: Math.max(0, raw.x), y: Math.max(0, raw.y) }
      : { x: raw.x + shift.x, y: raw.y + shift.y };
    placed.set(id, grid);
    next = setPosition(next, id, grid);
  }
  return { text: next, shift, placed };
}

export function placeAt(placement: Placement, text: string, id: string, raw: GridPoint): Placed & { grid: GridPoint } {
  const { text: next, shift, placed } = placeAll(placement, text, new Map([[id, raw]]));
  const grid = placed.get(id);
  if (!grid) throw new Error(`placeAll did not place ${id}.`);
  return { text: next, shift, grid };
}

// Pins every unpositioned top-level element where automatic layout drew it, so switching to custom layout
// moves nothing. The element about to be moved is left out, as its new position follows anyway.
export function toCustomLayout(placement: Placement, text: string, except?: string): string {
  const nested = parentsOf(placement.model);
  const pinned = new Map<string, GridPoint>();
  for (const element of placement.model?.elements ?? []) {
    if (element.id === except || nested.has(element.id) || positionOf(placement.model, element.id)) continue;
    const box = placement.boxes.get(element.id);
    if (box) pinned.set(element.id, gridFor(placement, element.id, box));
  }
  return setLayout(setPositions(text, pinned), 'custom');
}

// A position inside an unpositioned parent is ignored, so the parents are pinned where they are.
function pinParents(placement: Placement, text: string, id: string): string {
  const nested = parentsOf(placement.model);
  let next = text;
  for (let parent = nested.get(id); parent; parent = nested.get(parent)) {
    const box = placement.boxes.get(parent);
    if (box && !positionOf(placement.model, parent)) next = setPosition(next, parent, gridFor(placement, parent, box));
  }
  return next;
}

// Moving and resizing share one edit: resizing from the top or left edge moves the item too.
export function moveItem(
  placement: Placement,
  text: string,
  id: string,
  topLeft: Point,
  size?: GridSize,
): Placed & { grid: GridPoint } {
  const custom = placement.model?.layout === 'custom';
  const pinned = pinParents(placement, custom ? text : toCustomLayout(placement, text, id), id);
  const placed = placeAt(placement, pinned, id, rawGridFor(placement, id, topLeft));
  return size ? { ...placed, text: setSize(placed.text, id, size) } : placed;
}

// Every selected item moves by the grid distance the dragged one snapped to. An item whose parent is also
// selected already moves with that parent, because nested positions are relative. No distance, no edit.
export function moveItems(
  placement: Placement,
  text: string,
  lead: string,
  topLeft: Point,
  followers: readonly string[],
): Placed | undefined {
  const leadBox = placement.boxes.get(lead);
  if (!leadBox) return undefined;
  const from = rawGridFor(placement, lead, leadBox);
  const to = rawGridFor(placement, lead, topLeft);
  const delta = { x: to.x - from.x, y: to.y - from.y };
  if (!delta.x && !delta.y) return undefined;
  const chosen = new Set([lead, ...followers]);
  const nested = parentsOf(placement.model);
  const hasChosenAncestor = (id: string): boolean => {
    for (let parent = nested.get(id); parent; parent = nested.get(parent)) if (chosen.has(parent)) return true;
    return false;
  };
  let next = placement.model?.layout === 'custom' ? text : toCustomLayout(placement, text);
  const targets = new Map<string, GridPoint>();
  for (const id of chosen) {
    const box = placement.boxes.get(id);
    if (!box || hasChosenAncestor(id)) continue;
    next = pinParents(placement, next, id);
    const at = rawGridFor(placement, id, box);
    targets.set(id, { x: at.x + delta.x, y: at.y + delta.y });
  }
  const { text: placed, shift } = placeAll(placement, next, targets);
  return { text: placed, shift };
}
