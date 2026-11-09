import { Pressable, Text, View, type Style } from '@soundor/react';
import { useState } from 'react';

const label: Style = { color: '#c9ccd4', fontSize: 12 };

// `boxShadow` lists shadows, the first on top: raised outside the box, or
// sunk into it with `inset`. They follow the corners and take no room.
export default function BoxShadows() {
  const [armed, setArmed] = useState(false);
  // A percentage, in steps of 20: each press raises it, past 100 back to 20.
  const [level, setLevel] = useState(60);

  return (
    <View
      style={{
        width: 340,
        padding: 20,
        gap: 20,
        borderRadius: 12,
        backgroundColor: '#2a2c33',
        // Raised: a soft shadow below, and a sharp one close to it.
        boxShadow: [
          { offsetY: 8, blur: 24, color: 'rgba(0, 0, 0, 0.45)' },
          { offsetY: 1, blur: 2, color: 'rgba(0, 0, 0, 0.4)' },
        ],
      }}
    >
      <View style={{ gap: 8 }}>
        <Text style={label}>Level {level}%</Text>
        {/* Sunk: inset shadows inside the track, light along its bottom. */}
        <Pressable
          accessibilityLabel="Level"
          onPress={() => setLevel(level >= 100 ? 20 : level + 20)}
          style={{
            height: 14,
            borderRadius: 7,
            overflow: 'hidden',
            backgroundColor: '#1b1c21',
            boxShadow: [
              { inset: true, offsetY: 2, blur: 4, color: 'rgba(0, 0, 0, 0.7)' },
              { inset: true, offsetY: -1, color: 'rgba(255, 255, 255, 0.06)' },
            ],
          }}
        >
          <View
            style={{
              width: `${level}%`,
              height: '100%',
              borderRadius: 7,
              backgroundColor: '#34c77b',
            }}
          />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        {/* A glow is a colored shadow with spread; pressing sinks the knob. */}
        <Pressable
          accessibilityLabel="Arm"
          accessibilityState={{ selected: armed }}
          onPress={() => setArmed(!armed)}
          style={({ pressed }) => ({
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: '#3a3d46',
            boxShadow: [
              ...(armed
                ? [{ spread: 3, blur: 12, color: 'rgba(58, 123, 253, 0.8)' }]
                : []),
              pressed
                ? {
                    inset: true,
                    offsetY: 2,
                    blur: 6,
                    color: 'rgba(0, 0, 0, 0.6)',
                  }
                : { offsetY: 4, blur: 8, color: 'rgba(0, 0, 0, 0.5)' },
            ],
          })}
        />
        <Text style={label}>{armed ? 'Armed' : 'Press to arm'}</Text>
      </View>
    </View>
  );
}
