import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateArchiMate } from 'archimaid/language';
import type { Box } from '../src/geometry.ts';
import {
  gridOrigin,
  gridSize,
  moveItem,
  moveItems,
  placeAt,
  rawGridFor,
  snapMove,
  toCustomLayout,
  type Placement,
} from '../src/placement.ts';

const source = `archimate-beta
  layout custom
  element businessActor clerk "Clerk"
  element applicationComponent suite "Suite" {
    element applicationComponent billing "Billing"
  }
  note loose "Loose"

  positions {
    clerk at 2 1
    suite at 10 0
    billing at 1 1
    loose at 0 6
  }`;

// The boxes the renderer would draw for the positions above, with a 54px container header.
const boxes = new Map<string, Box>([
  ['clerk', { x: 64, y: 44, width: 140, height: 60 }],
  ['suite', { x: 224, y: 24, width: 300, height: 200 }],
  ['billing', { x: 268, y: 122, width: 140, height: 60 }],
  ['loose', { x: 24, y: 144, width: 140, height: 60 }],
]);

function placementFor(text: string, drawn: ReadonlyMap<string, Box> = boxes): Placement {
  return { model: validateArchiMate(text).model, boxes: drawn, headerOf: () => 54 };
}

test('a nested element counts its grid from inside its parent', () => {
  const placement = placementFor(source);
  assert.deepEqual(gridOrigin(placement, 'clerk'), { x: 24, y: 24 });
  assert.deepEqual(gridOrigin(placement, 'billing'), { x: 248, y: 102 });
  assert.deepEqual(rawGridFor(placement, 'billing', { x: 268, y: 122 }), { x: 1, y: 1 });
});

test('placing left of the others shifts every top-level item and leaves nested ones alone', () => {
  const placed = placeAt(placementFor(source), source, 'clerk', { x: -3, y: 0 });
  assert.deepEqual(placed.shift, { x: 3, y: 0 });
  assert.deepEqual(placed.grid, { x: 0, y: 0 });
  assert.ok(placed.text.includes('    clerk at 0 0\n    suite at 13 0\n    billing at 1 1\n    loose at 3 6'));
});

test('a selected container carries its selected child, which keeps its place inside', () => {
  const placement = placementFor(source);
  const moved = moveItems(placement, source, 'suite', { x: 264, y: 24 }, ['billing']);
  assert.ok(moved);
  assert.deepEqual(moved.shift, { x: 0, y: 0 });
  assert.ok(moved.text.includes('    suite at 12 0\n    billing at 1 1'));
  assert.equal(moveItems(placement, source, 'suite', { x: 224, y: 24 }, ['billing']), undefined);
});

test('moving in automatic layout pins the others where they were drawn first', () => {
  const auto = source.replace('  layout custom\n', '').replace(/\n\n {2}positions \{[\s\S]*\}$/u, '');
  const moved = moveItem(placementFor(auto), auto, 'clerk', { x: 104, y: 64 }, gridSize({ width: 139, height: 61 }));
  assert.ok(moved.text.includes('layout custom'));
  assert.ok(moved.text.includes('    suite at 10 0'));
  assert.ok(moved.text.includes('    clerk at 4 2 size 7x3'));
  assert.ok(!toCustomLayout(placementFor(auto), auto).includes('billing at'));
});

test('the snap label says when a drop makes room', () => {
  const placement = placementFor(source);
  assert.equal(snapMove(placement, 'clerk', { x: 64, y: 44 }).label, 'clerk at 2 1');
  assert.equal(snapMove(placement, 'clerk', { x: 0, y: 44 }).label, 'Moves the others to make room');
});
