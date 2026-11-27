import type { PaletteType } from './catalogue.ts';

export interface RelationshipChoice {
  readonly glyph: string;
  readonly name: string;
  // The key that picks this type in the relationship picker.
  readonly key: string;
  // A short line drawn left to right in the ArchiMate notation: its stroke, and what sits at either end.
  readonly icon: PaletteType['icon'];
}

const solid = { d: 'M2 8H14' };
const dashed = { d: 'M2 8H4M6 8H8M10 8H11' };
const dotted = { d: 'M2 8H3M5 8H6M8 8H9' };
const openHead = { d: 'M11 5L14 8L11 11' };
const filledHead = { d: 'M11 5.5L14 8L11 10.5Z', fill: 'ink' } as const;
const hollowTriangle = { d: 'M10 5L14 8L10 11Z' };

// All eleven types stay listed until relationship checks against Appendix B land in archimaid.
export const relationshipChoices: readonly RelationshipChoice[] = [
  { glyph: '-->', name: 'Serving', key: 's', icon: [solid, openHead] },
  { glyph: '==>', name: 'Triggering', key: 't', icon: [{ d: 'M2 8H11' }, filledHead] },
  { glyph: '-.=>', name: 'Flow', key: 'f', icon: [dashed, filledHead] },
  {
    glyph: '@==>',
    name: 'Assignment',
    key: 'a',
    icon: [{ d: 'M2 8A1.5 1.5 0 1 0 5 8A1.5 1.5 0 1 0 2 8Z', fill: 'ink' }, { d: 'M5 8H11' }, filledHead],
  },
  { glyph: '..|>', name: 'Realization', key: 'r', icon: [dotted, hollowTriangle] },
  {
    glyph: '*--',
    name: 'Composition',
    key: 'c',
    icon: [{ d: 'M2 8L5 5.5L8 8L5 10.5Z', fill: 'ink' }, { d: 'M8 8H14' }],
  },
  { glyph: 'o--', name: 'Aggregation', key: 'g', icon: [{ d: 'M2 8L5 5.5L8 8L5 10.5Z' }, { d: 'M8 8H14' }] },
  { glyph: '..', name: 'Access', key: 'x', icon: [{ d: 'M2 8H3M5 8H6M8 8H9M11 8H14' }, { d: 'M12 6L14 8L12 10' }] },
  { glyph: '-.->', name: 'Influence', key: 'i', icon: [{ d: 'M2 8H4M6 8H8M10 8H14' }, openHead] },
  { glyph: '---', name: 'Association', key: 'o', icon: [solid] },
  { glyph: '--|>', name: 'Specialization', key: 'p', icon: [{ d: 'M2 8H10' }, hollowTriangle] },
];
