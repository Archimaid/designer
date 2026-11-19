import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateArchiMate } from 'archimaid/language';
import { glyphOf, isNote, nameOf, parentsOf, positionOf, topLevelIds } from '../src/model.ts';

const { model } = validateArchiMate(`archimate-beta
  layout custom
  element businessActor clerk "Clerk"
  element applicationComponent suite "Suite" {
    element applicationComponent billing "Billing"
  }
  clerk --> suite
  note loose "Loose note"
  note pinned "Pinned note" on clerk
  positions {
    clerk at 2 3
  }`);

test('names, notes and positions come from the model', () => {
  assert.equal(nameOf(model, 'billing'), 'Billing');
  assert.equal(nameOf(model, 'loose'), 'Loose note');
  assert.equal(nameOf(model, 'missing'), 'missing');
  assert.equal(nameOf(undefined, 'clerk'), 'clerk');
  assert.ok(isNote(model, 'loose'));
  assert.ok(!isNote(model, 'clerk'));
  assert.deepEqual(positionOf(model, 'clerk'), { id: 'clerk', x: 2, y: 3 });
  assert.equal(parentsOf(model).get('billing'), 'suite');
});

test('top-level items leave out nested elements and notes attached to an element', () => {
  assert.deepEqual([...topLevelIds(model)].sort(), ['clerk', 'loose', 'suite']);
});

test('a relationship reads back as the connector that wrote it', () => {
  for (const connector of ['-->', '@==>', '..|>', '*--']) {
    const parsed = validateArchiMate(
      `archimate-beta\n  element applicationComponent a "A"\n  element applicationComponent b "B"\n  a ${connector} b`,
    ).model;
    const [relationship] = parsed?.relationships ?? [];
    assert.ok(relationship, connector);
    assert.equal(glyphOf(relationship), connector);
  }
});
