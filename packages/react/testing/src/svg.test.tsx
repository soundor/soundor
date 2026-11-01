import { createRoot, flushSync, FocusScope, Text, View } from '@soundor/react';
import * as ReactApi from '@soundor/react';
import {
  Svg,
  G,
  Path,
  Circle,
  Rect,
  Line,
  Ellipse,
  Polygon,
  Polyline,
} from '@soundor/react/svg';
import { getTestRuntime, type TestNode } from '@soundor/test-runtime';
import {
  render,
  fireEvent,
  screen,
  act,
  userEvent,
} from '@soundor/testing-library/react';
import { createRef, Fragment, useState, type ReactNode } from 'react';
import type { UiNode } from 'soundor:ui';
import { root } from 'soundor:ui';
import { describe, expect, it, vi } from 'vitest';

const mount = (element: ReactNode) => render(element, { container: root });
const node = () => root.children[0] as unknown as TestNode;
function Marker({ color }: { color: string }) {
  return <Circle cx={12} cy={12} r={6} fill={color} />;
}

describe('@soundor/react/svg', () => {
  it('exports an independent subpath and creates only one UI node for all vector primitives', async () => {
    expect('Svg' in ReactApi).toBe(false);
    await mount(
      <Svg
        width={100}
        height={80}
        viewBox="10 20 100 80"
        preserveAspectRatio="xMinYMax slice"
        fill="none"
        color="white"
      >
        <G
          stroke="currentColor"
          strokeWidth={2}
          transform="translate(10 20) rotate(90) scale(2)"
        >
          <Path
            d="M0 0 A10 10 0 0110 20"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={10} cy={10} r={5} />
          <Rect x={1} y={2} width={10} height={12} rx={2} />
          <Ellipse cx={20} cy={20} rx={4} ry={6} />
          <Line x1={0} y1={0} x2={10} y2={20} />
          <Polygon points="0,0 10,0 10,10" />
          <Polyline
            points={[0, 0, 20, 20]}
            strokeDasharray="2, 3 4"
            strokeDashoffset={1}
          />
        </G>
      </Svg>,
    );
    const svg = node();
    expect(svg.type).toBe('svg');
    expect(svg.children).toEqual([]);
    expect(getTestRuntime().nodes.size).toBe(3);
    expect(svg.svgSceneUpdates).toBe(1);
    expect(svg.svgScene?.viewBox).toEqual([10, 20, 100, 80]);
    expect(svg.svgScene?.preserveAspectRatio).toBe('xMinYMax slice');
    const group = svg.svgScene!.children[0]!;
    expect(group.type).toBe('g');
    if (group.type !== 'g') throw new Error('expected group');
    expect(group.presentation).toMatchObject({
      stroke: 'currentColor',
      strokeWidth: 2,
    });
    const matrix = group.presentation!.transform!;
    [0, 2, -2, 0, 10, 20].forEach((value, index) =>
      expect(matrix[index]).toBeCloseTo(value),
    );
    expect(group.children?.map((shape) => shape.type)).toEqual([
      'path',
      'circle',
      'rect',
      'ellipse',
      'line',
      'polygon',
      'polyline',
    ]);
    expect(group.children?.[5]).toMatchObject({
      points: [0, 0, 10, 0, 10, 10],
    });
    expect(group.children?.[6]).toMatchObject({
      presentation: { strokeDasharray: [2, 3, 4], strokeDashoffset: 1 },
    });
  });

  it('reconciles nested components, fragments, conditionals and keyed insertion/removal/reordering', async () => {
    const picture = (order: number[], marker: boolean) => (
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <G fill="currentColor" color="red">
          <> {marker && <Marker color="blue" />}</>
        </G>
        {order.map((value) => (
          <Fragment key={value}>
            <Circle cx={value} r={1} />
          </Fragment>
        ))}
      </Svg>
    );
    const mounted = await mount(picture([1, 2, 3], true));
    const svg = node();
    expect(svg.svgScene?.children[0]).toMatchObject({
      type: 'g',
      children: [{ type: 'circle', presentation: { fill: 'blue' } }],
    });
    await mounted.rerender(picture([3, 1, 4], false));
    expect(node()).toBe(svg);
    expect(svg.svgScene?.children[0]).toMatchObject({
      type: 'g',
      children: [],
    });
    expect(
      svg.svgScene?.children
        .slice(1)
        .map((shape) => (shape.type === 'circle' ? shape.cx : null)),
    ).toEqual([3, 1, 4]);
    expect(svg.svgSceneUpdates).toBe(2);
    await mounted.rerender(picture([], true));
    expect(svg.svgScene?.children).toHaveLength(1);
    expect(svg.svgSceneUpdates).toBe(3);
  });

  it('publishes one atomic scene for a dynamic React commit without replacing the UI root', async () => {
    const ref = createRef<UiNode>();
    function Status() {
      const [active, setActive] = useState(false);
      return (
        <View>
          <Svg
            ref={ref}
            width={24}
            height={24}
            viewBox="0 0 24 24"
            accessibilityRole="button"
            accessibilityLabel="Status"
            focusable
            onClick={() => setActive((value) => !value)}
          >
            <Marker color={active ? '#22c55e' : '#6b7280'} />
            <Path
              d="M6 12L10 16L18 8"
              stroke={active ? 'white' : 'black'}
              fill="none"
            />
          </Svg>
        </View>
      );
    }
    await mount(<Status />);
    const svg = ref.current as unknown as TestNode;
    const spy = vi.spyOn(svg, 'setSvgScene');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Status' })),
    );
    expect(ref.current).toBe(svg);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(svg.svgScene?.children[0]).toMatchObject({
      presentation: { fill: '#22c55e' },
    });
    expect(svg.svgScene?.children[1]).toMatchObject({
      presentation: { stroke: 'white' },
    });
    expect(svg.children).toEqual([]);
  });

  it('does not republish scenes for layout, event, accessibility or unrelated React changes', async () => {
    const picture = (tick: number) => (
      <View>
        <Text>{tick}</Text>
        <Svg
          width={24}
          height={24}
          viewBox="0 0 24 24"
          style={{ width: tick ? 48 : 24 }}
          accessibilityLabel={String(tick)}
          onClick={() => {}}
        >
          <G transform={[1, 0, 0, 1, 0, 0]} strokeDasharray={[2, 3]}>
            <Marker color="red" />
          </G>
        </Svg>
      </View>
    );
    const mounted = await mount(picture(0));
    const svg = root.children[0]!.children[1] as unknown as TestNode;
    const spy = vi.spyOn(svg, 'setSvgScene');
    await mounted.rerender(picture(1));
    expect(svg.style.width).toBe(48);
    expect(spy).not.toHaveBeenCalled();
    expect(svg.svgSceneUpdates).toBe(1);
  });

  it('lets root styles override width/height props and keeps viewBox in SVG coordinates', async () => {
    const mounted = await mount(
      <Svg
        width={24}
        height={24}
        style={[{ width: 40 }, { height: '50%' }]}
        viewBox={[10, 20, 24, 24]}
      >
        <Rect width={24} height={24} />
      </Svg>,
    );
    expect(node().style).toMatchObject({ width: 40, height: '50%' });
    expect(node().svgScene?.viewBox).toEqual([10, 20, 24, 24]);
    await mounted.rerender(
      <Svg width={48} height={32} viewBox="10 20 24 24">
        <Rect width={24} height={24} />
      </Svg>,
    );
    expect(node().style).toMatchObject({ width: 48, height: 32 });
    expect(node().svgSceneUpdates).toBe(1);
  });

  it('shares FocusScope, bubbles root events and clears scenes and refs on unmount', async () => {
    const ref = vi.fn<(value: UiNode | null) => void>();
    const clicked = vi.fn<() => void>();
    const mounted = await mount(
      <FocusScope trapped autoFocus>
        <View onClick={clicked}>
          <Svg
            ref={ref}
            width={24}
            height={24}
            focusable
            accessibilityRole="button"
            accessibilityLabel="Vector control"
          >
            <Circle r={5} />
          </Svg>
        </View>
      </FocusScope>,
    );
    const svg = screen.getByRole('button', {
      name: 'Vector control',
    }) as unknown as TestNode;
    expect(ref).toHaveBeenLastCalledWith(svg);
    expect(getTestRuntime().focusedNode()).toBe(svg);
    await userEvent.setup().tab();
    expect(getTestRuntime().focusedNode()).toBe(svg);
    await act(async () => fireEvent.click(svg));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(svg.svgScene).not.toBe(null);
    await mounted.unmount();
    expect(ref.mock.calls.at(-1)?.[0]).toBe(null);
    expect(svg.svgScene).toBe(null);
    expect(svg.isConnected).toBe(false);
    expect(root.children).toHaveLength(0);
  });

  it('rejects malformed public geometry and recovers without installing a partial scene', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reported = vi.fn();
    vi.stubGlobal('reportError', reported);
    const app = createRoot(root);
    try {
      for (const invalid of [
        <Polyline points={'1'.repeat(50000) + 'x'} />,
        <Polygon points="0 0 1px 2" />,
        <Circle r={Infinity} />,
      ]) {
        flushSync(() => app.render(<Svg>{invalid}</Svg>));
        expect(reported.mock.calls.at(-1)?.[0]).toBeInstanceOf(TypeError);
        expect(root.children).toHaveLength(0);
      }
      expect(reported).toHaveBeenCalledTimes(3);
      flushSync(() =>
        app.render(
          <Svg>
            <Marker color="blue" />
          </Svg>,
        ),
      );
      expect(node().svgScene?.children).toMatchObject([
        { type: 'circle', presentation: { fill: 'blue' } },
      ]);
    } finally {
      flushSync(() => app.unmount());
      vi.unstubAllGlobals();
      errors.mockRestore();
    }
  });

  it('keeps separate SVG roots independent when only one changes', async () => {
    const picture = (color: string) => (
      <View>
        <Svg>
          <Path d="M0 0h1v1z" fill={color} />
        </Svg>
        <Svg>
          <Marker color="blue" />
        </Svg>
      </View>
    );
    const mounted = await mount(picture('red'));
    const [left, right] = root.children[0]!.children as unknown as TestNode[];
    const a = vi.spyOn(left!, 'setSvgScene'),
      b = vi.spyOn(right!, 'setSvgScene');
    await mounted.rerender(picture('green'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});
