import { Animated, Pressable, Text, View } from '@soundor/react';
import { useState } from 'react';

// A spring follows the press; a looping paint animation runs on its own.
export default function Spring() {
  const [pressed, setPressed] = useState(false);

  return (
    <View style={{ alignItems: 'center', gap: 20 }}>
      <Pressable
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
      >
        <Animated.View
          style={{
            transform: [{ scale: pressed ? 0.9 : 1 }],
            paddingVertical: 14,
            paddingHorizontal: 24,
            borderRadius: 12,
            backgroundColor: '#3a7bfd',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 12, mass: 1 }}
        >
          <Text style={{ color: 'white', fontSize: 16 }}>Press and hold</Text>
        </Animated.View>
      </Pressable>
      <Animated.View
        style={{ width: 160, height: 12, borderRadius: 6 }}
        animation={[
          { backgroundColor: '#204080', offset: 0 },
          { backgroundColor: '#c08040', offset: 1 },
        ]}
        transition={{
          duration: 1000,
          iterations: Infinity,
          direction: 'alternate',
          fill: 'both',
        }}
      />
    </View>
  );
}
