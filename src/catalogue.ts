import { elementTypes } from 'archimaid/language';

export type Category = (typeof elementTypes)[keyof typeof elementTypes]['category'];

export interface PaletteType {
  readonly key: string;
  readonly name: string;
  // The name without the layer word, as the palette groups types by layer already.
  readonly label: string;
  readonly category: Category;
  readonly icon: readonly { readonly d: string; readonly fill?: 'none' | 'ink' }[];
}

export interface PaletteGroup {
  readonly category: Category;
  readonly name: string;
  readonly types: readonly PaletteType[];
}

const groupNames: readonly (readonly [Category, string])[] = [
  ['business', 'Business'],
  ['application', 'Application'],
  ['technology', 'Technology'],
  ['physical', 'Physical'],
  ['motivation', 'Motivation'],
  ['strategy', 'Strategy'],
  ['implementationAndMigration', 'Implementation'],
  ['composite', 'Other'],
];

const layerWords = /^(?:Business|Application|Technology)\s+/u;

// A plain rounded box stands in for types the catalogue draws without a corner symbol.
const fallbackIcon = [{ d: 'M3 4H13Q14 4 14 5V11Q14 12 13 12H3Q2 12 2 11V5Q2 4 3 4Z' }];

export const paletteTypes: readonly PaletteType[] = Object.entries(elementTypes).map(([key, type]) => ({
  key,
  name: type.name,
  label: type.name.replace(layerWords, ''),
  category: type.category,
  icon: type.notation?.icon?.length ? type.notation.icon : fallbackIcon,
}));

export const paletteGroups: readonly PaletteGroup[] = groupNames
  .map(([category, name]) => ({ category, name, types: paletteTypes.filter((type) => type.category === category) }))
  .filter(({ types }) => types.length > 0);

const typesByKey = new Map(paletteTypes.map((type) => [type.key, type]));

export function paletteType(key: string): PaletteType | undefined {
  return typesByKey.get(key);
}

const svgNamespace = 'http://www.w3.org/2000/svg';

export function iconSvg(type: Pick<PaletteType, 'icon'>): SVGSVGElement {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const { d, fill } of type.icon) {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', d);
    if (fill === 'ink') path.setAttribute('class', 'ink');
    svg.append(path);
  }
  return svg;
}

export function tileIcon(type: PaletteType, small = false): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = small ? 'tile-icon small' : 'tile-icon';
  span.append(iconSvg(type));
  return span;
}
