import {
  elementTypes,
  getElementType,
  relationshipTypes,
  type ArchiMateLayout,
  type ArchiMateSide,
} from 'archimaid/language';
import { connectorNotation, escapeRegExp, identifier, keywords, quotedText } from './grammar.ts';
import {
  parseRelationshipLine,
  readLabel,
  replaceSpan,
  type RelationshipLine,
  type ShorthandLine,
} from './relationship-line.ts';

// Every canvas gesture is one of these pure text edits. The source stays the only state, so the text panel,
// undo, share links and the renderer all see exactly what the designer wrote.

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

const identifierPattern = new RegExp(identifier, 'gu');
const defaultIndent = '  ';

// IDs never reuse a type name or a keyword, so a reader can always tell an ID from what it describes.
const reservedWords: ReadonlySet<string> = new Set([
  ...Object.keys(elementTypes),
  ...relationshipTypes,
  'archimate',
  ...keywords,
]);

// New elements join their own layer, and layers follow the order of the architecture layout rows.
const layerOrder = [
  'motivation',
  'strategy',
  'business',
  'application',
  'technology',
  'physical',
  'implementationAndMigration',
  'composite',
];

function layerRank(type: string): number {
  const category = getElementType(type)?.category;
  const rank = category ? layerOrder.indexOf(category) : -1;
  return rank < 0 ? layerOrder.length : rank;
}

function lines(source: string): string[] {
  return source.replace(/\r\n?/gu, '\n').split('\n');
}

function join(result: readonly string[]): string {
  return result.join('\n');
}

function code(line: string): string {
  return line.replace(/%%.*$/u, '');
}

// Identifiers outside quoted text and comments, with their offsets, so renames never touch names or notes.
function identifiers(line: string): { word: string; start: number }[] {
  const found: { word: string; start: number }[] = [];
  const masked = code(line).replace(new RegExp(quotedText, 'gu'), (text) => ' '.repeat(text.length));
  for (const match of masked.matchAll(identifierPattern)) found.push({ word: match[0], start: match.index });
  return found;
}

function indentOf(line: string): string {
  return /^\s*/u.exec(line)?.[0] ?? '';
}

function elementIndent(source: readonly string[]): string {
  const element = source.find((line) => /^\s+element\s/u.test(line));
  return element ? indentOf(element) : defaultIndent;
}

function headerIndex(source: readonly string[]): number {
  return source.findIndex((line) => line.trim().startsWith('archimate-beta'));
}

// Brace depth before each line; element blocks and the positions block are the only blocks that span lines.
function depths(source: readonly string[]): number[] {
  let depth = 0;
  return source.map((line) => {
    const trimmed = code(line).trim();
    if (trimmed.startsWith('}')) depth = Math.max(0, depth - 1);
    const before = depth;
    if (trimmed.endsWith('{') && !/^accDescr\b/u.test(trimmed)) depth++;
    return before;
  });
}

function isRelationshipLine(line: string): boolean {
  return parseRelationshipLine(line) !== undefined;
}

function positionsBlock(source: readonly string[]): { open: number; close: number } | undefined {
  const open = source.findIndex((line) => /^\s*positions\s*\{\s*$/u.test(code(line)));
  if (open < 0) return undefined;
  const close = source.findIndex((line, index) => index > open && /^\s*\}\s*$/u.test(code(line)));
  return close < 0 ? undefined : { open, close };
}

function lastContentIndex(source: readonly string[]): number {
  for (let index = source.length - 1; index >= 0; index--) {
    if (source[index]?.trim()) return index;
  }
  return -1;
}

// The line that ends a statement: its own line, or the closing brace of the block it opens.
function statementEnd(source: readonly string[], index: number): number {
  if (
    !code(source[index] ?? '')
      .trim()
      .endsWith('{')
  )
    return index;
  const depth = depths(source);
  const start = depth[index] ?? 0;
  const close = source.findIndex((line, at) => at > index && depth[at] === start && code(line).trim() === '}');
  return close < 0 ? index : close;
}

