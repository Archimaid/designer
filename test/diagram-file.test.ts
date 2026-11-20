import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeDiagram, readImported } from '../src/diagram-file.ts';

test('a diagram is recognised by its archimate-beta line, after front matter or comments', () => {
  assert.equal(looksLikeDiagram('archimate-beta\n  element businessActor a "A"'), true);
  assert.equal(looksLikeDiagram('---\ntitle: Orders\n---\n%% a comment\n  archimate-beta\n'), true);
  assert.equal(looksLikeDiagram('flowchart TD\n  a --> b'), false);
  assert.equal(looksLikeDiagram('archimate-betamax'), false);
  assert.equal(looksLikeDiagram('see archimate-beta in the docs'), false);
  assert.equal(looksLikeDiagram(''), false);
});

test('text that is not a diagram is refused', () => {
  assert.deepEqual(readImported('hello', 'notes.txt'), { kind: 'not-a-diagram' });
});

test('the title comes from the diagram, then the file name, then a default', () => {
  const titled = 'archimate-beta\n  title: Order fulfilment\n  element businessActor a "A"\n';
  const untitled = 'archimate-beta\n  element businessActor a "A"\n';
  assert.deepEqual(readImported(titled, 'orders.mmd'), { kind: 'diagram', source: titled, title: 'Order fulfilment' });
  assert.deepEqual(readImported(untitled, 'payments.v2.mmd'), {
    kind: 'diagram',
    source: untitled,
    title: 'payments.v2',
  });
  assert.deepEqual(readImported(untitled), { kind: 'diagram', source: untitled, title: 'Pasted diagram' });
});

test('a diagram with errors still imports, so its problems can be shown and fixed', () => {
  const broken = 'archimate-beta\n  element nonsense a "A"\n';
  assert.equal(readImported(broken, 'broken.mmd').kind, 'diagram');
});
