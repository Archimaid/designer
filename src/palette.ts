import { paletteGroups, tileIcon, type PaletteType } from './catalogue.ts';

export type DragPayload =
  { readonly kind: 'type'; readonly type: PaletteType } | { readonly kind: 'place'; readonly id: string };

export interface DropTarget {
  // Called with the pointer's position when a drag ends over the canvas; a click passes no position.
  readonly drop: (payload: DragPayload, client: { x: number; y: number } | undefined) => void;
}

const dragThreshold = 4;

// Tiles start a pointer drag; a ghost copy follows the pointer and the drop lands where the pointer is,
// unless it is released over a floating panel.
export function makeDraggable(tile: HTMLElement, payload: () => DragPayload, target: DropTarget): void {
  tile.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    let ghost: HTMLElement | undefined;
    tile.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (!ghost && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < dragThreshold) return;
      if (!ghost) {
        ghost = tile.cloneNode(true) as HTMLElement;
        ghost.classList.add('drag-ghost');
        ghost.removeAttribute('id');
        document.body.append(ghost);
      }
      ghost.style.left = `${moveEvent.clientX}px`;
      ghost.style.top = `${moveEvent.clientY}px`;
    };
    const end = (endEvent: PointerEvent) => {
      tile.removeEventListener('pointermove', move);
      tile.removeEventListener('pointerup', end);
      tile.removeEventListener('pointercancel', cancel);
      if (tile.hasPointerCapture(endEvent.pointerId)) tile.releasePointerCapture(endEvent.pointerId);
      if (!ghost) {
        target.drop(payload(), undefined);
        return;
      }
      ghost.remove();
      const under = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
      if (under && !under.closest('.float')) target.drop(payload(), { x: endEvent.clientX, y: endEvent.clientY });
    };
    const cancel = () => {
      ghost?.remove();
      tile.removeEventListener('pointermove', move);
      tile.removeEventListener('pointerup', end);
      tile.removeEventListener('pointercancel', cancel);
    };
    tile.addEventListener('pointermove', move);
    tile.addEventListener('pointerup', end);
    tile.addEventListener('pointercancel', cancel);
  });
  tile.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      target.drop(payload(), undefined);
    }
  });
}

function typeTile(type: PaletteType, target: DropTarget): HTMLButtonElement {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = `tile t-${type.category}`;
  tile.title = `${type.name}: drag onto the canvas`;
  tile.setAttribute('aria-label', `Add ${type.name}`);
  tile.append(tileIcon(type), type.label);
  makeDraggable(tile, () => ({ kind: 'type', type }), target);
  return tile;
}

export interface PaletteOptions {
  readonly groups: HTMLElement;
  readonly rail: HTMLElement;
  readonly search: HTMLInputElement;
  readonly openGroups: Set<string>;
  readonly onToggleGroup: (open: ReadonlySet<string>) => void;
}

export function buildPalette(options: PaletteOptions, target: DropTarget): void {
  const { groups, rail, search, openGroups } = options;
  const render = () => {
    const query = search.value.trim().toLowerCase();
    groups.replaceChildren();
    for (const group of paletteGroups) {
      const types = query ? group.types.filter((type) => type.name.toLowerCase().includes(query)) : group.types;
      if (!types.length) continue;
      const open = Boolean(query) || openGroups.has(group.category);
      const section = document.createElement('div');
      section.style.display = 'flex';
      section.style.flexDirection = 'column';
      section.style.gap = '4px';
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'group-head';
      head.setAttribute('aria-expanded', String(open));
      const name = document.createElement('span');
      name.className = `group-name t-${group.category}`;
      const first = group.types[0];
      if (first) name.append(tileIcon(first, true));
      name.append(group.name);
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = open ? '−' : String(group.types.length);
      head.append(name, count);
      // One layer is open at a time, so the palette fits without scrolling on most screens.
      head.addEventListener('click', () => {
        const wasOpen = openGroups.has(group.category);
        openGroups.clear();
        if (!wasOpen) openGroups.add(group.category);
        options.onToggleGroup(openGroups);
        render();
      });
      section.append(head);
      if (open) {
        const tiles = document.createElement('div');
        tiles.className = 'tiles appear';
        for (const type of types) tiles.append(typeTile(type, target));
        section.append(tiles);
      }
      groups.append(section);
    }
  };
  search.addEventListener('input', render);
  render();

  for (const group of paletteGroups) {
    const item = document.createElement('div');
    item.className = 'rail-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `rail-btn t-${group.category}`;
    button.setAttribute('aria-label', `${group.name} elements`);
    const first = group.types[0];
    if (first) button.append(tileIcon(first).firstChild ?? '');
    const popout = document.createElement('div');
    popout.className = 'popout';
    const title = document.createElement('span');
    title.className = 'popout-title';
    title.textContent = group.name;
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    for (const type of group.types) tiles.append(typeTile(type, target));
    popout.append(title, tiles);
    item.append(button, popout);
    rail.append(item);
  }
}
