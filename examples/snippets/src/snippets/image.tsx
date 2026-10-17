import { Image, Text, View } from '@soundor/react';

import cover from '../assets/cover.png';

const MODES = ['cover', 'contain', 'stretch', 'center'] as const;

// A bundled image (480 × 300 pixels) in square boxes: resizeMode says how
// it fills a box of another shape.
export default function ResizeModes() {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {MODES.map((mode) => (
        <View key={mode} style={{ alignItems: 'center', gap: 6 }}>
          <Image
            source={cover}
            accessibilityLabel={`A waveform, ${mode}`}
            style={{
              width: 96,
              height: 96,
              borderRadius: 8,
              backgroundColor: '#24262c',
              resizeMode: mode,
            }}
          />
          <Text style={{ color: '#8b8f98', fontSize: 12 }}>{mode}</Text>
        </View>
      ))}
    </View>
  );
}
