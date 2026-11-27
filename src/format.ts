import type { ArchiMateSide } from 'archimaid/language';

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export const sideNames: Record<ArchiMateSide, string> = { T: 'top', R: 'right', B: 'bottom', L: 'left' };
