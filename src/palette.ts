import { iconSvg, paletteGroups, tileIcon, type PaletteGroup, type PaletteType } from './catalogue.ts';
import { relationshipChoices, type RelationshipChoice } from './relationships.ts';

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

function typeButton(type: PaletteType, label: string): HTMLButtonElement {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = `tile t-${type.category}`;
  tile.setAttribute('aria-label', `Add ${type.name}`);
  tile.append(tileIcon(type), label);
  return tile;
}

function typeTile(type: PaletteType, target: DropTarget): HTMLButtonElement {
  const tile = typeButton(type, type.label);
  tile.dataset.tip = `${type.name}: drag onto the canvas`;
  makeDraggable(tile, () => ({ kind: 'type', type }), target);
  return tile;
}

// A layer's first type stands for the whole layer in group headers, rail buttons and chips.
function groupIcon(group: PaletteGroup): HTMLSpanElement[] {
  const first = group.types[0];
  return first ? [tileIcon(first, true)] : [];
}

// A relationship type is chosen, not dragged: the next two elements clicked on the canvas get the line.
function relationshipTile(choice: RelationshipChoice, connectors: Connectors): HTMLButtonElement {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile t-relationship';
  tile.dataset.glyph = choice.glyph;
  tile.dataset.tip = `${choice.name}: click two elements to connect them`;
  tile.setAttribute('aria-pressed', String(connectors.armed() === choice.glyph));
  tile.append(tileIcon(choice), choice.name);
  tile.addEventListener('click', () => connectors.choose(choice));
  return tile;
}

const relationshipsKey = 'relationships';
const relationshipsName = 'Relationships';
const [relationshipsIcon] = relationshipChoices;

export interface Connectors {
  readonly armed: () => string | undefined;
  readonly choose: (choice: RelationshipChoice) => void;
}

export interface PaletteOptions {
  readonly groups: HTMLElement;
  readonly rail: HTMLElement;
  readonly search: HTMLInputElement;
  readonly openGroups: Set<string>;
  readonly onToggleGroup: (open: ReadonlySet<string>) => void;
  readonly connectors: Connectors;
}

interface Section {
  readonly key: string;
  readonly name: string;
  readonly className: string;
  readonly icon: readonly HTMLElement[];
  readonly total: number;
  readonly tiles: () => HTMLElement[];
}

// Returns the function that shows which relationship type is armed, after it changed outside the palette.
export function buildPalette(options: PaletteOptions, target: DropTarget): () => void {
  const { groups, rail, search, openGroups, connectors } = options;
  const matches = (name: string, query: string) => !query || name.toLowerCase().includes(query);
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const sections: Section[] = paletteGroups.map((group) => {
      const types = group.types.filter((type) => matches(type.name, query));
      return {
        key: group.category,
        name: group.name,
        className: `t-${group.category}`,
        icon: groupIcon(group),
        total: types.length,
        tiles: () => types.map((type) => typeTile(type, target)),
      };
    });
    const choices = relationshipChoices.filter((choice) => matches(choice.name, query));
    sections.push({
      key: relationshipsKey,
      name: relationshipsName,
      className: 't-relationship',
      icon: relationshipsIcon ? [tileIcon(relationshipsIcon, true)] : [],
      total: choices.length,
      tiles: () => choices.map((choice) => relationshipTile(choice, connectors)),
    });
    groups.replaceChildren();
    for (const section of sections) {
      if (!section.total) continue;
      const open = Boolean(query) || openGroups.has(section.key);
      const wrapper = document.createElement('div');
      wrapper.className = 'palette-group';
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'group-head';
      head.setAttribute('aria-expanded', String(open));
      const name = document.createElement('span');
      name.className = `group-name ${section.className}`;
      name.append(...section.icon, section.name);
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = open ? '−' : String(section.total);
      head.append(name, count);
      // One group is open at a time, so the palette fits without scrolling on most screens.
      head.addEventListener('click', () => {
        const wasOpen = openGroups.has(section.key);
        openGroups.clear();
        if (!wasOpen) openGroups.add(section.key);
        options.onToggleGroup(openGroups);
        render();
      });
      wrapper.append(head);
      if (open) {
        const tiles = document.createElement('div');
        tiles.className = 'tiles appear';
        tiles.append(...section.tiles());
        wrapper.append(tiles);
      }
      groups.append(wrapper);
    }
  };
  search.addEventListener('input', render);
  render();

  const railSections = [
    ...paletteGroups.map((group) => ({
      label: `${group.name} elements`,
      name: group.name,
      className: `t-${group.category}`,
      icon: group.types[0],
      tiles: () => group.types.map((type) => typeTile(type, target)),
    })),
    {
      label: relationshipsName,
      name: relationshipsName,
      className: 't-relationship',
      icon: relationshipsIcon,
      tiles: () => relationshipChoices.map((choice) => relationshipTile(choice, connectors)),
    },
  ];
  for (const section of railSections) {
    const item = document.createElement('div');
    item.className = 'rail-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `rail-btn ${section.className}`;
    button.setAttribute('aria-label', section.label);
    if (section.icon) button.append(iconSvg(section.icon));
    const popout = document.createElement('div');
    popout.className = 'popout';
    const title = document.createElement('span');
    title.className = 'popout-title';
    title.textContent = section.name;
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    tiles.append(...section.tiles());
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

  return () => {
    const armed = connectors.armed();
    for (const tile of document.querySelectorAll<HTMLElement>('.tile[data-glyph]')) {
      tile.setAttribute('aria-pressed', String(tile.dataset.glyph === armed));
    }
  };
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
        chip.append(...groupIcon(group), group.name);
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
        const tile = typeButton(type, query ? type.name : type.label);
        tile.addEventListener('click', () => pick(type));
        return tile;
      }),
    );
  };
  search.addEventListener('input', render);
  render();
}
