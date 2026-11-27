import {
  validateArchiMate,
  type ArchiMateLongFormRelationshipSource,
  type ArchiMateModel,
  type ArchiMateRelationship,
  type ArchiMateRelationshipSource,
  type ArchiMateSourceMap,
} from 'archimaid/language';
import { connectorFor, connectorNotation, escapeRegExp, identifier } from './grammar.ts';
import { applySplices, replaceSpan, textOf, type Splice } from './spans.ts';

export type Notation = 'long' | 'shorthand';

export type NotationResult =
  | { readonly kind: 'converted'; readonly source: string; readonly converted: number; readonly kept: number }
  | { readonly kind: 'unchanged'; readonly kept: number }
  // Only a valid source is rewritten, so the result can be checked against the same model.
  | { readonly kind: 'invalid' }
  // The rewrite would have changed the diagram; this is a bug in the converter, so nothing is applied.
  | { readonly kind: 'failed' };

export function convertNotation(source: string, notation: Notation): NotationResult {
  const { model: before, sources } = validateArchiMate(source);
  if (!before || !sources) return { kind: 'invalid' };
  const result = notation === 'shorthand' ? toShorthand(source, before, sources) : toLongForm(source, sources);
  if (result.converted === 0) return { kind: 'unchanged', kept: result.kept };
  const after = validateArchiMate(result.source).model;
  if (!after || diagramSignature(after) !== diagramSignature(before)) return { kind: 'failed' };
  return { kind: 'converted', ...result };
}

// Long-form relationships that must stay long (another line names their ID) do not count as a choice of
// notation. Text with errors has no notation to show.
export function detectNotation(source: string, sources: ArchiMateSourceMap | undefined): Notation | 'mixed' | 'none' {
  let long = 0;
  let shorthand = 0;
  for (const relationship of sources?.relationships.values() ?? []) {
    if (relationship.notation === 'shorthand') shorthand++;
    else if (!isReferencedElsewhere(source, relationship)) long++;
  }
  if (long > 0 && shorthand > 0) return 'mixed';
  if (long > 0) return 'long';
  return shorthand > 0 ? 'shorthand' : 'none';
}

interface Rewrite {
  readonly source: string;
  readonly converted: number;
  readonly kept: number;
}

// The quoted label as written, without its `label` keyword or `:` marker, so its escapes stay as they are.
function writtenLabel(source: string, relationship: ArchiMateRelationshipSource): string | undefined {
  return relationship.label && textOf(source, relationship.label).replace(/^(?:label|:)\s*/u, '');
}

function toShorthand(source: string, model: ArchiMateModel, sources: ArchiMateSourceMap): Rewrite {
  const splices: Splice[] = [];
  let kept = 0;
  for (const relationship of model.relationships) {
    const written = sources.relationships.get(relationship.id);
    if (written?.notation !== 'longForm') continue;
    const connector = connectorFor(relationship.type, relationship.access, relationship.directed ?? false);
    // A shorthand relationship gets a generated ID, so one that another line names must stay in long form.
    if (!connector || isReferencedElsewhere(source, written)) {
      kept++;
      continue;
    }
    const label = writtenLabel(source, written);
    const ends = `${textOf(source, written.source)} ${connector} ${textOf(source, written.target)}`;
    splices.push(replaceSpan(written.statement, ends + (label ? ` : ${label}` : '')));
  }
  return { source: applySplices(source, splices), converted: splices.length, kept };
}

function toLongForm(source: string, sources: ArchiMateSourceMap): Rewrite {
  const usedIds = new Set(source.match(new RegExp(identifier, 'gu')));
  const splices: Splice[] = [];
  for (const written of sources.relationships.values()) {
    if (written.notation !== 'shorthand') continue;
    const notation = connectorNotation(textOf(source, written.connector));
    if (!notation) continue;
    const from = textOf(source, written.source);
    const to = textOf(source, written.target);
    let relationshipId = `${from}_${notation.type}_${to}`;
    for (let suffix = 2; usedIds.has(relationshipId); suffix++)
      relationshipId = `${from}_${notation.type}_${to}_${suffix}`;
    usedIds.add(relationshipId);
    const access = 'access' in notation && notation.access !== 'unspecified' ? ` access ${notation.access}` : '';
    const directed = 'directed' in notation ? ' directed' : '';
    const label = writtenLabel(source, written);
    splices.push(
      replaceSpan(
        written.statement,
        `relationship ${notation.type} ${relationshipId} ${from} -> ${to}${access}${directed}${label ? ` label ${label}` : ''}`,
      ),
    );
  }
  return { source: applySplices(source, splices), converted: splices.length, kept: 0 };
}

// Whether a long-form relationship's ID is named anywhere outside its own statement, comments left out.
function isReferencedElsewhere(source: string, relationship: ArchiMateLongFormRelationshipSource): boolean {
  const id = textOf(source, relationship.id);
  const word = new RegExp(String.raw`(?<![\w-])${escapeRegExp(id)}(?![\w-])`, 'u');
  const rest = source.slice(0, relationship.statement.offset) + source.slice(relationship.statement.endOffset);
  return rest.split('\n').some((line) => word.test(line.replace(/\s%%.*$/u, '')));
}

// Everything the diagram shows, with relationship IDs replaced by what the relationship is, since a
// notation switch is allowed to change IDs but nothing else.
function diagramSignature(model: ArchiMateModel): string {
  const describe = (relationship: ArchiMateRelationship): string =>
    JSON.stringify([
      relationship.type,
      relationship.source,
      relationship.target,
      relationship.access ?? null,
      relationship.directed ?? false,
      relationship.label ?? null,
    ]);
  const byId = new Map(model.relationships.map((relationship) => [relationship.id, describe(relationship)]));
  return JSON.stringify({
    ...model,
    relationships: model.relationships.map(describe).sort(),
    nesting: model.nesting?.map((nesting) => ({
      ...nesting,
      relationship:
        nesting.relationship === undefined ? null : (byId.get(nesting.relationship) ?? nesting.relationship),
    })),
    anchors: model.anchors
      ?.map((anchor) => ({ ...anchor, relationship: byId.get(anchor.relationship) ?? anchor.relationship }))
      .sort((left, right) => left.relationship.localeCompare(right.relationship)),
  });
}