function emptyPositionsBlock(indent: string): string[] {
  return ['', `${indent}positions {`, `${indent}}`];
}

function withPositionsBlock(source: readonly string[]): string[] {
  if (positionsBlock(source)) return [...source];
  const end = lastContentIndex(source) + 1;
  return [...source.slice(0, end), ...emptyPositionsBlock(elementIndent(source)), ...source.slice(end)];
}

export function usedWords(source: string): Set<string> {
  return new Set(lines(source).flatMap((line) => identifiers(line).map(({ word }) => word)));
}

// "Fulfil order" becomes fulfilOrder; IDs must start with a letter and stay unique in the source.
export function idFromName(name: string, taken: ReadonlySet<string>): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean);
  const camel = words
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0]?.toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
  const base = /^[A-Za-z]/u.test(camel) ? camel : 'element' + camel;
  let id = base;
  for (let suffix = 2; taken.has(id) || reservedWords.has(id); suffix++) id = base + suffix;
  return id;
}

export interface NewElement {
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly at?: GridPoint;
}

// A new element goes after the last top-level element of its own or an earlier layer, before relationships,
// so business elements stay together above application elements and the file keeps its usual order.
export function addElement(source: string, element: NewElement): string {
  const result = lines(source);
  const depth = depths(result);
  const header = headerIndex(result);
  const rank = layerRank(element.type);
  const statements: { start: number; end: number; rank: number }[] = [];
  for (let index = header + 1; index < result.length; index++) {
    if (depth[index] !== 0) continue;
    const trimmed = code(result[index] ?? '').trim();
    if (isRelationshipLine(trimmed) || trimmed.startsWith('positions')) break;
    const declared = /^element\s+(\S+)/u.exec(trimmed);
    if (declared?.[1]) statements.push({ start: index, end: index, rank: layerRank(declared[1]) });
    else if (trimmed === '}' && statements.length) {
      const last = statements.at(-1);
      if (last) last.end = index;
    }
  }
  let insertAt: number;
  const before = statements.filter((statement) => statement.rank <= rank).at(-1);
  if (before) insertAt = before.end + 1;
  else if (statements[0]) insertAt = statements[0].start;
  else {
    const firstOther = result.findIndex(
      (line, index) =>
        index > header && depth[index] === 0 && (isRelationshipLine(line) || /^\s*positions\b/u.test(line)),
    );
    insertAt = firstOther >= 0 ? firstOther : lastContentIndex(result) + 1;
  }
  const indent = elementIndent(result);
  result.splice(insertAt, 0, `${indent}element ${element.type} ${element.id} ${JSON.stringify(element.name)}`);
  const added = join(result);
  return element.at ? setPosition(added, element.id, element.at) : added;
}

// What declares an element or a note, up to its quoted name or text.
const elementPrefix = (id: string): string => String.raw`\s*element\s+\S+\s+${escapeRegExp(id)}\s+`;
const notePrefix = (id: string): string => String.raw`\s*note\s+${escapeRegExp(id)}\s+`;

