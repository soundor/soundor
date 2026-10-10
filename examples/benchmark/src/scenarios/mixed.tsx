// A plugin-like view with a bit of everything, all changing every frame:
// a value readout (text), 8 knobs drawn on canvases of their own, 2 level
// meters (layout), a waveform (Canvas 2D) and a small 3D view (Three.js).

import { Canvas, flushSync, Text, View } from '@soundor/react';
import { useEffect, useRef, useState } from 'react';
import type { UiNode } from 'soundor:ui';
import * as THREE from 'three';

import type { Scenario, StageProps } from './types';

const KNOBS = 8;
const KNOB = 48;
const WAVE_WIDTH = 360;
const WAVE_HEIGHT = 120;
const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 120;

function drawKnob(ctx: CanvasRenderingContext2D, value: number) {
  const middle = KNOB / 2;
  ctx.clearRect(0, 0, KNOB, KNOB);
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2a2d35';
  ctx.beginPath();
  ctx.arc(middle, middle, 18, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  ctx.strokeStyle = '#3b82f6';
  ctx.beginPath();
  ctx.arc(middle, middle, 18, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * value));
  ctx.stroke();
}

function MixedStage({ scenario, register }: StageProps) {
  const knobs = useRef<UiNode[]>([]);
  const wave = useRef<UiNode>(null);
  const view = useRef<UiNode>(null);
  const [state, setState] = useState({ gain: 0, left: 0, right: 0 });
  const scale = Math.max(1, Math.round(devicePixelRatio));

  useEffect(() => {
    const knobContexts = knobs.current.map((node) => node.getContext('2d')!);
    const waveContext = wave.current?.getContext('2d');
    const viewNode = view.current;
    if (
      !waveContext ||
      viewNode === null ||
      viewNode.getContext('webgl2') === null
    ) {
      return;
    }
    const renderer = new THREE.WebGLRenderer({
      canvas: viewNode as unknown as HTMLCanvasElement,
      antialias: true,
    });
    renderer.setPixelRatio(scale);
    renderer.setSize(VIEW_WIDTH, VIEW_HEIGHT, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15171c);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.6, 0.2, 128, 16),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4 }),
    );
    scene.add(knot);
    const camera = new THREE.PerspectiveCamera(
      50,
      VIEW_WIDTH / VIEW_HEIGHT,
      0.1,
      20,
    );
    camera.position.z = 3;

    register((time) => {
      // React: the readout and the meters.
      flushSync(() =>
        setState({
          gain: Math.sin(time) * 12,
          left: (Math.sin(time * 7) + 1) / 2,
          right: (Math.sin(time * 5 + 1) + 1) / 2,
        }),
      );
      // Canvas 2D: the knobs and the waveform.
      knobContexts.forEach((ctx, i) => {
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        drawKnob(ctx, (Math.sin(time * 2 + i) + 1) / 2);
      });
      waveContext.setTransform(scale, 0, 0, scale, 0, 0);
      waveContext.fillStyle = '#111317';
      waveContext.fillRect(0, 0, WAVE_WIDTH, WAVE_HEIGHT);
      waveContext.strokeStyle = '#4fd1c5';
      waveContext.lineWidth = 1.5;
      waveContext.beginPath();
      for (let i = 0; i < 2000; i++) {
        const x = (i / 1999) * WAVE_WIDTH;
        const y =
          WAVE_HEIGHT / 2 +
          Math.sin(i * 0.05 + time * 4) * Math.sin(i * 0.003 + time) * 45;
        if (i === 0) waveContext.moveTo(x, y);
        else waveContext.lineTo(x, y);
      }
      waveContext.stroke();
      // Three.js: the 3D view.
      knot.rotation.set(time * 0.7, time, 0);
      renderer.render(scene, camera);
    });
    return () => {
      knot.geometry.dispose();
      knot.material.dispose();
      renderer.dispose();
    };
  }, [register, scale]);

  const meter = (level: number) => (
    <View
      style={{
        width: 12,
        height: 120,
        justifyContent: 'flex-end',
        backgroundColor: '#1a1d23',
        borderRadius: 3,
      }}
    >
      <View
        style={{
          height: Math.round(level * 120),
          backgroundColor: level > 0.85 ? '#ef4444' : '#22c55e',
          borderRadius: 3,
        }}
      />
    </View>
  );

  return (
    <View style={{ width: 640, height: 360, gap: 12 }}>
      <Text style={{ color: '#f2f3f5', fontSize: 14 }}>
        {`Gain ${state.gain.toFixed(1)} dB`}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {Array.from({ length: KNOBS }, (_, i) => (
          <Canvas
            key={i}
            ref={(node) => {
              if (node) knobs.current[i] = node;
            }}
            width={KNOB * scale}
            height={KNOB * scale}
            style={{ width: KNOB, height: KNOB }}
            accessibilityLabel={`Knob ${i + 1}`}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
        <Canvas
          ref={wave}
          width={WAVE_WIDTH * scale}
          height={WAVE_HEIGHT * scale}
          style={{ width: WAVE_WIDTH, height: WAVE_HEIGHT, borderRadius: 6 }}
          accessibilityLabel="Waveform"
        />
        {meter(state.left)}
        {meter(state.right)}
        <Canvas
          ref={view}
          width={VIEW_WIDTH * scale}
          height={VIEW_HEIGHT * scale}
          style={{ width: VIEW_WIDTH, height: VIEW_HEIGHT, borderRadius: 6 }}
          accessibilityLabel={`The ${scenario.label} 3D view`}
        />
      </View>
    </View>
  );
}

export const MIXED_SCENARIOS: readonly Scenario[] = [
  {
    id: 'mixed',
    group: 'mixed',
    label: 'Mixed',
    stresses: 'text, 8 canvas knobs, meters, a waveform and a 3D view',
    Stage: MixedStage,
  },
];
