import { render, View } from '@soundor/react';

import { App } from './App';
import { ResizeGrip } from './ResizeGrip';

// The resize grip sits in the view's corner. The editor lays out again up
// to its maximum and is centred beyond it (fit: 'contain'), so in a window
// a host makes larger still, the grip is the view's corner, not the
// window's; with fit: 'cover' (as Orbit) it would be the window's.
render(
  <View style={{ flex: 1 }}>
    <App />
    <ResizeGrip />
  </View>,
);
