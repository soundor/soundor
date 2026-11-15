// What JavaScript keeps of each node: the tree as it was built (the engine has
// the same), and what the engine last reported of its layout.

import type { Style } from './style.ts';

/** A box, in CSS pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A node's laid-out box, as the engine reported it. */
export interface Frame {
  /** Relative to the parent's border box. */
  readonly x: number;
  readonly y: number;
  /** Relative to the parent's padding box: an element's `left` and `top`. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Border widths: top, right, bottom, left. */
  readonly border: readonly [number, number, number, number];
}

/** A line of a text node, relative to its border box. */
export interface Line {
  /** UTF-16 offsets into the text. */
  readonly start: number;
  readonly end: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A text node's text laid out. */
export interface Lines {
  /** Its CSS font (cssFont()). */
  readonly font: string;
  readonly lines: readonly Line[];
}

export type NodeType = 'view' | 'text';

export interface NodeState {
  readonly handle: number;
  readonly type: NodeType;
  /** The style asked for, and the last the engine accepted. */
  style: Style;
  committed: Style;
  text: string;
  parent: NodeState | null;
  children: NodeState[];
  frame: Frame | null;
  lines: Lines | null;
  released: boolean;
  /** Its element, while the engine is mounted. */
  element: HTMLElement | null;
}
