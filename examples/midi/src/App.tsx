import { Pressable, Text, View } from '@soundor/react';
import { useState } from 'react';
import { playNote, stats as readStats } from 'soundor:native';

import { KeyboardMonitor } from './KeyboardMonitor';

export function App() {
  const [stats, setStats] = useState('Controller: no snapshot');
  return (
    <View style={{ flex: 1, backgroundColor: '#111d32', padding: 22, gap: 14 }}>
      <Text style={{ color: '#f2f5fb', fontSize: 24, fontWeight: 'bold' }}>
        MIDI Lab
      </Text>
      <Text style={{ color: '#a4b2ca', fontSize: 12 }}>
        Virtual piano · 16 Rust voices · MIDI monitor
      </Text>
      <KeyboardMonitor />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable
          accessibilityLabel="Controller note"
          onPressIn={() => playNote(60, true)}
          onPressOut={() => playNote(60, false)}
          style={{ padding: 8, backgroundColor: '#294c7c', borderRadius: 6 }}
        >
          <Text style={{ color: 'white' }}>Hold controller C</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const value = readStats();
            setStats(
              `Controller: ${value.events} events · ${value.resets} resets`,
            );
          }}
          style={{ padding: 8, backgroundColor: '#294c7c', borderRadius: 6 }}
        >
          <Text style={{ color: 'white' }}>Read controller monitor</Text>
        </Pressable>
      </View>
      <Text style={{ color: '#a4b2ca', fontSize: 12 }}>{stats}</Text>
    </View>
  );
}
