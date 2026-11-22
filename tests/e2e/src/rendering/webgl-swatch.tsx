import { Canvas, Text, View, useCanvasSize } from '@soundor/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { UiNode } from 'soundor:ui';

import { text } from '../ui/theme';
import { swatchStyle } from './swatch-style';

/**
 * Cleared to blue by a WebGL 2 context, and says whether it got one: where
 * there is no GPU the context is null, which the tests allow only there.
 */
export function WebglSwatch() {
  const canvas = useRef<UiNode>(null);
  const size = useCanvasSize(canvas);
  const [available, setAvailable] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const gl = canvas.current?.getContext('webgl2') ?? null;
    setAvailable(gl !== null);
    if (!gl || size.width === 0) return;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }, [size]);
  return (
    <View style={{ gap: 4 }}>
      <Canvas
        ref={canvas}
        debugId="swatch.webgl"
        accessibilityLabel="WebGL swatch"
        style={swatchStyle}
      />
      <Text debugId="webgl.status" style={text.muted}>
        {available === null ? '' : available ? 'WebGL 2' : 'No WebGL'}
      </Text>
    </View>
  );
}
