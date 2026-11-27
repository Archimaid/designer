import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nothingSelected, reconcile, selectedIds, selectionOf } from '../src/selection.ts';

test('one item is an element, two or more a group, repeats count once', () => {
  assert.deepEqual(selectionOf([]), nothingSelected);
  assert.deepEqual(selectionOf(['a', 'a']), { kind: 'element', id: 'a' });
  assert.deepEqual(selectionOf(['a', 'b', 'a']), { kind: 'group', ids: ['a', 'b'] });
  assert.deepEqual(selectedIds({ kind: 'relationship', index: 0 }), []);
});

test('items that are no longer drawn drop out after an edit', () => {
  const drawn = (id: string) => id !== 'gone';
  assert.deepEqual(reconcile({ kind: 'element', id: 'gone' }, drawn, 0), nothingSelected);
  assert.deepEqual(reconcile({ kind: 'group', ids: ['a', 'gone'] }, drawn, 0), { kind: 'element', id: 'a' });
  assert.deepEqual(reconcile({ kind: 'relationship', index: 2 }, drawn, 2), nothingSelected);
  assert.deepEqual(reconcile({ kind: 'relationship', index: 1 }, drawn, 2), { kind: 'relationship', index: 1 });
});
