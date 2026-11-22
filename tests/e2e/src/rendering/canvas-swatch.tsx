import { Canvas, useCanvasSize } from '@soundor/react';
import { useLayoutEffect, useRef } from 'react';
import type { UiNode } from 'soundor:ui';

import { swatch } from '../ui/theme';
import { swatchStyle } from './swatch-style';

/** Its whole buffer filled by the 2D context (Skia natively). */
export function CanvasSwatch() {
  const canvas = useRef<UiNode>(null);
  const size = useCanvasSize(canvas);
  useLayoutEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || size.width === 0) return;
    context.fillStyle = swatch.canvas;
    context.fillRect(0, 0, size.width, size.height);
  }, [size]);
  return (
    <Canvas
      ref={canvas}
      debugId="swatch.canvas"
      accessibilityLabel="2D canvas swatch"
      style={swatchStyle}
    />
  );
}
