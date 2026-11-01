import type { LayoutRect } from './types';

export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(x: Matrix, y: Matrix): Matrix {
  return [
    x[0] * y[0] + x[2] * y[1],
    x[1] * y[0] + x[3] * y[1],
    x[0] * y[2] + x[2] * y[3],
    x[1] * y[2] + x[3] * y[3],
    x[0] * y[4] + x[2] * y[5] + x[4],
    x[1] * y[4] + x[3] * y[5] + x[5],
  ];
}
export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export function inversePoint(
  matrix: Matrix,
  x: number,
  y: number,
): { x: number; y: number } {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (Math.abs(determinant) < 1e-12) return { x: Infinity, y: Infinity };
  const dx = x - matrix[4],
    dy = y - matrix[5];
  return {
    x: (matrix[3] * dx - matrix[2] * dy) / determinant,
    y: (-matrix[1] * dx + matrix[0] * dy) / determinant,
  };
}
export function computedTransform(element: HTMLElement | SVGElement): Matrix {
  const text =
    element.ownerDocument.defaultView!.getComputedStyle(element).transform;
  if (!text || text === 'none') return IDENTITY;
  const match = /^matrix\((.*)\)$/.exec(text);
  if (match) return match[1]!.split(',').map(Number) as unknown as Matrix;
  const three = /^matrix3d\((.*)\)$/.exec(text);
  if (three) {
    const values = three[1]!.split(',').map(Number);
    return [
      values[0]!,
      values[1]!,
      values[4]!,
      values[5]!,
      values[12]!,
      values[13]!,
    ];
  }
  // DOM test environments may return authored transforms rather than matrices.
  let result = IDENTITY;
  for (const operation of text.matchAll(
    /(translateX|translateY|scale|scaleX|scaleY|rotate)\(([^)]+)\)/g,
  )) {
    const key = operation[1]!,
      input = operation[2]!;
    let value = Number.parseFloat(input);
    if (key === 'rotate' && input.endsWith('deg')) value *= Math.PI / 180;
    const next: Matrix =
      key === 'translateX'
        ? translation(value, 0)
        : key === 'translateY'
          ? translation(0, value)
          : key === 'rotate'
            ? [
                Math.cos(value),
                Math.sin(value),
                -Math.sin(value),
                Math.cos(value),
                0,
                0,
              ]
            : [
                key === 'scaleY' ? 1 : value,
                0,
                0,
                key === 'scaleX' ? 1 : value,
                0,
                0,
              ];
    result = multiply(result, next);
  }
  return result;
}

function origin(
  element: HTMLElement,
  viewport: HTMLElement,
): { x: number; y: number } {
  let x = 0,
    y = 0;
  for (
    let current: HTMLElement | null = element;
    current && current !== viewport;
    current = current.offsetParent as HTMLElement | null
  ) {
    x += current.offsetLeft;
    y += current.offsetTop;
    const parent = current.offsetParent as HTMLElement | null;
    if (parent && parent !== viewport) {
      x += parent.clientLeft;
      y += parent.clientTop;
    }
  }
  return { x, y };
}

/** Layout metrics never include presentation transforms or scrolling. */
export function logicalLayout(
  element: HTMLElement,
  parent: HTMLElement | null,
  viewport: HTMLElement,
): LayoutRect {
  const at = origin(element, viewport),
    from = parent ? origin(parent, viewport) : { x: 0, y: 0 };
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  return {
    x: at.x - from.x,
    y: at.y - from.y,
    width: Number.parseFloat(style.width) || element.offsetWidth,
    height: Number.parseFloat(style.height) || element.offsetHeight,
  };
}
