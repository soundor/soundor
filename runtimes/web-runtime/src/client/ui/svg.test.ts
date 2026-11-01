// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { UiNode } from './node';
import { updateSemantics } from './semantics';
import { normalizeSvgScene, svgNaturalSize } from './svg-scene';
import type { SvgScene } from './types';
import { UiView } from './view';

let view: UiView | undefined;
afterEach(() => {
  view?.dispose();
  view = undefined;
  vi.restoreAllMocks();
});
const scene = (fill = 'red'): SvgScene => ({
  version: 1,
  viewBox: [10, 20, 100, 100],
  children: [
    {
      type: 'g',
      presentation: { fill, transform: [1, 0, 0, 1, 2, 3] },
      children: [
        { type: 'path', d: 'M10 20h80v80H10z' },
        { type: 'circle', cx: 50, cy: 60, r: 10 },
      ],
    },
  ],
});
function setup() {
  view = new UiView(document);
  view.mount(document.body);
  const svg = view.createNode('svg');
  view.root.appendChild(svg);
  return { svg, element: UiNode.elementOf(svg) as SVGSVGElement, view };
}

describe('retained SVG browser representation', () => {
  it('uses native SVG elements but only one Soundor UI node, with stable geometry on paint updates', () => {
    const { svg, element } = setup();
    svg.setSvgScene(scene());
    expect(element.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(element.tagName.toLowerCase()).toBe('svg');
    expect(svg.children).toEqual([]);
    const viewport = element.firstElementChild!;
    expect(viewport.getAttribute('viewBox')).toBe('10 20 100 100');
    const path = element.querySelector('path')!;
    const spy = vi.spyOn(path, 'setAttribute');
    svg.setSvgScene(scene('blue'));
    expect(element.querySelector('path')).toBe(path);
    expect(spy.mock.calls.some(([name]) => name === 'd')).toBe(false);
    expect(path.parentElement!.getAttribute('fill')).toBe('blue');
    svg.style = {
      width: 200,
      height: 100,
      borderRadius: 12,
      overflow: 'visible',
      transform: [{ scale: 1.5 }],
    };
    expect(element.style.overflow).toBe('hidden');
    expect(element.style.width).toBe('200px');
    expect(viewport.getAttribute('viewBox')).toBe('10 20 100 100');
    expect(spy.mock.calls.some(([name]) => name === 'd')).toBe(false);
  });

  it('replaces, reorders and clears shapes while keeping the viewport and UI node', () => {
    const { svg, element } = setup();
    svg.setSvgScene(scene());
    const viewport = element.firstElementChild;
    svg.setSvgScene({
      version: 1,
      children: [
        { type: 'circle', r: 4 },
        { type: 'rect', width: 8, height: 6 },
      ],
    });
    expect(element.querySelectorAll('path')).toHaveLength(0);
    expect(
      [...element.querySelector('svg > g')!.children].map((el) => el.localName),
    ).toEqual(['circle', 'rect']);
    svg.setSvgScene({
      version: 1,
      children: [
        { type: 'rect', width: 8, height: 6 },
        { type: 'circle', r: 4 },
      ],
    });
    expect(
      [...element.querySelector('svg > g')!.children].map((el) => el.localName),
    ).toEqual(['rect', 'circle']);
    svg.setSvgScene(null);
    expect(element.firstElementChild).toBe(viewport);
    expect(element.querySelectorAll('path,circle,rect')).toHaveLength(0);
    expect(element.getAttribute('width')).toBe('300');
    expect(svg.isConnected).toBe(true);
    expect(() => svg.appendChild(view!.createNode('view'))).toThrow(
      'only views',
    );
  });

  it('validates completely before changing DOM, including script/resource injection and cyclic input', () => {
    const { svg, element } = setup();
    svg.setSvgScene(scene());
    const before = element.outerHTML;
    for (const bad of [
      { version: 2, children: [] },
      { version: 1, viewBox: [0, 0, NaN, 1], children: [] },
      { version: 1, children: [{ type: 'script' }] },
      { version: 1, children: [{ type: 'path', d: 'M0 0L' }] },
      { version: 1, children: [{ type: 'circle', r: -1 }] },
      {
        version: 1,
        children: [
          {
            type: 'path',
            d: 'M0 0',
            presentation: { fill: 'url(https://example.invalid/a)' },
          },
        ],
      },
      { version: 1, children: [{ type: 'polygon', points: [1, 2, 3] }] },
      {
        version: 1,
        children: [{ type: 'g', presentation: { transform: [1, 2, 3] } }],
      },
      { version: 1, children: new Array(4096).fill({ type: 'g' }) },
      {
        version: 1,
        children: [{ type: 'path', d: ' '.repeat(256 * 1024 + 1) }],
      },
    ]) {
      expect(() => svg.setSvgScene(bad as SvgScene)).toThrow('SVG scene');
      expect(element.outerHTML).toBe(before);
    }
    const cyclic: Record<string, unknown> = { type: 'g' };
    cyclic['children'] = [cyclic];
    expect(() =>
      svg.setSvgScene({
        version: 1,
        children: [cyclic],
      } as unknown as SvgScene),
    ).toThrow('nesting');
    expect(element.outerHTML).toBe(before);
  });

  it('keeps root accessibility and hides every internal shape', () => {
    const { svg, element, view } = setup();
    svg.setSvgScene(scene());
    updateSemantics([view.root, view.overlay]);
    expect(element.getAttribute('aria-hidden')).toBe('true');
    svg.accessibility = { role: 'button', label: 'Vector control' };
    updateSemantics([view.root, view.overlay]);
    expect(element.getAttribute('role')).toBe('button');
    expect(element.getAttribute('aria-label')).toBe('Vector control');
    expect(element.getAttribute('aria-hidden')).not.toBe('true');
    expect(element.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    expect(svg.children).toHaveLength(0);
  });
});

describe('SVG scene validation contract', () => {
  it('uses the exact same validator in Web and the test runtime', () => {
    const a = readFileSync(resolve('src/client/ui/svg-scene.ts'), 'utf8');
    const b = readFileSync(
      resolve('../../packages/test-runtime/src/svg-scene.ts'),
      'utf8',
    );
    expect(a).toBe(b);
  });
  it('supports SVG commands, compact arc flags, colors, transforms and intrinsic ratios', () => {
    for (const d of [
      '',
      'M0 0L1 2h3v4C1 2 3 4 5 6s1 2 3 4Q1 2 3 4t1 2z',
      'M10 50A10 10 0 0110 70',
    ])
      expect(
        normalizeSvgScene({ version: 1, children: [{ type: 'path', d }] })
          .children,
      ).toHaveLength(1);
    for (const fill of [
      'none',
      'transparent',
      'currentColor',
      '#1234',
      '#12345678',
      'white',
      'rebeccapurple',
      'rgb(10 20 30 / 50%)',
      'hsl(120deg 50% 50% / .5)',
    ])
      expect(
        normalizeSvgScene({ version: 1, presentation: { fill }, children: [] })
          .presentation?.fill,
      ).toBe(fill);
    expect(svgNaturalSize(null)).toEqual([300, 150]);
    expect(
      svgNaturalSize({ version: 1, viewBox: [10, 20, 20, 20], children: [] }),
    ).toEqual([150, 150]);
    expect(
      svgNaturalSize({ version: 1, viewBox: [10, 20, 60, 10], children: [] }),
    ).toEqual([300, 50]);
  });
});
