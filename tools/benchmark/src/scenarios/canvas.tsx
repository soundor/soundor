// Canvas 2D: a waveform (one path of many points per frame, as an
// oscilloscope or an audio editor draws), and a frame of everything a plugin
// UI draws by hand: rectangles, arcs, curves, text, gradients, clips and
// transforms, with state changes in between.

import { Canvas } from '@soundor/react';
import { useEffect, useRef } from 'react';
import type { UiNode } from 'soundor:ui';

import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Scenario,
  type StageProps,
} from './types';

type Draw = (ctx: CanvasRenderingContext2D, time: number) => void;

function waveform(points: number): Draw {
  return (ctx, time) => {
    ctx.fillStyle = '#111317';
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    ctx.strokeStyle = '#4fd1c5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const middle = STAGE_HEIGHT / 2;
    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * STAGE_WIDTH;
      const y =
        middle +
        Math.sin(i * 0.05 + time * 4) *
          Math.sin(i * 0.002 + time) *
          STAGE_HEIGHT *
          0.35;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
}

function complex(): Draw {
  let background: CanvasGradient | null = null;
  return (ctx, time) => {
    background ??= (() => {
      const gradient = ctx.createLinearGradient(0, 0, 0, STAGE_HEIGHT);
      gradient.addColorStop(0, '#1b1e25');
      gradient.addColorStop(1, '#0d0f13');
      return gradient;
    })();
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    // A spectrum: 96 bars, each its own color.
    for (let i = 0; i < 96; i++) {
      const level = 0.5 + 0.5 * Math.sin(i * 0.3 + time * 3);
      ctx.fillStyle = `hsl(${(i * 3.75) | 0}, 70%, ${(40 + level * 25) | 0}%)`;
      ctx.fillRect(16 + i * 4.5, 170 - level * 140, 3.5, level * 140);
    }

    // Knobs: a track, a value arc and a pointer, each rotated in place.
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const x = 470 + (i % 3) * 52;
      const y = 40 + Math.floor(i / 3) * 52;
      const value = 0.5 + 0.5 * Math.sin(time * 2 + i);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#2a2d35';
      ctx.beginPath();
      ctx.arc(x, y, 18, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();
      ctx.strokeStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(x, y, 18, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * value));
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI * (0.75 + 1.5 * value));
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(16, 0);
      ctx.stroke();
      ctx.restore();
    }

    // An envelope: curves with a filled area under them, clipped to a panel.
    ctx.save();
    ctx.beginPath();
    ctx.rect(16, 190, 420, 150);
    ctx.clip();
    for (let k = 0; k < 4; k++) {
      const shift = Math.sin(time + k) * 30;
      ctx.beginPath();
      ctx.moveTo(16, 330);
      ctx.bezierCurveTo(80 + shift, 200, 160, 210 + shift, 220, 260);
      ctx.quadraticCurveTo(300, 320 - shift, 436, 230);
      ctx.lineTo(436, 340);
      ctx.lineTo(16, 340);
      ctx.closePath();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = ['#f59e0b', '#10b981', '#8b5cf6', '#ef4444'][k]!;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    // Labels.
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#a8adb8';
    for (let i = 0; i < 24; i++) {
      ctx.fillText(
        `${(i * 1000 + ((time * 100) | 0)) % 20000} Hz`,
        460 + (i % 3) * 58,
        250 + Math.floor(i / 3) * 12,
      );
    }
  };
}

const DRAWS: Record<string, () => Draw> = {
  'waveform-1k': () => waveform(1000),
  'waveform-5k': () => waveform(5000),
  'waveform-10k': () => waveform(10_000),
  'canvas-complex': complex,
};

function CanvasStage({ scenario, register }: StageProps) {
  const canvas = useRef<UiNode>(null);
  const scale = Math.max(1, Math.round(devicePixelRatio));

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    const draw = DRAWS[scenario.id]?.();
    if (!ctx || !draw) return;
    register((time) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      draw(ctx, time);
    });
  }, [scenario, register, scale]);

  return (
    <Canvas
      ref={canvas}
      width={STAGE_WIDTH * scale}
      height={STAGE_HEIGHT * scale}
      style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, borderRadius: 8 }}
      accessibilityLabel={`The ${scenario.label} scenario`}
    />
  );
}

function canvas(id: string, label: string, stresses: string): Scenario {
  return { id, group: 'canvas', label, stresses, Stage: CanvasStage };
}

export const CANVAS_SCENARIOS: readonly Scenario[] = [
  canvas('waveform-1k', 'Waveform 1k', 'a path of 1,000 points per frame'),
  canvas('waveform-5k', 'Waveform 5k', 'a path of 5,000 points per frame'),
  canvas('waveform-10k', 'Waveform 10k', 'a path of 10,000 points per frame'),
  canvas(
    'canvas-complex',
    'Canvas complex',
    'bars, knobs, curves, clips, text and state changes',
  ),
];
