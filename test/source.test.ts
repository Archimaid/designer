import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateArchiMate } from 'archimaid/language';
import {
  addElement,
  addRelationship,
  readAnchor,
  readRelationshipLabel,
  reconnectRelationship,
  removeRelationship,
  setAnchor,
  setRelationshipGlyph,
  setRelationshipLabel,
  idFromName,
  readDescription,
  removeElement,
  renameElement,
  renameId,
  setDescription,
  setLayout,
  setPosition,
} from '../src/source.ts';

const base = `archimate-beta
  layout custom

  element businessRole clerk "Fulfilment clerk"
  element applicationComponent oms "Order management" {
    element applicationComponent billing "Billing"
  }
  clerk --> oms

  positions {
    clerk at 0 0
    oms at 10 0
  }`;

function errors(source: string): string[] {
  return validateArchiMate(source)
    .diagnostics.filter(({ severity }) => severity === 'error')
    .map(({ message }) => message);
}

test('IDs follow the name and stay unique', () => {
  assert.equal(idFromName('Fulfil order', new Set()), 'fulfilOrder');
  assert.equal(idFromName('Ça va 2', new Set()), 'caVa2');
  assert.equal(idFromName('42 things', new Set()), 'element42Things');
  assert.equal(idFromName('Clerk', new Set(['clerk'])), 'clerk2');
});

test('adds an element after the last element of its layer and pins it', () => {
  const result = addElement(base, { type: 'businessProcess', id: 'ship', name: 'Ship "fast"', at: { x: 4, y: 8 } });
  assert.deepEqual(errors(result), []);
  const lines = result.split('\n');
  assert.equal(lines[4], '  element businessProcess ship "Ship \\"fast\\""');
  assert.equal(lines[5], '  element applicationComponent oms "Order management" {');
  assert.ok(result.includes('    ship at 4 8\n  }'));
});

test('moves an existing position and keeps its size, or creates the block', () => {
  const sized = base.replace('oms at 10 0', 'oms at 10 0 size 9x3 %% wide');
  assert.ok(setPosition(sized, 'oms', { x: 12, y: 3 }).includes('    oms at 12 3 size 9x3 %% wide'));
  const withoutBlock = 'archimate-beta\n  element node n "N"\n';
  assert.equal(
    setPosition(withoutBlock, 'n', { x: 1, y: 2 }),
    'archimate-beta\n  element node n "N"\n\n  positions {\n    n at 1 2\n  }\n',
  );
});

test('renames the name, the ID and the description without touching quoted text', () => {
  let result = renameElement(base, 'clerk', 'Packer');
  result = renameId(result, 'clerk', 'packer');
  result = setDescription(result, 'packer', 'Packs "parcels"');
  result = setDescription(result, 'oms', 'Suite');
  assert.deepEqual(errors(result), []);
  assert.ok(result.includes('element businessRole packer "Packer"'));
  assert.ok(result.includes('  packer --> oms') && result.includes('    packer at 0 0'));
  assert.equal(readDescription(result, 'packer'), 'Packs "parcels"');
  assert.ok(result.includes('  }\n  description oms "Suite"'));
  assert.equal(readDescription(setDescription(result, 'packer', ' '), 'packer'), '');
});

test('adds relationships after the others and switches the layout', () => {
  const result = setLayout(addRelationship(base, 'billing', '..|>', 'clerk'), 'architecture');
  assert.deepEqual(errors(result), []);
  assert.ok(result.includes('  clerk --> oms\n  billing ..|> clerk'));
  assert.ok(result.includes('  layout architecture'));
  assert.ok(
    setLayout('archimate-beta\n  element node n "N"', 'custom').startsWith('archimate-beta\n  layout custom\n'),
  );
});

test('removing a container removes its children and every reference', () => {
  const result = removeElement(base, 'oms');
  assert.deepEqual(errors(result), []);
  assert.ok(!/oms|billing/u.test(result));
  assert.ok(result.includes('    clerk at 0 0\n  }'));
});

test('IDs never reuse a type name, and renaming an ID leaves the type alone', () => {
  assert.equal(idFromName('Business Actor', new Set()), 'businessActor2');
  const source =
    'archimate-beta\n  element businessActor businessActor "Business Actor"\n  businessActor --> businessActor';
  const result = renameId(source, 'businessActor', 'clerk');
  assert.equal(result, 'archimate-beta\n  element businessActor clerk "Business Actor"\n  clerk --> clerk');
});

test('new elements join their own layer in the text', () => {
  const layered = `archimate-beta
  element businessRole clerk "Clerk"
  element applicationComponent oms "Orders" {
    element applicationComponent billing "Billing"
  }
  element node server "Server"
  clerk --> oms`;
  const business = addElement(layered, { type: 'businessActor', id: 'customer', name: 'Customer' }).split('\n');
  assert.equal(business[2], '  element businessActor customer "Customer"');
  const application = addElement(layered, { type: 'applicationInterface', id: 'api', name: 'API' }).split('\n');
  assert.equal(application[5], '  element applicationInterface api "API"');
  const motivation = addElement(layered, { type: 'goal', id: 'speed', name: 'Speed' }).split('\n');
  assert.equal(motivation[1], '  element goal speed "Speed"');
});

const related = `archimate-beta
  layout custom
  element businessRole clerk "Clerk"
  element businessProcess fulfil "Fulfil"
  element applicationService orders "Orders"
  clerk @==> fulfil
  orders --> fulfil : "Supports"
  relationship realization rel1 orders -> clerk

  positions {
    clerk at 0 0
    orders --> fulfil from T to B
    rel1 to L
  }`;

test('reconnecting an end rewrites the relationship and drops the side pinned on the old element', () => {
  const moved = reconnectRelationship(related, 1, 'target', 'clerk');
  assert.deepEqual(errors(moved), []);
  assert.ok(moved.includes('  orders --> clerk : "Supports"'));
  assert.ok(moved.includes('    orders --> clerk from T\n'));
  const long = reconnectRelationship(related, 2, 'source', 'fulfil');
  assert.ok(long.includes('  relationship realization rel1 fulfil -> clerk'));
  assert.ok(long.includes('    rel1 to L'));
  assert.ok(!reconnectRelationship(related, 2, 'target', 'fulfil').includes('rel1 to'));
});

test('retypes, relabels, anchors and removes relationships', () => {
  let result = setRelationshipGlyph(related, 1, '==>');
  assert.ok(
    result.includes('  orders ==> fulfil : "Supports"') && result.includes('    orders ==> fulfil from T to B'),
  );
  result = setRelationshipLabel(result, 1, 'Feeds');
  result = setRelationshipLabel(result, 0, 'Does');
  result = setRelationshipLabel(result, 2, 'Realizes');
  assert.equal(readRelationshipLabel(result, 1), 'Feeds');
  assert.ok(result.includes('  clerk @==> fulfil : "Does"'));
  assert.ok(result.includes('relationship realization rel1 orders -> clerk label "Realizes"'));
  result = setAnchor(result, 0, 'source', 'R');
  assert.deepEqual(readAnchor(result, 0), { from: 'R' });
  result = setAnchor(result, 2, 'target', undefined);
  assert.ok(!result.includes('rel1 to'));
  assert.deepEqual(errors(result), []);
  result = removeRelationship(result, 1);
  assert.deepEqual(errors(result), []);
  assert.ok(!result.includes('orders ==> fulfil'));
});
