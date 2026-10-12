import { View } from '@soundor/react';
import { useEffect, useRef } from 'react';
import {
  animate,
  effect,
  parallel,
  sequence,
  type UiAnimation,
  type UiNode,
} from 'soundor:ui';

import {
  sampleSpring,
  springDuration,
  springParameters,
} from '../../../../runtimes/web-runtime/src/client/ui/spring';
import { ANIMATION_STEP, animationValue } from './animation-workload';
import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  type Scenario,
  type StageProps,
} from './types';

const physics = {
  stiffness: 300,
  damping: 25,
  mass: 1,
  restDisplacement: 0.001,
  restVelocity: 0.001,
};
const parameters = springParameters(physics);
const springMs = springDuration(parameters, 0.25, 1, 0);

function AdvancedStage({ scenario, register }: StageProps) {
  const nodes = useRef<UiNode[]>([]);
  const [, kind, countText] = scenario.id.split(':');
  const count = Number(countText);
  useEffect(() => {
    const handles: UiAnimation[] = [];
    const tracks = nodes.current.map(() => ({
      position: 0.25,
      velocity: 0,
      origin: 0.25,
      target: 1,
      started: 0,
    }));
    let started = false,
      previousRetarget = -1;
    const native = scenario.nativeAnimations;
    const create = () => {
      if (kind === 'parallel') {
        handles.push(
          animate(
            parallel(
              nodes.current.flatMap((node) => [
                effect(node, [{ opacity: 0.25 }, { opacity: 1 }], {
                  duration: 1000,
                  iterations: Infinity,
                  direction: 'alternate',
                }),
                effect(
                  node,
                  [
                    { transform: [{ translateY: 0 }] },
                    { transform: [{ translateY: 12 }] },
                  ],
                  {
                    duration: 1000,
                    iterations: Infinity,
                    direction: 'alternate',
                  },
                ),
              ]),
              { fill: 'forwards' },
            ),
          ),
        );
        return;
      }
      for (const node of nodes.current) {
        if (kind === 'spring')
          handles.push(
            node.animate([{ opacity: 0.25 }, { opacity: 1 }], {
              type: 'spring',
              ...physics,
              iterations: Infinity,
              direction: 'alternate',
              fill: 'forwards',
            }),
          );
        else if (kind === 'sequence')
          handles.push(
            node.animate(
              sequence(
                Array.from({ length: 1000 }, (_, i) => ({
                  keyframes: [{ opacity: i % 2 === 0 ? 1 : 0.25 }],
                  options: { duration: 20 },
                })),
                { iterations: Infinity, fill: 'forwards' },
              ),
            ),
          );
        else if (kind === 'repeat')
          handles.push(
            node.animate([{ opacity: 0.25 }, { opacity: 1 }], {
              duration: 1000,
              iterations: Infinity,
              direction: 'alternate',
              fill: 'forwards',
            }),
          );
        else if (kind === 'keyframes')
          handles.push(
            node.animate(
              [
                { opacity: 0.25, offset: 0 },
                { opacity: 1, offset: 0.3 },
                { opacity: 0.5, offset: 0.7 },
                { opacity: 0.25, offset: 1 },
              ],
              { duration: 1000, iterations: Infinity, fill: 'forwards' },
            ),
          );
        else if (kind === 'paint')
          handles.push(
            node.animate(
              [{ backgroundColor: '#204080' }, { backgroundColor: '#c08040' }],
              {
                duration: 1000,
                iterations: Infinity,
                direction: 'alternate',
                fill: 'forwards',
              },
            ),
          );
      }
    };
    register((time) => {
      if (!started) {
        started = true;
        if (native) create();
      }
      if (kind === 'retarget') {
        const phase = Math.floor((time + 1e-9) / 0.4);
        if (phase !== previousRetarget) {
          nodes.current.forEach((node, index) => {
            const track = tracks[index]!;
            const sampled = sampleSpring(
              parameters,
              time - track.started,
              track.origin,
              track.target,
              track.velocity,
            );
            track.origin = Math.min(1, Math.max(0, sampled.position));
            track.velocity = sampled.velocity;
            track.started = time;
            track.target = phase % 2 === 0 ? 1 : 0.25;
            if (native) {
              handles[index] = node.animate([{ opacity: track.target }], {
                type: 'spring',
                ...physics,
                fill: 'forwards',
              });
            }
          });
          previousRetarget = phase;
        }
        if (native) return;
        nodes.current.forEach((node, index) => {
          const track = tracks[index]!;
          node.style.opacity = sampleSpring(
            parameters,
            time - track.started,
            track.origin,
            track.target,
            track.velocity,
          ).position;
        });
        return;
      }
      if (native) return;
      nodes.current.forEach((node) => {
        const value = animationValue(time, 0);
        if (kind === 'spring') {
          const phase = ((time * 1000) / springMs) % 2;
          node.style.opacity = sampleSpring(
            parameters,
            ((phase <= 1 ? phase : 2 - phase) * springMs) / 1000,
            0.25,
            1,
            0,
          ).position;
        } else if (kind === 'paint') {
          const channel = (a: number, b: number) =>
            Math.round(a + (b - a) * value)
              .toString(16)
              .padStart(2, '0');
          node.style.backgroundColor = `#${channel(32, 192)}${channel(64, 128)}${channel(128, 64)}`;
        } else if (kind === 'keyframes') {
          const phase = time % 1;
          node.style.opacity =
            phase < 0.3
              ? 0.25 + (0.75 * phase) / 0.3
              : phase < 0.7
                ? 1 - (0.5 * (phase - 0.3)) / 0.4
                : 0.5 - (0.25 * (phase - 0.7)) / 0.3;
        } else if (kind === 'sequence') {
          const phase = (time / 0.02) % 2;
          node.style.opacity = 0.25 + 0.75 * (phase <= 1 ? phase : 2 - phase);
        } else {
          node.style.opacity = 0.25 + 0.75 * value;
          if (kind === 'parallel')
            node.style.transform = [{ translateY: value * 12 }];
        }
      });
    });
    return () => handles.forEach((handle) => handle.cancel());
  }, [register, scenario.nativeAnimations, kind]);
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
            backgroundColor: kind === 'paint' ? '#204080' : '#3b82f6',
            opacity: kind === 'paint' ? 1 : 0.25,
            ...(kind === 'parallel' ? { transform: [{ translateY: 0 }] } : {}),
          }}
        />
      ))}
    </View>
  );
}

export const ADVANCED_ANIMATION_SCENARIOS: readonly Scenario[] = [
  ...['spring', 'retarget', 'parallel', 'repeat', 'keyframes', 'paint'].flatMap(
    (kind) =>
      [50, 500].map((count): Scenario => ({
        id: `advanced:${kind}:${count}`,
        group: 'advanced-animation',
        label: `${kind} × ${count}`,
        stresses:
          'Fixed-step, identical JS/native presentation and node count; no DSP',
        Stage: AdvancedStage,
        stepSeconds: ANIMATION_STEP,
      })),
  ),
  ...[1, 50].map((count): Scenario => ({
    id: `advanced:sequence:${count}`,
    group: 'advanced-animation',
    label: `1000-phase sequence × ${count}`,
    stresses:
      'Native phase progression; identical JS triangle curve, 20ms phases',
    Stage: AdvancedStage,
    stepSeconds: ANIMATION_STEP,
  })),
];
