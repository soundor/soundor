/**
 * The tiles of drawing.tsx, in order: one for each thing the engine paints,
 * text aside. Their nodes' debug ids are `drawing.<index>`.
 */
export const drawingTiles = [
  'border 0.5',
  'border 1',
  'border 1.5',
  'border 2, radius 5',
  'ring',
  'radius 4.3',
  'outline',
  'shadow',
  'inset shadow',
  'opacity',
  'translate',
  'rotate',
  'scale',
  'clip',
  'svg',
  'nested',
] as const;

export type DrawingTile = (typeof drawingTiles)[number];
