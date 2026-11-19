import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileBaseOf } from '../src/export.ts';

test('a diagram name becomes a lower-case, hyphenated file name', () => {
  assert.equal(fileBaseOf('Order fulfilment'), 'order-fulfilment');
  assert.equal(fileBaseOf('ArchiMate Cross-Layer view'), 'archimate-cross-layer-view');
  assert.equal(fileBaseOf(''), 'diagram');
});
