import type { Side } from './geometry.ts';

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export const sideNames: Record<Side, string> = { T: 'top', R: 'right', B: 'bottom', L: 'left' };
