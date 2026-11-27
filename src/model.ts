import type { ArchiMateModel, ArchiMatePosition, ArchiMateRelationship } from 'archimaid/language';
import { connectorFor } from './grammar.ts';

// Questions about the last valid model. They take the model as it may still be missing while the text is invalid.

export function parentsOf(model: ArchiMateModel | undefined): Map<string, string> {
  return new Map((model?.nesting ?? []).map(({ child, parent }) => [child, parent]));
}

// An element's name or a note's text; the ID when neither is known.
export function nameOf(model: ArchiMateModel | undefined, id: string): string {
  return (
    model?.elements.find((element) => element.id === id)?.name ??
    model?.notes?.find((note) => note.id === id)?.text ??
    id
  );
}

export function isNote(model: ArchiMateModel | undefined, id: string): boolean {
  return model?.notes?.some((note) => note.id === id) ?? false;
}

export function positionOf(model: ArchiMateModel | undefined, id: string): ArchiMatePosition | undefined {
  return model?.positions?.find((position) => position.id === id);
}

// Elements outside any container and notes attached to nothing: the items placed on the diagram's own grid.
export function topLevelIds(model: ArchiMateModel | undefined): Set<string> {
  const nested = parentsOf(model);
  return new Set([
    ...(model?.elements ?? []).filter((element) => !nested.has(element.id)).map((element) => element.id),
    ...(model?.notes ?? []).filter((note) => !note.on).map((note) => note.id),
  ]);
}

// The shorthand connector that writes this relationship, or its type when no connector does.
export function glyphOf(relationship: ArchiMateRelationship): string {
  return connectorFor(relationship.type, relationship.access, relationship.directed ?? false) ?? relationship.type;
}
