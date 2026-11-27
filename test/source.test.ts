import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateArchiMate } from 'archimaid/language';
import {
  addElement,
  addNote,
  setNoteText,
  clearDiagram,
  addRelationship,
  reconnectRelationship,
  removeRelationship,
  setAnchor,
  setRelationshipGlyph,
  setRelationshipLabel,
  setSize,
  shiftPositions,
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

function edited(result: string | undefined): string {
  assert.ok(result !== undefined, 'the edit found its relationship');
  return result;
}

function modelOf(source: string) {
  const { model } = validateArchiMate(source);
  assert.ok(model);
  return model;
}

const assignment = 'clerk__assignment__fulfil';
const serving = 'orders__serving__fulfil';

test('reconnecting an end rewrites the relationship and drops the side pinned on the old element', () => {
  const moved = edited(reconnectRelationship(related, serving, 'target', 'clerk'));
  assert.deepEqual(errors(moved), []);
  assert.ok(moved.includes('  orders --> clerk : "Supports"'));
  assert.ok(moved.includes('    orders --> clerk from T\n'));
  const long = edited(reconnectRelationship(related, 'rel1', 'source', 'fulfil'));
  assert.ok(long.includes('  relationship realization rel1 fulfil -> clerk'));
  assert.ok(long.includes('    rel1 to L'));
  assert.ok(!edited(reconnectRelationship(related, 'rel1', 'target', 'fulfil')).includes('rel1 to'));
});

test('retypes, relabels, anchors and removes relationships', () => {
  let result = edited(setRelationshipGlyph(related, serving, '==>'));
  assert.ok(
    result.includes('  orders ==> fulfil : "Supports"') && result.includes('    orders ==> fulfil from T to B'),
  );
  const triggering = 'orders__triggering__fulfil';
  result = edited(setRelationshipLabel(result, triggering, 'Feeds'));
  result = edited(setRelationshipLabel(result, assignment, 'Does'));
  result = edited(setRelationshipLabel(result, 'rel1', 'Realizes'));
  assert.equal(modelOf(result).relationships.find(({ id }) => id === triggering)?.label, 'Feeds');
  assert.ok(result.includes('  clerk @==> fulfil : "Does"'));
  assert.ok(result.includes('relationship realization rel1 orders -> clerk label "Realizes"'));
  result = edited(setAnchor(result, assignment, 'source', 'R'));
  assert.deepEqual(
    modelOf(result).anchors?.find(({ relationship }) => relationship === assignment),
    { relationship: assignment, source: 'R' },
  );
  result = edited(setAnchor(result, 'rel1', 'target', undefined));
  assert.ok(!result.includes('rel1 to'));
  assert.deepEqual(errors(result), []);
  result = edited(removeRelationship(result, triggering));
  assert.deepEqual(errors(result), []);
  assert.ok(!result.includes('orders ==> fulfil'));
});

test('relationship edits keep comments, tight spelling and quoted %%', () => {
  const tight = `archimate-beta
  element businessRole clerk "Clerk"
  element applicationService orders "Orders"
  orders-->clerk : "50%% of it" %% why

  positions {
    orders-->clerk from T %% pinned
  }`;
  const id = 'orders__serving__clerk';
  assert.deepEqual(errors(tight), []);
  const relabelled = edited(setRelationshipLabel(tight, id, 'All'));
  assert.ok(relabelled.includes('  orders-->clerk : "All" %% why'));
  assert.ok(relabelled.includes('    orders-->clerk from T %% pinned'));
  assert.ok(edited(setRelationshipLabel(tight, id, '')).includes('  orders-->clerk %% why'));
  const retyped = edited(setRelationshipGlyph(tight, id, '==>'));
  assert.ok(retyped.includes('  orders==>clerk : "50%% of it" %% why'));
  assert.ok(retyped.includes('    orders ==> clerk from T %% pinned'));
  assert.deepEqual(errors(retyped), []);
});

test('an anchor that names a long-form relationship by its connector follows it', () => {
  const named = `archimate-beta
  element businessRole clerk "Clerk"
  element businessProcess fulfil "Fulfil"
  element applicationService orders "Orders"
  relationship serving rel1 orders -> fulfil

  positions {
    orders --> fulfil from T to B
  }`;
  const moved = edited(reconnectRelationship(named, 'rel1', 'target', 'clerk'));
  assert.ok(moved.includes('    rel1 from T\n'));
  assert.deepEqual(errors(moved), []);
  const removed = edited(removeRelationship(named, 'rel1'));
  assert.ok(!removed.includes('from T'));
  assert.deepEqual(errors(removed), []);
});

test('relationship edits refuse text with errors, and pinning creates the positions block', () => {
  assert.equal(setRelationshipLabel(related + '\n  element', serving, 'x'), undefined);
  assert.equal(setRelationshipLabel(related, 'missing', 'x'), undefined);
  const plain = 'archimate-beta\n  element businessRole a "A"\n  element businessRole b "B"\n  a --> b\n';
  const pinned = edited(setAnchor(plain, 'a__serving__b', 'target', 'L'));
  assert.ok(pinned.includes('  positions {\n    a --> b to L\n  }'));
  assert.deepEqual(errors(pinned), []);
});

test('shifting makes room above and left without moving nested positions', () => {
  const result = shiftPositions(base, 2, 3, new Set(['clerk', 'oms']));
  assert.ok(result.includes('    clerk at 2 3\n    oms at 12 3'));
  const nested = base.replace('    oms at 10 0', '    oms at 10 0\n    billing at 1 1');
  assert.ok(shiftPositions(nested, 1, 1, new Set(['clerk', 'oms'])).includes('    billing at 1 1'));
});

test('sets a size on a position and replaces an earlier one', () => {
  const sized = setSize(base, 'clerk', { width: 9, height: 4 });
  assert.ok(sized.includes('    clerk at 0 0 size 9x4\n'));
  assert.ok(setSize(sized, 'clerk', { width: 0, height: 5 }).includes('    clerk at 0 0 size 1x5\n'));
  assert.deepEqual(errors(sized), []);
});

test('clearing keeps the header and the layout setting only', () => {
  const cleared = clearDiagram(`%% kept\n${base}`);
  assert.equal(cleared, '%% kept\narchimate-beta\n  layout custom\n\n  positions {\n  }');
  assert.deepEqual(validateArchiMate(cleared).diagnostics, []);
  assert.equal(clearDiagram(cleared), cleared);
  assert.equal(clearDiagram('archimate-beta\n  direction LR\n  element node n "N"'), 'archimate-beta\n  direction LR');
  assert.equal(clearDiagram('not a diagram'), 'not a diagram');
});

test('adds, rewrites and removes a note with everything that names it', () => {
  let result = addNote(base, 'note2', 'Check "this"\nfirst');
  assert.deepEqual(errors(result), []);
  assert.ok(result.includes('  clerk --> oms\n  note note2 "Check \\"this\\"\\nfirst"\n\n  positions {'));
  assert.equal(validateArchiMate(result).model?.notes?.[0]?.text, 'Check "this"\nfirst');
  result = addNote(setPosition(result, 'note2', { x: 4, y: 6 }), 'note3', 'Second');
  assert.ok(result.includes('  note note2 "Check \\"this\\"\\nfirst"\n  note note3 "Second"\n'));
  result = setNoteText(result, 'note3', 'Renamed');
  assert.ok(result.includes('  note note3 "Renamed"'));
  result = removeElement(result, 'note2');
  assert.ok(!result.includes('note2'));
  assert.deepEqual(errors(result), []);
  assert.equal(addNote('archimate-beta\n', 'note', 'Only'), 'archimate-beta\n  note note "Only"\n');
});
