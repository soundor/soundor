import type { SvgPresentation, SvgScene, SvgShape, UiNode } from 'soundor:ui';

type Props = Record<string, unknown>;
export const SvgTypes = {
  G: 'soundor-svg-g',
  Path: 'soundor-svg-path',
  Circle: 'soundor-svg-circle',
  Rect: 'soundor-svg-rect',
  Ellipse: 'soundor-svg-ellipse',
  Line: 'soundor-svg-line',
  Polygon: 'soundor-svg-polygon',
  Polyline: 'soundor-svg-polyline',
} as const;
export type VectorType = (typeof SvgTypes)[keyof typeof SvgTypes];
const TYPES: Readonly<Record<string, SvgShape['type']>> = {
  [SvgTypes.G]: 'g',
  [SvgTypes.Path]: 'path',
  [SvgTypes.Circle]: 'circle',
  [SvgTypes.Rect]: 'rect',
  [SvgTypes.Ellipse]: 'ellipse',
  [SvgTypes.Line]: 'line',
  [SvgTypes.Polygon]: 'polygon',
  [SvgTypes.Polyline]: 'polyline',
};
export function isVector(type: string): type is VectorType {
  return Object.hasOwn(TYPES, type);
}
const PRESENTATION = [
  'fill',
  'stroke',
  'color',
  'strokeWidth',
  'fillRule',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeMiterlimit',
  'strokeDasharray',
  'strokeDashoffset',
  'opacity',
  'fillOpacity',
  'strokeOpacity',
  'transform',
] as const;
const GEOMETRY: Readonly<Record<SvgShape['type'], readonly string[]>> = {
  g: [],
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polygon: ['points'],
  polyline: ['points'],
};
const ROOT_KEYS = [...PRESENTATION, 'viewBox', 'preserveAspectRatio'];
function same(a: unknown, b: unknown): boolean {
  return (
    Object.is(a, b) ||
    (Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i])))
  );
}
function changed(
  previous: Props | null,
  next: Props,
  keys: readonly string[],
): boolean {
  return (
    previous === null || keys.some((key) => !same(previous[key], next[key]))
  );
}
function invalid(field: string): never {
  throw new TypeError(`SVG: invalid ${field}; use finite numeric user units`);
}
function number(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e6
  )
    invalid('number');
  return value;
}
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const LIST = new RegExp(`^\\s*${NUMBER}(?:(?:\\s*,\\s*|\\s+)${NUMBER})*\\s*$`);
function numbers(value: unknown, max: number): number[] {
  if (typeof value === 'string') {
    if (value.length > 256 * 1024 || !LIST.test(value)) invalid('numeric list');
    value = value
      .trim()
      .split(/[\s,]+/)
      .map(Number);
  }
  if (!Array.isArray(value) || value.length > max) invalid('numeric list');
  const out: number[] = [];
  for (let i = 0; i < value.length; i++) out.push(number(value[i]));
  return out;
}
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function transform(value: unknown): Matrix {
  if (typeof value !== 'string') {
    const list = numbers(value, 6);
    if (list.length !== 6) invalid('transform');
    return list as unknown as Matrix;
  }
  if (value.length > 4096) invalid('transform');
  let result = IDENTITY,
    rest = value.trim(),
    count = 0;
  if (rest === '' || rest === 'none') return result;
  while (rest) {
    const match = /^([a-zA-Z]+)\s*\(([^()]*)\)\s*,?\s*/.exec(rest);
    if (!match || ++count > 64) invalid('transform');
    const args = numbers(match[2], 6),
      name = match[1];
    let matrix: Matrix;
    const angle = ((args[0] ?? 0) * Math.PI) / 180;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    switch (name) {
      case 'matrix':
        if (args.length !== 6) invalid('matrix');
        matrix = args as unknown as Matrix;
        break;
      case 'translate':
        if (args.length < 1 || args.length > 2) invalid('translate');
        matrix = [1, 0, 0, 1, args[0]!, args[1] ?? 0];
        break;
      case 'scale':
        if (args.length < 1 || args.length > 2) invalid('scale');
        matrix = [args[0]!, 0, 0, args[1] ?? args[0]!, 0, 0];
        break;
      case 'rotate': {
        if (args.length !== 1 && args.length !== 3) invalid('rotate');
        const x = args[1] ?? 0,
          y = args[2] ?? 0;
        matrix = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
        break;
      }
      case 'skewX':
        if (args.length !== 1) invalid('skewX');
        matrix = [1, 0, Math.tan(angle), 1, 0, 0];
        break;
      case 'skewY':
        if (args.length !== 1) invalid('skewY');
        matrix = [1, Math.tan(angle), 0, 1, 0, 0];
        break;
      default:
        invalid('transform function');
    }
    result = multiply(result, matrix);
    result.forEach(number);
    rest = rest.slice(match[0].length);
  }
  return result;
}
function presentation(props: Props): SvgPresentation | undefined {
  const out: Props = {};
  for (const key of PRESENTATION) {
    const value = props[key];
    if (value === undefined) continue;
    if (key === 'transform') out[key] = transform(value);
    else if (key === 'strokeDasharray')
      out[key] = value === 'none' || value === '' ? [] : numbers(value, 4096);
    else out[key] = value;
  }
  return Object.keys(out).length ? (out as SvgPresentation) : undefined;
}
function shape(type: VectorType, props: Props): SvgShape {
  const name = TYPES[type]!;
  const out: Props = { type: name };
  for (const key of GEOMETRY[name]) {
    const value = props[key];
    if (value !== undefined) {
      if (key === 'points') {
        const points =
          typeof value === 'string' && value.trim() === ''
            ? []
            : numbers(value, 65536);
        if (points.length % 2) invalid('points');
        out[key] = points;
      } else if (key === 'd') {
        if (typeof value !== 'string' || value.length > 256 * 1024)
          invalid('path data');
        out[key] = value;
      } else out[key] = number(value);
    }
  }
  const paint = presentation(props);
  if (paint) out['presentation'] = paint;
  return out as SvgShape;
}
function base(props: Props): Omit<SvgScene, 'children'> {
  const out: Props = { version: 1 };
  if (props['viewBox'] !== undefined) {
    const box = numbers(props['viewBox'], 4);
    if (box.length !== 4 || box[2]! <= 0 || box[3]! <= 0) invalid('viewBox');
    out['viewBox'] = box;
  }
  if (props['preserveAspectRatio'] !== undefined)
    out['preserveAspectRatio'] = props['preserveAspectRatio'];
  const paint = presentation(props);
  if (paint) out['presentation'] = paint;
  return out as Omit<SvgScene, 'children'>;
}

