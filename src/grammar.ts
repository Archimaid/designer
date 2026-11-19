import { relationshipConnectors } from 'archimaid/language';

// The pieces of the archimaid text that the designer's edits and rewrites recognise.

export const identifier = String.raw`[A-Za-z_]\w*(?:-\w+)*`;

// A quoted name, text or label on one line, with backslash escapes.
export const quotedText = String.raw`"(?:[^"\\\r\n]|\\.)*"`;

// Longest first, so a pattern never stops at a short connector that begins a longer one.
export const connectorGlyphs: readonly string[] = Object.keys(relationshipConnectors).sort(
  (left, right) => right.length - left.length,
);

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
