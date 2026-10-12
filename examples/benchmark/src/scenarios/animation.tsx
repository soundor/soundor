import { Canvas, flushSync, Text, View } from '@soundor/react';
import { useEffect, useRef, useState } from 'react';
import type { UiNode } from 'soundor:ui';

import {
  ANIMATION_COUNTS,
  ANIMATION_STEP,
  animationOpacity,
  animationValue,
} from './animation-workload';
import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Scenario,
  type StageProps,
} from './types';

function countOf(scenario: Scenario): number {
  return Number(scenario.id.split('-').at(-1));
}

function OpacityStage({ scenario, register }: StageProps) {
  const nodes = useRef<UiNode[]>([]);
  const count = countOf(scenario);
  useEffect(() => {
    register((time) => {
      nodes.current.forEach((node, i) => {
        node.style.opacity = animationOpacity(time, i);
      });
    });
  }, [register]);
  return (
    <View
      style={{
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 2,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          ref={(node) => {
            if (node) nodes.current[i] = node;
          }}
          style={{
            width: 18,
            height: 18,
            backgroundColor: '#3b82f6',
            opacity: animationOpacity(0, i),
          }}
        />
      ))}
    </View>
  );
}

/** Independent component state, flushed synchronously inside the measured update. */
function ReactCell({
  index,
  updates,
}: {
  index: number;
  updates: Map<number, (time: number) => void>;
}) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    updates.set(index, setTime);
    return () => {
      updates.delete(index);
    };
  }, [index, updates]);
  return (
    <View
      style={{
        width: 18,
        height: 18,
        backgroundColor: '#3b82f6',
        opacity: animationOpacity(time, index),
      }}
    />
  );
}

function ReactStage({ scenario, register }: StageProps) {
  const updates = useRef(new Map<number, (time: number) => void>());
  useEffect(() => {
    register((time) => {
      flushSync(() => updates.current.forEach((update) => update(time)));
    });
  }, [register]);
  return (
    <View
      style={{
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 2,
      }}
    >
      {Array.from({ length: countOf(scenario) }, (_, i) => (
        <ReactCell key={i} index={i} updates={updates.current} />
      ))}
    </View>
  );
}

/** Visual smoothing only: no parameters, audio processing or random input. */
function PluginStage({ scenario, register }: StageProps) {
  const count = countOf(scenario);
  const staticStage = scenario.id.startsWith('animation-static-');
  const mixed = scenario.id.startsWith('animation-mixed-');
  const canvas = useRef<UiNode>(null);
  const webgl = useRef<UiNode>(null);
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (mixed) {
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) throw new Error('animation mixed workload needs Canvas 2D');
      ctx.fillStyle = '#173040';
      ctx.fillRect(0, 0, 240, 64);
      ctx.strokeStyle = '#4fd1c5';
      ctx.beginPath();
      for (let i = 0; i < 240; i++) {
        const y = 32 + Math.sin(i * 0.15) * 24;
        if (i === 0) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
      }
      ctx.stroke();
      const gl = webgl.current?.getContext('webgl2');
      if (!gl) throw new Error('animation mixed workload needs WebGL 2');
      gl.clearColor(0.1, 0.2, 0.35, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    register((time) => {
      if (!staticStage) flushSync(() => setTime(time));
    });
  }, [register, staticStage, mixed]);
  return (
    <View
      style={{
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        gap: 8,
        backgroundColor: '#111317',
      }}
    >
      <Text style={{ fontSize: 14, color: '#ddd' }}>
        Soundor · visual smoothing · no DSP
      </Text>
      {mixed && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Canvas
            ref={canvas}
            width={240}
            height={64}
            style={{ width: 240, height: 64 }}
          />
          <Canvas
            ref={webgl}
            width={120}
            height={64}
            style={{ width: 120, height: 64 }}
          />
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {Array.from({ length: count }, (_, i) => {
          const value = animationValue(time, i);
          return (
            <View
              key={i}
              style={{
                width: 60,
                height: 90,
                padding: 4,
                gap: 3,
                backgroundColor: '#242832',
                opacity: animationOpacity(time, i),
              }}
            >
              <Text
                style={{ color: '#bbb', fontSize: 9 }}
              >{`Gain ${i + 1}`}</Text>
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: '#3b82f6',
                  backgroundColor: '#16191f',
                }}
              >
                <View
                  style={{
                    width: 3,
                    height: 5,
                    left: Math.round(value * 12),
                    backgroundColor: '#ddd',
                  }}
                />
              </View>
              <View style={{ height: 5, backgroundColor: '#16191f' }}>
                <View
                  style={{
                    width: `${value * 100}%`,
                    height: 5,
                    backgroundColor: '#4fd1c5',
                  }}
                />
              </View>
              <View
                style={{
                  height: 5,
                  width: `${value * 100}%`,
                  backgroundColor: '#22c55e',
                }}
              />
              <Text
                style={{ fontSize: 9, color: '#ddd' }}
              >{`${(-60 + value * 72).toFixed(1)} dB`}</Text>
            </View>
          );
        })}
      </View>
      <Text style={{ fontSize: 10, color: '#aaa' }}>
        Preset: deterministic baseline
      </Text>
    </View>
  );
}

function workload(
  kind: string,
  count: number,
  Stage: Scenario['Stage'],
): Scenario {
  return {
    id: `animation-${kind}-${count}`,
    group: 'animation',
    label: `${kind} × ${count}`,
    stresses:
      '1 s linear alternating visual ramps at a fixed 60 Hz simulation step',
    Stage,
    stepSeconds: ANIMATION_STEP,
  };
}

export const ANIMATION_SCENARIOS: readonly Scenario[] = [
  ...ANIMATION_COUNTS.map((count) => workload('opacity', count, OpacityStage)),
  ...ANIMATION_COUNTS.map((count) => workload('react', count, ReactStage)),
  ...[1, 20, 50].flatMap((count) => [
    workload('plugin', count, PluginStage),
    workload('static', count, PluginStage),
  ]),
  workload('mixed', 20, PluginStage),
];
