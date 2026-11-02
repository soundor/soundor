import { render, useViewSize, View } from '@soundor/react';

import { App } from './App';
import { ResizeGrip } from './ResizeGrip';

/**
 * Orbit's editor covers windows of another shape (`fit: 'cover'`): the view
 * spans the whole window, and the 800×600 Orbit is designed at, its safe
 * area, sits in the middle. Its background carries on around it, so a host
 * that ignores the aspect ratio shows a wider (or taller) Orbit, not bands.
 * Its resize grip is in the view's corner, outside the safe area: covering
 * the window, that is the window's corner, whatever its shape.
 */
function Covered() {
  const { safeArea } = useViewSize();
  return (
    <View style={{ flex: 1, backgroundColor: '#eaece4' }}>
      <View
        style={{
          position: 'absolute',
          left: safeArea.x,
          top: safeArea.y,
          width: safeArea.width,
          height: safeArea.height,
        }}
      >
        <App />
      </View>
      <ResizeGrip />
    </View>
  );
}

render(<Covered />);
