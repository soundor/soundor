// One production React bundle used by native and browser rendering tests.
import { createRoot, flushSync, Image, View } from '@soundor/react';
import {
  Svg,
  G,
  Circle,
  Rect,
  Path,
  Line,
  Ellipse,
  Polygon,
  Polyline,
} from '@soundor/react/svg';
import { Fragment } from 'react';
import type { UiNode } from 'soundor:ui';

import reference from './svg-reference.svg';

const app = createRoot();
let current: UiNode | null = null;
let retained: UiNode | null = null;
const ref = (node: UiNode | null) => {
  current = node;
  if (node) retained = node;
};
function Marker() {
  return <Circle cx={50} cy={50} r={40} fill="currentColor" />;
}
function Picture({ mode }: { mode: string }) {
  const active = mode === 'active',
    size = mode === 'small' ? 8 : 100;
  const order =
    mode === 'reorder' ? ['blue', 'green', 'red'] : ['red', 'green', 'blue'];
  return (
    <View style={{ width: 220, height: 110, backgroundColor: 'white' }}>
      {mode !== 'clear' && (
        <Svg
          ref={ref}
          width={size}
          height={size}
          viewBox="0 0 100 100"
          color={active ? 'blue' : 'red'}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            backgroundColor: 'white',
          }}
          accessibilityRole="button"
          accessibilityLabel="React vector probe"
          focusable
          onClick={() =>
            globalThis.soundorSvgProbe.run(active ? 'grow' : 'active')
          }
        >
          <Marker />
          <G
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            transform="translate(2 3)"
          >
            <Rect x={35} y={2} width={30} height={12} rx={4} />
            <Ellipse cx={15} cy={15} rx={8} ry={4} />
            <Line x1={5} y1={90} x2={25} y2={90} />
            <Polygon points="70,80 85,85 95,90" />
            <Polyline points={[70, 10, 80, 20, 90, 10]} />
            <Path d="M4 50A5 5 0 0114 50" />
          </G>
          <Path
            d={mode === 'path' ? 'M25 35L50 65L75 35' : 'M30 50L45 65L70 35'}
            stroke={active || mode === 'path' ? 'white' : 'none'}
            strokeWidth={3}
            fill="none"
          />
          {active && <Circle cx={50} cy={25} r={3} fill="white" />}
          {order.map((color) => (
            <Fragment key={color}>
              <Rect x={42} y={42} width={16} height={16} fill={color} />
            </Fragment>
          ))}
        </Svg>
      )}
      <Image
        source={reference}
        accessibilityLabel="SVG document probe"
        style={{
          position: 'absolute',
          left: 110,
          top: 0,
          width: size,
          height: size,
          resizeMode: 'contain',
        }}
      />
    </View>
  );
}
declare global {
  var soundorSvgProbe: {
    run(mode: string): {
      sameRoot: boolean;
      children: number;
      width: number;
      connected: boolean;
      unmounted: boolean;
    };
    test(mode: string): Promise<unknown>;
  };
}
globalThis.soundorSvgProbe = {
  test: testMode,
  run(mode) {
    const previous = retained;
    flushSync(() => app.render(<Picture mode={mode} />));
    if (!retained) throw new Error('Missing SVG ref');
    return {
      sameRoot: previous === retained,
      children: retained.children.length,
      width: current?.layout.width ?? 0,
      connected: retained.isConnected,
      unmounted: current === null,
    };
  },
};
globalThis.soundorSvgProbe.run('small');

function testMode(mode: string): Promise<unknown> {
  globalThis.soundorSvgProbe.run('grow');
  return new Promise((resolve) =>
    requestAnimationFrame(() => {
      globalThis.soundorRunUiPhase =
        mode === 'idle' ? 'svg-static' : 'svg-update';
      let count = 0;
      const next = () => {
        if (mode === 'idle' && ++count < 8) {
          requestAnimationFrame(next);
          return;
        }
        resolve(
          mode === 'idle'
            ? { idle: true }
            : globalThis.soundorSvgProbe.run(mode),
        );
      };
      requestAnimationFrame(next);
    }),
  );
}
