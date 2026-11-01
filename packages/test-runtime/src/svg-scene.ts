// Portable, bounded scene validation. Kept identical in the test runtime.
// This validates path grammar only; browser SVG and Skia own all geometry.
import type { SvgPresentation, SvgScene, SvgShape } from './types';

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NUMBER_FULL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const GEOMETRY = {
  g: [],
  path: [],
  circle: ['cx', 'cy', 'r'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polygon: [],
  polyline: [],
} as const;
const NUMERIC = [
  'strokeWidth',
  'strokeMiterlimit',
  'strokeDashoffset',
  'opacity',
  'fillOpacity',
  'strokeOpacity',
] as const;
const ENUMS = {
  fillRule: ['nonzero', 'evenodd'],
  strokeLinecap: ['butt', 'round', 'square'],
  strokeLinejoin: ['miter', 'round', 'bevel'],
} as const;

function fail(field: string): never {
  throw new TypeError(`SVG scene: invalid or excessive ${field}`);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('object');
  return value as Record<string, unknown>;
}

// Named colors match the engine's existing CSS color vocabulary.
const COLOR_NAMES =
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen';
let names: Set<string> | undefined;
function color(value: string, paint: boolean): boolean {
  const text = value.trim().toLowerCase();
  if (
    text === 'currentcolor' ||
    text === 'transparent' ||
    (paint && text === 'none')
  )
    return true;
  names ??= new Set(COLOR_NAMES.split(' '));
  if (
    names.has(text) ||
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text)
  )
    return true;
  const match = /^(rgba?|hsla?)\((.*)\)$/.exec(text);
  if (!match) return false;
  const parts = match[2]!.trim().split(/\s*[,/]\s*|\s+/);
  if (parts.length !== 3 && parts.length !== 4) return false;
  const hsl = match[1]!.startsWith('hsl');
  return parts.every((part, index) => {
    if (hsl && index === 0) part = part.replace(/deg$/, '');
    if (hsl && (index === 1 || index === 2) && !part.endsWith('%'))
      return false;
    part = part.replace(/%$/, '');
    return NUMBER_FULL.test(part) && Number.isFinite(Number(part));
  });
}

