import type { ArchiMateSourceSpan } from 'archimaid/language';

// Edits by the spans archimaid reports for a text: each one replaces a stretch of that exact text.

export interface Splice {
  readonly offset: number;
  readonly endOffset: number;
  readonly text: string;
}

export function textOf(source: string, span: Pick<ArchiMateSourceSpan, 'offset' | 'endOffset'>): string {
  return source.slice(span.offset, span.endOffset);
}

export function replaceSpan(span: Pick<ArchiMateSourceSpan, 'offset' | 'endOffset'>, text: string): Splice {
  return { offset: span.offset, endOffset: span.endOffset, text };
}

// The lines a span sits on, with the line break after them, so removing a statement leaves no blank line.
export function removeLines(source: string, span: Pick<ArchiMateSourceSpan, 'offset' | 'endOffset'>): Splice {
  const start = source.lastIndexOf('\n', span.offset - 1) + 1;
  const end = source.indexOf('\n', span.endOffset);
  return { offset: start, endOffset: end < 0 ? source.length : end + 1, text: '' };
}

// A span together with the spaces and tabs before it, so removing a clause leaves no gap behind.
export function removeWithSpaceBefore(source: string, span: Pick<ArchiMateSourceSpan, 'offset' | 'endOffset'>): Splice {
  let start = span.offset;
  while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--;
  return { offset: start, endOffset: span.endOffset, text: '' };
}

// Later splices go first, so the offsets of the earlier ones still hold.
export function applySplices(source: string, splices: readonly Splice[]): string {
  return [...splices]
    .sort((left, right) => right.offset - left.offset)
    .reduce((text, splice) => text.slice(0, splice.offset) + splice.text + text.slice(splice.endOffset), source);
}
