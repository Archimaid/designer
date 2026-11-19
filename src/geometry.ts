// The layout space the renderer draws in, which the canvas, placement and the positions block all share.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box extends Point {
  readonly width: number;
  readonly height: number;
}

// Where a dragged or resized item would land, with the words the canvas shows beside it.
export interface Snapped {
  readonly box: Box;
  readonly label: string;
}

// The sides of an element in the T/R/B/L letters of the positions block.
export type Side = 'T' | 'R' | 'B' | 'L';

// The renderer leaves this margin around a custom layout before the first grid line.
export const layoutPadding = 24;
export const gridUnit = 20;
