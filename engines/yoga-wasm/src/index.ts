/**
 * `@soundor/yoga-wasm`: the Yoga that `@soundor/engine` links, its revision and
 * its patches, as WebAssembly. Yoga's C API is called directly: a node is the
 * integer its pointer is, freed with `YGNodeFree`.
 *
 * The module is small enough to compile on the main thread, so `loadYoga()` is
 * synchronous and a runtime's own modules can use it as they evaluate.
 */

import wasmBase64 from '../generated/yoga-wasm.ts';

/** A Yoga config's address in the module's memory. */
export type YogaConfig = number;
/** A Yoga node's address in the module's memory. */
export type YogaNode = number;

// Yoga's enums (yoga/YGEnums.h).
export const Align = {
  Auto: 0,
  FlexStart: 1,
  Center: 2,
  FlexEnd: 3,
  Stretch: 4,
  Baseline: 5,
  SpaceBetween: 6,
  SpaceAround: 7,
  SpaceEvenly: 8,
} as const;
export const BoxSizing = { BorderBox: 0, ContentBox: 1 } as const;
export const Direction = { Inherit: 0, LTR: 1, RTL: 2 } as const;
export const Display = { Flex: 0, None: 1, Contents: 2 } as const;
export const Edge = {
  Left: 0,
  Top: 1,
  Right: 2,
  Bottom: 3,
} as const;
export const FlexDirection = {
  Column: 0,
  ColumnReverse: 1,
  Row: 2,
  RowReverse: 3,
} as const;
export const Gutter = { Column: 0, Row: 1, All: 2 } as const;
export const Justify = {
  FlexStart: 0,
  Center: 1,
  FlexEnd: 2,
  SpaceBetween: 3,
  SpaceAround: 4,
  SpaceEvenly: 5,
} as const;
export const MeasureMode = { Undefined: 0, Exactly: 1, AtMost: 2 } as const;
export const NodeType = { Default: 0, Text: 1 } as const;
export const Overflow = { Visible: 0, Hidden: 1, Scroll: 2 } as const;
export const PositionType = { Static: 0, Relative: 1, Absolute: 2 } as const;
export const Wrap = { NoWrap: 0, Wrap: 1, WrapReverse: 2 } as const;

/**
 * Measures the node registered as `id` (see {@link Yoga.setMeasure}): returns
 * its size by calling `size(width, height)`, as a measure function must not
 * allocate on every call of a layout.
 */
export type MeasureHandler = (
  id: number,
  width: number,
  widthMode: number,
  height: number,
  heightMode: number,
  size: (width: number, height: number) => void,
) => void;

type NodeSetter = (node: YogaNode, value: number) => void;
type NodeUnset = (node: YogaNode) => void;
type EdgeSetter = (node: YogaNode, edge: number, value: number) => void;
type EdgeUnset = (node: YogaNode, edge: number) => void;
type EdgeGetter = (node: YogaNode, edge: number) => number;
type NodeGetter = (node: YogaNode) => number;

/** Yoga's C API, as `yoga/Yoga.h` declares it; booleans as 0 and 1. */
export interface YogaApi {
  YGConfigNew(): YogaConfig;
  YGConfigFree(config: YogaConfig): void;
  YGConfigSetPointScaleFactor(config: YogaConfig, scale: number): void;

  YGNodeNewWithConfig(config: YogaConfig): YogaNode;
  YGNodeFree: NodeUnset;
  YGNodeInsertChild(parent: YogaNode, child: YogaNode, index: number): void;
  YGNodeRemoveChild(parent: YogaNode, child: YogaNode): void;
  YGNodeRemoveAllChildren: NodeUnset;
  YGNodeCalculateLayout(
    node: YogaNode,
    width: number,
    height: number,
    direction: number,
  ): void;
  YGNodeMarkDirty: NodeUnset;
  YGNodeIsDirty: NodeGetter;
  YGNodeGetHasNewLayout: NodeGetter;
  YGNodeSetHasNewLayout: NodeSetter;
  YGNodeSetNodeType: NodeSetter;

