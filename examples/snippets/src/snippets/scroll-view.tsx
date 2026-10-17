import { Pressable, ScrollView, Text, View } from '@soundor/react';
import { useRef, useState } from 'react';
import type { UiNode } from 'soundor:ui';

const PRESETS = Array.from({ length: 24 }, (_, index) => `Preset ${index + 1}`);

// A ScrollView scrolls by wheel or trackpad, or from code with scrollTo().
export default function PresetList() {
  const list = useRef<UiNode>(null);
  const [chosen, setChosen] = useState(PRESETS[0]);

  return (
    <View style={{ width: 260, gap: 8 }}>
      <ScrollView
        ref={list}
        style={{ height: 150, borderRadius: 8, backgroundColor: '#24262c' }}
        contentContainerStyle={{ padding: 4 }}
      >
        {PRESETS.map((preset) => (
          <Pressable
            key={preset}
            onPress={() => setChosen(preset)}
            style={({ hovered }) => ({
              padding: 6,
              borderRadius: 4,
              backgroundColor:
                preset === chosen
                  ? '#3a7bfd'
                  : hovered
                    ? '#2a2c33'
                    : 'transparent',
            })}
          >
            <Text style={{ color: '#e6e7ea' }}>{preset}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        onPress={() => list.current?.scrollTo({ top: 0 })}
        style={{
          alignSelf: 'flex-start',
          padding: 6,
          borderRadius: 6,
          backgroundColor: '#2a2c33',
        }}
      >
        <Text style={{ color: '#e6e7ea' }}>Back to top</Text>
      </Pressable>
    </View>
  );
}