function statementIndex(source: readonly string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}${quotedText}`, 'u');
  return source.findIndex((line) => pattern.test(line));
}

const elementLineIndex = (source: readonly string[], id: string): number => statementIndex(source, elementPrefix(id));

// Rewrites the quoted name or text of a statement and keeps the rest of its line, such as a trailing comment.
function rewriteQuoted(source: string, prefix: string, text: string): string {
  const result = lines(source);
  const pattern = new RegExp(`^(${prefix})${quotedText}`, 'u');
  const index = result.findIndex((line) => pattern.test(line));
  const line = result[index];
  if (line === undefined) return source;
  result[index] = line.replace(pattern, (_, kept: string) => kept + JSON.stringify(text));
  return join(result);
}

// Notes follow the other notes, or close the statements before the positions block, as the examples write them.
export function addNote(source: string, id: string, text: string): string {
  const result = lines(source);
  const depth = depths(result);
  const header = headerIndex(result);
  let insertAt = -1;
  for (let index = header + 1; index < result.length; index++) {
    if (depth[index] === 0 && /^\s*note\s/u.test(code(result[index] ?? ''))) insertAt = index + 1;
  }
  if (insertAt < 0) {
    const block = positionsBlock(result);
    insertAt = block ? block.open : lastContentIndex(result) + 1;
    while (insertAt > header + 1 && !result[insertAt - 1]?.trim()) insertAt--;
  }
  result.splice(insertAt, 0, `${elementIndent(result)}note ${id} ${JSON.stringify(text)}`);
  return join(result);
}

export function setNoteText(source: string, id: string, text: string): string {
  return rewriteQuoted(source, notePrefix(id), text);
}

export function renameElement(source: string, id: string, name: string): string {
  return rewriteQuoted(source, elementPrefix(id), name);
}

// The type word in an element or long-form relationship declaration is never an ID, even when it is spelt alike.
export function renameId(source: string, from: string, to: string): string {
  return join(
    lines(source).map((line) => {
      let rewritten = line;
      const words = identifiers(line);
      const declaresType = words[0]?.word === 'element' || words[0]?.word === 'relationship';
      for (const [index, { word, start }] of [...words.entries()].reverse()) {
        if (declaresType && index === 1) continue;
        if (word === from) rewritten = rewritten.slice(0, start) + to + rewritten.slice(start + from.length);
      }
      return rewritten;
    }),
  );
}

export function setDescription(source: string, id: string, text: string): string {
  const result = lines(source);
  const pattern = new RegExp(`^\\s*description\\s+${escapeRegExp(id)}\\s`, 'u');
  const existing = result.findIndex((line) => pattern.test(line));
  const trimmed = text.trim();
  if (!trimmed) {
    if (existing >= 0) result.splice(existing, 1);
    return join(result);
  }
  const indent = elementIndent(result);
  const line = `${indent}description ${id} ${JSON.stringify(trimmed)}`;
  if (existing >= 0) {
    result[existing] = indentOf(result[existing] ?? '') + line.trimStart();
    return join(result);
  }
  const element = elementLineIndex(result, id);
  if (element < 0) return source;
  // A block element keeps its description after the closing brace, at the element's own depth.
  result.splice(statementEnd(result, element) + 1, 0, indentOf(result[element] ?? '') + line.trimStart());
  return join(result);
}

export function readDescription(source: string, id: string): string {
  const pattern = new RegExp(`^\\s*description\\s+${escapeRegExp(id)}\\s+(${quotedText})`, 'u');
  for (const line of lines(source)) {
    const match = pattern.exec(line);
    if (match?.[1]) return JSON.parse(match[1]) as string;
  }
  return '';
}

export function setLayout(source: string, layout: ArchiMateLayout): string {
  const result = lines(source);
  const depth = depths(result);
  const existing = result.findIndex((line, index) => depth[index] === 0 && /^\s*layout\s+\S+/u.test(code(line)));
  if (existing >= 0) {
    result[existing] = result[existing]?.replace(/(^\s*layout\s+)\S+/u, `$1${layout}`) ?? '';
    return join(result);
  }
  result.splice(headerIndex(result) + 1, 0, `${elementIndent(result)}layout ${layout}`);
  return join(result);
}

export function readLayout(source: string): ArchiMateLayout {
  for (const line of lines(source)) {
    const match = /^\s*layout\s+(architecture|framework|graph|custom)\b/u.exec(code(line));
    if (match?.[1]) return match[1] as ArchiMateLayout;
  }
  return 'architecture';
}

function positionPattern(id: string): RegExp {
  return new RegExp(`^(\\s*)${escapeRegExp(id)}\\s+at\\s+\\d+\\s+\\d+(.*)$`, 'u');
}

// Moves keep an explicit size and any trailing comment; the block is created at the end of the file when missing.
export function setPosition(source: string, id: string, at: GridPoint): string {
  const result = withPositionsBlock(lines(source));
  const x = Math.max(0, Math.round(at.x));
  const y = Math.max(0, Math.round(at.y));
  const block = positionsBlock(result);
  if (!block) return source;
  const indent = elementIndent(result);
  const pattern = positionPattern(id);
  for (let index = block.open + 1; index < block.close; index++) {
    const match = pattern.exec(result[index] ?? '');
    if (match) {
      result[index] = `${match[1] ?? ''}${id} at ${x} ${y}${match[2] ?? ''}`;
      return join(result);
    }
  }
  // Element positions come before anchors, so a new one goes after the last existing position.
  let insertAt = block.open + 1;
  for (let index = block.open + 1; index < block.close; index++) {
    if (/^\s*\S+\s+at\s+\d/u.test(result[index] ?? '')) insertAt = index + 1;
  }
  const entryIndent = indentOf(result[block.open] ?? '') + indent;
  result.splice(insertAt, 0, `${entryIndent}${id} at ${x} ${y}`);
  return join(result);
}

export function setPositions(source: string, positions: ReadonlyMap<string, GridPoint>): string {
  let result = source;
  for (const [id, at] of positions) result = setPosition(result, id, at);
  return result;
}

export function addRelationship(source: string, from: string, connector: string, to: string): string {
  const result = lines(source);
  const depth = depths(result);
  const header = headerIndex(result);
  let insertAt = -1;
  for (let index = header + 1; index < result.length; index++) {
    if (depth[index] === 0 && isRelationshipLine(result[index] ?? '')) insertAt = index + 1;
  }
  if (insertAt < 0) {
    const block = positionsBlock(result);
    if (block) {
      insertAt = block.open;
      while (insertAt > 0 && !result[insertAt - 1]?.trim()) insertAt--;
    } else {
      insertAt = lastContentIndex(result) + 1;
    }
  }
  result.splice(insertAt, 0, `${elementIndent(result)}${from} ${connector} ${to}`);
  return join(result);
}

// An empty diagram keeps whatever precedes the header (front matter, comments) and the diagram-wide settings.
export function clearDiagram(source: string): string {
  const result = lines(source);
  const header = headerIndex(result);
  if (header < 0) return source;
  const depth = depths(result);
  const settings = result.filter(
    (line, index) => index > header && depth[index] === 0 && /^\s*(?:layout|direction)\s+\S+/u.test(code(line)),
  );
  // Custom layout without a positions block draws a warning, so a cleared custom diagram keeps an empty one.
  const positions = readLayout(source) === 'custom' ? emptyPositionsBlock(elementIndent(result)) : [];
  return join([...result.slice(0, header + 1), ...settings, ...positions]);
}

// Removes the element or note, an element's block, and everything that refers to it or to its nested elements.
export function removeElement(source: string, id: string): string {
  const result = lines(source);
  const elementIndex = elementLineIndex(result, id);
  const index = elementIndex >= 0 ? elementIndex : statementIndex(result, notePrefix(id));
  if (index < 0) return source;
  const end = statementEnd(result, index);
  const removed = new Set([id]);
  for (let at = index + 1; at <= end; at++) {
    const nested = /^\s*element\s+\S+\s+(\S+)/u.exec(result[at] ?? '');
    if (nested?.[1]) removed.add(nested[1]);
  }
  const kept = result.filter((line, at) => {
    if (at >= index && at <= end) return false;
    if (/^\s*element\s/u.test(line) || /^\s*(?:positions\s*\{|\})\s*$/u.test(code(line))) return true;
    return !identifiers(line).some(({ word }) => removed.has(word));
  });
  return join(kept);
}

// Relationship edits address a relationship by its place among the relationship statements, which is the
// order of the model's relationships. The positions block is skipped, because its anchor lines look alike.

export type RelationshipEnd = 'source' | 'target';

function relationshipLineIndices(source: readonly string[]): number[] {
  const block = positionsBlock(source);
  return source.flatMap((line, index) =>
    (!block || index < block.open || index > block.close) && isRelationshipLine(line) ? [index] : [],
  );
}

function locateRelationship(
  source: readonly string[],
  index: number,
): { readonly at: number; readonly line: RelationshipLine } | undefined {
  const at = relationshipLineIndices(source)[index];
  const line = at === undefined ? undefined : parseRelationshipLine(source[at] ?? '');
  return at === undefined || !line ? undefined : { at, line };
}

export function readRelationshipLine(source: string, index: number): RelationshipLine | undefined {
  return locateRelationship(lines(source), index)?.line;
}

export function countRelationshipLines(source: string): number {
  return relationshipLineIndices(lines(source)).length;
}

function generatedId(line: ShorthandLine): string {
  return `${line.source.text}__${connectorNotation(line.connector.text)?.type ?? 'relationship'}__${line.target.text}`;
}

function reference(line: RelationshipLine): string {
  return line.kind === 'longForm' ? line.id.text : `${line.source.text} ${line.connector.text} ${line.target.text}`;
}

// An anchor names a long-form relationship by its ID, and a shorthand one by its line or its generated ID.
function sameReference(written: string, line: RelationshipLine): boolean {
  const byLine = parseRelationshipLine(written);
  if (byLine) return byLine.kind === 'shorthand' && line.kind === 'shorthand' && reference(byLine) === reference(line);
  return written.trim() === (line.kind === 'longForm' ? line.id.text : generatedId(line));
}

interface AnchorLine {
  readonly index: number;
  readonly indent: string;
  readonly from: string | undefined;
  readonly to: string | undefined;
}

function findAnchor(source: readonly string[], line: RelationshipLine): AnchorLine | undefined {
  const block = positionsBlock(source);
  if (!block) return undefined;
  for (let index = block.open + 1; index < block.close; index++) {
    const match = /^(\s*)(.+?)((?:\s+(?:from|to)\s+\S+)+)\s*$/u.exec(code(source[index] ?? ''));
    if (!match || !sameReference(match[2] ?? '', line)) continue;
    const sides = match[3] ?? '';
    return {
      index,
      indent: match[1] ?? '',
      from: /\bfrom\s+(\S+)/u.exec(sides)?.[1],
      to: /\bto\s+(\S+)/u.exec(sides)?.[1],
    };
  }
  return undefined;
}

function anchorText(indent: string, line: RelationshipLine, from: string | undefined, to: string | undefined): string {
  return `${indent}${reference(line)}${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`;
}

// Rewrites or removes the relationship's anchor line after the relationship itself changed. An anchor that
// still names the relationship and loses no side stays exactly as written.
function rewriteAnchor(
  result: string[],
  before: RelationshipLine,
  after: RelationshipLine | undefined,
  dropEnd?: RelationshipEnd,
): void {
  if (after && !dropEnd && reference(after) === reference(before)) return;
  const anchor = findAnchor(result, before);
  if (!anchor) return;
  const from = dropEnd === 'source' ? undefined : anchor.from;
  const to = dropEnd === 'target' ? undefined : anchor.to;
  if (!after || (!from && !to)) result.splice(anchor.index, 1);
  else result[anchor.index] = anchorText(anchor.indent, after, from, to);
}

export function removeRelationship(source: string, index: number): string {
  const result = lines(source);
  const found = locateRelationship(result, index);
  if (!found) return source;
  result.splice(found.at, 1);
  rewriteAnchor(result, found.line, undefined);
  return join(result);
}

// Rewrites one relationship line and carries its anchor line along. A change that rewrites nothing returns
// the source exactly as it came in.
function rewriteRelationship(
  source: string,
  index: number,
  change: (text: string, line: RelationshipLine) => string,
  dropEnd?: RelationshipEnd,
): string {
  const result = lines(source);
  const found = locateRelationship(result, index);
  const text = found && result[found.at];
  if (!found || text === undefined) return source;
  const rewritten = change(text, found.line);
  if (rewritten === text) return source;
  result[found.at] = rewritten;
  rewriteAnchor(result, found.line, parseRelationshipLine(rewritten), dropEnd);
  return join(result);
}

// Moving one end to another element keeps the other end, the type and the label; a side pinned on the old
// element is dropped, since it described that element.
export function reconnectRelationship(source: string, index: number, end: RelationshipEnd, to: string): string {
  return rewriteRelationship(source, index, (text, line) => replaceSpan(text, line[end], to), end);
}

export function setRelationshipGlyph(source: string, index: number, glyph: string): string {
  return rewriteRelationship(source, index, (text, line) =>
    line.kind === 'shorthand' ? replaceSpan(text, line.connector, glyph) : text,
  );
}

export function readRelationshipLabel(source: string, index: number): string {
  const line = readRelationshipLine(source, index);
  return (line && readLabel(line)) ?? '';
}

// The label clause takes the notation's own form; an empty label removes the clause.
export function setRelationshipLabel(source: string, index: number, label: string): string {
  const trimmed = label.trim();
  return rewriteRelationship(source, index, (text, line) => {
    const marker = line.kind === 'longForm' ? ' label ' : ' : ';
    const clause = trimmed ? marker + JSON.stringify(trimmed) : '';
    const end = line.statement.end;
    return replaceSpan(text, line.label ?? { start: end, end }, clause);
  });
}

export function readAnchor(source: string, index: number): { from?: ArchiMateSide; to?: ArchiMateSide } {
  const line = readRelationshipLine(source, index);
  const anchor = line && findAnchor(lines(source), line);
  return {
    ...(anchor?.from && { from: anchor.from as ArchiMateSide }),
    ...(anchor?.to && { to: anchor.to as ArchiMateSide }),
  };
}

// Pins the side where one end meets its element; the positions block is created when missing.
export function setAnchor(
  source: string,
  index: number,
  end: RelationshipEnd,
  side: ArchiMateSide | undefined,
): string {
  const line = readRelationshipLine(source, index);
  if (!line) return source;
  const result = withPositionsBlock(lines(source));
  const anchor = findAnchor(result, line);
  const from = end === 'source' ? side : anchor?.from;
  const to = end === 'target' ? side : anchor?.to;
  const block = positionsBlock(result);
  if (!block) return source;
  const indent = indentOf(result[block.open] ?? '') + elementIndent(result);
  if (anchor) {
    if (from || to) result[anchor.index] = anchorText(anchor.indent, line, from, to);
    else result.splice(anchor.index, 1);
  } else if (from || to) {
    result.splice(block.close, 0, anchorText(indent, line, from, to));
  }
  return join(result);
}

// Positions cannot be negative, so making room above or left of the top-left element moves every given
// top-level element instead. Nested positions are relative to their parent and stay as they are.
export function shiftPositions(source: string, dx: number, dy: number, ids: ReadonlySet<string>): string {
  const result = lines(source);
  const block = positionsBlock(result);
  if (!block || (!dx && !dy)) return source;
  for (let index = block.open + 1; index < block.close; index++) {
    result[index] =
      result[index]?.replace(
        /^(\s*)(\S+)(\s+at\s+)(\d+)(\s+)(\d+)/u,
        (whole, indent: string, id: string, at: string, x: string, gap: string, y: string) =>
          ids.has(id) ? `${indent}${id}${at}${Number(x) + dx}${gap}${Number(y) + dy}` : whole,
      ) ?? '';
  }
  return join(result);
}

export interface GridSize {
  readonly width: number;
  readonly height: number;
}

// Sets the minimum size on an existing position; the renderer still grows an element to fit its name.
export function setSize(source: string, id: string, size: GridSize): string {
  const result = lines(source);
  const block = positionsBlock(result);
  if (!block) return source;
  const pattern = new RegExp(`^(\\s*${escapeRegExp(id)}\\s+at\\s+\\d+\\s+\\d+)(?:\\s+size\\s+\\d+x\\d+)?(.*)$`, 'u');
  for (let index = block.open + 1; index < block.close; index++) {
    const match = pattern.exec(result[index] ?? '');
    if (!match) continue;
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    result[index] = `${match[1] ?? ''} size ${width}x${height}${match[2] ?? ''}`;
    return join(result);
  }
  return source;
}
