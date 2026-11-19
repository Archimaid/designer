import { validateArchiMate } from 'archimaid/language';
import starterSource from './starter.mmd?raw';

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly source: string;
}

// The npm package ships its examples, so the list always matches the installed renderer version.
const packagedSources = import.meta.glob<string>('/node_modules/archimaid/examples/*.mmd', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function titleOf(id: string, source: string): string {
  const { model } = validateArchiMate(source);
  return model?.title ?? model?.accTitle ?? id.replaceAll('-', ' ');
}

function elementCount(source: string): number {
  return validateArchiMate(source).model?.elements.length ?? Number.POSITIVE_INFINITY;
}

const packagedExamples: Example[] = Object.entries(packagedSources)
  .map(([path, source]) => {
    const id = path.slice(path.lastIndexOf('/') + 1, -'.mmd'.length);
    return { id, title: titleOf(id, source), source };
  })
  // Smallest first, so the list reads as a progression from one relationship to a full view.
  .sort((left, right) => elementCount(left.source) - elementCount(right.source));

export const starterExample: Example = { id: 'starter', title: 'Order fulfilment', source: starterSource };

export const examples: readonly Example[] = [starterExample, ...packagedExamples];

// A new diagram starts in custom layout, so elements dropped on the canvas stay where they land. The empty
// positions block keeps the checker from warning that custom layout has nothing to place.
export const blankSource = 'archimate-beta\n  layout custom\n\n  positions {\n  }\n';
export const blankTitle = 'Untitled diagram';
