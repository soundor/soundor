import { Pressable, Text, View } from '@soundor/react';
import { useState } from 'react';

// A Pressable's style and children can follow its state: pressed, hovered
// and focused (Tab to it, then Enter or Space). Hold it for a long press.
export default function PressableStates() {
  const [presses, setPresses] = useState(0);
  const [longPresses, setLongPresses] = useState(0);

  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <Pressable
        onPress={() => setPresses((count) => count + 1)}
        onLongPress={() => setLongPresses((count) => count + 1)}
        style={({ pressed, hovered, focused }) => ({
          width: 220,
          alignItems: 'center',
          padding: 16,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: focused ? '#8fb3ff' : 'transparent',
          backgroundColor: pressed
            ? '#2a5fd0'
            : hovered
              ? '#4f8bff'
              : '#3a7bfd',
          transform: [{ scale: pressed ? 0.97 : 1 }],
        })}
      >
        {({ pressed, hovered, focused }) => (
          <Text style={{ color: 'white', fontSize: 16 }}>
            {pressed ? 'Pressed' : hovered ? 'Hovered' : 'Press me'}
            {focused ? ' · focused' : ''}
          </Text>
        )}
      </Pressable>
      <Text style={{ color: '#8b8f98' }}>
        {presses} presses · {longPresses} long presses
      </Text>
    </View>
  );
}
