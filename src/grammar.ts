import { relationshipConnectors } from 'archimaid/language';

// The pieces of the archimaid text that the designer's edits and rewrites recognise.

export const identifier = String.raw`[A-Za-z_]\w*(?:-\w+)*`;

// A quoted name, text or label on one line, with backslash escapes.
export const quotedText = String.raw`"(?:[^"\\\r\n]|\\.)*"`;

export const keywords: readonly string[] = [
  'direction',
  'layout',
  'element',
  'description',
  'relationship',
  'access',
  'directed',
  'label',
  'note',
  'on',
  'nest',
  'in',
  'via',
  'click',
  'href',
  'positions',
  'at',
  'size',
  'from',
  'to',
];

export type Connector = keyof typeof relationshipConnectors;
type ConnectorNotation = (typeof relationshipConnectors)[Connector];

const connectorEntries = Object.entries(relationshipConnectors) as [Connector, ConnectorNotation][];
const notationsByGlyph: ReadonlyMap<string, ConnectorNotation> = new Map(connectorEntries);

export function longestFirst(left: string, right: string): number {
  return right.length - left.length;
}

// Longest first, so a pattern never stops at a short connector that begins a longer one.
export const connectorGlyphs: readonly string[] = connectorEntries.map(([glyph]) => glyph).sort(longestFirst);

export function connectorNotation(glyph: string): ConnectorNotation | undefined {
  return notationsByGlyph.get(glyph);
}

// The shorthand connector that writes a relationship, if one does. Access without a mode is unspecified access.
export function connectorFor(type: string, access: string | undefined, directed: boolean): Connector | undefined {
  const mode = access ?? (type === 'access' ? 'unspecified' : undefined);
  return connectorEntries.find(
    ([, notation]) =>
      notation.type === type &&
      ('access' in notation ? notation.access : undefined) === mode &&
      'directed' in notation === directed,
  )?.[0];
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
