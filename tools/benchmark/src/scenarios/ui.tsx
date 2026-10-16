// UI updates without canvases: React re-rendering a grid whose every cell
// changes each frame; soundor:ui nodes restyled directly, a property that
// only changes how a node looks (opacity) or one that moves things (height);
// and a UI that does not change at all, which should cost (almost) nothing.

import { flushSync, Text, View, type Style } from '@soundor/react';
import { useEffect, useRef, useState } from 'react';
import type { UiNode } from 'soundor:ui';

import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Scenario,
  type StageProps,
} from './types';

const PALETTE = Array.from(
  { length: 32 },
  (_, i) => `hsl(${i * 11}, 65%, 55%)`,
);

const grid: Style = {
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT,
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  alignContent: 'flex-start',
  gap: 2,
};

const CELL = 11;

/** React re-renders every cell each frame, with a new color and opacity. */
function ReactGridStage({ scenario, register }: StageProps) {
  const count = Number(scenario.id.slice('react-'.length));
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let frames = 0;
    // The update is flushed inside the frame, so the bench times React too.
    register(() => {
      frames++;
      flushSync(() => setFrame(frames));
    });
  }, [register]);

  const cells = [];
  for (let i = 0; i < count; i++) {
    cells.push(
      <View
        key={i}
        style={{
          width: CELL,
          height: CELL,
          backgroundColor: PALETTE[(i + frame) % PALETTE.length],
          opacity: 0.35 + 0.65 * ((Math.sin(i * 0.3 + frame * 0.1) + 1) / 2),
        }}
      />,
    );
  }
  return <View style={grid}>{cells}</View>;
}

const NODES = 500;

/**
 * soundor:ui nodes restyled directly, without React: `node.style.opacity`
 * (paint only) or `node.style.height` (layout too).
 */
function NodeStyleStage({ scenario, register }: StageProps) {
  const nodes = useRef<UiNode[]>([]);
  const layout = scenario.id === 'style-height';

  useEffect(() => {
    register((time) => {
      const list = nodes.current;
      for (let i = 0; i < list.length; i++) {
        const wave = (Math.sin(i * 0.3 + time * 6) + 1) / 2;
        if (layout) list[i]!.style.height = 3 + Math.round(wave * 8);
        else list[i]!.style.opacity = 0.35 + 0.65 * wave;
      }
    });
  }, [register, layout]);

  const cells = [];
  for (let i = 0; i < NODES; i++) {
    cells.push(
      <View
        key={i}
        ref={(node) => {
          if (node) nodes.current[i] = node;
        }}
        style={{
          width: CELL,
          height: CELL,
          backgroundColor: PALETTE[i % PALETTE.length],
        }}
      />,
    );
  }
  return <View style={grid}>{cells}</View>;
}

/** Nothing changes: frames should find nothing to do. */
function StaticStage({ register }: StageProps) {
  useEffect(() => register(() => {}), [register]);
  const cells = [];
  for (let i = 0; i < 300; i++) {
    cells.push(
      <View
        key={i}
        style={{
          width: 2 * CELL,
          height: CELL,
          borderRadius: 3,
          backgroundColor: PALETTE[i % PALETTE.length],
        }}
      />,
    );
  }
  for (let i = 0; i < 30; i++) {
    cells.push(
      <Text key={`label-${i}`} style={{ color: '#a8adb8', fontSize: 11 }}>
        {`Label ${i}`}
      </Text>,
    );
  }
  return <View style={grid}>{cells}</View>;
}

function ui(
  id: string,
  label: string,
  stresses: string,
  Stage: Scenario['Stage'],
): Scenario {
  return { id, group: 'ui', label, stresses, Stage };
}

export const UI_SCENARIOS: readonly Scenario[] = [
  ui(
    'react-100',
    'React 100',
    '100 cells re-rendered per frame',
    ReactGridStage,
  ),
  ui(
    'react-500',
    'React 500',
    '500 cells re-rendered per frame',
    ReactGridStage,
  ),
  ui(
    'react-1000',
    'React 1,000',
    '1,000 cells re-rendered per frame',
    ReactGridStage,
  ),
  ui(
    'style-opacity',
    'Style: opacity',
    `${NODES} nodes' opacity set per frame (paint only)`,
    NodeStyleStage,
  ),
  ui(
    'style-height',
    'Style: height',
    `${NODES} nodes' height set per frame (layout)`,
    NodeStyleStage,
  ),
  ui('static', 'Static', '330 nodes, nothing changes', StaticStage),
];
