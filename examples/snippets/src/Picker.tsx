// What `soundor dev web` shows: every snippet, one at a time.
import { Pressable, ScrollView, Text, View } from '@soundor/react';
import { useState } from 'react';

import { Frame } from './frame';
import { snippets } from './snippets';

export function Picker() {
  const names = Object.keys(snippets);
  const [chosen, setChosen] = useState(names[0]!);
  const Snippet = snippets[chosen]!;

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <ScrollView
        style={{ width: 160, backgroundColor: '#1d1f24' }}
        contentContainerStyle={{ padding: 8, gap: 2 }}
      >
        {names.map((name) => (
          <Pressable
            key={name}
            onPress={() => setChosen(name)}
            accessibilityState={{ selected: name === chosen }}
            style={({ hovered }) => ({
              padding: 8,
              borderRadius: 6,
              backgroundColor:
                name === chosen
                  ? '#3a7bfd33'
                  : hovered
                    ? '#ffffff14'
                    : 'transparent',
            })}
          >
            <Text style={{ color: name === chosen ? '#8fb3ff' : '#e6e7ea' }}>
              {name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Frame>
        <Snippet key={chosen} />
      </Frame>
    </View>
  );
}
