import { Animated, Pressable, Text, View } from '@soundor/react';
import { useState } from 'react';

// Animated.View animates its opacity and transform to each new style: the
// runtime runs the animation, and React renders only the endpoints.
export default function FadeIn() {
  const [visible, setVisible] = useState(true);

  return (
    <View style={{ alignItems: 'center', gap: 16 }}>
      <Pressable
        onPress={() => setVisible((shown) => !shown)}
        style={({ pressed }) => ({
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 6,
          backgroundColor: pressed ? '#2a5fd0' : '#3a7bfd',
        })}
      >
        <Text style={{ color: 'white' }}>{visible ? 'Hide' : 'Show'}</Text>
      </Pressable>
      <Animated.View
        style={{
          opacity: visible ? 1 : 0,
          transform: [
            { translateY: visible ? 0 : 12 },
            { scale: visible ? 1 : 0.95 },
          ],
          padding: 16,
          borderRadius: 10,
          backgroundColor: '#24262c',
        }}
        transition={{ duration: 250, easing: 'ease-out' }}
      >
        <Text style={{ color: '#e6e7ea' }}>Preset loaded</Text>
      </Animated.View>
    </View>
  );
}
