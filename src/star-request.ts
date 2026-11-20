import { readStored, writeStored } from './storage.ts';
import type { ToastAction } from './toast.ts';

export const STAR_REQUEST_MS = 7000;

const repositoryUrl = 'https://github.com/Archimaid/archimaid';
const askedKey = 'archimaid.designer.star-asked';

// Asks once, after the first export or share, when the designer has just been useful. Without storage it
// never asks: staying quiet beats asking on every export.
export function starRequest(): ToastAction | undefined {
  if (readStored(askedKey) !== null || !writeStored(askedKey, '1')) return undefined;
  return { label: 'Star on GitHub', run: () => window.open(repositoryUrl, '_blank', 'noopener') };
}
