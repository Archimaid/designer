import { paletteGroups, tileIcon, type PaletteType } from './catalogue.ts';

export type DragPayload =
  { readonly kind: 'type'; readonly type: PaletteType } | { readonly kind: 'place'; readonly id: string };

export interface DropTarget {
  // Called with the pointer's position when a drag ends over the canvas; a click passes no position.
  readonly drop: (payload: DragPayload, client: { x: number; y: number } | undefined) => void;
}

const dragThreshold = 4;
const popoutMargin = 24;

// Tiles start a pointer drag; a ghost copy follows the pointer and the drop lands where the pointer is,
// unless it is released over a floating panel. The drag is followed on the window, not the tile: a tile in
// the collapsed palette's popout hides as soon as the pointer leaves it, and a hidden tile gets no release.
export function makeDraggable(tile: HTMLElement, payload: () => DragPayload, target: DropTarget): void {
  tile.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const { pointerId } = event;
    const start = { x: event.clientX, y: event.clientY };
    let ghost: HTMLElement | undefined;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!ghost && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < dragThreshold) return;
      if (!ghost) {
        const copy = tile.cloneNode(true);
        if (!(copy instanceof HTMLElement)) return;
        ghost = copy;
        ghost.classList.add('drag-ghost');
        ghost.removeAttribute('id');
        document.body.append(ghost);
        document.body.classList.add('is-dragging-type');
      }
      ghost.style.left = `${moveEvent.clientX}px`;
      ghost.style.top = `${moveEvent.clientY}px`;
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      ghost?.remove();
      document.body.classList.remove('is-dragging-type');
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      const dragged = Boolean(ghost);
      finish();
      if (!dragged) {
        target.drop(payload(), undefined);
        return;
      }
      const under = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
      if (under && !under.closest('.float')) target.drop(payload(), { x: endEvent.clientX, y: endEvent.clientY });
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) finish();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
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
  tile.dataset.tip = `${type.name}: drag onto the canvas`;
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
    // The rail sits in the middle of the window, so a tall layer's popout moves up to stay on screen.
    const keepInView = () => {
      popout.style.top = '';
      const overflow = popout.getBoundingClientRect().bottom - (window.innerHeight - popoutMargin);
      if (overflow > 0) popout.style.top = `${popout.offsetTop - overflow}px`;
    };
    item.addEventListener('pointerenter', keepInView);
    item.addEventListener('focusin', keepInView);
    rail.append(item);
  }
}

export interface AddSheetOptions {
  readonly chips: HTMLElement;
  readonly tiles: HTMLElement;
  readonly search: HTMLInputElement;
  readonly pick: (type: PaletteType) => void;
}

// On phones a type is tapped, not dragged: layer chips choose the group, and search spans every layer.
export function buildAddSheet({ chips, tiles, search, pick }: AddSheetOptions): void {
  let category = paletteGroups[0]?.category;
  const render = () => {
    const query = search.value.trim().toLowerCase();
    chips.replaceChildren(
      ...paletteGroups.map((group) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `chip t-${group.category}`;
        chip.setAttribute('role', 'tab');
        const active = !query && group.category === category;
        chip.setAttribute('aria-selected', String(active));
        const first = group.types[0];
        if (first) chip.append(tileIcon(first, true));
        chip.append(group.name);
        chip.addEventListener('click', () => {
          category = group.category;
          search.value = '';
          render();
        });
        return chip;
      }),
    );
    const types = query
      ? paletteGroups.flatMap((group) => group.types).filter((type) => type.name.toLowerCase().includes(query))
      : (paletteGroups.find((group) => group.category === category)?.types ?? []);
    tiles.replaceChildren(
      ...types.map((type) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = `tile t-${type.category}`;
        tile.setAttribute('aria-label', `Add ${type.name}`);
        tile.append(tileIcon(type), query ? type.name : type.label);
        tile.addEventListener('click', () => pick(type));
        return tile;
      }),
    );
  };
  search.addEventListener('input', render);
  render();
}
