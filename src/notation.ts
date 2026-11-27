import { validateArchiMate, type ArchiMateModel, type ArchiMateRelationship } from 'archimaid/language';
import { connectorFor, connectorNotation, escapeRegExp, identifier } from './grammar.ts';
import { parseRelationshipLine, type RelationshipLine } from './relationship-line.ts';

export type Notation = 'long' | 'shorthand';

export type NotationResult =
  | { readonly kind: 'converted'; readonly source: string; readonly converted: number; readonly kept: number }
  | { readonly kind: 'unchanged'; readonly kept: number }
  // Only a valid source is rewritten, so the result can be checked against the same model.
  | { readonly kind: 'invalid' }
  // The rewrite would have changed the diagram; this is a bug in the converter, so nothing is applied.
  | { readonly kind: 'failed' };

export function convertNotation(source: string, notation: Notation): NotationResult {
  const before = validateArchiMate(source).model;
  if (!before) return { kind: 'invalid' };
  const result = notation === 'shorthand' ? toShorthand(source) : toLongForm(source);
  if (result.converted === 0) return { kind: 'unchanged', kept: result.kept };
  const after = validateArchiMate(result.source).model;
  if (!after || diagramSignature(after) !== diagramSignature(before)) return { kind: 'failed' };
  return { kind: 'converted', ...result };
}

// Long-form relationships that must stay long (another line names their ID) do not count as a choice of notation.
export function detectNotation(source: string): Notation | 'mixed' | 'none' {
  const lines = source.split('\n');
  let long = 0;
  let shorthand = 0;
  lines.forEach((line, index) => {
    const parsed = parseRelationshipLine(line);
    if (parsed?.kind === 'shorthand') shorthand++;
    else if (parsed && !isReferencedElsewhere(lines, index, parsed.id.text)) long++;
  });
  if (long > 0 && shorthand > 0) return 'mixed';
  if (long > 0) return 'long';
  return shorthand > 0 ? 'shorthand' : 'none';
}

interface Rewrite {
  readonly source: string;
  readonly converted: number;
  readonly kept: number;
}

// The indent before a statement and whatever follows it, such as a comment, stay as written.
function rewriteStatement(line: string, parsed: RelationshipLine, statement: string): string {
  return line.slice(0, parsed.statement.start) + statement + line.slice(parsed.statement.end);
}

function toShorthand(source: string): Rewrite {
  const lines = source.split('\n');
  let converted = 0;
  let kept = 0;
  const rewritten = lines.map((line, index) => {
    const parsed = parseRelationshipLine(line);
    if (parsed?.kind !== 'longForm') return line;
    const connector = connectorFor(parsed.type.text, parsed.access?.text, parsed.directed);
    // A shorthand relationship gets a generated ID, so one that another line names must stay in long form.
    if (!connector || isReferencedElsewhere(lines, index, parsed.id.text)) {
      kept++;
      return line;
    }
    converted++;
    const label = parsed.labelText ? ` : ${parsed.labelText.text}` : '';
    return rewriteStatement(line, parsed, `${parsed.source.text} ${connector} ${parsed.target.text}${label}`);
  });
  return { source: rewritten.join('\n'), converted, kept };
}

function toLongForm(source: string): Rewrite {
  const lines = source.split('\n');
  const usedIds = new Set(source.match(new RegExp(identifier, 'gu')));
  let converted = 0;
  const rewritten = lines.map((line) => {
    const parsed = parseRelationshipLine(line);
    if (parsed?.kind !== 'shorthand') return line;
    const notation = connectorNotation(parsed.connector.text);
    if (!notation) return line;
    const from = parsed.source.text;
    const to = parsed.target.text;
    let relationshipId = `${from}_${notation.type}_${to}`;
    for (let suffix = 2; usedIds.has(relationshipId); suffix++)
      relationshipId = `${from}_${notation.type}_${to}_${suffix}`;
    usedIds.add(relationshipId);
    const access = 'access' in notation && notation.access !== 'unspecified' ? ` access ${notation.access}` : '';
    const directed = 'directed' in notation ? ' directed' : '';
    const label = parsed.labelText ? ` label ${parsed.labelText.text}` : '';
    converted++;
    return rewriteStatement(
      line,
      parsed,
      `relationship ${notation.type} ${relationshipId} ${from} -> ${to}${access}${directed}${label}`,
    );
  });
  return { source: rewritten.join('\n'), converted, kept: 0 };
}

function isReferencedElsewhere(lines: readonly string[], declarationIndex: number, relationshipId: string): boolean {
  const word = new RegExp(String.raw`(?<![\w-])${escapeRegExp(relationshipId)}(?![\w-])`, 'u');
  return lines.some((line, index) => index !== declarationIndex && word.test(line.replace(/\s%%.*$/u, '')));
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
