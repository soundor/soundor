/**
 * Soundor styles as Yoga's: the same library the JUCE runtime lays out with
 * (`@soundor/yoga-wasm` is the engine's Yoga), told the same things. This is
 * `readSpacing()` and friends of the engine's `UiModule.cpp`, then `applyStyle()`
 * of its `Surface.cpp`: keep them in step.
 */

import {
  Align,
  BoxSizing,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  loadYoga,
  MeasureMode,
  Overflow,
  PositionType,
  Wrap,
  type Yoga,
  type YogaNode,
} from '@soundor/yoga-wasm';

import type { Style } from './types';

type StyleLength = number | string | undefined;

const Unit = { Undefined: 0, Point: 1, Percent: 2, Auto: 3 } as const;

interface Length {
  readonly unit: number;
  readonly value: number;
}

const UNDEFINED: Length = { unit: Unit.Undefined, value: NaN };
const AUTO: Length = { unit: Unit.Auto, value: NaN };
const ZERO: Length = { unit: Unit.Point, value: 0 };

function read(value: StyleLength, otherwise: Length): Length {
  if (value === undefined) return otherwise;
  if (typeof value === 'number') return { unit: Unit.Point, value };
  if (value === 'auto') return AUTO;
  return { unit: Unit.Percent, value: Number.parseFloat(value) };
}

/** Sets a length through its point, percent and auto setters. */
function set(
  length: Length,
  point: (value: number) => void,
  percent: (value: number) => void,
  automatic: () => void,
): void {
  switch (length.unit) {
    case Unit.Point:
      point(length.value);
      break;
    case Unit.Percent:
      percent(length.value);
      break;
    case Unit.Auto:
      automatic();
      break;
    default:
      point(NaN);
  }
}

/**
 * `size` within `min` and `max` where they share its unit. Yoga clamps a box
 * with a fixed size itself, but a container sized by its content and stretched
 * across its parent counted the size before the clamp.
 */
function clamped(size: Length, min: Length, max: Length): Length {
  if (size.unit !== Unit.Point && size.unit !== Unit.Percent) return size;
  let { value } = size;
  if (max.unit === size.unit) value = Math.min(value, max.value);
  if (min.unit === size.unit) value = Math.max(value, min.value);
  return { unit: size.unit, value };
}

const ALIGN: Readonly<Record<string, number>> = {
  auto: Align.Auto,
  'flex-start': Align.FlexStart,
  center: Align.Center,
  'flex-end': Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
  'space-between': Align.SpaceBetween,
  'space-around': Align.SpaceAround,
  'space-evenly': Align.SpaceEvenly,
};
const JUSTIFY: Readonly<Record<string, number>> = {
  'flex-start': Justify.FlexStart,
  center: Justify.Center,
  'flex-end': Justify.FlexEnd,
  'space-between': Justify.SpaceBetween,
  'space-around': Justify.SpaceAround,
  'space-evenly': Justify.SpaceEvenly,
};
const DIRECTION: Readonly<Record<string, number>> = {
  column: FlexDirection.Column,
  'column-reverse': FlexDirection.ColumnReverse,
  row: FlexDirection.Row,
  'row-reverse': FlexDirection.RowReverse,
};
const WRAP: Readonly<Record<string, number>> = {
  nowrap: Wrap.NoWrap,
  wrap: Wrap.Wrap,
  'wrap-reverse': Wrap.WrapReverse,
};
const POSITION: Readonly<Record<string, number>> = {
  relative: PositionType.Relative,
  absolute: PositionType.Absolute,
  static: PositionType.Static,
};
const OVERFLOW: Readonly<Record<string, number>> = {
  visible: Overflow.Visible,
  hidden: Overflow.Hidden,
  scroll: Overflow.Scroll,
};

type Side = 'Left' | 'Top' | 'Right' | 'Bottom';
const SIDES: readonly (readonly [Side, number])[] = [
  ['Left', Edge.Left],
  ['Top', Edge.Top],
  ['Right', Edge.Right],
  ['Bottom', Edge.Bottom],
];

/** The shorthand, then the axis, then the side, as the engine reads them. */
function edge<T>(
  side: Side,
  all: T | undefined,
  horizontal: T | undefined,
  vertical: T | undefined,
  own: T | undefined,
): T | undefined {
  const axis = side === 'Left' || side === 'Right' ? horizontal : vertical;
  return own ?? axis ?? all;
}

