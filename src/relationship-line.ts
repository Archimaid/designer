import { connectorGlyphs, escapeRegExp, identifier, quotedText } from './grammar.ts';

// The one reader of relationship statements, for the canvas edits and the notation switch alike. Every part
// carries where it sits in the line, so an edit replaces that part and keeps the rest of the line as written.
// The shape follows the relationship sources that archimaid 0.2.2 adds to the model, so the designer can move
// to those once it depends on that version.

export interface Span {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface Statement {
  // From the first word to the end of the last part, without the indent or a trailing comment.
  readonly statement: Span;
  readonly source: Span;
  readonly target: Span;
  // The whole clause with its `label` keyword or `:` marker and the space before it.
  readonly label?: Span;
  // The quoted label as written, escapes and quotes included.
  readonly labelText?: Span;
}

export interface LongFormLine extends Statement {
  readonly kind: 'longForm';
  readonly type: Span;
  readonly id: Span;
  readonly access?: Span;
  readonly directed: boolean;
}

export interface ShorthandLine extends Statement {
  readonly kind: 'shorthand';
  readonly connector: Span;
}

export type RelationshipLine = LongFormLine | ShorthandLine;

const id = identifier;
const comment = String.raw`(?:\s*%%.*)?\s*$`;
const label = (marker: string) => String.raw`(?<label>${marker}(?<labelText>${quotedText}))?`;

// Options follow the order the grammar requires: access, then directed, then label.
const longFormPattern = new RegExp(
  String.raw`^\s*(?<statement>relationship\s+(?<type>${id})\s+(?<id>${id})\s+(?<source>${id})\s*->\s*(?<target>${id})` +
    String.raw`(?:\s+access\s+(?<access>${id}))?(?<directed>\s+directed)?${label(String.raw`\s+label\s*`)})${comment}`,
  'du',
);

const shorthandPattern = new RegExp(
  String.raw`^\s*(?<statement>(?<source>${id})\s*(?<connector>${connectorGlyphs.map(escapeRegExp).join('|')})\s*` +
    String.raw`(?<target>${id})${label(String.raw`\s*:\s*`)})${comment}`,
  'du',
);

function spanOf(match: RegExpExecArray, name: string): Span | undefined {
  const range = match.indices?.groups?.[name];
  const text = match.groups?.[name];
  return range && text !== undefined ? { text, start: range[0], end: range[1] } : undefined;
}

function requiredSpan(match: RegExpExecArray, name: string): Span {
  const span = spanOf(match, name);
  if (!span) throw new Error(`The relationship pattern matched without its ${name}.`);
  return span;
}

function optionalSpans(match: RegExpExecArray): Pick<Statement, 'label' | 'labelText'> & { access?: Span } {
  const access = spanOf(match, 'access');
  const labelClause = spanOf(match, 'label');
  const labelText = spanOf(match, 'labelText');
  return {
    ...(access && { access }),
    ...(labelClause && { label: labelClause }),
    ...(labelText && { labelText }),
  };
}

export function parseRelationshipLine(line: string): RelationshipLine | undefined {
  const long = longFormPattern.exec(line);
  if (long) {
    return {
      kind: 'longForm',
      statement: requiredSpan(long, 'statement'),
      type: requiredSpan(long, 'type'),
      id: requiredSpan(long, 'id'),
      source: requiredSpan(long, 'source'),
      target: requiredSpan(long, 'target'),
      directed: long.groups?.['directed'] !== undefined,
      ...optionalSpans(long),
    };
  }
  const short = shorthandPattern.exec(line);
  if (!short) return undefined;
  return {
    kind: 'shorthand',
    statement: requiredSpan(short, 'statement'),
    source: requiredSpan(short, 'source'),
    connector: requiredSpan(short, 'connector'),
    target: requiredSpan(short, 'target'),
    ...optionalSpans(short),
  };
}

export function replaceSpan(line: string, span: Pick<Span, 'start' | 'end'>, text: string): string {
  return line.slice(0, span.start) + text + line.slice(span.end);
}

export function readLabel(line: RelationshipLine): string | undefined {
  return line.labelText ? (JSON.parse(line.labelText.text) as string) : undefined;
}
