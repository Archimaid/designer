import { validateArchiMate } from 'archimaid/language';

// Larger than any hand-written diagram, small enough that a wrongly chosen file cannot stall the page.
export const maxFileBytes = 1_000_000;

export type Imported =
  { readonly kind: 'diagram'; readonly source: string; readonly title: string } | { readonly kind: 'not-a-diagram' };

// Front matter, comments and blank lines may come first; the diagram starts at its `archimate-beta` line.
export function looksLikeDiagram(text: string): boolean {
  return /^[ \t]*archimate-beta\b/mu.test(text);
}

// The diagram's own title wins; an untitled file is named after the file, and pasted text after nothing.
export function readImported(text: string, fileName?: string): Imported {
  if (!looksLikeDiagram(text)) return { kind: 'not-a-diagram' };
  const { model } = validateArchiMate(text);
  const fromFile = fileName?.replace(/\.[^.]*$/u, '').trim();
  const title = model?.title ?? model?.accTitle ?? (fromFile || 'Pasted diagram');
  return { kind: 'diagram', source: text, title };
}