/** Tells Yoga `style`, which replaces what it was told before. */
export function applyYogaStyle(
  yoga: Yoga,
  node: YogaNode,
  style: Readonly<Style>,
): void {
  yoga.YGNodeStyleSetDisplay(
    node,
    style.display === 'none' ? Display.None : Display.Flex,
  );
  yoga.YGNodeStyleSetPositionType(
    node,
    POSITION[style.position ?? 'relative']!,
  );
  yoga.YGNodeStyleSetFlexDirection(
    node,
    DIRECTION[style.flexDirection ?? 'column']!,
  );
  yoga.YGNodeStyleSetFlexWrap(node, WRAP[style.flexWrap ?? 'nowrap']!);
  yoga.YGNodeStyleSetJustifyContent(
    node,
    JUSTIFY[style.justifyContent ?? 'flex-start']!,
  );
  yoga.YGNodeStyleSetAlignItems(node, ALIGN[style.alignItems ?? 'stretch']!);
  yoga.YGNodeStyleSetAlignSelf(node, ALIGN[style.alignSelf ?? 'auto']!);
  yoga.YGNodeStyleSetAlignContent(
    node,
    ALIGN[style.alignContent ?? 'flex-start']!,
  );

  // `flex` as in React Native: n > 0 grows by n, shrinks, from zero; a
  // negative n only shrinks. The longhands win over it.
  let grow = 0;
  let shrink = 0;
  let basis = AUTO;
  if (style.flex !== undefined) {
    if (style.flex > 0) {
      grow = style.flex;
      shrink = 1;
      basis = ZERO;
    } else if (style.flex < 0) shrink = 1;
  }
  yoga.YGNodeStyleSetFlexGrow(node, style.flexGrow ?? grow);
  yoga.YGNodeStyleSetFlexShrink(node, style.flexShrink ?? shrink);
  set(
    read(style.flexBasis, basis),
    (value) => yoga.YGNodeStyleSetFlexBasis(node, value),
    (value) => yoga.YGNodeStyleSetFlexBasisPercent(node, value),
    () => yoga.YGNodeStyleSetFlexBasisAuto(node),
  );

  const minWidth = read(style.minWidth, UNDEFINED);
  const minHeight = read(style.minHeight, UNDEFINED);
  const maxWidth = read(style.maxWidth, UNDEFINED);
  const maxHeight = read(style.maxHeight, UNDEFINED);
  set(
    clamped(read(style.width, AUTO), minWidth, maxWidth),
    (value) => yoga.YGNodeStyleSetWidth(node, value),
    (value) => yoga.YGNodeStyleSetWidthPercent(node, value),
    () => yoga.YGNodeStyleSetWidthAuto(node),
  );
  set(
    clamped(read(style.height, AUTO), minHeight, maxHeight),
    (value) => yoga.YGNodeStyleSetHeight(node, value),
    (value) => yoga.YGNodeStyleSetHeightPercent(node, value),
    () => yoga.YGNodeStyleSetHeightAuto(node),
  );
  // Minimums and maximums have no 'auto'; their absence is NaN.
  const noAuto = (): void => {};
  set(
    minWidth,
    (value) => yoga.YGNodeStyleSetMinWidth(node, value),
    (value) => yoga.YGNodeStyleSetMinWidthPercent(node, value),
    noAuto,
  );
  set(
    minHeight,
    (value) => yoga.YGNodeStyleSetMinHeight(node, value),
    (value) => yoga.YGNodeStyleSetMinHeightPercent(node, value),
    noAuto,
  );
  set(
    maxWidth,
    (value) => yoga.YGNodeStyleSetMaxWidth(node, value),
    (value) => yoga.YGNodeStyleSetMaxWidthPercent(node, value),
    noAuto,
  );
  set(
    maxHeight,
    (value) => yoga.YGNodeStyleSetMaxHeight(node, value),
    (value) => yoga.YGNodeStyleSetMaxHeightPercent(node, value),
    noAuto,
  );
  yoga.YGNodeStyleSetAspectRatio(node, style.aspectRatio ?? NaN);
  yoga.YGNodeStyleSetBoxSizing(
    node,
    style.boxSizing === 'content-box'
      ? BoxSizing.ContentBox
      : BoxSizing.BorderBox,
  );

  for (const [side, id] of SIDES) {
    set(
      read(
        edge<StyleLength>(
          side,
          style.margin,
          style.marginHorizontal,
          style.marginVertical,
          style[`margin${side}`],
        ),
        ZERO,
      ),
      (value) => yoga.YGNodeStyleSetMargin(node, id, value),
      (value) => yoga.YGNodeStyleSetMarginPercent(node, id, value),
      () => yoga.YGNodeStyleSetMarginAuto(node, id),
    );
    set(
      read(
        edge<StyleLength>(
          side,
          style.padding,
          style.paddingHorizontal,
          style.paddingVertical,
          style[`padding${side}`],
        ),
        ZERO,
      ),
      (value) => yoga.YGNodeStyleSetPadding(node, id, value),
      (value) => yoga.YGNodeStyleSetPaddingPercent(node, id, value),
      () => yoga.YGNodeStyleSetPadding(node, id, 0),
    );
    const own = style[side.toLowerCase() as Lowercase<Side>];
    set(
      read(own ?? style.inset, UNDEFINED),
      (value) => yoga.YGNodeStyleSetPosition(node, id, value),
      (value) => yoga.YGNodeStyleSetPositionPercent(node, id, value),
      () => yoga.YGNodeStyleSetPositionAuto(node, id),
    );
    yoga.YGNodeStyleSetBorder(
      node,
      id,
      edge(
        side,
        style.borderWidth,
        style.borderHorizontalWidth,
        style.borderVerticalWidth,
        style[`border${side}Width`],
      ) ?? 0,
    );
  }
  yoga.YGNodeStyleSetGap(node, Gutter.Row, style.rowGap ?? style.gap ?? 0);
  yoga.YGNodeStyleSetGap(
    node,
    Gutter.Column,
    style.columnGap ?? style.gap ?? 0,
  );
  yoga.YGNodeStyleSetOverflow(node, OVERFLOW[style.overflow ?? 'visible']!);
}