  YGNodeStyleSetDisplay: NodeSetter;
  YGNodeStyleSetPositionType: NodeSetter;
  YGNodeStyleSetFlexDirection: NodeSetter;
  YGNodeStyleSetFlexWrap: NodeSetter;
  YGNodeStyleSetJustifyContent: NodeSetter;
  YGNodeStyleSetAlignItems: NodeSetter;
  YGNodeStyleSetAlignSelf: NodeSetter;
  YGNodeStyleSetAlignContent: NodeSetter;
  YGNodeStyleSetFlexGrow: NodeSetter;
  YGNodeStyleSetFlexShrink: NodeSetter;
  YGNodeStyleSetFlexBasis: NodeSetter;
  YGNodeStyleSetFlexBasisPercent: NodeSetter;
  YGNodeStyleSetFlexBasisAuto: NodeUnset;
  YGNodeStyleSetWidth: NodeSetter;
  YGNodeStyleSetWidthPercent: NodeSetter;
  YGNodeStyleSetWidthAuto: NodeUnset;
  YGNodeStyleSetHeight: NodeSetter;
  YGNodeStyleSetHeightPercent: NodeSetter;
  YGNodeStyleSetHeightAuto: NodeUnset;
  YGNodeStyleSetMinWidth: NodeSetter;
  YGNodeStyleSetMinWidthPercent: NodeSetter;
  YGNodeStyleSetMinHeight: NodeSetter;
  YGNodeStyleSetMinHeightPercent: NodeSetter;
  YGNodeStyleSetMaxWidth: NodeSetter;
  YGNodeStyleSetMaxWidthPercent: NodeSetter;
  YGNodeStyleSetMaxHeight: NodeSetter;
  YGNodeStyleSetMaxHeightPercent: NodeSetter;
  YGNodeStyleSetAspectRatio: NodeSetter;
  YGNodeStyleSetBoxSizing: NodeSetter;
  YGNodeStyleSetMargin: EdgeSetter;
  YGNodeStyleSetMarginPercent: EdgeSetter;
  YGNodeStyleSetMarginAuto: EdgeUnset;
  YGNodeStyleSetPadding: EdgeSetter;
  YGNodeStyleSetPaddingPercent: EdgeSetter;
  YGNodeStyleSetPosition: EdgeSetter;
  YGNodeStyleSetPositionPercent: EdgeSetter;
  YGNodeStyleSetPositionAuto: EdgeUnset;
  YGNodeStyleSetBorder: EdgeSetter;
  YGNodeStyleSetGap(node: YogaNode, gutter: number, value: number): void;
  YGNodeStyleSetOverflow: NodeSetter;

  YGNodeLayoutGetLeft: NodeGetter;
  YGNodeLayoutGetTop: NodeGetter;
  YGNodeLayoutGetWidth: NodeGetter;
  YGNodeLayoutGetHeight: NodeGetter;
  YGNodeLayoutGetMargin: EdgeGetter;
  YGNodeLayoutGetPadding: EdgeGetter;
  YGNodeLayoutGetBorder: EdgeGetter;
}

export interface Yoga extends YogaApi {
  /** Has `node` measured by the handler, as `id`. */
  setMeasure(node: YogaNode, id: number): void;
  /** Who measures the nodes given a measure id. */
  setMeasureHandler(handler: MeasureHandler | null): void;
}

/**
 * The WASI functions libc links, none of which Yoga's layout needs: stdio is
 * only its logger, "not supported" (52) here. Entropy succeeds, zeroed: libc
 * aborts when it fails, and nothing here depends on it being random.
 */
const ENOSYS = 52;
const wasiStub = (name: string): (() => number) =>
  name === 'random_get' ? () => 0 : () => ENOSYS;

function instantiate(): Yoga {
  const binary = atob(wasmBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const module = new WebAssembly.Module(bytes);

  let handler: MeasureHandler | null = null;
  let memory: WebAssembly.Memory | undefined;
  let result = 0;
  const size = (width: number, height: number): void => {
    const floats = new Float32Array(memory!.buffer, result, 2);
    floats[0] = width;
    floats[1] = height;
  };
  const measure = (
    id: number,
    width: number,
    widthMode: number,
    height: number,
    heightMode: number,
    out: number,
  ): void => {
    if (handler === null) throw new Error('Yoga has no measure handler');
    result = out;
    handler(id, width, widthMode, height, heightMode, size);
  };

  const wasi: Record<string, () => number> = {};
  for (const { module: from, name } of WebAssembly.Module.imports(module))
    if (from === 'wasi_snapshot_preview1') wasi[name] = wasiStub(name);
  const { exports } = new WebAssembly.Instance(module, {
    env: { measure },
    wasi_snapshot_preview1: wasi,
  });
  memory = exports.memory as WebAssembly.Memory;
  (exports._initialize as () => void)();

  const setMeasure = exports.soundorSetMeasure as Yoga['setMeasure'];
  return Object.freeze({
    ...(exports as unknown as YogaApi),
    setMeasure,
    setMeasureHandler(next: MeasureHandler | null): void {
      handler = next;
    },
  });
}

let yoga: Yoga | undefined;

/** This page's Yoga, compiled on first use. */
export function loadYoga(): Yoga {
  yoga ??= instantiate();
  return yoga;
}
