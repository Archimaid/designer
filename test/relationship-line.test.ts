import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRelationshipLine, readLabel, replaceSpan } from '../src/relationship-line.ts';

test('reads a long-form relationship with every option, and where each part sits', () => {
  const text = '  relationship access reads clerk -> orders access read directed label "Looks up" %% why';
  const line = parseRelationshipLine(text);
  assert.equal(line?.kind, 'longForm');
  if (line?.kind !== 'longForm') return;
  assert.equal(line.type.text, 'access');
  assert.equal(line.id.text, 'reads');
  assert.equal(line.source.text, 'clerk');
  assert.equal(line.target.text, 'orders');
  assert.equal(line.access?.text, 'read');
  assert.equal(line.directed, true);
  assert.equal(line.label?.text, ' label "Looks up"');
  assert.equal(readLabel(line), 'Looks up');
  assert.equal(text.slice(line.statement.start, line.statement.end), text.trim().replace(/ %%.*$/u, ''));
});

test('reads shorthand with or without spaces around the connector', () => {
  for (const text of ['  a --> b', '  a-->b', '  a-->b : "Serves"', '  a <..> b-c %% both ways']) {
    const line = parseRelationshipLine(text);
    assert.equal(line?.kind, 'shorthand', text);
  }
  const line = parseRelationshipLine('  a-->b');
  assert.equal(line?.kind === 'shorthand' && line.connector.text, '-->');
});

test('reads tight spellings archimaid accepts', () => {
  const long = parseRelationshipLine('  relationship serving s a->b label"x"');
  assert.ok(long && readLabel(long) === 'x');
  const short = parseRelationshipLine('  a --> b:"x"');
  assert.ok(short && readLabel(short) === 'x');
});

test('keeps a %% inside a quoted label, and drops a trailing comment', () => {
  const line = parseRelationshipLine('  a --> b : "100%% done" %% note');
  assert.ok(line);
  assert.equal(readLabel(line), '100%% done');
  assert.equal(line.label?.text, ' : "100%% done"');
});

test('anchor lines, other statements and broken relationships are not relationships', () => {
  for (const text of [
    '    a --> b from T',
    '  element businessRole a "A"',
    '  nest a in b',
    '  relationship serving s a ->',
    '  relationship serving s a -> b label "x" directed',
  ]) {
    assert.equal(parseRelationshipLine(text), undefined, text);
  }
});

test('replacing a part keeps the rest of the line as written', () => {
  const text = '  a-->b   %% keep';
  const line = parseRelationshipLine(text);
  assert.equal(line?.kind, 'shorthand');
  if (line?.kind !== 'shorthand') return;
  assert.equal(replaceSpan(text, line.connector, '==>'), '  a==>b   %% keep');
  assert.equal(replaceSpan(text, line.target, 'c'), '  a-->c   %% keep');
});
