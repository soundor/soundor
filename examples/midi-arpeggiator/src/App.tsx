import { Text, View } from '@soundor/react';

import { KeyboardMonitor } from './KeyboardMonitor';

export function App() {
  return (
    <View style={{ flex: 1, backgroundColor: '#111d32', padding: 22, gap: 14 }}>
      <Text style={{ color: '#f2f5fb', fontSize: 24, fontWeight: 'bold' }}>
        MIDI Arpeggiator
      </Text>
      <Text style={{ color: '#a4b2ca', fontSize: 12 }}>
        120 BPM sixteenths · Rust sample clock · MIDI output, no audio
      </Text>
      <KeyboardMonitor />
      <Text style={{ color: '#a4b2ca', fontSize: 12 }}>
        Hold a chord on a MIDI device or send overlapping virtual notes. Select
        a Web MIDI output explicitly, or route this plugin in your DAW.
      </Text>
    </View>
  );
}
