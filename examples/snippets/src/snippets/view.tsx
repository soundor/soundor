import { Pressable, Text, View } from '@soundor/react';
import { useState } from 'react';

const DIRECTIONS = ['column', 'row'] as const;
const JUSTIFY = ['flex-start', 'center', 'space-between'] as const;

// Views lay their children out with flexbox: a column by default, as in
// React Native. Change the direction and the spacing along it.
export default function Layout() {
  const [direction, setDirection] =
    useState<(typeof DIRECTIONS)[number]>('row');
  const [justify, setJustify] = useState<(typeof JUSTIFY)[number]>('center');

  return (
    <View style={{ gap: 12, alignItems: 'center' }}>
      <View
        style={{
          width: 300,
          height: 120,
          padding: 8,
          gap: 8,
          flexDirection: direction,
          justifyContent: justify,
          borderRadius: 8,
          backgroundColor: '#24262c',
        }}
      >
        {['#3a7bfd', '#34c77b', '#f2b13a'].map((color) => (
          <View
            key={color}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              backgroundColor: color,
            }}
          />
        ))}
      </View>
      {[DIRECTIONS, JUSTIFY].map((options, row) => (
        <View key={row} style={{ flexDirection: 'row', gap: 6 }}>
          {options.map((option) => {
            const selected = option === direction || option === justify;
            return (
              <Pressable
                key={option}
                accessibilityState={{ selected }}
                onPress={() =>
                  row === 0
                    ? setDirection(option as (typeof DIRECTIONS)[number])
                    : setJustify(option as (typeof JUSTIFY)[number])
                }
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderRadius: 6,
                  backgroundColor: selected ? '#3a7bfd' : '#2a2c33',
                }}
              >
                <Text style={{ color: 'white', fontSize: 12 }}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
