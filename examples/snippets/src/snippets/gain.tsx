import { Pressable, Text, View, useParameter } from '@soundor/react';
import { parameters } from 'soundor:parameters';

// A parameter's value, re-rendered whenever it changes: here, from the
// buttons; in a plugin, from host automation and presets too.
export default function Gain() {
  const gain = useParameter(parameters.gain);
  const step = (by: number) => parameters.gain.set(gain + by);

  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <Text style={{ fontSize: 28, color: '#e6e7ea' }}>
        Gain {gain.toFixed(2)}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          { label: '−', onPress: () => step(-0.1) },
          { label: 'Reset', onPress: () => parameters.gain.set(0.5) },
          { label: '+', onPress: () => step(0.1) },
        ].map(({ label, onPress }) => (
          <Pressable
            key={label}
            onPress={onPress}
            style={({ pressed, hovered }) => ({
              minWidth: 44,
              alignItems: 'center',
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: 8,
              backgroundColor: pressed
                ? '#2a5fd0'
                : hovered
                  ? '#4f8bff'
                  : '#3a7bfd',
            })}
          >
            <Text style={{ color: 'white', fontSize: 15 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