/** Clones into a validated snapshot; no input object or array is retained. */
export function normalizeSvgScene(input: unknown): SvgScene {
  let nodes = 1,
    numbers = 0,
    bytes = 0;
  const numeric = (value: unknown): number => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      Math.abs(value) > 1e6 ||
      ++numbers > 65536
    )
      fail('coordinate');
    return Math.fround(value);
  };
  const text = (value: unknown, limit = 128): string => {
    if (
      typeof value !== 'string' ||
      value.length > limit ||
      value.includes('\0')
    )
      fail('string');
    // UTF-8 length without depending on browser globals in a test runtime.
    bytes += value.length;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        value.charCodeAt(i + 1) >= 0xdc00 &&
        value.charCodeAt(i + 1) <= 0xdfff
      ) {
        bytes += 2;
        i++;
      } else if (code > 0x7ff) bytes += 2;
      else if (code > 0x7f) bytes++;
    }
    if (bytes > 1024 * 1024) fail('scene bytes');
    return value;
  };
  const array = (value: unknown, max: number): unknown[] => {
    if (!Array.isArray(value)) fail('array');
    const size = value.length;
    if (!Number.isInteger(size) || size < 0 || size > max) fail('array');
    // Snapshot bounded indices into a dense ordinary array. Array.map skips
    // holes and an input's own map method must not bypass validation.
    const result: unknown[] = [];
    for (let index = 0; index < size; index++) result[index] = value[index];
    return result;
  };
  const tuple = (value: unknown, count: number): number[] => {
    const given = array(value, count);
    if (given.length !== count) fail('tuple');
    return given.map(numeric);
  };
  const path = (value: string) => {
    let at = 0,
      command = '';
    const skip = () => {
      while (at < value.length && /[ \t\r\n\f,]/.test(value[at]!)) at++;
    };
    skip();
    if (at < value.length && value[at]!.toUpperCase() !== 'M')
      fail('path data');
    while (at < value.length) {
      const char = value[at]!;
      if (/[a-z]/i.test(char)) {
        command = char.toUpperCase();
        at++;
        skip();
        if (command === 'Z') {
          command = '';
          continue;
        }
      }
      const count = (
        { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 } as Record<
          string,
          number
        >
      )[command];
      if (!count) fail('path command');
      for (let i = 0; i < count; i++) {
        skip();
        if (command === 'A' && (i === 3 || i === 4)) {
          if (value[at] !== '0' && value[at] !== '1') fail('arc flag');
          numeric(Number(value[at++]));
        } else {
          const match = NUMBER.exec(value.slice(at));
          if (!match) fail('path data');
          numeric(Number(match[0]));
          at += match[0].length;
        }
      }
      if (command === 'M') command = 'L';
      skip();
    }
  };
  const presentation = (value: unknown): SvgPresentation | undefined => {
    if (value === undefined) return undefined;
    const given = object(value),
      result: Record<string, unknown> = {};
    for (const key of ['fill', 'stroke', 'color'] as const)
      if (given[key] !== undefined) {
        const paint = text(given[key]);
        if (!color(paint, key !== 'color')) fail(key);
        result[key] = paint;
      }
    for (const key of NUMERIC)
      if (given[key] !== undefined) {
        const val = numeric(given[key]);
        if (
          (key === 'strokeWidth' && val < 0) ||
          (key === 'strokeMiterlimit' && val < 1)
        )
          fail(key);
        result[key] = val;
      }
    for (const [key, options] of Object.entries(ENUMS))
      if (given[key] !== undefined) {
        const val = text(given[key]);
        if (!(options as readonly string[]).includes(val)) fail(key);
        result[key] = val;
      }
    if (given['strokeDasharray'] !== undefined)
      result['strokeDasharray'] = array(given['strokeDasharray'], 4096).map(
        (val) => {
          const num = numeric(val);
          if (num < 0) fail('strokeDasharray');
          return num;
        },
      );
    if (given['transform'] !== undefined)
      result['transform'] = tuple(given['transform'], 6);
    return result as SvgPresentation;
  };
  type Matrix = readonly number[];
  const multiply = (a: Matrix, b: Matrix): Matrix => {
    const result = [
      a[0]! * b[0]! + a[2]! * b[1]!,
      a[1]! * b[0]! + a[3]! * b[1]!,
      a[0]! * b[2]! + a[2]! * b[3]!,
      a[1]! * b[2]! + a[3]! * b[3]!,
      a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
      a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
    ];
    if (result.some((val) => !Number.isFinite(val) || Math.abs(val) > 1e12))
      fail('accumulated transform');
    return result;
  };
  const identity = [1, 0, 0, 1, 0, 0];
  const children = (
    value: unknown,
    depth: number,
    parent: Matrix,
  ): SvgShape[] => {
    if (value === undefined) return [];
    if (depth > 64) fail('nesting');
    const items = array(value, 4096 - nodes);
    nodes += items.length;
    return items.map((item) => {
      const given = object(item),
        type = given['type'];
      if (typeof type !== 'string' || !Object.hasOwn(GEOMETRY, type))
        fail('shape type');
      const props = presentation(given['presentation']);
      const matrix = multiply(parent, props?.transform ?? identity);
      const result: Record<string, unknown> = { type };
      if (props) result['presentation'] = props;
      for (const key of GEOMETRY[type as keyof typeof GEOMETRY])
        if (given[key] !== undefined) {
          const val = numeric(given[key]);
          if (['r', 'rx', 'ry', 'width', 'height'].includes(key) && val < 0)
            fail(key);
          result[key] = val;
        }
      if (type === 'path') {
        const data =
          given['d'] === undefined ? '' : text(given['d'], 256 * 1024);
        path(data);
        result['d'] = data;
      }
      if (type === 'polygon' || type === 'polyline') {
        const points =
          given['points'] === undefined
            ? []
            : array(given['points'], 65536).map(numeric);
        if (points.length % 2 !== 0) fail('points');
        result['points'] = points;
      }
      if (type === 'g')
        result['children'] = children(given['children'], depth + 1, matrix);
      else if (
        given['children'] !== undefined &&
        array(given['children'], 0).length
      )
        fail('shape children');
      return result as unknown as SvgShape;
    });
  };
  const root = object(input);
  if (root['version'] !== 1) fail('version (expected 1)');
  const result: SvgScene = { version: 1, children: [] };
  const out = result as unknown as Record<string, unknown>;
  if (root['viewBox'] !== undefined) {
    const box = tuple(root['viewBox'], 4);
    if (
      box[2]! <= 0 ||
      box[3]! <= 0 ||
      Math.fround(box[2]! / box[3]!) <= 0 ||
      !Number.isFinite(Math.fround(box[2]! / box[3]!))
    )
      fail('viewBox');
    out['viewBox'] = box;
  }
  if (root['preserveAspectRatio'] !== undefined) {
    const ratio = text(root['preserveAspectRatio']).trim();
    if (
      !/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(
        ratio,
      )
    )
      fail('preserveAspectRatio');
    out['preserveAspectRatio'] = ratio;
  }
  const props = presentation(root['presentation']);
  if (props) out['presentation'] = props;
  out['children'] = children(root['children'], 1, props?.transform ?? identity);
  return result;
}

/** Intrinsic fallback: viewBox supplies a ratio, never intrinsic pixels. */
export function svgNaturalSize(
  scene: SvgScene | null,
): readonly [number, number] {
  const box = scene?.viewBox;
  if (!box) return [300, 150];
  const ratio = box[2] / box[3],
    width = Math.min(300, 150 * ratio);
  return [width, width / ratio];
}
