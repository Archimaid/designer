import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from '@codemirror/language';
import { Tag, tags } from '@lezer/highlight';
import { elementTypes, relationshipTypes } from 'archimaid/language';
import type { Category } from './catalogue.ts';
import { connectorGlyphs, keywords as keywordList, longestFirst } from './grammar.ts';

const keywords = new Set(keywordList);

// Element types are tinted by their layer, as on archimaid.org, so the source previews the diagram's colours.
const elementLayers = new Map<string, Category>(
  Object.entries(elementTypes).map(([key, type]) => [key, type.category]),
);
const layers = new Set(elementLayers.values());
const relationshipTypeNames = new Set<string>(relationshipTypes);
const layerTags = new Map(Array.from(layers, (layer) => [layer, Tag.define(tags.typeName)]));
const layerToken = (layer: Category): string => `layer-${layer}`;
const metadataKeys = /^(?:title|accTitle|accDescr)\s*:/u;
// Longest first, so `<..>` wins over `<..` and `..`.
const connectors = [...connectorGlyphs, '->'].sort(longestFirst);

interface State {
  inMetadataValue: boolean;
}

function token(stream: StringStream, state: State): string | null {
  if (stream.sol()) state.inMetadataValue = false;
  if (stream.eatSpace()) return null;
  if (stream.match('%%')) {
    stream.skipToEnd();
    return 'comment';
  }
  if (state.inMetadataValue) {
    if (stream.match(/^[^%]+/u) || stream.next()) return 'string';
  }
  if (stream.match(metadataKeys)) {
    state.inMetadataValue = true;
    return 'meta';
  }
  if (stream.match('archimate-beta')) return 'heading';
  if (stream.peek() === '"') {
    stream.next();
    let escaped = false;
    while (!stream.eol()) {
      const character = stream.next();
      if (character === '"' && !escaped) break;
      escaped = !escaped && character === '\\';
    }
    return 'string';
  }
  if (stream.match(/^\d+(?:x\d+)?/u)) return 'number';
  for (const connector of connectors) {
    if (stream.match(connector)) return 'operator';
  }
  const word = stream.match(/^[a-zA-Z_]\w*(?:-\w+)*/u);
  if (Array.isArray(word)) {
    const text = word[0];
    if (keywords.has(text)) return 'keyword';
    const layer = elementLayers.get(text);
    if (layer) return layerToken(layer);
    if (relationshipTypeNames.has(text)) return 'operator';
    if (/^(?:TB|BT|LR|RL|architecture|framework|graph|custom|T|R|B|L|read|write|readWrite|unspecified)$/u.test(text))
      return 'atom';
    return 'variableName';
  }
  stream.next();
  return null;
}

const archimateLanguage = StreamLanguage.define<State>({
  name: 'archimate',
  startState: () => ({ inMetadataValue: false }),
  copyState: (state) => ({ ...state }),
  token,
  tokenTable: Object.fromEntries(Array.from(layerTags, ([layer, tag]) => [layerToken(layer), tag])),
  languageData: { commentTokens: { line: '%%' } },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.operator, color: 'var(--syntax-operator)', fontWeight: '600' },
  { tag: tags.atom, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.meta, color: 'var(--syntax-keyword)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  ...Array.from(layerTags, ([layer, tag]) => ({ tag, color: `var(--syntax-layer-${layer})`, fontWeight: '600' })),
]);

export const archimateSyntax = [archimateLanguage, syntaxHighlighting(highlightStyle)];