/** Applies a measure mode to a natural size. */
export function constrain(
  natural: number,
  available: number,
  mode: number,
): number {
  if (mode === MeasureMode.Exactly) return available;
  if (mode === MeasureMode.AtMost) return Math.min(natural, available);
  return natural;
}

/** What a node measures itself by, given the room it has. */
export type Measure = (
  width: number,
  widthMode: number,
  height: number,
  heightMode: number,
  size: (width: number, height: number) => void,
) => void;

/**
 * A natural size (an image's, a canvas's): one side given, the other follows
 * its aspect ratio.
 */
export function measureNatural(
  naturalWidth: number,
  naturalHeight: number,
  width: number,
  widthMode: number,
  height: number,
  heightMode: number,
  size: (width: number, height: number) => void,
): void {
  let w = naturalWidth;
  let h = naturalHeight;
  if (w > 0 && h > 0) {
    if (widthMode === MeasureMode.Exactly && heightMode !== MeasureMode.Exactly)
      [w, h] = [width, (width * naturalHeight) / naturalWidth];
    else if (
      heightMode === MeasureMode.Exactly &&
      widthMode !== MeasureMode.Exactly
    )
      [w, h] = [(height * naturalWidth) / naturalHeight, height];
  }
  size(constrain(w, width, widthMode), constrain(h, height, heightMode));
}

/** Who measures, by the id a Yoga node was given. Nothing in wasm holds them. */
const measures = new Map<number, Measure>();
let nextMeasure = 1;

/** The page's Yoga, measuring through `registerMeasure()`. */
export function pageYoga(): Yoga {
  const yoga = loadYoga();
  yoga.setMeasureHandler((id, width, widthMode, height, heightMode, size) => {
    const measure = measures.get(id);
    if (measure === undefined) size(0, 0);
    else measure(width, widthMode, height, heightMode, size);
  });
  return yoga;
}

/** Has `node` measured by `measure`; returns what forgets it. */
export function registerMeasure(
  yoga: Yoga,
  node: YogaNode,
  measure: Measure,
): () => void {
  const id = nextMeasure++;
  measures.set(id, measure);
  yoga.setMeasure(node, id);
  return () => measures.delete(id);
}
