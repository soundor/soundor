// The plugin's UI: a React app, bundled by `soundor dev` / `soundor build` and
// run inside the plugin view by Soundor's runtime (no browser, no DOM).

import { Pressable, render, Text, useParameter, View } from '@soundor/react';
import { useRef } from 'react';
import { plugin } from 'soundor:host';
import { parameters } from 'soundor:parameters';
import type { PointerEvent } from 'soundor:ui';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function App() {
  const gain = useParameter(parameters.gain);
  const drag = useRef<{ x: number; value: number } | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: '#17181c', padding: 20, gap: 12 }}>
      <Text style={{ color: '#f2f3f5', fontSize: 20, fontWeight: 'bold' }}>
        {plugin.name}
      </Text>
      <Text style={{ color: '#8b8f98' }}>
        {parameters.gain.info.label}: {gain.toFixed(2)}
      </Text>
      <View
        style={{
          width: 240,
          height: 24,
          borderRadius: 6,
          backgroundColor: '#24262c',
        }}
        onPointerDown={(event: PointerEvent) => {
          drag.current = { x: event.clientX, value: gain };
          parameters.gain.beginGesture();
        }}
        onPointerMove={(event: PointerEvent) => {
          if (drag.current === null) return;
          const moved = (event.clientX - drag.current.x) / 240;
          parameters.gain.set(clamp(drag.current.value + moved));
        }}
        onPointerUp={() => {
          drag.current = null;
          parameters.gain.endGesture();
        }}
      >
        <View
          style={{
            width: `${gain * 100}%`,
            height: '100%',
            borderRadius: 6,
            backgroundColor: '#4c8dff',
          }}
        />
      </View>
      <Pressable
        onPress={() => parameters.gain.set(parameters.gain.info.default)}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 6,
          backgroundColor: pressed ? '#2a5fd0' : '#3a7bfd',
        })}
      >
        <Text style={{ color: 'white' }}>Reset</Text>
      </Pressable>
    </View>
  );
}

render(<App />);
