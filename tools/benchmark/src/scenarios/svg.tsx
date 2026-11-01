import { Canvas, Image, View, flushSync } from '@soundor/react';
import { Svg, Circle, Path } from '@soundor/react/svg';
import { useEffect, useRef, useState } from 'react';
import type { UiNode } from 'soundor:ui';

import reference from '../fixtures/svg-document.svg';
import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  type Scenario,
  type StageProps,
} from './types';

const CHECK = 'M6 12L10 16L18 8';
const OTHER = 'M6 8L10 16L18 12';
let retainedLargePath: string | undefined;
function largePath(): string {
  return (retainedLargePath ??= Array.from(
    { length: 5000 },
    (_, index) =>
      `${index ? 'L' : 'M'}${((index * 640) / 4999).toFixed(2)} ${(180 + 100 * Math.sin(index * 0.013)).toFixed(2)}`,
  ).join(''));
}
declare global {
  var soundorRunUiScale: number | undefined;
}

function IconStage({ scenario, register }: StageProps) {
  const count = Number(scenario.id.split('-').at(-1));
  const dynamic =
    scenario.id.startsWith('svg-color') || scenario.id.startsWith('svg-path');
  const path = scenario.id.startsWith('svg-path');
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    let current = 0;
    register(() => {
      if (dynamic) flushSync(() => setFrame(++current));
    });
  }, [register, dynamic]);
  return (
    <View style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}>
      {Array.from({ length: count }, (_, index) => (
        <Svg
          key={index}
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          color={path || frame % 2 === 0 ? '#38bdf8' : '#22c55e'}
          style={{
            position: 'absolute',
            left: (index % 32) * 20,
            top: Math.floor(index / 32) * 20,
          }}
        >
          <Circle cx={12} cy={12} r={10} />
          <Path
            d={path && frame % 2 ? OTHER : CHECK}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ))}
    </View>
  );
}
function LargeStage({ register }: StageProps) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    let current = 0;
    register(() => flushSync(() => setFrame(++current)));
  }, [register]);
  return (
    <Svg
      width={STAGE_WIDTH}
      height={STAGE_HEIGHT}
      viewBox="0 0 640 360"
      fill="none"
      stroke={frame % 2 ? '#38bdf8' : '#22c55e'}
      strokeWidth={1}
    >
      <Path d={largePath()} />
    </Svg>
  );
}
function CanvasStage({ scenario, register }: StageProps) {
  const ref = useRef<UiNode | null>(null),
    large = scenario.id.includes('large');
  useEffect(() => {
    const context = ref.current!.getContext('2d')!;
    context.lineWidth = large ? 1 : 1.125;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    // Canvas retains its current path across strokes and clearRect calls.
    // Build the same geometry once, rather than rebuilding it per frame.
    context.beginPath();
    if (large) {
      for (let index = 0; index < 5000; index++) {
        const x = Number(((index * 640) / 4999).toFixed(2));
        const y = Number((180 + 100 * Math.sin(index * 0.013)).toFixed(2));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
    } else
      for (let index = 0; index < 100; index++) {
        const x = (index % 32) * 20,
          y = Math.floor(index / 32) * 20;
        context.moveTo(x + 16.5, y + 9);
        context.arc(x + 9, y + 9, 7.5, 0, Math.PI * 2);
        context.moveTo(x + 4.5, y + 9);
        context.lineTo(x + 7.5, y + 12);
        context.lineTo(x + 13.5, y + 6);
      }
    let frame = 0;
    register(() => {
      context.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      context.strokeStyle = ++frame % 2 ? '#38bdf8' : '#22c55e';
      context.stroke();
    });
  }, [register, large]);
  return <Canvas ref={ref} width={STAGE_WIDTH} height={STAGE_HEIGHT} />;
}
function UnrelatedStage({ register }: StageProps) {
  const moving = useRef<UiNode | null>(null);
  useEffect(() => {
    let frame = 0;
    register(() => {
      moving.current!.style.opacity = ++frame % 2 ? 0.5 : 1;
    });
  }, [register]);
  // The changed region does not intersect the static vector roots.
  return (
    <View style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}>
      {Array.from({ length: 100 }, (_, index) => (
        <Svg
          key={index}
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          style={{
            position: 'absolute',
            left: (index % 32) * 20,
            top: Math.floor(index / 32) * 20,
          }}
        >
          <Path d={CHECK} />
        </Svg>
      ))}
      <View
        ref={moving}
        style={{
          position: 'absolute',
          left: 600,
          top: 340,
          width: 20,
          height: 20,
          backgroundColor: 'white',
        }}
      />
    </View>
  );
}
function ScaleStage({ register }: StageProps) {
  useEffect(() => {
    let frame = 0;
    register(() => {
      globalThis.soundorRunUiScale = [0.5, 1, 1.5, 2][frame++ % 4];
    });
    return () => {
      globalThis.soundorRunUiScale = undefined;
    };
  }, [register]);
  return (
    <Svg
      width={100}
      height={100}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
    >
      <Circle cx={12} cy={12} r={10} />
      <Path d={CHECK} />
    </Svg>
  );
}
function ImageStage({ register }: StageProps) {
  const ref = useRef<UiNode | null>(null);
  useEffect(() => {
    let frame = 0;
    register(() => {
      ref.current!.style.opacity = ++frame % 2 ? 0.75 : 1;
    });
  }, [register]);
  return (
    <Image
      ref={ref}
      source={reference}
      style={{ width: 300, height: 300, resizeMode: 'contain' }}
    />
  );
}
export const SVG_SCENARIOS: readonly Scenario[] = [
  ...[1, 100, 500].map((count) => ({
    id: `svg-static-${count}`,
    group: 'svg' as const,
    label: `${count} static SVG icons`,
    stresses: 'Retained scenes at rest; no updates or rasterization',
    Stage: IconStage,
  })),
  ...[1, 100, 500].map((count) => ({
    id: `svg-color-${count}`,
    group: 'svg' as const,
    label: `${count} SVG paint updates`,
    stresses: 'One atomic snapshot per root; unchanged path geometry',
    Stage: IconStage,
  })),
  {
    id: 'svg-path-100',
    group: 'svg',
    label: '100 SVG path updates',
    stresses: 'Changed path shared across 100 roots',
    Stage: IconStage,
  },
  {
    id: 'svg-large-color',
    group: 'svg',
    label: '5,000-point SVG paint update',
    stresses: 'Large retained geometry and complete paint snapshots',
    Stage: LargeStage,
  },
  {
    id: 'svg-canvas-color-100',
    group: 'svg',
    label: 'Canvas control: 100 icons',
    stresses: 'Cached current path, explicit full-canvas redraw',
    Stage: CanvasStage,
  },
  {
    id: 'svg-canvas-large',
    group: 'svg',
    label: 'Canvas control: large vector',
    stresses: 'Cached current path, paint-only change and full-canvas redraw',
    Stage: CanvasStage,
  },
  {
    id: 'svg-static-unrelated',
    group: 'svg',
    label: '100 SVGs with unrelated damage',
    stresses: 'No SVG serialization, parsing or drawing outside damage',
    Stage: UnrelatedStage,
  },
  {
    id: 'svg-editor-scale',
    group: 'svg',
    label: 'Editor presentation scale changes',
    stresses: 'Host render scale 0.5/1/1.5/2; logical geometry unchanged',
    Stage: ScaleStage,
  },
  {
    id: 'svg-image',
    group: 'svg',
    label: 'Cached SVG Image repaint',
    stresses: 'Reuse a parsed SVG document on opacity updates',
    Stage: ImageStage,
  },
];
