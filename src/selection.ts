// What is selected on the canvas: nothing, one element or note, several of them, or one relationship. A
// relationship is held by its place among the relationships, which survives edits that change its ID.
export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'element'; readonly id: string }
  | { readonly kind: 'group'; readonly ids: readonly string[] }
  | { readonly kind: 'relationship'; readonly index: number };

export const nothingSelected: Selection = { kind: 'none' };

// Fewer than two distinct items make no group.
export function selectionOf(ids: readonly string[]): Selection {
  const unique = [...new Set(ids)];
  const [first] = unique;
  if (first === undefined) return nothingSelected;
  return unique.length === 1 ? { kind: 'element', id: first } : { kind: 'group', ids: unique };
}

export function selectedIds(selection: Selection): readonly string[] {
  if (selection.kind === 'element') return [selection.id];
  return selection.kind === 'group' ? selection.ids : [];
}

export function selectedElement(selection: Selection): string | null {
  return selection.kind === 'element' ? selection.id : null;
}

export function selectedRelationship(selection: Selection): number | null {
  return selection.kind === 'relationship' ? selection.index : null;
}

// After an edit, whatever is no longer drawn drops out of the selection.
export function reconcile(selection: Selection, isDrawn: (id: string) => boolean, relationships: number): Selection {
  switch (selection.kind) {
    case 'element':
      return isDrawn(selection.id) ? selection : nothingSelected;
    case 'group':
      return selectionOf(selection.ids.filter(isDrawn));
    case 'relationship':
      return selection.index < relationships ? selection : nothingSelected;
    case 'none':
      return selection;
  }
}
