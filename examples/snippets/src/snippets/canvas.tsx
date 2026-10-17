import { Canvas, useAnimationFrame, useParameter } from '@soundor/react';
import { useRef } from 'react';
import { parameters } from 'soundor:parameters';
import type { UiNode } from 'soundor:ui';

const WIDTH = 320;
const HEIGHT = 120;

// A canvas drawn every frame: a wave as tall as the gain parameter.
export default function Wave() {
  const canvas = useRef<UiNode>(null);
  const gain = useParameter(parameters.gain);

  useAnimationFrame((time) => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.fillStyle = '#17181c';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.strokeStyle = '#3a7bfd';
    context.lineWidth = 2;
    context.beginPath();
    for (let x = 0; x <= WIDTH; x += 2) {
      const phase = x / 24 - time / 300;
      const y = HEIGHT / 2 - Math.sin(phase) * gain * (HEIGHT / 2 - 4);
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  });

  return (
    <Canvas
      ref={canvas}
      width={WIDTH}
      height={HEIGHT}
      style={{ borderRadius: 8 }}
    />
  );
}
