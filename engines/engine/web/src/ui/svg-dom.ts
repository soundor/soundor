import { svgNaturalSize } from './svg-scene';
import type { SvgPresentation, SvgScene, SvgShape } from './types';

export const SVG_NS = 'http://www.w3.org/2000/svg';
const PRESENTATION = {
  fill: 'fill',
  stroke: 'stroke',
  color: 'color',
  strokeWidth: 'stroke-width',
  fillRule: 'fill-rule',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  opacity: 'opacity',
  fillOpacity: 'fill-opacity',
  strokeOpacity: 'stroke-opacity',
  transform: 'transform',
} as const;
const DEFAULTS: SvgPresentation = {
  fill: 'black',
  stroke: 'none',
  color: 'black',
  strokeWidth: 1,
  fillRule: 'nonzero',
  strokeLinecap: 'butt',
  strokeLinejoin: 'miter',
  strokeMiterlimit: 4,
  strokeDasharray: [],
  strokeDashoffset: 0,
  opacity: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
};
const GEOMETRY = [
  'd',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'width',
  'height',
  'rx',
  'ry',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
];
function attribute(
  element: Element,
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value)
    element.setAttribute(name, value);
}
function presentation(
  element: Element,
  props: SvgPresentation = {},
  root = false,
): void {
  const values = root ? { ...DEFAULTS, ...props } : props;
  for (const [key, attr] of Object.entries(PRESENTATION)) {
    const value = values[key as keyof SvgPresentation];
    let text: string | undefined;
    if (value !== undefined) {
      if (key === 'transform')
        text = `matrix(${(value as readonly number[]).join(' ')})`;
      else if (key === 'strokeDasharray') {
        const dash = value as readonly number[];
        text = dash.every((length) => length === 0) ? 'none' : dash.join(' ');
      } else text = String(value);
    }
    attribute(element, attr, text);
  }
}

/** A browser vector representation of one scene, never Soundor child nodes. */
export class SvgDom {
  readonly #viewport: SVGSVGElement;
  readonly #group: SVGGElement;
  constructor(readonly element: SVGSVGElement) {
    const document = element.ownerDocument;
    this.#viewport = document.createElementNS(SVG_NS, 'svg');
    this.#viewport.setAttribute('width', '100%');
    this.#viewport.setAttribute('height', '100%');
    this.#viewport.style.overflow = 'hidden';
    this.#viewport.style.pointerEvents = 'none';
    this.#viewport.setAttribute('aria-hidden', 'true');
    this.#group = document.createElementNS(SVG_NS, 'g');
    this.#viewport.append(this.#group);
    element.append(this.#viewport);
    this.update(null);
  }

  update(scene: SvgScene | null): void {
    const [width, height] = svgNaturalSize(scene);
    attribute(this.element, 'width', String(width));
    attribute(this.element, 'height', String(height));
    attribute(this.#viewport, 'viewBox', scene?.viewBox?.join(' '));
    attribute(
      this.#viewport,
      'preserveAspectRatio',
      scene?.preserveAspectRatio ?? 'xMidYMid meet',
    );
    presentation(this.#group, scene?.presentation, true);
    this.#children(this.#group, scene?.children ?? []);
  }

  #children(parent: SVGElement, shapes: readonly SvgShape[]): void {
    shapes.forEach((shape, index) => {
      let element = parent.children[index] as SVGElement | undefined;
      if (!element || element.localName !== shape.type) {
        const replacement = parent.ownerDocument.createElementNS(
          SVG_NS,
          shape.type,
        );
        if (element) element.replaceWith(replacement);
        else parent.append(replacement);
        element = replacement;
      }
      // Leave unchanged d/points/geometry attributes alone on paint updates.
      // The browser retains its own parsed geometry across draws and resizes.
      const data = shape as unknown as Record<string, unknown>;
      for (const key of GEOMETRY) {
        const value = data[key];
        attribute(
          element,
          key,
          value === undefined
            ? undefined
            : Array.isArray(value)
              ? value.join(' ')
              : String(value),
        );
      }
      presentation(element, shape.presentation);
      this.#children(element, shape.type === 'g' ? (shape.children ?? []) : []);
    });
    while (parent.children.length > shapes.length)
      parent.lastElementChild!.remove();
  }
}
