import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiagramDocument } from '../src/document.ts';

const valid = 'archimate-beta\n  element businessRole clerk "Clerk"\n';
const invalid = 'archimate-beta\n  element businessRole\n';

test('a canvas edit never turns valid text into invalid text', () => {
  const doc = new DiagramDocument();
  doc.load(valid);
  assert.equal(doc.commit(valid), 'unchanged');
  assert.equal(doc.commit(invalid), 'refused');
  assert.equal(doc.source, valid);
  assert.ok(!doc.canUndo);
  const next = valid + '  element businessActor buyer "Buyer"\n';
  assert.equal(doc.commit(next), 'applied');
  assert.ok(doc.undo());
  assert.equal(doc.source, valid);
  assert.ok(doc.redo());
  assert.equal(doc.source, next);
});

test('typing is one undo step per pause', () => {
  const doc = new DiagramDocument();
  doc.load('a');
  doc.type('ab', 1000);
  doc.type('abc', 1500);
  doc.type('abcd', 3000);
  assert.ok(doc.undo());
  assert.equal(doc.source, 'abc');
  assert.ok(doc.undo());
  assert.equal(doc.source, 'a');
  assert.ok(!doc.undo());
});

test('typing straight after a canvas edit is its own undo step', () => {
  const doc = new DiagramDocument();
  doc.load(valid);
  doc.type(valid + ' ', 1000);
  const edited = valid + '  element businessActor buyer "Buyer"\n';
  assert.equal(doc.commit(edited), 'applied');
  doc.type(edited + ' ', 1200);
  assert.ok(doc.undo());
  assert.equal(doc.source, edited);
});

test('the model stays the last valid one while the text is broken', () => {
  const doc = new DiagramDocument();
  doc.load(valid);
  doc.validate();
  assert.equal(doc.model?.elements.length, 1);
  doc.replace(invalid);
  doc.validate();
  assert.equal(doc.model?.elements.length, 1);
  assert.ok(doc.diagnostics.some(({ severity }) => severity === 'error'));
});
