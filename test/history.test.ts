import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedLineNumbers, History } from '../src/history.ts';

test('undo and redo walk the recorded versions, and a new edit ends redo', () => {
  const history = new History();
  assert.equal(history.undo('a'), undefined);
  history.record('a');
  history.record('b');
  assert.equal(history.undo('c'), 'b');
  assert.equal(history.undo('b'), 'a');
  assert.ok(!history.canUndo);
  assert.equal(history.redo('a'), 'b');
  assert.ok(history.canRedo);
  history.record('b');
  assert.ok(!history.canRedo);
  assert.equal(history.redo('x'), undefined);
});

test('history keeps the last 200 versions', () => {
  const history = new History();
  for (let version = 0; version < 250; version++) history.record(String(version));
  let oldest = '';
  for (let current = 'now'; history.canUndo;) {
    const previous = history.undo(current);
    if (previous === undefined) break;
    oldest = previous;
    current = previous;
  }
  assert.equal(oldest, '50');
});

test('changed lines are the new or extra lines, ignoring blank ones', () => {
  assert.deepEqual(changedLineNumbers('a\nb\nb', 'a\nb\nc\nb\nb\n\n'), [3, 5]);
  assert.deepEqual(changedLineNumbers('same', 'same'), []);
});
