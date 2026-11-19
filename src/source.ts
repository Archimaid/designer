import { relationshipConnectors } from 'archimaid/language';

// Every canvas gesture is one of these pure text edits. The source stays the only state, so the text panel,
// undo, share links and the renderer all see exactly what the designer wrote.

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export type LayoutName = 'architecture' | 'framework' | 'graph' | 'custom';

const quotedText = String.raw`"(?:[^"\\]|\\.)*"`;
const identifierPattern = /[A-Za-z_]\w*(?:-\w+)*/gu;
const connectorGlyphs = Object.keys(relationshipConnectors).sort((left, right) => right.length - left.length);
const defaultIndent = '  ';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
  const trimmed = code(line).trim();
  if (trimmed.startsWith('relationship ')) return true;
  const words = trimmed.split(/\s+/u);
  return words.length >= 3 && connectorGlyphs.includes(words[1] ?? '');
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
  for (let suffix = 2; taken.has(id); suffix++) id = base + suffix;
  return id;
}

export interface NewElement {
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly at?: GridPoint;
}

// New elements go after the last top-level element, before relationships, so the file keeps its usual order.
export function addElement(source: string, element: NewElement): string {
  const result = lines(source);
  const depth = depths(result);
  const header = headerIndex(result);
  let insertAt = -1;
  for (let index = header + 1; index < result.length; index++) {
    if (depth[index] !== 0) continue;
    const trimmed = code(result[index] ?? '').trim();
    if (isRelationshipLine(trimmed) || trimmed.startsWith('positions')) break;
    if (trimmed.startsWith('element ')) insertAt = index + 1;
    else if (trimmed === '}' && insertAt >= 0) insertAt = index + 1;
  }
  if (insertAt < 0) {
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

function elementLineIndex(source: readonly string[], id: string): number {
  const pattern = new RegExp(`^\\s*element\\s+\\S+\\s+${escapeRegExp(id)}\\s+${quotedText}`, 'u');
  return source.findIndex((line) => pattern.test(line));
}

export function renameElement(source: string, id: string, name: string): string {
  const result = lines(source);
  const index = elementLineIndex(result, id);
  const line = result[index];
  if (line === undefined) return source;
  const pattern = new RegExp(`^(\\s*element\\s+\\S+\\s+${escapeRegExp(id)}\\s+)${quotedText}`, 'u');
  result[index] = line.replace(pattern, (_, prefix: string) => prefix + JSON.stringify(name));
  return join(result);
}

export function renameId(source: string, from: string, to: string): string {
  return join(
    lines(source).map((line) => {
      let rewritten = line;
      for (const { word, start } of identifiers(line).reverse()) {
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
  let after = element;
  if (
    code(result[element] ?? '')
      .trim()
      .endsWith('{')
  ) {
    const depth = depths(result);
    const start = depth[element] ?? 0;
    after = result.findIndex((entry, index) => index > element && depth[index] === start && code(entry).trim() === '}');
    if (after < 0) after = element;
  }
  result.splice(after + 1, 0, indentOf(result[element] ?? '') + line.trimStart());
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

export function setLayout(source: string, layout: LayoutName): string {
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

export function readLayout(source: string): LayoutName {
  for (const line of lines(source)) {
    const match = /^\s*layout\s+(architecture|framework|graph|custom)\b/u.exec(code(line));
    if (match?.[1]) return match[1] as LayoutName;
  }
  return 'architecture';
}

function positionPattern(id: string): RegExp {
  return new RegExp(`^(\\s*)${escapeRegExp(id)}\\s+at\\s+\\d+\\s+\\d+(.*)$`, 'u');
}

// Moves keep an explicit size and any trailing comment; the block is created at the end of the file when missing.
export function setPosition(source: string, id: string, at: GridPoint): string {
  const result = lines(source);
  const x = Math.max(0, Math.round(at.x));
  const y = Math.max(0, Math.round(at.y));
  const block = positionsBlock(result);
  const indent = elementIndent(result);
  if (!block) {
    const end = lastContentIndex(result) + 1;
    result.splice(end, 0, '', `${indent}positions {`, `${indent}${indent}${id} at ${x} ${y}`, `${indent}}`);
    return join(result);
  }
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

// Removes the element, its block and everything that refers to it or to its nested elements.
export function removeElement(source: string, id: string): string {
  const result = lines(source);
  const index = elementLineIndex(result, id);
  if (index < 0) return source;
  const depth = depths(result);
  let end = index;
  if (
    code(result[index] ?? '')
      .trim()
      .endsWith('{')
  ) {
    const start = depth[index] ?? 0;
    end = result.findIndex((line, at) => at > index && depth[at] === start && code(line).trim() === '}');
    if (end < 0) end = index;
  }
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
