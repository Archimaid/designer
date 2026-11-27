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

// The renderer leaves this margin around a custom layout before the first grid line.
export const layoutPadding = 24;
export const gridUnit = 20;

// The renderer's smallest container header, which is where a container's content area starts at the least.
export const minimumHeaderHeight = 54;

// The size the canvas assumes for an item it has not drawn yet, such as one just dropped from the palette.
export const defaultItemSize = { width: 140, height: 60 } as const;