const dirty = new Set<SvgRoot>();
export const svgRoots = new WeakMap<UiNode, SvgRoot>();
type Parent = SvgRoot | VectorInstance;
function rootOf(parent: Parent | null): SvgRoot | null {
  while (parent instanceof VectorInstance) parent = parent.parent;
  return parent;
}
export class VectorInstance {
  readonly kind = 'vector';
  readonly children: VectorInstance[] = [];
  parent: Parent | null = null;
  hidden = false;
  data: SvgShape | null = null;
  props: Props | null = null;
  constructor(
    readonly type: VectorType | '#text',
    props: Props,
  ) {
    if (type !== '#text') this.update(props);
  }
  update(next: Props): void {
    if (this.type === '#text') return;
    if (
      changed(this.props, next, [
        ...PRESENTATION,
        ...GEOMETRY[TYPES[this.type]!],
      ])
    ) {
      this.data = shape(this.type, next);
      rootOf(this.parent)?.touch();
    }
    this.props = next;
  }
  text(value: string): void {
    if (value.trim() !== '')
      throw new Error('SVG text is not supported; place Text outside Svg');
  }
  dispose(): void {
    for (const child of this.children) child.dispose();
    this.children.length = 0;
    this.parent = null;
    this.props = null;
    this.data = null;
  }
}
export class SvgRoot {
  readonly children: VectorInstance[] = [];
  committed = false;
  props: Props | null = null;
  data: Omit<SvgScene, 'children'> = { version: 1 };
  constructor(readonly node: UiNode) {
    svgRoots.set(node, this);
  }
  update(next: Props): void {
    if (changed(this.props, next, ROOT_KEYS)) {
      this.data = base(next);
      this.touch();
    }
    this.props = next;
  }
  touch(): void {
    if (this.committed) dirty.add(this);
  }
  mount(): void {
    if (!this.committed) {
      this.committed = true;
      this.touch();
    }
  }
  clear(): void {
    dirty.delete(this);
    if (this.committed) this.node.setSvgScene(null);
    this.committed = false;
    for (const child of this.children) child.dispose();
    this.children.length = 0;
    this.props = null;
    this.data = { version: 1 };
  }
}
export function insertVector(
  parent: Parent,
  child: VectorInstance,
  before: VectorInstance | null,
): void {
  if (
    parent instanceof VectorInstance &&
    parent.type !== SvgTypes.G &&
    child.type !== '#text'
  )
    throw new Error('Only G can contain SVG shapes');
  if (child.parent) removeVector(child.parent, child);
  const index = before === null ? -1 : parent.children.indexOf(before);
  if (index < 0) parent.children.push(child);
  else parent.children.splice(index, 0, child);
  child.parent = parent;
  rootOf(parent)?.touch();
}
export function removeVector(parent: Parent, child: VectorInstance): void {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
  child.parent = null;
  rootOf(parent)?.touch();
}
function snapshot(
  children: readonly VectorInstance[],
  budget = { nodes: 1 },
  depth = 1,
): SvgShape[] {
  if (depth > 64) throw new RangeError('SVG scene exceeds 64 nesting levels');
  const out: SvgShape[] = [];
  for (const child of children) {
    if (child.hidden || child.data === null) continue;
    if (++budget.nodes > 4096)
      throw new RangeError('SVG scene exceeds 4096 nodes');
    out.push(
      child.type === SvgTypes.G
        ? ({
            ...child.data,
            children: snapshot(child.children, budget, depth + 1),
          } as SvgShape)
        : child.data,
    );
  }
  return out;
}
/** Called once after a React mutation commit, never while rendering a work-in-progress tree. */
export function publishSvgScenes(): void {
  if (dirty.size === 0) return;
  const roots = [...dirty];
  dirty.clear();
  for (const root of roots)
    if (root.committed)
      root.node.setSvgScene({
        ...root.data,
        children: snapshot(root.children),
      });
}
export function touchVector(instance: VectorInstance): void {
  rootOf(instance.parent)?.touch();
}
